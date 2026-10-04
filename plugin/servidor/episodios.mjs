// Panel de Obra · estado de las obras: une los hooks (lo instantáneo) con los transcripts (lo que queda escrito)
// y produce los mismos mensajes que consume la página (snapshot, obra, agente, linea, bitacora, asesor).
import { writeFileSync, readFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { DIR_OBRAS, LIMITES, skillsActivas, asegurarCarpetas, esSeguir } from "./config.mjs";
import { Lector, buscarSubagente, leerMeta, nombreDeSesion, rutaPermitida, tamano } from "./transcripts.mjs";
import { describir, resultado, nombreModelo } from "./interprete.mjs";
import { corto, redactar } from "./redactar.mjs";

const ESFUERZOS = new Set(["low", "medium", "high", "xhigh", "max"]);
const sinFormato = (x) => (x == null ? x : String(x).replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|]+/g, "").replace(/\s+/g, " ").trim());
const nuevoId = (p) => p + Date.now().toString(36) + randomBytes(3).toString("hex");

export class Panel {
  constructor({ emitir = () => {}, abrir = () => {}, hayPestana = () => false, ahora = () => Date.now() } = {}) {
    this.emitir = emitir; this.abrir = abrir; this.hayPestana = hayPestana; this.ahora = ahora;
    this.obras = new Map();      // obraId → obra
    this.visible = null;         // obra que muestra la página
    this.sesiones = new Map();   // session_id → {cwd, transcript, modelo, titulo, t, env, obraId, cardId}
    this.agentes = new Map();    // cardId → agente
    this.lineas = new Map();     // cardId → [linea]
    this.alias = new Map();      // agent_id → cardId
    this.pendientes = new Map(); // tool_use_id de Agent → cardId
    this.herramientas = new Map(); // cardId → Map(tool_use_id → {desc, input})
    this.mensajes = new Map();   // cardId → Map(message.id → tokens)
    this.lectores = new Map();   // cardId → Lector
    this.candidatos = [];        // sesiones nuevas que podrían ser terminales de una obra
  }

  // ── salida hacia la página ─────────────────────────────────
  obraPublica(o) { return o && { id: o.id, titulo: o.titulo, skills: [...o.skills], proyecto: o.proyecto, comando: o.comando, pruebas: o.pruebas || null }; }
  snapshot() {
    const o = this.obras.get(this.visible);
    const agentes = o ? [...this.agentes.values()].filter((a) => a.obraId === o.id) : [];
    const lineas = {}; for (const a of agentes) lineas[a.id] = this.lineas.get(a.id) || [];
    return { tipo: "snapshot", modo: "real", servidorAhora: this.ahora(), obra: this.obraPublica(o), agentes, lineas, bitacora: o ? o.bitacora : [], asesor: o ? o.asesor : null };
  }
  enVista(obraId) { return obraId && obraId === this.visible; }
  tocar(o) { o.ultima = this.ahora(); }

  agente(cardId, cambios) {
    const previo = this.agentes.get(cardId);
    const a = { contadores: {}, tokens: 0, ...(previo || { id: cardId, inicio: this.ahora(), fin: null }), ...cambios };
    if (!previo || previo.estado !== a.estado) a.estadoT = this.ahora();
    if (["termino", "fallo", "detenido"].includes(a.estado) && !a.fin) a.fin = this.ahora();
    if (/^haiku/i.test(a.modelo || "") && !a.esfuerzo) a.esfuerzo = "no-aplica";
    if (["trabajando", "permiso", "espera"].includes(a.estado)) a.fin = null;
    this.agentes.set(cardId, a);
    const o = this.obras.get(a.obraId); if (o) this.tocar(o);
    // Si la obra que se ve ya terminó (su principal se cerró o la obra se cerró) y otra tiene actividad, la página cambia a esa.
    if (a.obraId && !this.enVista(a.obraId) && ["trabajando", "permiso"].includes(a.estado)) {
      const vista = this.obras.get(this.visible);
      const principal = vista && this.agentes.get("p:" + vista.sesion);
      if (!vista || !vista.abierta || (principal && ["detenido", "fallo"].includes(principal.estado))) {
        this.visible = a.obraId; this.emitir(this.snapshot()); return a;
      }
    }
    if (this.enVista(a.obraId)) this.emitir({ tipo: "agente", agente: a });
    return a;
  }
  linea(cardId, simple, tecnico, clase = null, t = this.ahora()) {
    const a = this.agentes.get(cardId); if (!a) return;
    const l = { t, simple: corto(simple, 220), tecnico: corto(tecnico || simple, 220), clase };
    const arr = this.lineas.get(cardId) || []; arr.push(l);
    if (arr.length > LIMITES.lineasPorAgente) arr.splice(0, arr.length - LIMITES.lineasPorAgente);
    this.lineas.set(cardId, arr);
    if (this.enVista(a.obraId)) this.emitir({ tipo: "linea", agenteId: cardId, linea: l });
  }
  bitacora(o, actorId, texto) {
    const a = this.agentes.get(actorId);
    const item = actorId === "asesor" ? { t: this.ahora(), actor: "Asesor", rol: "asesor", texto: corto(texto, 200) }
      : { t: this.ahora(), actor: a ? a.nombre : "—", rol: a ? a.rol : "principal", texto: corto(texto, 200) };
    o.bitacora.push(item); if (o.bitacora.length > LIMITES.bitacora) o.bitacora.shift();
    if (this.enVista(o.id)) this.emitir({ tipo: "bitacora", item });
  }
  asesor(o, cambios) { o.asesor = { ...o.asesor, ...cambios }; if (this.enVista(o.id)) this.emitir({ tipo: "asesor", asesor: o.asesor }); }
  obraCambio(o) { if (this.enVista(o.id)) this.emitir({ tipo: "obra", obra: this.obraPublica(o) }); }

