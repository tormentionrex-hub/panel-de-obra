// Panel de Obra · simulador de F1.
// Sirve la página real (plugin/web) y reproduce una obra INVENTADA por el mismo canal en vivo (SSE)
// y con el mismo formato de mensajes que usará el servidor de verdad en F2.
// Uso:  node herramientas/simulador.mjs [--puerto 47821] [--velocidad 1] [--abrir]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const PUERTO = Number(arg("puerto", 47821));
const VELOCIDAD = Math.max(0.1, Number(arg("velocidad", 1)));
const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "web");

const CABECERAS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};
const TIPOS = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const ARCHIVOS = { "/": "index.html", "/index.html": "index.html", "/panel.css": "panel.css", "/panel.js": "panel.js" };

// ── estado (mismo modelo que mandará el servidor real) ──────
let st;
function reiniciar() {
  st = { obra: null, agentes: new Map(), lineas: new Map(), bitacora: [], asesor: { modelo: "Opus 5.5", estado: "espera", consultas: 0, tokens: 0, ultima: null, lista: [], nota: "Con Opus 5.5 el consejo llega cifrado: Claude Code no deja leer su texto." } };
}
const clientes = new Set();
function emitir(msg) { const s = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clientes) c.write(s); }
function snapshot() {
  return { tipo: "snapshot", modo: "simulacion", servidorAhora: Date.now(), obra: st.obra, agentes: [...st.agentes.values()],
    lineas: Object.fromEntries(st.lineas), bitacora: st.bitacora, asesor: st.asesor };
}

// ── ayudas del guion ────────────────────────────────────────
const ROL_BITACORA = { principal: "principal", subagente: "subagente", terminal: "terminal" };
function obra(o) { st.obra = { ...(st.obra || {}), ...o }; emitir({ tipo: "obra", obra: st.obra }); }
function agente(id, cambios) {
  const a = { contadores: {}, tokens: 0, ...(st.agentes.get(id) || { id, inicio: Date.now(), fin: null }), ...cambios };
  if (["termino", "fallo", "detenido"].includes(a.estado) && !a.fin) a.fin = Date.now();
  st.agentes.set(id, a);
  emitir({ tipo: "agente", agente: a });
  return a;
}
function linea(id, simple, tecnico, { clase = null, cuenta = null, tokens = 900, ahora = clase !== "error" && clase !== "ok" } = {}) {
  const l = { t: Date.now(), simple, tecnico, clase };
  const arr = st.lineas.get(id) || []; arr.push(l); st.lineas.set(id, arr);
  emitir({ tipo: "linea", agenteId: id, linea: l });
  const a = st.agentes.get(id);
  const contadores = { ...a.contadores };
  if (cuenta) contadores[cuenta] = (contadores[cuenta] || 0) + 1;
  agente(id, { contadores, tokens: (a.tokens || 0) + tokens, ...(a.rol === "principal" ? { contexto: (a.contexto || 0) + tokens * 4 } : {}), ...(ahora ? { ahora: { simple, tecnico } } : {}) });
}
function bitacora(id, texto) {
  const a = st.agentes.get(id);
  const item = id === "asesor"
    ? { t: Date.now(), actor: "Asesor", rol: "asesor", texto }
    : { t: Date.now(), actor: a ? a.nombre : id, rol: a ? ROL_BITACORA[a.rol] : id, texto };
  st.bitacora.push(item);
  emitir({ tipo: "bitacora", item });
}
function asesor(cambios) { st.asesor = { ...st.asesor, ...cambios }; emitir({ tipo: "asesor", asesor: st.asesor }); }
function consulta(quienId, antes, tokens, momento = null) {
  const a = st.agentes.get(quienId);
  asesor({ estado: "consultando" });
  bitacora("asesor", `${a.nombre} consultó al asesor`);
  return () => {
    const q = { t: Date.now(), quien: a.nombre, resultado: "revisó (consejo cifrado)", antes, momento };
    asesor({ estado: "reviso", consultas: st.asesor.consultas + 1, tokens: st.asesor.tokens + tokens, ultima: q, lista: [...st.asesor.lista, q] });
    bitacora("asesor", `Revisó la consulta ${st.asesor.consultas} (pedida por ${a.nombre})`);
  };
}
reiniciar();

