// Panel de Obra · lectura incremental de transcripts (.jsonl) de Claude Code.
// Solo lee lo nuevo desde una posición dada, por bloques; nunca carga el archivo entero.
import { openSync, readSync, closeSync, statSync, existsSync, readdirSync, realpathSync, readFileSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { DIR_PROYECTOS } from "./config.mjs";

const BLOQUE = 4 * 1024 * 1024;
const LINEA_MAX = 8 * 1024 * 1024;

/** Solo se aceptan .jsonl que estén de verdad dentro de ~/.claude/projects. */
export function rutaPermitida(ruta) {
  try {
    if (!ruta || !String(ruta).endsWith(".jsonl")) return false;
    // el transcript puede no existir todavía: entonces se valida su carpeta
    const real = existsSync(ruta) ? realpathSync(ruta) : join(realpathSync(dirname(ruta)), String(ruta).split(/[\\/]/).pop());
    const base = realpathSync(DIR_PROYECTOS);
    return real.toLowerCase().startsWith((base + sep).toLowerCase());
  } catch { return false; }
}

export function tamano(ruta) { try { return statSync(ruta).size; } catch { return 0; } }

export class Lector {
  constructor(ruta, desde, alLinea) {
    this.ruta = ruta; this.pos = desde || 0; this.resto = ""; this.alLinea = alLinea; this.cerrado = false; this.descartando = false;
  }
  leer() {
    if (this.cerrado || !existsSync(this.ruta)) return 0;
    let total = 0;
    try {
      const tam = statSync(this.ruta).size;
      if (tam < this.pos) { this.pos = 0; this.resto = ""; } // el archivo se reescribió
      while (this.pos < tam) {
        const n = Math.min(BLOQUE, tam - this.pos);
        const buf = Buffer.alloc(n);
        const fd = openSync(this.ruta, "r");
        try { readSync(fd, buf, 0, n, this.pos); } finally { closeSync(fd); }
        this.pos += n; total += n;
        const texto = this.resto + buf.toString("utf8");
        const lineas = texto.split("\n");
        this.resto = lineas.pop();
        if (this.resto.length > LINEA_MAX) { this.resto = ""; this.descartando = true; }
        for (const l of lineas) {
          if (this.descartando) { this.descartando = false; continue; }
          if (!l.trim() || l.length > LINEA_MAX) continue;
          let o; try { o = JSON.parse(l); } catch { continue; }
          try { this.alLinea(o); } catch { /* una línea rara no detiene la lectura */ }
        }
      }
    } catch { /* se reintenta en la próxima vuelta */ }
    return total;
  }
  cerrar() { this.cerrado = true; }
}

/** Busca el transcript y el .meta.json de un subagente (también dentro de workflows/wf_*). */
export function buscarSubagente(transcriptPrincipal, agentId) {
  const base = join(dirname(transcriptPrincipal), String(transcriptPrincipal).split(/[\\/]/).pop().replace(/\.jsonl$/, ""), "subagents");
  const nombre = `agent-${agentId}`;
  const directo = join(base, nombre + ".jsonl");
  if (existsSync(directo) || existsSync(join(base, nombre + ".meta.json"))) return { jsonl: directo, meta: join(base, nombre + ".meta.json") };
  try {
    for (const d of readdirSync(join(base, "workflows"), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = join(base, "workflows", d.name, nombre + ".jsonl");
      if (existsSync(p) || existsSync(p.replace(/\.jsonl$/, ".meta.json"))) return { jsonl: p, meta: p.replace(/\.jsonl$/, ".meta.json"), workflow: d.name };
    }
  } catch { /* sin workflows */ }
  return { jsonl: directo, meta: join(base, nombre + ".meta.json") };
}

export function leerMeta(ruta) { try { return JSON.parse(readFileSync(ruta, "utf8")); } catch { return null; } }

/** Lee las primeras líneas de un transcript para encontrar su nombre (agent-name / custom-title). */
export function nombreDeSesion(ruta) {
  try {
    const fd = openSync(ruta, "r"); const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
    for (const l of buf.toString("utf8", 0, n).split("\n").slice(0, 12)) {
      try { const o = JSON.parse(l); if (o.type === "agent-name" && o.agentName) return o.agentName; if (o.type === "custom-title" && o.customTitle) return o.customTitle; } catch { /* línea cortada */ }
    }
  } catch { /* aún no existe */ }
  return null;
}
