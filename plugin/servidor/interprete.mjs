// Panel de Obra · traduce la actividad real a frases simples, con reglas fijas (sin ningún modelo).
// Adaptado de OrquestadorTerminales/interprete.mjs: un resultado solo se interpreta según el TIPO de
// comando que lo produjo (un grep que contiene "24 passed" no cuenta como pruebas).
import { corto, esSensible } from "./redactar.mjs";

const archivo = (p) => String(p || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "un archivo";

const COMANDOS = [
  { re: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|vitest|jest)\b|\bvitest\b|\bjest\b|\bpytest\b|\bplaywright\s+test\b|\bnode\s+--test\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b/, tipo: "pruebas", texto: "Corriendo las pruebas" },
  { re: /\bgit\s+commit\b/, tipo: "git", texto: "Guardando cambios con git" },
  { re: /\bgit\s+push\b/, tipo: "git", texto: "Subiendo cambios con git" },
  { re: /\bgit\s+(status|diff|log|show|branch)\b/, tipo: "git", texto: "Revisando el estado de git" },
  { re: /\bgit\b/, tipo: "git", texto: "Usando git" },
  { re: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\bvite\s+build\b|\bnext\s+build\b|\btsc\b/, tipo: "build", texto: "Construyendo el proyecto" },
  { re: /\b(npm|pnpm|yarn|bun)\s+(install|ci|i|add)\b|\bpip\s+install\b/, tipo: "install", texto: "Instalando dependencias" },
  { re: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start)\b/, tipo: "servidor", texto: "Levantando la aplicación" },
  { re: /\b(migrate|migration|prisma\s+(db|migrate))\b/, tipo: "datos", texto: "Cambiando la estructura de la base de datos" },
  { re: /\bpsql\b|\bmysql\b|\bsqlite3\b/, tipo: "datos", texto: "Consultando la base de datos" },
  { re: /\bclaude\b.*--name\s+("?)([\w.-]+)\1/, tipo: "terminal", texto: null },
  { re: /\bcurl\b|\bInvoke-WebRequest\b|\biwr\b|\bwget\b/i, tipo: "red", texto: "Consultando un servicio" },
];

/** Describe una llamada a herramienta. Devuelve {simple, tecnico, cuenta, tipoComando}. */
export function describir(tool, input = {}) {
  const t = String(tool || "");
  const tl = t.toLowerCase();
  const f = archivo(input.file_path || input.notebook_path || input.path);
  const tec = (x) => corto(`${t}: ${x}`, 200);
  switch (tl) {
    case "read": return { simple: `Leyendo ${f}`, tecnico: tec(input.file_path || ""), cuenta: "leidos" };
    case "write": return { simple: `Creando ${f}`, tecnico: tec(input.file_path || ""), cuenta: "cambiados" };
    case "edit": case "multiedit": case "notebookedit": return { simple: `Modificando ${f}`, tecnico: tec(input.file_path || input.notebook_path || ""), cuenta: "cambiados" };
    case "grep": return { simple: `Buscando "${corto(input.pattern, 40)}" en el proyecto`, tecnico: tec(`${input.pattern} ${input.path || ""}`), cuenta: "buscados" };
    case "glob": return { simple: `Buscando archivos ${corto(input.pattern, 40)}`, tecnico: tec(input.pattern || ""), cuenta: "buscados" };
    case "webfetch": case "websearch": return { simple: "Consultando internet", tecnico: tec(input.url || input.query || ""), cuenta: "comandos" };
    case "agent": case "task": return { simple: `Pidiéndole ayuda a "${corto(input.description || input.subagent_type || "un agente", 50)}"`, tecnico: tec(`${input.subagent_type || ""} · ${input.description || ""}${input.model ? " · " + input.model : ""}`) };
    case "workflow": return { simple: "Poniendo en marcha un flujo con varios agentes", tecnico: tec(input.scriptPath || input.name || "script") };
    case "skill": return { simple: `Usando la skill ${corto(input.skill, 40)}`, tecnico: tec(`${input.skill || ""} ${input.args || ""}`) };
    case "sendmessage": return { simple: `Le escribió a ${corto(input.to, 40)}`, tecnico: tec(`to ${input.to || ""}: ${input.summary || input.message || ""}`) };
    case "todowrite": case "taskcreate": case "taskupdate": return { simple: "Actualizando su lista de tareas", tecnico: tec("lista de tareas") };
    case "askuserquestion": return { simple: "Te hizo una pregunta y espera tu respuesta", tecnico: tec("AskUserQuestion") };
    case "toolsearch": return { simple: "Cargando herramientas", tecnico: tec(input.query || "") };
    case "listagents": return { simple: "Revisando qué otras sesiones están abiertas", tecnico: tec("ListAgents") };
    case "enterplanmode": case "exitplanmode": return { simple: "Organizando el plan antes de tocar código", tecnico: tec(tl) };
    case "bash": case "powershell": return comando(input.command, input.description, t);
  }
  if (tl.startsWith("mcp__")) {
    const [, servidor = "", ...accion] = t.split("__");
    return { simple: `Usando una herramienta externa: ${corto(servidor, 30)}`, tecnico: tec(accion.join("_")), cuenta: "comandos" };
  }
  return { simple: `Usando la herramienta ${corto(t, 40)}`, tecnico: tec(JSON.stringify(input).slice(0, 120)) };
}

function comando(cmd, descripcion, tool) {
  const c = String(cmd || "");
  for (const r of COMANDOS) {
    const m = c.match(r.re);
    if (!m) continue;
    if (r.tipo === "terminal") return { simple: `Abriendo la terminal "${m[2]}"`, tecnico: corto(`${tool}: ${c}`, 200), cuenta: "comandos", tipoComando: "terminal", terminal: m[2] };
    return { simple: r.texto, tecnico: corto(`${tool}: ${c}`, 200), cuenta: r.tipo === "pruebas" ? "pruebas" : "comandos", tipoComando: r.tipo };
  }
  return { simple: descripcion ? corto(descripcion, 80) : "Ejecutando un comando", tecnico: corto(`${tool}: ${c}`, 200), cuenta: "comandos", tipoComando: "otro" };
}

/** Texto de un tool_result → contenido plano. */
export function textoResultado(contenido) {
  if (typeof contenido === "string") return contenido;
  if (Array.isArray(contenido)) return contenido.map((b) => (b && b.type === "text" ? b.text : "")).join("\n");
  return "";
}

/**
 * Interpreta el resultado real de una herramienta.
 * Devuelve {simple, tecnico, clase, pruebas?} o null si no hay nada que destacar.
 */
export function resultado(desc, esError, contenido, input = {}) {
  const s = textoResultado(contenido);
  if (/User rejected tool use|doesn't want to proceed with this tool use/i.test(s)) {
    return { simple: `Rechazaste el permiso para: ${(desc.simple || "esta acción").toLowerCase()}`, tecnico: "User rejected tool use", clase: "permiso", rechazo: true };
  }
  if (esError && /requested permissions? to|permission (was )?denied|not allowed|sin permiso/i.test(s)) {
    return { simple: `Sin permiso para: ${(desc.simple || "esta acción").toLowerCase()}`, tecnico: corto(s.split(/\r?\n/)[0], 200), clase: "permiso" };
  }
  if (esError) {
    const primera = s.split(/\r?\n/).find((l) => l.trim()) || "error";
    return { simple: `✗ Algo falló: ${corto(primera, 110)}`, tecnico: corto(primera, 200), clase: "error", fallo: true };
  }
  if (desc.tipoComando === "pruebas") {
    const pasan = s.match(/(\d+)\s+(passed|pasaron|passing)/i) || s.match(/# pass\s+(\d+)/i);
    const fallan = s.match(/(\d+)\s+(failed|failing|fallaron)/i) || s.match(/# fail\s+(\d+)/i);
    const nP = pasan ? Number(pasan[1]) : null, nF = fallan ? Number(fallan[1]) : 0;
    if (nP != null || nF) {
      const total = (nP || 0) + nF;
      if (nF > 0) return { simple: `✗ Pruebas: ${nF} fallaron de ${total}`, tecnico: corto(s.split(/\r?\n/).filter((l) => /fail|pass/i.test(l)).slice(-1)[0] || "", 200), clase: "error", fallo: true, pruebas: { pasan: nP || 0, total } };
      return { simple: `✓ Pruebas pasando: ${nP} de ${total}`, tecnico: `${nP} passed`, clase: "ok", pruebas: { pasan: nP, total } };
    }
  }
  if (desc.tipoComando === "git" && /^\[[\w./-]+\s+[0-9a-f]{7,}\]/m.test(s)) return { simple: "✓ Cambios guardados con git", tecnico: corto(s.split(/\r?\n/)[0], 200), clase: "ok" };
  if (/^read$/i.test(input.__tool || "") && esSensible(input.file_path)) return null;
  return null;
}

/** Nombre legible de un modelo a partir de su id o alias. */
export function nombreModelo(id) {
  if (!id) return null;
  const s = String(id).toLowerCase().replace(/\[1m\]$/, "");
  const m = s.match(/(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-|$)/);
  const cap = (x) => x[0].toUpperCase() + x.slice(1);
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  if (/^(opus|sonnet|haiku|fable)$/.test(s)) return cap(s);
  return String(id);
}

/** «45 s», «12 min», «2 h 05 min». */
export function duracionTexto(ms) {
  if (!(ms >= 0)) return "—";
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return h + " h " + String(m).padStart(2, "0") + " min";
  if (m) return m + " min";
  return s + " s";
}

/** Lee la autoevaluación que la propia IA escribe al terminar:
 *  «AUTOEVALUACIÓN: 7/10», seguida (opcionalmente) de «Bien: …» y «Mejorar: …». Nunca se inventa: sin esa línea, null. */
export function autoevaluacion(texto) {
  if (typeof texto !== "string") return null;
  const m = /AUTOEVALUACI[OÓ]N\**\s*[:：\-–—]?\s*\**\s*(\d{1,2})\s*\/\s*10/i.exec(texto);
  if (!m) return null;
  const nota = Number(m[1]); if (nota < 1 || nota > 10) return null;
  const resto = texto.slice(m.index);
  const campo = (nombre) => { const r = new RegExp("(?:^|\\n)\\s*[-*•]?\\s*\\**" + nombre + "\\**\\s*[:：]\\s*\\**\\s*(.+)", "i").exec(resto); return r ? corto(r[1].replace(/\*\*/g, "").trim(), 240) : null; };
  return { nota, bien: campo("bien"), mejorar: campo("mejorar") };
}
