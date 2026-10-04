// Pruebas del estado de las obras con datos reales de F0b y transcripts sintéticos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const datos = mkdtempSync(join(tmpdir(), "panel-prueba-"));
process.env.PANEL_DATOS = datos;
writeFileSync(join(datos, "config.json"), JSON.stringify({ skillsExtra: ["prueba-panel"], autoabrir: true }));
let Panel;
before(async () => { ({ Panel } = await import("../plugin/servidor/episodios.mjs")); });
after(() => { rmSync(join(homedir(), ".claude", "projects", "panel-prueba-unitaria"), { recursive: true, force: true }); rmSync(datos, { recursive: true, force: true }); });

function nuevoPanel() {
  const msgs = []; let aperturas = 0;
  const p = new Panel({ emitir: (m) => msgs.push(m), abrir: () => { aperturas++; } });
  return { p, msgs, aperturas: () => aperturas };
}

test("una sesión sin skill no crea nada", () => {
  const { p, msgs } = nuevoPanel();
  p.ingerir({ hook_event_name: "SessionStart", session_id: "s1", cwd: "C:/x" });
  p.ingerir({ hook_event_name: "Stop", session_id: "s1", last_assistant_message: "hola" });
  assert.equal(p.obras.size, 0); assert.equal(msgs.length, 0);
});

test("director-de-obra abre la página una sola vez; escalera espera al primer agente", () => {
  const { p, aperturas } = nuevoPanel();
  p.ingerir({ hook_event_name: "UserPromptExpansion", session_id: "s2", command_name: "director-de-obra", prompt: "/director-de-obra migrar pedidos", cwd: "C:/proy/ejemplo" });
  p.ingerir({ hook_event_name: "PreToolUse", session_id: "s2", tool_name: "Skill", tool_input: { skill: "subagentes" } });
  assert.equal(aperturas(), 1);
  const { p: q, aperturas: ap2 } = nuevoPanel();
  q.ingerir({ hook_event_name: "PreToolUse", session_id: "s3", tool_name: "Skill", tool_input: { skill: "escalera-de-ejecucion" } });
  assert.equal(ap2(), 0);
  q.ingerir({ hook_event_name: "PreToolUse", session_id: "s3", tool_name: "Agent", tool_use_id: "tu1", tool_input: { description: "lector", subagent_type: "lector", prompt: "lee", model: "sonnet" } });
  assert.equal(ap2(), 1);
  const sub = q.agentes.get("t:tu1");
  assert.equal(sub.nombre, "lector"); assert.equal(sub.modelo, "Sonnet"); assert.equal(sub.modeloConfirmado, false);
});

test("permiso: entra en ámbar y sale con el rechazo escrito en el transcript", () => {
  const dir = join(homedir(), ".claude", "projects", "panel-prueba-unitaria");
  mkdirSync(dir, { recursive: true });
  const tr = join(dir, "sesion-permiso.jsonl");
  writeFileSync(tr, "");
  const { p } = nuevoPanel();
  p.ingerir({ hook_event_name: "SessionStart", session_id: "s4", transcript_path: tr, cwd: "C:/x" });
  p.ingerir({ hook_event_name: "UserPromptExpansion", session_id: "s4", command_name: "director-de-obra", prompt: "/director-de-obra x", transcript_path: tr });
  p.ingerir({ hook_event_name: "PermissionRequest", session_id: "s4", tool_name: "Write", tool_input: { file_path: "a.txt" } });
  assert.equal(p.agentes.get("p:s4").estado, "permiso");
  const lin = (o) => JSON.stringify(o) + "\n";
  writeFileSync(tr, lin({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "w1", name: "Write", input: { file_path: "a.txt" } }], usage: { input_tokens: 10, output_tokens: 5 } } })
    + lin({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1", is_error: true, content: "The user doesn't want to proceed with this tool use. The tool use was rejected" }] }, toolUseResult: "User rejected tool use" }), { flag: "a" });
  p.tic();
  const a = p.agentes.get("p:s4");
  assert.equal(a.estado, "trabajando"); assert.equal(a.modelo, "Opus 5.5"); assert.equal(a.modeloConfirmado, true);
  assert.ok((p.lineas.get("p:s4") || []).some((l) => /Rechazaste el permiso/.test(l.simple)));
});

test("tokens: un mensaje repetido en varias líneas se cuenta una vez", () => {
  const dir = join(homedir(), ".claude", "projects", "panel-prueba-unitaria");
  const tr = join(dir, "sesion-tokens.jsonl"); writeFileSync(tr, "");
  const { p } = nuevoPanel();
  p.ingerir({ hook_event_name: "UserPromptExpansion", session_id: "s5", command_name: "director-de-obra", prompt: "/director-de-obra y", transcript_path: tr });
  const l = { type: "assistant", message: { id: "mX", model: "claude-sonnet-5-5", content: [], usage: { input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 25 } } };
  writeFileSync(tr, [l, l, l, l].map((x) => JSON.stringify(x)).join("\n") + "\n", { flag: "a" });
  p.tic();
  assert.equal(p.agentes.get("p:s5").tokens, 175);
});