  // ── entrada: un evento de hook ─────────────────────────────
  ingerir(ev, t0 = this.ahora()) {
    if (!ev || typeof ev !== "object" || !ev.session_id) return;
    const nombreEv = ev.hook_event_name;
    const s = this.sesion(ev, t0);
    const { todas } = skillsActivas();
    if (nombreEv === "SessionStart") return this.alIniciarSesion(ev, s, t0);
    if (nombreEv === "UserPromptExpansion" && todas.includes(ev.command_name)) return this.activar(s, ev.command_name, ev.prompt || `/${ev.command_name} ${ev.command_args || ""}`, t0, ev);
    if (nombreEv === "PreToolUse" && ev.tool_name === "Skill" && todas.includes(ev.tool_input && ev.tool_input.skill)) {
      return this.activar(s, ev.tool_input.skill, `/${ev.tool_input.skill} ${ev.tool_input.args || ""}`.trim(), t0, ev);
    }
    if (!s.obraId) return; // sesión que no es de una obra: se ignora
    const o = this.obras.get(s.obraId); if (!o) return;
    const cardId = ev.agent_id ? this.alias.get(ev.agent_id) : s.cardId;
    switch (nombreEv) {
      case "PreToolUse": {
        if (["Agent", "Task"].includes(ev.tool_name)) this.nuevoSubagente(o, ev.tool_use_id, ev.tool_input || {}, cardId || s.cardId, t0);
        if (ev.tool_name === "Workflow") this.nuevoWorkflow(o, ev.tool_use_id, ev.tool_input || {}, cardId || s.cardId, t0);
        if (cardId && ev.effort && ESFUERZOS.has(ev.effort.level)) { const a = this.agentes.get(cardId); if (a && a.esfuerzo !== ev.effort.level) this.agente(cardId, { esfuerzo: ev.effort.level }); }
        break;
      }
      case "SubagentStart": if (ev.agent_type) this.subagenteEmpieza(o, s, ev, t0); break;
      case "SubagentStop": {
        if (!ev.agent_type) break; // agentes internos de Claude Code
        const id = this.alias.get(ev.agent_id); if (!id) break;
        const a = this.agentes.get(id);
        if (a && !["fallo", "detenido"].includes(a.estado)) {
          this.agente(id, { estado: "termino", estadoTexto: null, permiso: null, resultado: corto(sinFormato(ev.last_assistant_message), LIMITES.textoMax), ahora: { simple: "Terminó", tecnico: "SubagentStop" } });
          this.bitacora(o, id, "Terminó" + (ev.last_assistant_message ? ": " + corto(sinFormato(ev.last_assistant_message), 90) : ""));
        }
        const l = this.lectores.get(id); if (l) { l.leer(); setTimeout(() => { l.leer(); l.cerrar(); }, 4000).unref?.(); }
        break;
      }
      case "PermissionRequest": {
        const id = cardId || s.cardId; const a = this.agentes.get(id); if (!a) break;
        const d = describir(ev.tool_name, ev.tool_input || {});
        this.agente(id, { estado: "permiso", estadoTexto: `espera tu permiso para: ${d.simple.toLowerCase()}`, permiso: { tool: ev.tool_name, desde: t0 } });
        this.linea(id, `Pide permiso para: ${d.simple.toLowerCase()}`, `PermissionRequest · ${d.tecnico}`, "permiso", t0);
        this.bitacora(o, id, "Espera tu permiso");
        break;
      }
      case "PermissionDenied": {
        const id = cardId || s.cardId; if (!this.agentes.get(id)) break;
        this.agente(id, { estado: "trabajando", estadoTexto: null, permiso: null });
        this.linea(id, "El modo automático no lo permitió", `PermissionDenied · ${ev.tool_name || ""}`, "permiso", t0);
        break;
      }
      case "Notification": {
        const a = this.agentes.get(s.cardId);
        if (a && ev.notification_type === "idle_prompt" && a.estado !== "permiso") this.agente(s.cardId, { estado: "espera", estadoTexto: "esperando tu respuesta" });
        break;
      }
      case "Stop": {
        if (!this.agentes.get(s.cardId)) break;
        this.agente(s.cardId, { estado: "espera", estadoTexto: "terminó su turno; espera instrucciones", permiso: null, resultado: corto(sinFormato(ev.last_assistant_message), LIMITES.textoMax) });
        this.bitacora(o, s.cardId, "Terminó su turno");
        break;
      }
      case "StopFailure": {
        if (!this.agentes.get(s.cardId)) break;
        this.agente(s.cardId, { estado: "fallo", estadoTexto: "se detuvo por un error del servicio", resultado: corto(ev.error || ev.message || ev.error_type || "error del servicio", LIMITES.textoMax) });
        this.bitacora(o, s.cardId, "Se detuvo por un error del servicio");
        break;
      }
      case "SessionEnd": {
        if (!this.agentes.get(s.cardId)) break;
        this.agente(s.cardId, { estado: "detenido", estadoTexto: "sesión cerrada", permiso: null });
        this.bitacora(o, s.cardId, "Se cerró la sesión");
        break;
      }
    }
  }

