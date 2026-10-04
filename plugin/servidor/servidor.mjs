// Panel de Obra · servidor local. Solo escucha en 127.0.0.1. Sin dependencias.
// Recibe eventos firmados de los hooks, mantiene el estado en memoria y lo sirve a la página en vivo (SSE).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, existsSync, appendFileSync, statSync, renameSync } from "node:fs";
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PUERTOS, ARCHIVO_SERVIDOR, ARCHIVO_CANDADO, DIR_REGISTRO, LIMITES, asegurarCarpetas, leerOCrearSecreto } from "./config.mjs";
import { Panel } from "./episodios.mjs";
import { abrirNavegador } from "./navegador.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const ARCHIVOS = { "/": ["index.html", "text/html; charset=utf-8"], "/panel.css": ["panel.css", "text/css; charset=utf-8"], "/panel.js": ["panel.js", "text/javascript; charset=utf-8"] };
const SEGURIDAD = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin", "X-Frame-Options": "DENY", "Cache-Control": "no-store",
};

// ── registro de diagnóstico (sin contenido de eventos) ──────
const LOG = join(DIR_REGISTRO, "servidor.log");
function log(msg) {
  try {
    if (existsSync(LOG) && statSync(LOG).size > 1_000_000) renameSync(LOG, LOG + ".1");
    appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* sin registro */ }
}

// ── un solo servidor: candado ────────────────────────────────
asegurarCarpetas();
function vivo(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
function tomarCandado() {
  try { const fd = openSync(ARCHIVO_CANDADO, "wx"); writeFileSync(fd, String(process.pid)); closeSync(fd); return true; }
  catch {
    const pid = Number(readFileSync(ARCHIVO_CANDADO, "utf8")) || 0;
    if (pid && pid !== process.pid && vivo(pid)) return false;
    try { unlinkSync(ARCHIVO_CANDADO); } catch { /* otro lo quitó */ }
    try { const fd = openSync(ARCHIVO_CANDADO, "wx"); writeFileSync(fd, String(process.pid)); closeSync(fd); return true; } catch { return false; }
  }
}
if (!tomarCandado()) { log("ya hay un servidor vivo; salgo"); process.exit(0); }
const SECRETO = leerOCrearSecreto();
const COOKIE_VALOR = randomBytes(24).toString("hex");
let PUERTO = null;
const codigos = new Map(); // código de un solo uso → caduca
const clientes = new Set();
let ultimoEvento = Date.now();

const panel = new Panel({
  emitir: (msg) => { const s = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clientes) c.write(s); },
  abrir: () => abrirNavegador(enlaceNuevo()),
  hayPestana: () => clientes.size > 0,
});

function enlaceNuevo() {
  const c = randomBytes(18).toString("hex");
  codigos.set(c, Date.now() + 60_000);
  return `http://127.0.0.1:${PUERTO}/open?code=${c}`;
}