// ── guion: una obra inventada de ~2 minutos ─────────────────
const P = "principal", C = "constructor-pedidos", L = "lector-docs", S = "lente-seguridad", B = "backend-pedidos", F = "frontend-pedidos";
let fin1, fin2, fin3;
const GUION = [
  [0, () => {
    obra({ id: "obra-ejemplo", titulo: "Migrar pedidos a la nueva API (ejemplo)", skills: ["director-de-obra"], proyecto: "proyecto-ejemplo", comando: "/director-de-obra migrar el módulo de pedidos a la nueva API, con pruebas" });
    agente(P, { rol: "principal", nombre: "Director de obra", tipo: "sesión principal", modelo: "Opus 5.5", modeloConfirmado: true, esfuerzo: "high", estado: "trabajando", contexto: 48200,
      tarea: "/director-de-obra migrar el módulo de pedidos a la nueva API, con pruebas", pidio: "Tú", resultado: null });
    bitacora(P, "Se activó director-de-obra");
    linea(P, "Leyendo SPEC.md", "Read specs/pedidos/SPEC.md", { cuenta: "leidos" });
  }],
  [3, () => linea(P, "Escribiendo el plan de la obra", "Write specs/pedidos/COLA.md", { cuenta: "cambiados" })],
  [5, () => { fin1 = consulta(P, "escribió el plan de la obra", 152300, "plan"); linea(P, "Consultando al asesor antes de repartir el trabajo", "advisor → server_tool_use", { clase: "ahora" }); }],
  [9, () => fin1()],
  [10, () => {
    linea(P, 'Pidiéndole ayuda a "constructor-pedidos"', 'Agent(subagent_type: obra-constructor, description: "constructor-pedidos")');
    agente(C, { rol: "subagente", nombre: "constructor-pedidos", tipo: "obra-constructor", modelo: null, esfuerzo: null, estado: "trabajando",
      tarea: "Corregir las pruebas del módulo de pedidos. Archivos tuyos: src/pedidos.ts y src/pedidos.test.ts. No toques nada más.", pidio: "Director de obra",
      ahora: { simple: "Recibió su tarea", tecnico: "SubagentStart" } });
    bitacora(P, 'Le pidió ayuda a "constructor-pedidos"');
  }],
  [11.5, () => agente(C, { modelo: "Sonnet 5.5", modeloConfirmado: true })],
  [12, () => {
    linea(P, 'Pidiéndole ayuda a "lector-docs"', 'Agent(subagent_type: lector, description: "lector-docs")');
    agente(L, { rol: "subagente", nombre: "lector-docs", tipo: "lector", modelo: "Sonnet 5.5", modeloConfirmado: false, esfuerzo: "low", estado: "trabajando",
      tarea: "Busca en la documentación de la nueva API cómo se calculan los descuentos y resume en 5 líneas.", pidio: "Director de obra" });
    linea(C, "Leyendo pedidos.ts", "Read src/pedidos.ts", { cuenta: "leidos" });
  }],
  [13, () => { agente(L, { modeloConfirmado: true }); agente(C, { esfuerzo: "high" }); linea(L, 'Buscando "descuento" en el proyecto', 'Grep "descuento" src/', { cuenta: "buscados" }); }],
  [14, () => {
    agente(S, { rol: "subagente", nombre: "lente-seguridad", tipo: "obra-lente", modelo: null, esfuerzo: null, estado: "trabajando",
      tarea: "Intenta demostrar que el cambio de pedidos tiene un fallo grave de seguridad o de acceso. Reproduce, no razones.", pidio: "Director de obra" });
    linea(C, "Leyendo pedidos.test.ts", "Read src/pedidos.test.ts", { cuenta: "leidos" });
    bitacora(P, 'Le pidió ayuda a "lente-seguridad"');
  }],
  [15.5, () => agente(S, { modelo: "Opus 5.5", modeloConfirmado: true, esfuerzo: "medium" })],
  [16, () => linea(L, "Consultando internet", "WebFetch https://api.ejemplo.dev/docs/descuentos")],
  [17, () => linea(S, "Leyendo auth.ts", "Read src/auth.ts", { cuenta: "leidos" })],
  [18, () => linea(C, "Modificando pedidos.ts", "Edit src/pedidos.ts", { cuenta: "cambiados", tokens: 2400 })],
  [20, () => { linea(C, "Corriendo las pruebas", "Bash: npm test -- pedidos", { clase: "ahora", cuenta: "pruebas" }); }],
  [22, () => linea(L, "Leyendo 12 archivos de la carpeta docs", "Read docs/** (12)", { cuenta: "leidos" })],
  [24, () => { linea(C, "✗ Una prueba falló: el total con descuento no cuadra", "Exit 1 · 1 failed, 47 passed", { clase: "error", cuenta: "fallos" }); bitacora(C, "Una prueba falló, está corrigiendo"); obra({ pruebas: { pasan: 47, total: 48, quien: "constructor-pedidos" } }); }],
  [25, () => linea(S, 'Buscando "token" en el proyecto', 'Grep "token" src/', { cuenta: "buscados" })],
  [27, () => linea(C, "Modificando pedidos.ts", "Edit src/pedidos.ts", { cuenta: "cambiados", tokens: 1800 })],
  [28, () => {
    agente(S, { estado: "permiso", estadoTexto: "Espera tu permiso para ejecutar un comando", ahora: { simple: "Quiere ejecutar un comando que consulta un servidor", tecnico: "PermissionRequest · Bash: curl -s https://api.ejemplo.dev/health" } });
    linea(S, "Pide permiso para ejecutar un comando", "PermissionRequest Bash(curl -s https://api.ejemplo.dev/health)", { clase: "permiso", ahora: false });
    bitacora(S, "Espera tu permiso");
  }],
  [29, () => linea(C, "Corriendo las pruebas", "Bash: npm test -- pedidos", { clase: "ahora", cuenta: "pruebas" })],
  [31, () => {
    obra({ skills: ["director-de-obra", "subagentes"] });
    linea(P, "Abriendo 2 terminales con nombre", 'Bash: wt new-tab … claude --name backend-pedidos / frontend-pedidos', { cuenta: "comandos" });
    bitacora(P, "Se activó subagentes: abre 2 terminales");
  }],
  [32, () => {
    linea(C, "✓ Pruebas pasando: 48 de 48", "Exit 0 · 48 passed", { clase: "ok" }); obra({ pruebas: { pasan: 48, total: 48, quien: "constructor-pedidos" } });
    agente(B, { rol: "terminal", nombre: "backend-pedidos", tipo: "terminal aparte", modelo: "Sonnet 5.5", modeloConfirmado: true, esfuerzo: "high", estado: "trabajando",
      tarea: "Eres backend-pedidos. Tu carril: la API de pedidos (src/api/**). Anota tu avance en el tablero y avisa a frontend-pedidos cuando el endpoint esté listo.", pidio: "Director de obra" });
    agente(F, { rol: "terminal", nombre: "frontend-pedidos", tipo: "terminal aparte", modelo: "Opus 5.5", modeloConfirmado: true, esfuerzo: "xhigh", estado: "trabajando",
      tarea: "Eres frontend-pedidos. Tu carril: la pantalla de pedidos (web/pedidos/**). Espera el aviso de backend-pedidos antes de conectar la API.", pidio: "Director de obra" });
    bitacora(B, "Se abrió la terminal"); bitacora(F, "Se abrió la terminal");
  }],
  [34, () => {
    agente(C, { estado: "termino", resultado: "Arreglé el cálculo del descuento en pedidos.ts. Las 48 pruebas pasan. No toqué otros archivos.", ahora: { simple: "Terminó", tecnico: "SubagentStop" } });
    bitacora(C, "Terminó: pruebas pasando 48 de 48");
    linea(B, "Leyendo el tablero de la obra", "Read tablero-subagentes.md", { cuenta: "leidos" });
  }],
  [36, () => { linea(F, "Leyendo pedidos.vue", "Read web/pedidos/Pedidos.vue", { cuenta: "leidos" }); linea(L, "Resumiendo lo que encontró", "Read docs/descuentos.md", { cuenta: "leidos" }); }],
  [38, () => linea(B, "Creando ruta-pedidos.ts", "Write src/api/ruta-pedidos.ts", { cuenta: "cambiados", tokens: 3100 })],
  [40, () => {
    agente(S, { estado: "trabajando", estadoTexto: null, ahora: { simple: "Sigue sin ese comando", tecnico: "tool_result: User rejected tool use" } });
    linea(S, "Rechazaste el permiso para ejecutar ese comando", "User rejected tool use: Bash(curl …)", { clase: "permiso", ahora: false });
    bitacora(S, "Rechazaste su permiso; sigue sin ese comando");
  }],
  [42, () => linea(F, "Modificando pedidos.vue", "Edit web/pedidos/Pedidos.vue", { cuenta: "cambiados", tokens: 2600 })],
  [44, () => { agente(L, { estado: "detenido", estadoTexto: "Detenido: lo paraste tú", resultado: "Se detuvo antes de terminar el resumen.", ahora: { simple: "Lo detuviste", tecnico: "task-notification status=killed" } }); bitacora(L, "Lo detuviste antes de terminar"); }],
  [45, () => linea(B, "Corriendo las pruebas", "Bash: npm test -- api", { clase: "ahora", cuenta: "pruebas" })],
  [47, () => {
    agente(F, { estado: "permiso", estadoTexto: "Espera tu permiso para instalar una librería", ahora: { simple: "Quiere instalar una librería nueva", tecnico: "PermissionRequest · Bash: npm install date-fns" } });
    linea(F, "Pide permiso para instalar una librería", "PermissionRequest Bash(npm install date-fns)", { clase: "permiso", ahora: false });
    bitacora(F, "Espera tu permiso");
  }],
  [49, () => { linea(B, "✗ La misma prueba falló otra vez", "Exit 1 · 1 failed", { clase: "error", cuenta: "fallos" }); bitacora(B, "La misma prueba falló 2 veces"); obra({ pruebas: { pasan: 20, total: 21, quien: "backend-pedidos" } }); fin2 = consulta(B, "la misma prueba falló 2 veces", 98400, "error"); }],
  [52, () => {
    fin2();
    agente(F, { estado: "trabajando", estadoTexto: null });
    linea(F, "Aceptaste el permiso: instalando la librería", "Bash: npm install date-fns", { clase: "ok", cuenta: "comandos" });
  }],
  [54, () => linea(S, "Ejecutando un intento de acceso sin sesión", "Bash: node scripts/probar-acceso.mjs", { cuenta: "comandos" })],
  [56, () => linea(B, "Modificando ruta-pedidos.ts", "Edit src/api/ruta-pedidos.ts", { cuenta: "cambiados" })],
  [58, () => {
    agente(S, { estado: "termino", resultado: "No encontré fallos graves: sin sesión, la ruta de pedidos responde 401. Dejé la evidencia en el tablero.", ahora: { simple: "Terminó", tecnico: "SubagentStop" } });
    bitacora(S, "Terminó: sin fallos graves");
  }],
  [60, () => { linea(B, "✓ Pruebas pasando: 21 de 21", "Exit 0 · 21 passed", { clase: "ok", cuenta: "pruebas" }); obra({ pruebas: { pasan: 21, total: 21, quien: "backend-pedidos" } }); }],
  [62, () => { linea(B, 'Le escribió a "frontend-pedidos": el endpoint está listo', 'SendMessage(to: frontend-pedidos)', { cuenta: "comandos" }); bitacora(B, "→ frontend-pedidos: el endpoint está listo"); }],
  [64, () => { agente(B, { estado: "espera", estadoTexto: "Terminó su turno; espera instrucciones", resultado: "La ruta /pedidos está lista y probada (21 de 21). Avisé a frontend-pedidos." }); bitacora(B, "Terminó su turno"); }],
  [66, () => linea(F, "Conectando la pantalla con la API", "Edit web/pedidos/api.ts", { cuenta: "cambiados" })],
  [70, () => {
    agente(F, { estado: "fallo", estadoTexto: "Se detuvo por un error del servicio", resultado: "Claude Code no pudo continuar: el servicio respondió «sobrecargado». Habría que reanudar esta terminal.", ahora: { simple: "Se detuvo por un error del servicio", tecnico: "StopFailure · overloaded_error" } });
    linea(F, "✗ Se detuvo por un error del servicio", "StopFailure: overloaded_error", { clase: "error", cuenta: "fallos", ahora: false });
    bitacora(F, "Se detuvo por un error del servicio");
  }],
  [74, () => linea(P, "Revisando lo que entregaron los agentes", "Read tablero-subagentes.md", { cuenta: "leidos" })],
  [75, () => { fin3 = consulta(P, "revisó lo que entregaron los agentes", 181500, "fin"); }],
  [77, () => fin3()],
  [78, () => {
    agente(P, { estado: "espera", estadoTexto: "Terminó su turno; espera instrucciones", resultado: "Obra al 80 %: pedidos y API listos; frontend-pedidos se detuvo por un error del servicio y hay que reanudarlo." });
    bitacora(P, "Terminó su turno");
  }],
];
const DURACION = 95;

