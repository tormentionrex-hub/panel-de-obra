// Panel de Obra · desinstalador en un paso.
// Quita el plugin y su marketplace, detiene el servidor y borra ~/.claude/panel-agentes y la copia del plugin.
// Los cambios del asesor (F4) se revierten aparte con: node herramientas/asesor.mjs off
import { existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { DATOS, ARCHIVO_SERVIDOR } from "../plugin/servidor/config.mjs";

const entorno = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE_CODE_|^CLAUDECODE$/.test(k)));
const claude = (args) => { try { return execFileSync(process.platform === "win32" ? "claude.cmd" : "claude", args, { encoding: "utf8", env: entorno, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch (e) { return `· ${args.slice(1).join(" ")}: ${String(e.stdout || e.stderr || e.message).trim()}`; } };
function borrar(ruta, nombre) {
  if (!existsSync(ruta)) return;
  const quedan = [];
  const recorrer = (r) => {
    try { rmSync(r, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); return; } catch { /* algo dentro está en uso: ir por partes */ }
    let hijos = []; try { hijos = readdirSync(r); } catch { /* sin acceso */ }
    for (const h of hijos) recorrer(join(r, h));
    try { rmSync(r, { recursive: true, force: true }); } catch { quedan.push(r); }
  };
  recorrer(ruta);
  if (!quedan.length) console.log(`✓ borrado ${nombre}`);
  else console.log(`⚠ borré ${nombre} salvo lo que está en uso:\n  ${quedan.join("\n  ")}\n  Cierra la sesión de Claude Code que usa esa carpeta y vuelve a correr este comando.`);
}

// Primero se deshacen los cambios del asesor en tus skills (sus copias viven en la carpeta de datos que se borra después).
if (existsSync(join(DATOS, "copias-asesor"))) {
  try { console.log(execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "asesor.mjs"), "off"], { encoding: "utf8" }).trim()); }
  catch (e) { console.log("⚠ no pude revertir el asesor; no borro tus copias: " + e.message); process.exit(1); }
}
console.log(claude(["plugin", "uninstall", "panel-agentes@panel-agentes-local"]));
console.log(claude(["plugin", "marketplace", "remove", "panel-agentes-local"]));
try { const s = JSON.parse(readFileSync(ARCHIVO_SERVIDOR, "utf8")); process.kill(s.pid); console.log("✓ servidor detenido"); } catch { console.log("· el servidor no estaba corriendo"); }
borrar(join(homedir(), ".claude", "plugins", "cache", "panel-agentes-local"), "la copia instalada del plugin");
borrar(join(homedir(), ".claude", "plugins", "data", "panel-agentes-panel-agentes-local"), "los datos del plugin");
borrar(DATOS, DATOS);
console.log("Listo. La carpeta del código (PanelAgentes) no se toca: bórrala tú si ya no la quieres.");