  sesion(ev, t0) {
    let s = this.sesiones.get(ev.session_id);
    if (!s) { s = { id: ev.session_id, t: t0 }; this.sesiones.set(ev.session_id, s); }
    if (ev.cwd) s.cwd = ev.cwd;
    if (ev.transcript_path && rutaPermitida(ev.transcript_path)) s.transcript = ev.transcript_path;
    if (ev.model) s.modelo = ev.model;
    if (ev.session_title) s.titulo = ev.session_title;
    if (ev.__env) s.env = ev.__env;
    return s;
  }

  alIniciarSesion(ev, s, t0) {
    if (s.obraId) {
      const o = this.obras.get(s.obraId);
      if (ev.source === "compact") this.linea(s.cardId, "Resumió su memoria para seguir", "SessionStart · compact");
      if (ev.model && this.agentes.get(s.cardId)) this.agente(s.cardId, { modelo: nombreModelo(ev.model), modeloConfirmado: true });
      if (o && ev.source === "resume") this.linea(s.cardId, "Retomó la sesión", "SessionStart · resume");
      return;
    }
    // ¿Es una terminal hija de una obra? Exacto con PANEL_OBRA; si no, por el nombre anunciado.
    const marca = s.env && s.env.PANEL_OBRA;
    if (marca && this.obras.has(marca)) return this.crearTerminal(this.obras.get(marca), s, null, t0);
    if ([...this.obras.values()].some((o) => o.abierta && o.esperadas.size)) this.candidatos.push({ sesion: s.id, t: t0 });
  }

