// Panel de Obra · enlace «Ir a Claude»: lleva al chat del orquestador en la app de escritorio.
// La app abre una conversación con claude://code/continue?session=local_…, pero el panel solo conoce el
// id de Claude Code (el del transcript). La app guarda el par en claude-code-sessions/**/local_*.json;
// de esos archivos se leen SOLO sessionId, cliSessionId y title. Si la sesión no es de la app
// (terminal o VS Code), se usa claude://resume?session=<id>, que la importa en la app.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL = /^local_[A-Za-z0-9-]{1,64}$/;

function carpetas() {
  const r = [];
  if (process.env.APPDATA) r.push(join(process.env.APPDATA, "Claude", "claude-code-sessions"));
  if (process.env.LOCALAPPDATA) {
    const pk = join(process.env.LOCALAPPDATA, "Packages");
    try { for (const d of readdirSync(pk)) if (/^Claude_/i.test(d)) r.push(join(pk, d, "LocalCache", "Roaming", "Claude", "claude-code-sessions")); } catch { /* sin paquetes */ }
  }
  r.push(join(homedir(), "Library", "Application Support", "Claude", "claude-code-sessions"));
  return r.filter((d) => existsSync(d));
}

const mapa = new Map(); // cliSessionId → { sessionId, titulo }
let ultimoEscaneo = 0;
function escanear() {
  ultimoEscaneo = Date.now();
  const recorrer = (dir, prof) => {
    let entradas; try { entradas = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const p = join(dir, e.name);
      if (e.isDirectory() && prof < 4) recorrer(p, prof + 1);
      else if (e.isFile() && /^local_.*\.json$/.test(e.name)) {
        try {
          const j = JSON.parse(readFileSync(p, "utf8"));
          if (j && UUID.test(j.cliSessionId || "") && LOCAL.test(j.sessionId || "")) mapa.set(j.cliSessionId, { sessionId: j.sessionId, titulo: typeof j.title === "string" ? j.title.slice(0, 120) : null });
        } catch { /* archivo a medio escribir */ }
      }
    }
  };
  for (const d of carpetas()) recorrer(d, 0);
}

/** { href, titulo, enApp } para volver al chat de esta sesión, o null si el id no es válido. */
export function enlaceClaude(cliSessionId) {
  if (!UUID.test(String(cliSessionId || ""))) return null;
  if (!mapa.has(cliSessionId) && Date.now() - ultimoEscaneo > 30_000) escanear();
  const m = mapa.get(cliSessionId);
  if (m) return { href: `claude://code/continue?session=${m.sessionId}&source=panel-de-obra`, titulo: m.titulo, enApp: true };
  return { href: `claude://resume?session=${cliSessionId}`, titulo: null, enApp: false };
}