// ── validaciones ─────────────────────────────────────────────
const hostValido = (h) => h === `127.0.0.1:${PUERTO}` || h === `localhost:${PUERTO}`;
function cookieValida(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)panel_${PUERTO}=([a-f0-9]+)`));
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(COOKIE_VALOR);
  return a.length === b.length && timingSafeEqual(a, b);
}
function firmaValida(req, cuerpo) {
  const t0 = Number(req.headers["x-panel-t0"]), firma = String(req.headers["x-panel-firma"] || "");
  if (!t0 || Math.abs(Date.now() - t0) > 10 * 60_000) return null;
  const esperada = createHmac("sha256", SECRETO).update(`${t0}.${cuerpo}`).digest("hex");
  const a = Buffer.from(firma), b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b) ? t0 : null;
}
let ventana = { t: 0, n: 0 };
function limiteVelocidad() {
  const s = Math.floor(Date.now() / 1000);
  if (ventana.t !== s) ventana = { t: s, n: 0 };
  return ++ventana.n <= LIMITES.eventosPorSegundo;
}
const vistos = new Map(); // hash del cuerpo → hora (descarta duplicados)
function duplicado(cuerpo) {
  const h = createHash("sha256").update(cuerpo).digest("hex");
  if (vistos.has(h)) return true;
  vistos.set(h, Date.now()); if (vistos.size > 4000) vistos.delete(vistos.keys().next().value);
  return false;
}
function leerCuerpo(req) {
  return new Promise((ok, mal) => {
    let n = 0; const partes = [];
    let excedido = false;
    req.on("data", (d) => { if (excedido) return; n += d.length; if (n > LIMITES.cuerpoMax) { excedido = true; partes.length = 0; mal(new Error("grande")); } else partes.push(d); });
    req.on("end", () => ok(Buffer.concat(partes).toString("utf8")));
    req.on("error", mal);
  });
}
const responder = (res, codigo, cuerpo = "", extra = {}) => { res.writeHead(codigo, { ...SEGURIDAD, "Content-Type": "text/plain; charset=utf-8", ...extra }); res.end(cuerpo); };

// ── rutas ────────────────────────────────────────────────────
const servidor = createServer(async (req, res) => {
  try {
    if (!hostValido(req.headers.host || "")) return responder(res, 421, "Host no permitido");
    const url = new URL(req.url, `http://127.0.0.1:${PUERTO}`);
    const desdeNavegador = !!req.headers.origin || !!req.headers["sec-fetch-site"];

    if (url.pathname === "/health" && req.method === "GET") return responder(res, 200, JSON.stringify({ app: "panel-agentes", pid: process.pid }), { "Content-Type": "application/json" });

    if ((url.pathname === "/ingest" || url.pathname === "/abrir") && req.method === "POST") {
      if (desdeNavegador) return responder(res, 403, "no");
      if (!String(req.headers["content-type"] || "").startsWith("application/json")) return responder(res, 415, "json");
      if (!limiteVelocidad()) return responder(res, 429, "despacio");
      if (Number(req.headers["content-length"] || 0) > LIMITES.cuerpoMax) { responder(res, 413, "grande", { Connection: "close" }); req.resume(); return; }
      let cuerpo; try { cuerpo = await leerCuerpo(req); } catch { return responder(res, 413, "grande", { Connection: "close" }); }
      const t0 = firmaValida(req, cuerpo); if (!t0) return responder(res, 401, "firma");
      if (url.pathname === "/abrir") {
        let pedido = {}; try { pedido = JSON.parse(cuerpo); } catch { /* vacío */ }
        const enlace = enlaceNuevo();
        if (!pedido.imprimir) abrirNavegador(enlace);
        return responder(res, 200, JSON.stringify({ ok: true, ...(pedido.imprimir ? { enlace } : {}) }), { "Content-Type": "application/json" });
      }
      if (duplicado(cuerpo)) return responder(res, 200, "dup");
      let ev; try { ev = JSON.parse(cuerpo); } catch { return responder(res, 400, "json"); }
      ultimoEvento = Date.now();
      try { panel.ingerir(ev, t0); } catch (e) { log("error al procesar evento: " + (e && e.message)); }
      return responder(res, 204);
    }

    if (req.method !== "GET") return responder(res, 405, "método");
    const sitio = req.headers["sec-fetch-site"];
    if (sitio && sitio !== "same-origin" && sitio !== "none") return responder(res, 403, "no");

    if (url.pathname === "/open") {
      const c = url.searchParams.get("code") || "", vence = codigos.get(c);
      codigos.delete(c);
      if (!vence || vence < Date.now()) return responder(res, 403, "Este enlace ya se usó o caducó. Abre el panel otra vez con /panel.");
      res.writeHead(302, { ...SEGURIDAD, Location: "/", "Set-Cookie": `panel_${PUERTO}=${COOKIE_VALOR}; HttpOnly; SameSite=Strict; Path=/` });
      return res.end();
    }
    if (!cookieValida(req)) return responder(res, 401, "Panel de Obra: abre la página con el enlace que da /panel (o espera a que una de tus skills empiece).");

    if (url.pathname === "/events") {
      res.writeHead(200, { ...SEGURIDAD, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
      res.write(`data: ${JSON.stringify(panel.snapshot())}\n\n`);
      clientes.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => { clearInterval(ping); clientes.delete(res); });
      return;
    }
    if (url.pathname === "/api/snapshot") return responder(res, 200, JSON.stringify(panel.snapshot()), { "Content-Type": "application/json" });
    const a = ARCHIVOS[url.pathname];
    if (!a) return responder(res, 404, "No existe");
    const cuerpo = await readFile(join(WEB, a[0]));
    res.writeHead(200, { ...SEGURIDAD, "Content-Type": a[1] }); res.end(cuerpo);
  } catch (e) { log("error: " + (e && e.message)); try { responder(res, 500, "error"); } catch { /* conexión cerrada */ } }
});

function escuchar(i = 0) {
  if (i >= PUERTOS.length) { log("sin puertos libres"); salir(); return; }
  PUERTO = PUERTOS[i];
  servidor.removeAllListeners("error"); servidor.removeAllListeners("listening");
  servidor.once("error", (e) => { if (e.code === "EADDRINUSE") escuchar(i + 1); else { log("error al escuchar: " + e.message); salir(); } });
  servidor.listen(PUERTO, "127.0.0.1");
  servidor.once("listening", () => {
    writeFileSync(ARCHIVO_SERVIDOR, JSON.stringify({ pid: process.pid, puerto: PUERTO, inicio: Date.now() }));
    log(`escuchando en 127.0.0.1:${PUERTO} (pid ${process.pid})`);
    panel.restaurar();
  });
}
function salir() {
  try { if (Number(readFileSync(ARCHIVO_CANDADO, "utf8")) === process.pid) unlinkSync(ARCHIVO_CANDADO); } catch { /* ya no está */ }
  try { const s = JSON.parse(readFileSync(ARCHIVO_SERVIDOR, "utf8")); if (s.pid === process.pid) unlinkSync(ARCHIVO_SERVIDOR); } catch { /* ya no está */ }
  process.exit(0);
}
process.on("SIGINT", salir); process.on("SIGTERM", salir);
process.on("uncaughtException", (e) => log("excepción: " + (e && e.stack)));

// reloj: lee transcripts, limpia códigos y se apaga si no hay nada que mostrar
setInterval(() => {
  try { panel.tic(); } catch (e) { log("tic: " + e.message); }
  for (const [c, v] of codigos) if (v < Date.now()) codigos.delete(c);
}, 700);
setInterval(() => {
  if (clientes.size === 0 && !panel.hayObrasAbiertas() && Date.now() - ultimoEvento > LIMITES.inactividadServidorMs) { log("sin actividad: me apago"); salir(); }
}, 60_000);

escuchar();
