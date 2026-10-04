// Pruebas de seguridad contra un servidor real (en una carpeta de datos temporal).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { createHmac } from "node:crypto";

const AQUI = dirname(fileURLToPath(import.meta.url));
const datos = mkdtempSync(join(tmpdir(), "panel-seg-"));
let servidor, puerto, secreto;

function pedir({ metodo = "GET", ruta = "/", cabeceras = {}, cuerpo = null, host }) {
  return new Promise((ok, mal) => {
    const req = request({ host: "127.0.0.1", port: puerto, path: ruta, method: metodo, headers: { Host: host || `127.0.0.1:${puerto}`, ...cabeceras } }, (res) => {
      let d = ""; res.on("data", (x) => { d += x; }); res.on("end", () => ok({ codigo: res.statusCode, cabeceras: res.headers, cuerpo: d }));
    });
    req.on("error", mal);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}
function firmado(ruta, obj, { t0 = Date.now(), extra = {} } = {}) {
  const cuerpo = typeof obj === "string" ? obj : JSON.stringify(obj);
  const firma = createHmac("sha256", secreto).update(`${t0}.${cuerpo}`).digest("hex");
  return pedir({ metodo: "POST", ruta, cuerpo, cabeceras: { "Content-Type": "application/json", "X-Panel-T0": String(t0), "X-Panel-Firma": firma, ...extra } });
}

before(async () => {
  servidor = spawn(process.execPath, [join(AQUI, "..", "plugin", "servidor", "servidor.mjs")], { env: { ...process.env, PANEL_DATOS: datos }, stdio: "ignore" });
  for (let i = 0; i < 50 && !existsSync(join(datos, "estado", "servidor.json")); i++) await new Promise((r) => setTimeout(r, 100));
  puerto = JSON.parse(readFileSync(join(datos, "estado", "servidor.json"), "utf8")).puerto;
  secreto = readFileSync(join(datos, "estado", "secreto"), "utf8").trim();
});
after(() => { servidor.kill(); rmSync(datos, { recursive: true, force: true }); });

test("health responde sin datos", async () => { const r = await pedir({ ruta: "/health" }); assert.equal(r.codigo, 200); assert.match(r.cuerpo, /panel-agentes/); });
test("Host ajeno → 421 (rebinding de DNS)", async () => { assert.equal((await pedir({ ruta: "/health", host: "evil.example:80" })).codigo, 421); });
test("ingest sin firma → 401", async () => {
  const r = await pedir({ metodo: "POST", ruta: "/ingest", cuerpo: "{}", cabeceras: { "Content-Type": "application/json" } });
  assert.equal(r.codigo, 401);
});
test("ingest con firma válida → 204", async () => { assert.equal((await firmado("/ingest", { hook_event_name: "Stop", session_id: "x" })).codigo, 204); });
test("ingest con firma de otro secreto → 401", async () => {
  const cuerpo = JSON.stringify({ hook_event_name: "Stop", session_id: "y" }), t0 = Date.now();
  const firma = createHmac("sha256", "otro").update(`${t0}.${cuerpo}`).digest("hex");
  const r = await pedir({ metodo: "POST", ruta: "/ingest", cuerpo, cabeceras: { "Content-Type": "application/json", "X-Panel-T0": String(t0), "X-Panel-Firma": firma } });
  assert.equal(r.codigo, 401);
});
test("ingest con hora vieja (11 min) → 401", async () => { assert.equal((await firmado("/ingest", { hook_event_name: "Stop", session_id: "z" }, { t0: Date.now() - 11 * 60_000 })).codigo, 401); });
test("ingest desde un navegador (Origin) → 403", async () => { assert.equal((await firmado("/ingest", { a: 1 }, { extra: { Origin: "https://evil.example" } })).codigo, 403); });
test("ingest con Content-Type de formulario → 415", async () => {
  const r = await pedir({ metodo: "POST", ruta: "/ingest", cuerpo: "a=1", cabeceras: { "Content-Type": "text/plain" } });
  assert.equal(r.codigo, 415);
});
test("ingest demasiado grande → 413", async () => { assert.equal((await firmado("/ingest", { x: "a".repeat(300 * 1024) })).codigo, 413); });
test("la página sin cookie → 401 y sin datos", async () => {
  for (const ruta of ["/", "/events", "/api/snapshot", "/panel.js"]) {
    const r = await pedir({ ruta }); assert.equal(r.codigo, 401, ruta); assert.doesNotMatch(r.cuerpo, /agentes|session/);
  }
});
test("enlace de un solo uso: cookie HttpOnly + SameSite=Strict, y no se puede reutilizar", async () => {
  const { enlace } = JSON.parse((await firmado("/abrir", { imprimir: true })).cuerpo);
  const ruta = enlace.replace(/^http:\/\/127\.0\.0\.1:\d+/, "");
  const r = await pedir({ ruta });
  assert.equal(r.codigo, 302);
  const galleta = String(r.cabeceras["set-cookie"]);
  assert.match(galleta, /HttpOnly/); assert.match(galleta, /SameSite=Strict/);
  assert.equal((await pedir({ ruta })).codigo, 403, "reutilizar el enlace");
  const conCookie = galleta.split(";")[0];
  const pagina = await pedir({ ruta: "/", cabeceras: { Cookie: conCookie } });
  assert.equal(pagina.codigo, 200);
  const csp = pagina.cabeceras["content-security-policy"];
  assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /require-trusted-types-for 'script'/); assert.match(csp, /script-src 'self'/);
  assert.equal(pagina.cabeceras["cross-origin-resource-policy"], "same-origin");
  assert.equal(pagina.cabeceras["access-control-allow-origin"], undefined, "sin CORS");
  assert.equal((await pedir({ ruta: "/api/snapshot", cabeceras: { Cookie: conCookie, "Sec-Fetch-Site": "cross-site" } })).codigo, 403, "petición de otro sitio");
  assert.equal((await pedir({ ruta: "/api/snapshot", cabeceras: { Cookie: "panel_" + puerto + "=" + "0".repeat(48) } })).codigo, 401, "cookie falsa");
});
test("texto con <script> viaja como texto y la página nunca usa innerHTML", async () => {
  const js = readFileSync(join(AQUI, "..", "plugin", "web", "panel.js"), "utf8");
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
});
test("límite de eventos por segundo → 429", async () => {
  const rs = await Promise.all(Array.from({ length: 260 }, (_, i) => firmado("/ingest", { hook_event_name: "Stop", session_id: "r" + i })));
  assert.ok(rs.some((r) => r.codigo === 429));
});
