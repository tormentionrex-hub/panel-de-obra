// Panel de Obra · reenviador de hooks. Lo ejecuta Claude Code en cada evento registrado.
// Reglas: nunca imprime nada, siempre sale con código 0 y vuelve enseguida.
// Claude Code espera al hook SessionStart antes de su primera respuesta, así que este proceso solo
// decide si el evento interesa; el envío (y arrancar el servidor si hace falta) lo hace un proceso
// hijo desacoplado (modo --enviar), para no retrasar nunca a Claude.
const t0 = Date.now();
setTimeout(() => process.exit(0), process.argv.includes("--enviar") ? 6000 : 2500).unref();
process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODO_ENVIO = process.argv.includes("--enviar");

async function leerEntrada() {
  let entrada = "";
  for await (const trozo of process.stdin) { entrada += trozo; if (entrada.length > 1_000_000) return null; }
  return entrada;
}

async function decidir() {
  if (process.env.AGENT_PANEL === "off") return;
  if (process.env.CLAUDE_CODE_REMOTE === "true" || process.env.SSH_CONNECTION || process.env.SSH_TTY) return;
  const { ARCHIVO_APAGADO, DIR_OBRAS, skillsActivas } = await import("../servidor/config.mjs");
  if (existsSync(ARCHIVO_APAGADO)) return;
  const entrada = await leerEntrada(); if (!entrada) return;
  let ev; try { ev = JSON.parse(entrada); } catch { return; }
  if (!ev || !ev.session_id || !ev.hook_event_name) return;

  const { todas } = skillsActivas();
  const nombre = ev.hook_event_name;
  const disparador = (nombre === "UserPromptExpansion" && todas.includes(ev.command_name))
    || (nombre === "PreToolUse" && ev.tool_name === "Skill" && todas.includes(ev.tool_input && ev.tool_input.skill));
  const inicio = nombre === "SessionStart";
  const marcada = existsSync(join(DIR_OBRAS, String(ev.session_id).replace(/[^\w-]/g, "") + ".json"));
  const hija = !!process.env.PANEL_OBRA;
  if (!disparador && !inicio && !marcada && !hija) return; // sesión que no es de una obra: no se toca la red

  // De las sesiones que aún no son de una obra solo viajan metadatos.
  const cuerpo = inicio && !marcada
    ? { hook_event_name: nombre, session_id: ev.session_id, transcript_path: ev.transcript_path, cwd: ev.cwd, source: ev.source, model: ev.model, session_title: ev.session_title }
    : recortar(ev);
  cuerpo.__env = {};
  for (const k of ["PANEL_OBRA", "CLAUDE_CODE_DISABLE_ADVISOR_TOOL", "DISABLE_TELEMETRY"]) if (process.env[k]) cuerpo.__env[k] = k === "PANEL_OBRA" ? process.env[k] : "1";

  // Entrega desacoplada: el hijo recibe el evento por su entrada estándar y este proceso termina ya.
  const hijo = spawn(process.execPath, [fileURLToPath(import.meta.url), "--enviar", String(t0)], { detached: true, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  hijo.on("error", () => {});
  await new Promise((ok) => hijo.stdin.end(JSON.stringify(cuerpo), ok));
  hijo.unref();
}

async function enviarAhora() {
  const tEvento = Number(process.argv[process.argv.indexOf("--enviar") + 1]) || t0;
  const texto = await leerEntrada(); if (!texto) return;
  const { enviar, asegurarServidor, esperarServidor } = await import("./comun.mjs");
  let r = await enviar("/ingest", texto, { t0: tEvento });
  if (r === null) {
    if (asegurarServidor()) await esperarServidor(1800);
    r = await enviar("/ingest", texto, { t0: tEvento, timeout: 1000 });
  }
}

/** Recorta textos largos para no mandar más de lo necesario. */
function recortar(o, prof = 0) {
  if (typeof o === "string") return o.length > 8000 ? o.slice(0, 8000) + "…" : o;
  if (Array.isArray(o)) return prof > 6 ? [] : o.slice(0, 200).map((x) => recortar(x, prof + 1));
  if (o && typeof o === "object") {
    const r = {};
    for (const [k, v] of Object.entries(o)) { if (k === "tool_response") continue; r[k] = recortar(v, prof + 1); }
    return r;
  }
  return o;
}

(MODO_ENVIO ? enviarAhora() : decidir()).catch(() => {}).finally(() => process.exit(0));