test("eventos reales de F0b: subagentes con su modelo real, anidado y padre", () => {
  const archivo = join(AQUI, "datos-f0", "eventos.jsonl");
  if (!existsSync(archivo)) return; // datos de F0b: solo existen en el equipo donde se capturaron
  const eventos = readFileSync(archivo, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.payload.session_id === "cab7407d-3102-43e3-b8e1-ab4161e9dbbd");
  const transcript = eventos[0].payload.transcript_path;
  if (!transcript || !existsSync(transcript)) return; // los transcripts de prueba ya no existen en esta máquina
  const { p } = nuevoPanel();
  for (const e of eventos) p.ingerir(e.payload, e.t);
  p.tic();
  const subs = [...p.agentes.values()].filter((a) => a.rol === "subagente");
  const por = Object.fromEntries(subs.map((a) => [a.nombre, a]));
  assert.ok(por["explorador-prueba"] && por["lector-prueba"] && por["primer-plano-prueba"] && por["nieto-prueba"], subs.map((a) => a.nombre).join(","));
  assert.equal(por["lector-prueba"].modelo, "Opus 5.5");
  assert.equal(por["explorador-prueba"].modelo, "Sonnet 5"); // dato real: en el CLI 2.1.280 «sonnet» resolvió a claude-sonnet-5
  assert.match(por["nieto-prueba"].modelo, /^Haiku/);
  assert.equal(por["nieto-prueba"].pidio, "explorador-prueba");
  for (const a of subs) assert.equal(a.estado, "termino", a.nombre);
  assert.ok(por["primer-plano-prueba"].contadores.comandos >= 1);
  const principal = p.agentes.get("p:cab7407d-3102-43e3-b8e1-ab4161e9dbbd");
  assert.equal(principal.estado, "detenido"); // la sesión de prueba terminó con SessionEnd
});

test("asesor: una consulta real se cuenta, con quién la pidió, resultado cifrado y tokens", () => {
  const tr = process.env.PANEL_TRANSCRIPT_ASESOR; // transcript con una consulta real al asesor (opcional)
  if (!tr || !existsSync(tr)) return; // sin ese transcript en esta máquina, la prueba se omite
  const { p } = nuevoPanel();
  p.ingerir({ hook_event_name: "UserPromptExpansion", session_id: "s-asesor", command_name: "director-de-obra", prompt: "/director-de-obra prueba", transcript_path: tr });
  const id = "p:s-asesor";
  p.lectores.get(id).cerrar(); p.lectores.delete(id);
  p.leerTranscript(id, tr, 0);
  const o = p.obras.get(p.agentes.get(id).obraId);
  assert.equal(o.asesor.consultas, 1);
  assert.equal(o.asesor.ultima.resultado, "revisó (consejo cifrado)");
  assert.equal(o.asesor.ultima.quien, p.agentes.get(id).nombre);
  assert.ok(o.asesor.tokens > 0, "tokens del asesor");
  assert.equal(o.asesor.estado, "reviso");
});

test("/panel empieza a seguir la sesión sin abrir otra pestaña", () => {
  const { p, aperturas } = nuevoPanel();
  p.ingerir({ hook_event_name: "SessionStart", session_id: "s-panel", cwd: "C:/proy/visor" });
  p.ingerir({ hook_event_name: "UserPromptExpansion", session_id: "s-panel", command_name: "panel-agentes:panel", prompt: "/panel-agentes:panel" });
  const o = [...p.obras.values()][0];
  assert.ok(o, "se creó la obra");
  assert.equal(o.titulo, "sesión en visor");
  assert.ok(o.skills.has("seguimiento con /panel"));
  assert.equal(aperturas(), 0, "no abre otra pestaña: la abre el comando");
  p.ingerir({ hook_event_name: "PreToolUse", session_id: "s-panel", tool_name: "Agent", tool_use_id: "tp1", tool_input: { description: "ayudante", prompt: "x" } });
  assert.equal(aperturas(), 0, "tampoco al lanzar un agente");
  assert.equal(p.agentes.get("t:tp1").nombre, "ayudante");
});

test("la página pasa a la obra viva cuando la que se ve ya terminó", () => {
  const { p } = nuevoPanel();
  p.ingerir({ hook_event_name: "UserPromptExpansion", session_id: "sA", command_name: "director-de-obra", prompt: "/director-de-obra a" });
  const obraA = p.visible;
  p.ingerir({ hook_event_name: "UserPromptExpansion", session_id: "sB", command_name: "director-de-obra", prompt: "/director-de-obra b" });
  const obraB = p.visible;
  assert.notEqual(obraA, obraB);
  p.ingerir({ hook_event_name: "SessionEnd", session_id: "sB" });
  p.ingerir({ hook_event_name: "PreToolUse", session_id: "sA", tool_name: "Agent", tool_use_id: "ta1", tool_input: { description: "x", prompt: "y" } });
  assert.equal(p.visible, obraA, "vuelve a la obra con actividad");
});