  // ── activación de una obra ─────────────────────────────────
  activar(s, skill, comando, t0, ev) {
    if (esSeguir(skill)) { skill = "seguimiento con /panel"; comando = ""; }
    let o = s.obraId && this.obras.get(s.obraId);
    if (!o || !o.abierta) {
      asegurarCarpetas();
      o = {
        id: nuevoId("o-"), sesion: s.id, inicio: t0, ultima: t0, abierta: true, skills: new Set(),
        titulo: corto(String(comando).replace(/^\/[\w-]+\s*/, "") || s.titulo || (s.cwd ? `sesión en ${basename(s.cwd)}` : `obra con ${skill}`), 90),
        proyecto: s.cwd ? basename(s.cwd) : "obra", comando: corto(comando, 160), pruebas: null, bitacora: [],
        esperadas: new Map(), abrirConAgente: false, paginaAbierta: false,
        asesor: this.configAsesor(s),
      };
      this.obras.set(o.id, o);
      this.visible = o.id;
      const cardId = "p:" + s.id;
      s.obraId = o.id; s.cardId = cardId;
      const offset = s.transcript ? tamano(s.transcript) : 0;
      this.agente(cardId, {
        obraId: o.id, rol: "principal", nombre: s.titulo ? corto(s.titulo, 40) : "Agente principal", tipo: "sesión principal",
        modelo: s.modelo ? nombreModelo(s.modelo) : null, modeloConfirmado: !!s.modelo, esfuerzo: ev && ev.effort && ESFUERZOS.has(ev.effort.level) ? ev.effort.level : null,
        estado: "trabajando", estadoTexto: null, inicio: t0, tarea: corto(comando, 4000) || "Sesión seguida con /panel (la tarea es lo que le pidas en el chat).", pidio: "Tú", sesion: s.id,
      });
      this.guardarMarca(s.id, { obraId: o.id, rol: "principal", t: t0, offset, transcript: s.transcript || null });
      if (s.transcript) this.leerTranscript(cardId, s.transcript, offset);
      this.emitir(this.snapshot()); // la página pasa a mostrar esta obra
      this.bitacora(o, cardId, `Se activó ${skill}`);
    } else this.bitacora(o, s.cardId, `Se activó ${skill}`);
    o.skills.add(skill);
    this.obraCambio(o);
    const { abren } = skillsActivas();
    if (abren.includes(skill)) this.abrirSiHaceFalta(o);
    else if (skill === "seguimiento con /panel") o.paginaAbierta = true; // la abre el propio comando /panel
    else o.abrirConAgente = true;
  }

  abrirSiHaceFalta(o) {
    const { autoabrir } = skillsActivas();
    if (!autoabrir || o.paginaAbierta) return;
    o.paginaAbierta = true; // una vez por episodio
    this.visible = o.id;
    if (this.hayPestana()) { this.emitir(this.snapshot()); return; }
    this.abrir();
  }

  configAsesor(s) {
    const leer = (p) => { try { return JSON.parse(readFileSync(p, "utf8")).advisorModel || null; } catch { return null; } };
    const env = (s && s.env) || {};
    const fuentes = [s && s.cwd && join(s.cwd, ".claude", "settings.local.json"), s && s.cwd && join(s.cwd, ".claude", "settings.json"), join(homedir(), ".claude", "settings.json")].filter(Boolean);
    let modelo = null; for (const f of fuentes) { modelo = leer(f); if (modelo) break; }
    if (env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL) return { modelo: modelo ? nombreModelo(modelo) : null, estado: "no_disponible", consultas: 0, tokens: 0, ultima: null, lista: [], nota: "No disponible: CLAUDE_CODE_DISABLE_ADVISOR_TOOL está activa." };
    if (env.DISABLE_TELEMETRY) return { modelo: modelo ? nombreModelo(modelo) : null, estado: "no_disponible", consultas: 0, tokens: 0, ultima: null, lista: [], nota: "No disponible: DISABLE_TELEMETRY apaga el asesor." };
    if (!modelo) {
      // Opción A del Panel: asesor Opus solo en las terminales Sonnet que abre «subagentes» (--advisor opus).
      let opcionA = false;
      try { opcionA = readFileSync(join(homedir(), ".claude", "skills", "subagentes", "SKILL.md"), "utf8").includes("panel-asesor"); } catch { /* sin la skill */ }
      if (opcionA) return { modelo: "Opus 5.5", estado: "espera", consultas: 0, tokens: 0, ultima: null, lista: [], nota: "Activo solo en las terminales Sonnet de «subagentes» (--advisor opus). Tu sesión principal no lo usa. El consejo llega cifrado." };
      return { modelo: null, estado: "apagado", consultas: 0, tokens: 0, ultima: null, lista: [], nota: "Apagado: ningún archivo de ajustes define advisorModel. No gasta nada." };
    }
    return { modelo: nombreModelo(modelo), estado: "espera", consultas: 0, tokens: 0, ultima: null, lista: [], nota: "El consejo de Opus 5.5, Sonnet 5.5 o Fable 5.1 llega cifrado: Claude Code no deja leer su texto." };
  }

