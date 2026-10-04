// Panel de Obra · utilidades compartidas por el reenviador, el lanzador y /panel.
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { request } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVO_SERVIDOR, ARCHIVO_LANZADO, leerOCrearSecreto, asegurarCarpetas } from "../servidor/config.mjs";

const SERVIDOR_JS = join(dirname(fileURLToPath(import.meta.url)), "..", "servidor", "servidor.mjs");

export function leerServidor() { try { return JSON.parse(readFileSync(ARCHIVO_SERVIDOR, "utf8")); } catch { return null; } }
function vivo(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }

/** POST firmado con HMAC(t0.cuerpo). Resuelve con el código de estado o null si no hay servidor. */
export function enviar(ruta, cuerpo, { t0 = Date.now(), timeout = 1500 } = {}) {
  return new Promise((ok) => {
    const s = leerServidor();
    if (!s || !s.puerto || !vivo(s.pid)) return ok(null);
    let secreto; try { secreto = leerOCrearSecreto(); } catch { return ok(null); }
    const firma = createHmac("sha256", secreto).update(`${t0}.${cuerpo}`).digest("hex");
    const req = request({ host: "127.0.0.1", port: s.puerto, path: ruta, method: "POST", timeout,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo), "X-Panel-T0": String(t0), "X-Panel-Firma": firma } },
    (res) => { let d = ""; res.on("data", (x) => { d += x; }); res.on("end", () => ok({ codigo: res.statusCode, cuerpo: d })); });
    req.on("timeout", () => { req.destroy(); ok(null); });
    req.on("error", () => ok(null));
    req.end(cuerpo);
  });
}

/** Arranca el servidor desacoplado (sin ventana) si no está vivo. Como mucho una vez cada 10 s. */
export function asegurarServidor() {
  const s = leerServidor();
  if (s && vivo(s.pid)) return false;
  asegurarCarpetas();
  try { if (existsSync(ARCHIVO_LANZADO) && Date.now() - statSync(ARCHIVO_LANZADO).mtimeMs < 10_000) return false; } catch { /* seguir */ }
  try { writeFileSync(ARCHIVO_LANZADO, String(Date.now())); } catch { /* seguir */ }
  const hijo = spawn(process.execPath, [SERVIDOR_JS], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env } });
  hijo.unref();
  return true;
}

export async function esperarServidor(ms = 1500) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { const s = leerServidor(); if (s && vivo(s.pid)) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}