let temporizadores = [];
function correrGuion() {
  for (const t of temporizadores) clearTimeout(t);
  reiniciar();
  emitir(snapshot());
  temporizadores = GUION.map(([s, f]) => setTimeout(f, (s * 1000) / VELOCIDAD));
  temporizadores.push(setTimeout(correrGuion, (DURACION * 1000) / VELOCIDAD));
}

// ── servidor (solo 127.0.0.1) ───────────────────────────────
const servidor = createServer(async (req, res) => {
  const host = req.headers.host || "";
  if (host !== `127.0.0.1:${PUERTO}` && host !== `localhost:${PUERTO}`) { res.writeHead(421).end(); return; }
  const url = new URL(req.url, `http://${host}`);
  if (req.method !== "GET") { res.writeHead(405, CABECERAS).end(); return; }
  if (url.pathname === "/events") {
    res.writeHead(200, { ...CABECERAS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clientes.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => { clearInterval(ping); clientes.delete(res); });
    return;
  }
  if (url.pathname === "/api/snapshot") { res.writeHead(200, { ...CABECERAS, "Content-Type": "application/json" }).end(JSON.stringify(snapshot())); return; }
  const nombre = ARCHIVOS[url.pathname];
  if (!nombre) { res.writeHead(404, CABECERAS).end("No existe"); return; }
  try {
    const cuerpo = await readFile(join(WEB, nombre));
    res.writeHead(200, { ...CABECERAS, "Content-Type": TIPOS[nombre.slice(nombre.lastIndexOf("."))] }).end(cuerpo);
  } catch { res.writeHead(500, CABECERAS).end(); }
});
servidor.listen(PUERTO, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PUERTO}/`;
  console.log(`Simulador del Panel de Obra (datos de ejemplo): ${url}  · velocidad ×${VELOCIDAD} · Ctrl+C para salir`);
  correrGuion();
  if (process.argv.includes("--abrir")) {
    const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  }
});