  // ── subagentes ─────────────────────────────────────────────
  nuevoSubagente(o, toolUseId, input, padreId, t0) {
    const cardId = "t:" + toolUseId;
    if (this.agentes.has(cardId)) return cardId;
    const padre = this.agentes.get(padreId);
    this.pendientes.set(toolUseId, cardId);
    this.agente(cardId, {
      obraId: o.id, rol: "subagente", nombre: corto(input.description || input.subagent_type || "subagente", 40), tipo: input.subagent_type || "general-purpose",
      modelo: input.model ? nombreModelo(input.model) : null, modeloConfirmado: false, esfuerzo: null,
      estado: "trabajando", estadoTexto: "preparándose", ahora: { simple: "Recibió su tarea", tecnico: "PreToolUse · Agent" },
      inicio: t0, tarea: redactar(String(input.prompt || "").slice(0, 4000)), pidio: padre ? padre.nombre : "—", padre: padreId,
    });
    if (padre) this.bitacora(o, padreId, `Le pidió ayuda a "${input.description || input.subagent_type || "un agente"}"`);
    if (o.abrirConAgente) this.abrirSiHaceFalta(o);
    return cardId;
  }
  nuevoWorkflow(o, toolUseId, input, padreId, t0) {
    const cardId = "w:" + toolUseId;
    if (this.agentes.has(cardId)) return;
    const padre = this.agentes.get(padreId);
    this.agente(cardId, { obraId: o.id, rol: "subagente", nombre: corto(input.name || (input.scriptPath ? basename(input.scriptPath) : "workflow"), 40), tipo: "workflow",
      modelo: null, esfuerzo: null, estado: "trabajando", inicio: t0, tarea: "Flujo con varios agentes", pidio: padre ? padre.nombre : "—", padre: padreId });
    if (o.abrirConAgente) this.abrirSiHaceFalta(o);
  }
  subagenteEmpieza(o, s, ev, t0, intento = 0) {
    let cardId = this.alias.get(ev.agent_id);
    const rutas = s.transcript ? buscarSubagente(s.transcript, ev.agent_id) : null;
    const meta = rutas ? leerMeta(rutas.meta) : null;
    if (!cardId && meta && meta.toolUseId && this.pendientes.has(meta.toolUseId)) cardId = this.pendientes.get(meta.toolUseId);
    if (!cardId && !meta && intento < 5) { setTimeout(() => this.subagenteEmpieza(o, s, ev, t0, intento + 1), 150).unref?.(); return; }
    if (!cardId) {
      // sin metadatos: el pendiente más antiguo del mismo tipo, o una tarjeta nueva (p. ej. agentes de Workflow)
      const libre = [...this.pendientes.values()].find((id) => { const a = this.agentes.get(id); return a && !a.agentId && a.obraId === o.id && a.tipo === ev.agent_type; });
      cardId = libre || "a:" + ev.agent_id;
    }
    this.alias.set(ev.agent_id, cardId);
    const previo = this.agentes.get(cardId);
    const padreId = meta && meta.parentAgentId ? this.alias.get(meta.parentAgentId) : (rutas && rutas.workflow ? [...this.agentes.values()].find((a) => a.tipo === "workflow" && a.obraId === o.id)?.id : s.cardId);
    this.agente(cardId, {
      obraId: o.id, rol: "subagente", agentId: ev.agent_id,
      nombre: previo ? previo.nombre : corto((meta && meta.description) || ev.agent_type, 40),
      tipo: previo ? previo.tipo : (rutas && rutas.workflow ? "agente de workflow" : ev.agent_type),
      modelo: previo && previo.modelo ? previo.modelo : meta && meta.model ? nombreModelo(meta.model) : null,
      estado: "trabajando", estadoTexto: null, inicio: previo ? previo.inicio : t0,
      pidio: previo ? previo.pidio : (this.agentes.get(padreId) || {}).nombre || "—",
    });
    if (rutas && !this.lectores.has(cardId)) this.leerTranscript(cardId, rutas.jsonl, 0);
  }

