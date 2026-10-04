// Panel de Obra · configuración y rutas compartidas (servidor, reenviador y herramientas).
import { homedir, release } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

export const DATOS = process.env.PANEL_DATOS || join(homedir(), ".claude", "panel-agentes");
export const DIR_ESTADO = join(DATOS, "estado");
export const DIR_OBRAS = join(DATOS, "obras");
export const DIR_REGISTRO = join(DATOS, "registro");
export const ARCHIVO_SERVIDOR = join(DIR_ESTADO, "servidor.json");
export const ARCHIVO_SECRETO = join(DIR_ESTADO, "secreto");
export const ARCHIVO_CANDADO = join(DIR_ESTADO, "candado");
export const ARCHIVO_LANZADO = join(DIR_ESTADO, "lanzado");
export const ARCHIVO_APAGADO = join(DATOS, "apagado");
export const DIR_PROYECTOS = join(homedir(), ".claude", "projects");

export const ES_WSL = process.platform === "linux" && /microsoft/i.test(release());
export const PUERTO_BASE = ES_WSL ? 47831 : 47821;
export const PUERTOS = Array.from({ length: 10 }, (_, i) => PUERTO_BASE + i);

// Skills que activan una obra. Las de ABREN abren la página al instante; el resto, al lanzar su primer agente.
export const SKILLS = ["escalera-de-ejecucion", "subagentes", "director-de-obra"];
export const ABREN = ["subagentes", "director-de-obra"];

export const LIMITES = {
  cuerpoMax: 256 * 1024,      // bytes por evento recibido
  eventosPorSegundo: 200,
  lineasPorAgente: 400,
  bitacora: 300,
  textoMax: 600,              // caracteres de un resultado mostrado
  inactividadObraMs: 30 * 60_000,
  inactividadServidorMs: 30 * 60_000,
};

export function asegurarCarpetas() {
  for (const d of [DATOS, DIR_ESTADO, DIR_OBRAS, DIR_REGISTRO]) mkdirSync(d, { recursive: true });
}

/** Lee config.json opcional (p. ej. {"skillsExtra": ["prueba-panel"], "autoabrir": true}). */
export function leerConfig() {
  try { return JSON.parse(readFileSync(join(DATOS, "config.json"), "utf8")); } catch { return {}; }
}
export function skillsActivas() {
  const c = leerConfig();
  return { todas: [...SKILLS, ...(c.skillsExtra || [])], abren: [...ABREN, ...(c.skillsExtra || [])], autoabrir: c.autoabrir !== false };
}

/** Secreto compartido entre el reenviador y el servidor; solo legible por tu usuario. */
export function leerOCrearSecreto() {
  asegurarCarpetas();
  if (existsSync(ARCHIVO_SECRETO)) return readFileSync(ARCHIVO_SECRETO, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  try { writeFileSync(ARCHIVO_SECRETO, s, { mode: 0o600, flag: "wx" }); }
  catch (e) { if (e.code === "EEXIST") return readFileSync(ARCHIVO_SECRETO, "utf8").trim(); throw e; }
  restringir(ARCHIVO_SECRETO);
  return s;
}
export function restringir(ruta) {
  try {
    if (process.platform === "win32") {
      const usuario = process.env.USERNAME;
      if (usuario) execFileSync("icacls", [ruta, "/inheritance:r", "/grant:r", `${usuario}:F`], { stdio: "ignore", windowsHide: true });
    } else chmodSync(ruta, 0o600);
  } catch { /* lo mejor posible */ }
}