  // ── terminales con nombre ──────────────────────────────────
  crearTerminal(o, s, nombre, t0) {
    const cardId = "s:" + s.id;
    s.obraId = o.id; s.cardId = cardId;
    this.agente(cardId, {
      obraId: o.id, rol: "terminal", nombre: corto(nombre || s.titulo || "terminal", 40), tipo: "terminal aparte",
      modelo: s.modelo ? nombreModelo(s.modelo) : null, modeloConfirmado: !!s.modelo, esfuerzo: null,
      estado: "trabajando", inicio: s.t || t0, tarea: null, pidio: (this.agentes.get(o.sesion && "p:" + o.sesion) || {}).nombre || "—", sesion: s.id,
    });
    this.guardarMarca(s.id, { obraId: o.id, rol: "terminal", t: t0, offset: 0, transcript: s.transcript || null, nombre });
    if (s.transcript) this.leerTranscript(cardId, s.transcript, 0);
    this.bitacora(o, cardId, "Se abrió la terminal");
  }

  // ── lectura de transcripts ─────────────────────────────────
  leerTranscript(cardId, ruta, desde) {
    if (this.lectores.has(cardId) || !ruta) return;
    const l = new Lector(ruta, desde, (linea) => this.procesar(cardId, linea));
    this.lectores.set(cardId, l);
    l.leer();
  }

  procesar(cardId, o) {
    const a = this.agentes.get(cardId); if (!a) return;
    const obra = this.obras.get(a.obraId); if (!obra) return;
    const t = o.timestamp ? Date.parse(o.timestamp) || this.ahora() : this.ahora();
    if (o.type === "agent-name" && a.rol === "terminal" && o.agentName) { if (a.nombre !== o.agentName) this.agente(cardId, { nombre: corto(o.agentName, 40) }); return; }
    if (o.type === "system" && o.subtype === "compact_boundary") { this.linea(cardId, "Resumió su memoria para seguir", "compact_boundary", null, t); return; }
    const herr = this.herramientas.get(cardId) || new Map(); this.herramientas.set(cardId, herr);

    if (o.type === "assistant" && o.message) {
      const m = o.message, cambios = {};
      if (m.model && m.model !== "<synthetic>") { const n = nombreModelo(m.model); if (a.modelo !== n || !a.modeloConfirmado) { cambios.modelo = n; cambios.modeloConfirmado = true; } }
      if (ESFUERZOS.has(o.effort) && a.esfuerzo !== o.effort) cambios.esfuerzo = o.effort;
      if (m.usage && m.id) {
        const vistos = this.mensajes.get(cardId) || new Map(); this.mensajes.set(cardId, vistos);
        const u = m.usage;
        vistos.set(m.id, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0));
        cambios.tokens = [...vistos.values()].reduce((x, y) => x + y, 0);
        if (a.rol === "principal" || a.rol === "terminal") cambios.contexto = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        for (const [i, it] of (u.iterations || []).entries()) if (it.type === "advisor_message") this.tokensAsesor(obra, `${m.id}:${i}`, (it.input_tokens || 0) + (it.cache_creation_input_tokens || 0) + (it.output_tokens || 0));
      }
      if (a.permiso && t > (a.estadoT || 0)) { cambios.permiso = null; cambios.estado = "trabajando"; cambios.estadoTexto = null; }
      else if ((a.estado === "espera" || a.estado === "termino") && t > (a.estadoT || 0) + 1500) { cambios.estado = "trabajando"; cambios.estadoTexto = null; }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === "tool_use") {
          if (herr.has(b.id)) continue;
          const d = describir(b.name, b.input || {});
          herr.set(b.id, { desc: d, input: { ...(b.input || {}), __tool: b.name } });
          cambios.ahora = { simple: d.simple, tecnico: d.tecnico };
          if (d.cuenta) cambios.contadores = { ...(cambios.contadores || a.contadores), [d.cuenta]: ((cambios.contadores || a.contadores)[d.cuenta] || 0) + 1 };
          if (d.terminal) obra.esperadas.set(d.terminal, this.ahora());
          if (["Agent", "Task"].includes(b.name) && !this.agentes.has("t:" + b.id)) this.nuevoSubagente(obra, b.id, b.input || {}, cardId, t);
          this.linea(cardId, d.simple, d.tecnico, null, t);
        } else if (b.type === "server_tool_use" && b.name === "advisor") {
          const antes = (this.lineas.get(cardId) || []).slice(-1)[0];
          obra.asesorPendiente = { quien: a.nombre, cardId, antes: antes ? antes.simple : null, t };
          this.asesor(obra, { estado: "consultando" });
          this.bitacora(obra, "asesor", `${a.nombre} consultó al asesor`);
        } else if (b.type === "advisor_tool_result") this.resultadoAsesor(obra, cardId, b.content || {}, t);
      }
      if (Object.keys(cambios).length) this.agente(cardId, cambios);
      return;
    }

    if (o.type === "user" && o.message) {
      const c = o.message.content;
      const textos = typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text) : [];
      for (const tx of textos) {
        const tn = /<task-notification>[\s\S]*?<task-id>([^<]+)<\/task-id>[\s\S]*?<status>(\w+)<\/status>/.exec(tx || "");
        if (tn) { this.notificacionTarea(obra, tn[1].trim(), tn[2]); continue; }
        if (a.rol === "terminal" && !a.tarea && tx && !tx.startsWith("<")) this.agente(cardId, { tarea: redactar(tx.slice(0, 4000)) });
      }
      if (o.toolUseResult && o.toolUseResult.agentId && o.toolUseResult.status) {
        const id = Array.isArray(c) && (c.find((b) => b.type === "tool_result") || {}).tool_use_id;
        if (id && this.agentes.has("t:" + id)) {
          const sub = "t:" + id;
          this.alias.set(o.toolUseResult.agentId, sub);
          if (o.toolUseResult.resolvedModel) this.agente(sub, { modelo: nombreModelo(o.toolUseResult.resolvedModel), modeloConfirmado: true, agentId: o.toolUseResult.agentId });
          const s = this.sesiones.get(a.sesion) || [...this.sesiones.values()].find((x) => x.cardId === cardId);
          if (s && s.transcript && !this.lectores.has(sub)) { const r = buscarSubagente(s.transcript, o.toolUseResult.agentId); this.leerTranscript(sub, r.jsonl, 0); }
        }
      }
      for (const b of Array.isArray(c) ? c : []) {
        if (b.type !== "tool_result") continue;
        const p = herr.get(b.tool_use_id); herr.delete(b.tool_use_id);
        const r = resultado(p ? p.desc : { simple: "esta acción" }, !!b.is_error, b.content, p ? p.input : {});
        const cambios = {};
        if (a.permiso) { cambios.permiso = null; cambios.estado = "trabajando"; cambios.estadoTexto = null; }
        if (r) {
          this.linea(cardId, r.simple, r.tecnico, r.clase, t);
          if (r.fallo && !r.rechazo) cambios.contadores = { ...a.contadores, fallos: (a.contadores.fallos || 0) + 1 };
          if (r.rechazo) this.bitacora(obra, cardId, "Rechazaste su permiso");
          if (r.pruebas) { obra.pruebas = { ...r.pruebas, quien: a.nombre }; this.obraCambio(obra); }
        }
        if (Object.keys(cambios).length) this.agente(cardId, cambios);
      }
    }
  }

  notificacionTarea(obra, taskId, status) {
    const id = this.alias.get(taskId); if (!id) return;
    const a = this.agentes.get(id); if (!a) return;
    const estado = status === "completed" ? "termino" : status === "failed" ? "fallo" : status === "killed" ? "detenido" : null;
    if (!estado || a.estado === estado) return;
    this.agente(id, { estado, estadoTexto: estado === "detenido" ? "detenido antes de terminar" : null, permiso: null });
    if (estado !== "termino") this.bitacora(obra, id, estado === "fallo" ? "Falló" : "Se detuvo antes de terminar");
  }

  tokensAsesor(obra, clave, n) {
    obra.asesorTokens = obra.asesorTokens || new Map();
    if (obra.asesorTokens.has(clave)) return;
    obra.asesorTokens.set(clave, n);
    this.asesor(obra, { tokens: [...obra.asesorTokens.values()].reduce((x, y) => x + y, 0) });
  }
  resultadoAsesor(obra, cardId, contenido, t) {
    const p = obra.asesorPendiente || { quien: (this.agentes.get(cardId) || {}).nombre || "—", antes: null, t };
    obra.asesorPendiente = null;
    let res, estado = "reviso", legible = null;
    if (contenido.type === "advisor_result") { res = "revisó"; legible = corto(contenido.text, 300); }
    else if (contenido.type === "advisor_redacted_result") res = "revisó (consejo cifrado)";
    else if (contenido.type === "advisor_tool_result_error") { res = `no disponible (${contenido.error_code || "error"})`; estado = "no_disponible"; }
    else res = "respondió";
    const lineas = (this.lineas.get(cardId) || []).slice(-4);
    const errores = lineas.filter((l) => l.clase === "error").length;
    const vivos = [...this.agentes.values()].filter((x) => x.obraId === obra.id && x.rol !== "principal" && ["trabajando", "permiso"].includes(x.estado)).length;
    const subs = [...this.agentes.values()].filter((x) => x.obraId === obra.id && x.rol !== "principal").length;
    const momento = errores >= 2 ? "error" : subs === 0 ? "plan" : vivos === 0 ? "fin" : null;
    const q = { t, quien: p.quien, resultado: res, antes: p.antes, momento, legible };
    this.asesor(obra, { estado, consultas: (obra.asesor.consultas || 0) + 1, ultima: q, lista: [...(obra.asesor.lista || []), q].slice(-50) });
    this.bitacora(obra, "asesor", `${res[0].toUpperCase() + res.slice(1)} (consulta ${obra.asesor.consultas}, pedida por ${p.quien})`);
  }

  // ── marcas en disco (para sobrevivir a un reinicio) ────────
  guardarMarca(sesion, datos) {
    try { writeFileSync(join(DIR_OBRAS, sesion.replace(/[^\w-]/g, "") + ".json"), JSON.stringify({ sesion, ...datos })); } catch { /* sin disco: sigue en memoria */ }
  }
  borrarMarcas(o) {
    for (const s of this.sesiones.values()) if (s.obraId === o.id) { try { unlinkSync(join(DIR_OBRAS, s.id.replace(/[^\w-]/g, "") + ".json")); } catch { /* ya no está */ } }
  }
  restaurar() {
    let archivos = []; try { archivos = readdirSync(DIR_OBRAS).filter((f) => f.endsWith(".json")); } catch { return; }
    const marcas = archivos.map((f) => { try { return JSON.parse(readFileSync(join(DIR_OBRAS, f), "utf8")); } catch { return null; } }).filter(Boolean);
    for (const m of marcas.filter((x) => x.rol === "principal").sort((x, y) => x.t - y.t)) {
      if (!m.transcript || !rutaPermitida(m.transcript)) continue;
      const s = this.sesion({ session_id: m.sesion, transcript_path: m.transcript }, m.t);
      this.activar(s, "obra retomada", "(retomada tras reiniciar el panel)", m.t, null);
      const o = this.obras.get(s.obraId); o.skills.delete("obra retomada"); o.paginaAbierta = true;
      // releer desde la posición original de la marca
      const l = this.lectores.get(s.cardId); if (l) { l.cerrar(); this.lectores.delete(s.cardId); }
      this.guardarMarca(s.id, m);
      this.leerTranscript(s.cardId, m.transcript, m.offset || 0);
      for (const tm of marcas.filter((x) => x.rol === "terminal" && x.obraId === m.obraId)) {
        if (!tm.transcript || !rutaPermitida(tm.transcript)) continue;
        const st = this.sesion({ session_id: tm.sesion, transcript_path: tm.transcript }, tm.t);
        this.crearTerminal(o, st, tm.nombre, tm.t);
      }
    }
  }

  // ── reloj: lee lo nuevo, asocia terminales, cierra obras inactivas ─
  tic() {
    for (const l of this.lectores.values()) l.leer();
    const ahora = this.ahora();
    this.candidatos = this.candidatos.filter((c) => {
      const s = this.sesiones.get(c.sesion); if (!s || s.obraId) return false;
      if (ahora - c.t > 10 * 60_000) return false;
      const nombre = s.transcript && nombreDeSesion(s.transcript); if (!nombre) return true;
      const o = [...this.obras.values()].find((x) => x.abierta && x.esperadas.has(nombre) && ahora - x.esperadas.get(nombre) < 10 * 60_000);
      if (o) { o.esperadas.delete(nombre); this.crearTerminal(o, s, nombre, c.t); return false; }
      return true;
    });
    for (const [id, s] of this.sesiones) if (!s.obraId && ahora - (s.t || 0) > 10 * 60_000) this.sesiones.delete(id); // sesiones ajenas: se olvidan
    for (const o of this.obras.values()) {
      if (!o.abierta) continue;
      const vivos = [...this.agentes.values()].some((a) => a.obraId === o.id && ["trabajando", "permiso"].includes(a.estado));
      if (!vivos && ahora - o.ultima > LIMITES.inactividadObraMs) { o.abierta = false; this.borrarMarcas(o); for (const [id, l] of this.lectores) if ((this.agentes.get(id) || {}).obraId === o.id) { l.cerrar(); this.lectores.delete(id); } }
    }
  }
  hayObrasAbiertas() { return [...this.obras.values()].some((o) => o.abierta); }
}
