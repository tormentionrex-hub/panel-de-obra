// Panel de Obra · cliente. Estética de la animación de referencia: ventana de terminal, árbol de cajas,
// conectores con puntos que viajan. Regla de oro: todo texto del servidor se pinta con textContent.
"use strict";

(() => {
  const ESTADOS = {
    trabajando: { texto: "trabajando", icono: null },
    permiso: { texto: "espera tu permiso", icono: "◆" },
    termino: { texto: "terminó", icono: "✓" },
    fallo: { texto: "falló", icono: "✗" },
    detenido: { texto: "detenido", icono: "■" },
    espera: { texto: "esperando instrucciones", icono: "○" },
  };
  const ESFUERZO = { low: "bajo", medium: "medio", high: "alto", xhigh: "muy alto", max: "máximo", "no-aplica": "no aplica" };
  const NIVEL = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 };
  const ASESOR_ESTADO = { apagado: "apagado", espera: "de guardia", consultando: "consultando…", reviso: "revisó", nego: "se negó", no_disponible: "no disponible" };
  const GIRO = ["◐", "◓", "◑", "◒"];
  const MINI_LINEAS = 2, MAX_LINEAS = 400, MAX_BITACORA = 300;
  const SVG = "http://www.w3.org/2000/svg";
  const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const estado = {
    desfase: 0, modo: leer("modo", "simple"), obra: null, agentes: new Map(), lineas: new Map(),
    bitacora: [], asesor: null, simulacion: false, ritmo: [], ultimoTotal: null,
  };

  // ── utilidades ─────────────────────────────────────────────
  function el(tag, props, ...hijos) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const h of hijos) if (h != null && h !== false) n.append(h);
    return n;
  }
  function svg(tag, attrs, ...hijos) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if ((k === "fill" || k === "stroke") && String(v).startsWith("var(")) n.style[k] = v; // var() solo funciona como estilo
      else n.setAttribute(k, v);
    }
    for (const h of hijos) if (h) n.append(h);
    return n;
  }
  const $ = (id) => document.getElementById(id);
  function leer(k, d) { try { return localStorage.getItem("panel." + k) || d; } catch { return d; } }
  function guardar(k, v) { try { localStorage.setItem("panel." + k, v); } catch { /* sin almacenamiento */ } }
  const ahora = () => Date.now() + estado.desfase;
  const hora = (t) => new Date(t).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  function duracion(ms) {
    if (!(ms >= 0)) return "—";
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60, d = (x) => String(x).padStart(2, "0");
    return h ? `${h}:${d(m)}:${d(r)}` : `${d(m)}:${d(r)}`;
  }
  function k(n) { if (n == null) return "—"; if (n < 1000) return String(n); return (n / 1000).toLocaleString("es", { maximumFractionDigits: n < 10000 ? 1 : 0 }) + "k"; }
  const texto = (p) => (p ? (estado.modo === "tecnico" ? p.tecnico || p.simple : p.simple || p.tecnico) || "" : "");
  const span = (cls, t) => el("span", { class: cls, text: t });
  function barras(esfuerzo) {
    const n = NIVEL[esfuerzo] || 0;
    return el("span", { class: "barras", "aria-hidden": "true" }, "▮".repeat(n), span("vacia", "▯".repeat(4 - n)));
  }
  function esfuerzoNodo(a) {
    if (!a.esfuerzo) return span("porconfirmar", "esfuerzo por confirmar");
    return el("span", null, span("k", "esfuerzo "), barras(a.esfuerzo), " " + (ESFUERZO[a.esfuerzo] || a.esfuerzo));
  }
  function modeloNodo(a) {
    if (!a.modelo) return span("porconfirmar", "modelo por confirmar");
    return el("span", null, a.modelo, a.modeloConfirmado ? null : span("porconfirmar", " (por confirmar)"));
  }
  function moda(lista) { const c = new Map(); for (const x of lista) if (x) c.set(x, (c.get(x) || 0) + 1); let m = null, n = 0; for (const [x, v] of c) if (v > n) { m = x; n = v; } return m; }
  function anunciar(msg) { const z = $("anuncios"); z.textContent = ""; setTimeout(() => { z.textContent = msg; }, 50); }
  const lista = (rol) => [...estado.agentes.values()].filter((a) => a.rol === rol).sort((x, y) => (x.inicio || 0) - (y.inicio || 0));

  // ── estado (icono + texto + reloj) ─────────────────────────
  function pintarEstado(nodo, a) {
    const info = ESTADOS[a.estado] || { texto: a.estado, icono: "·" };
    nodo.dataset.estado = a.estado;
    const icono = el("span", { class: "estado__icono", "aria-hidden": "true", text: info.icono || GIRO[0] });
    if (a.estado === "trabajando" && !quieto) icono.dataset.gira = "1";
    const reloj = el("span", { class: "estado__reloj", "data-inicio": a.inicio || "", "data-fin": a.fin || "" });
    nodo.replaceChildren(icono, span(null, a.estadoTexto || info.texto), reloj);
    reloj_(reloj);
  }
  function reloj_(r) { const i = Number(r.dataset.inicio), f = Number(r.dataset.fin) || null; r.textContent = !i ? "" : f ? "· tardó " + tardo(f - i) : "· " + duracion(ahora() - i); }
  function tardo(ms) { const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")} min` : m ? `${m} min` : `${s} s`; }
  // nota que la propia IA se puso al terminar (nunca la pone el panel)
  function notaNodo(a) {
    if (a.rol === "principal") return null;
    const e = a.evaluacion;
    if (!e) return a.fin ? el("p", { class: "caja__nota" }, span("porconfirmar", "sin autoevaluación")) : null;
    return el("p", { class: "caja__nota", "data-nivel": e.nota >= 8 ? "alta" : e.nota >= 5 ? "media" : "baja", title: [e.bien && "Bien: " + e.bien, e.mejorar && "Mejorar: " + e.mejorar].filter(Boolean).join("\n") },
      span("k", "autoevaluación "), el("b", { text: `${e.nota}/10` }));
  }

  // ── cajas de agentes ───────────────────────────────────────
  function miniTerminal(id) {
    const ls = (estado.lineas.get(id) || []).slice(-MINI_LINEAS);
    return el("ol", { class: "caja__mini", "aria-label": "Últimas acciones" }, ...ls.map((l) => el("li", { class: l.clase || null, text: `${hora(l.t).slice(0, 5)} ${texto(l)}` })));
  }
  function cajaAgente(a) {
    const est = el("p", { class: "estado" }); pintarEstado(est, a);
    const principal = a.rol === "principal";
    const cuerpo = principal
      ? [el("p", { class: "caja__titulo-rol" }, modeloNodo(a), " · sesión principal"),
         el("p", { class: "caja__linea", text: rolPrincipal() }),
         el("p", { class: "caja__linea" }, esfuerzoNodo(a)),
         el("p", { class: "caja__linea" }, span("k", "contexto "), a.contexto != null ? k(a.contexto) : span("porconfirmar", "desconocido"))]
      : [el("p", { class: "caja__nombre", text: a.nombre }),
         el("p", { class: "caja__modelo" }, modeloNodo(a)),
         el("p", { class: "caja__linea" }, esfuerzoNodo(a))];
    const caja = el("a", { class: "caja", href: "#/agente/" + encodeURIComponent(a.id), "data-rol": a.rol, "data-estado": a.estado, "data-id": a.id, "aria-label": `Ver más sobre ${a.nombre}` },
      ...cuerpo,
      el("p", { class: "caja__ahora", title: texto(a.ahora) }, texto(a.ahora) || "—"),
      est, notaNodo(a), miniTerminal(a.id), span("caja__vermas", "ver más ▸"));
    return caja;
  }
  // ── procesos en segundo plano (no son agentes) ─────────────
  const VIVO = new Set(["running", "pending"]);
  const PROC = { running: ["en marcha", null, "trabajando"], pending: ["en espera", "○", "espera"], completed: ["terminó", "✓", "termino"], failed: ["falló", "✗", "fallo"], killed: ["detenido", "■", "detenido"] };
  function pintarProcesos() {
    const l = estado.procesos || [];
    const ul = $("lista-procesos");
    if (!l.length) { ul.replaceChildren(el("li", { class: "porconfirmar", text: "ninguno por ahora" })); return; }
    const tecnico = estado.modo === "tecnico";
    ul.replaceChildren(...[...l].reverse().map((p) => {
      const [txt, ic, clase] = PROC[p.estado] || [p.estado || "desconocido", "·", "espera"];
      const vivo = VIVO.has(p.estado);
      const icono = el("span", { class: "proceso__icono", "aria-hidden": "true", text: ic || GIRO[0] });
      if (vivo && !quieto) icono.dataset.gira = "1";
      const titulo = tecnico ? el("code", { class: "proceso__cmd", text: p.tecnico || p.simple || "—" }) : el("span", { class: "proceso__que", text: p.simple || "proceso en segundo plano" });
      const extra = tecnico ? [p.descripcion, p.id].filter(Boolean).join(" · ") : (p.descripcion && p.descripcion !== p.simple ? p.descripcion : "");
      const r = el("span", { class: "estado__reloj", "data-inicio": p.inicio || "" }); if (p.fin) r.dataset.fin = p.fin; reloj_(r);
      return el("li", { class: "proceso", "data-estado": clase },
        icono,
        el("div", { class: "proceso__cuerpo" }, titulo, extra ? el("p", { class: "proceso__extra", text: extra }) : null),
        el("p", { class: "proceso__meta" }, el("span", { class: "proceso__estado", text: txt }), " ", r, el("span", { class: "k", text: " · lo lanzó " }), el("span", { class: "actor", "data-rol": p.quienRol || "principal", text: p.quien || "—" })));
    }));
  }
  function rolPrincipal() {
    const s = (estado.obra && estado.obra.skills) || [];
    if (s.includes("director-de-obra")) return "dirige la obra + revisa";
    if (s.includes("subagentes")) return "reparte + revisa";
    return "elige modelo + esfuerzo";
  }
  function latido(id) {
    if (quieto) return;
    const c = document.querySelector(`.caja[data-id="${CSS.escape(id)}"]`);
    if (!c) return; c.classList.add("latido"); setTimeout(() => c.classList.remove("latido"), 700);
  }

  // ── encabezado ─────────────────────────────────────────────
  function pintarEncabezado() {
    const p = lista("principal")[0];
    const hijos = [...lista("subagente"), ...lista("terminal")];
    const mHijos = moda(hijos.map((a) => a.modelo));
    const s = estado.asesor;
    const t = $("titular");
    const partes = [span(null, "PANEL DE OBRA")];
    const sep = () => span("sep", "·");
    if (p && p.modelo) partes.push(sep(), span("c-principal", p.modelo.toUpperCase()), " DIRIGE");
    if (mHijos) partes.push(sep(), span("c-subagente", mHijos.toUpperCase()), " CONSTRUYE");
    if (s) partes.push(sep(), span("c-asesor", s.estado === "apagado" ? "ASESOR" : (s.modelo || "ASESOR").toUpperCase()), s.estado === "apagado" ? " APAGADO" : " DE GUARDIA");
    t.replaceChildren(...partes);
    const eHijos = moda(hijos.map((a) => a.esfuerzo));
    const item = (color, txt) => el("li", null, el("i", { style: null, class: "c-" + color, "data-c": color }), txt);
    $("leyenda").replaceChildren(
      item("principal", `principal · ${p && p.esfuerzo ? ESFUERZO[p.esfuerzo] : "—"}`),
      item("subagente", `subagentes · ${eHijos ? ESFUERZO[eHijos] : "—"}`),
      item("terminal", "terminales · con nombre"),
      item("asesor", "asesor · advisor"));
    for (const i of $("leyenda").querySelectorAll("i")) i.style.background = `var(--${i.dataset.c})`;
    const o = estado.obra;
    $("ventana-titulo").textContent = o ? `~/${o.proyecto || "obra"} — panel de obra — ${o.titulo}` : "panel de obra — esperando a que una de tus skills empiece";
    $("aviso-simulacion").hidden = !estado.simulacion;
  }

  // ── columna del asesor ─────────────────────────────────────
  function pintarAsesor() {
    const s = estado.asesor || { estado: "apagado", consultas: 0 };
    const m = s.ultima && s.ultima.momento;
    const mom = (clave, txt) => el("p", { class: "momento" + (m === clave && s.estado !== "apagado" ? " activo" : ""), "data-momento": clave, text: txt });
    const ult = s.ultima;
    const caja = el("div", { class: "asesor" },
      el("p", { class: "asesor__cab" }, el("b", { text: `ASESOR${s.modelo ? " · " + s.modelo : ""}` }), el("br"), span(null, `advisor · ${ASESOR_ESTADO[s.estado] || s.estado}`)),
      mom("plan", "antes de un plan"),
      el("div", { class: "asesor__tramo" },
        el("p", { text: "lee toda la sesión, cada herramienta y cada resultado" }),
        el("p", null, span("k", "último consejo:"), el("br"), span("v", ult ? "» " + (ult.legible || "cifrado, no se puede leer") : "» todavía ninguno")),
        el("p", { class: "asesor__par" }, span(null, "consultas"), span("v", String(s.consultas ?? 0))),
        el("p", { class: "asesor__par" }, span(null, "tokens leídos"), span("v", s.tokens == null ? "—" : k(s.tokens))),
        ult ? el("p", null, span("k", `pidió ${ult.quien}`), el("br"), span("k", "justo antes: " + (ult.antes || "—"))) : null,
        el("p", { class: "k", text: "callado en los turnos de rutina" })),
      mom("error", "error repetido"),
      el("div", { class: "asesor__tramo" },
        el("p", { text: "nunca escribe código." }),
        el("p", { class: "verde", text: "los subagentes Sonnet lo heredan" })),
      mom("fin", "antes de terminar"),
      el("a", { class: "asesor__vermas", href: "#/asesor", text: "ver más ▸" }));
    $("col-asesor").replaceChildren(caja);
  }

  // ── árbol ──────────────────────────────────────────────────
  function pintarArbol() {
    const p = lista("principal")[0];
    $("caja-principal").replaceChildren(p ? cajaAgente(p) : el("div", { class: "caja", "data-rol": "principal" }, el("p", { class: "caja__titulo-rol", text: "sesión principal" }), el("p", { class: "porconfirmar", text: "esperando a que una de tus skills empiece" })));
    pintarRitmo();
    pintarActividad();
    pintarPruebas();
    pintarProcesos();
    const subs = lista("subagente"), terms = lista("terminal");
    const mS = moda(subs.map((a) => a.modelo)), eS = moda(subs.map((a) => a.esfuerzo));
    $("rotulo-subagentes").replaceChildren(...["reparte a subagentes", mS ? el("span", null, " · ", el("b", { text: mS })) : null, eS ? " · " + ESFUERZO[eS] : null].filter(Boolean));
    for (const b of $("rotulo-subagentes").querySelectorAll("b")) b.style.color = "var(--subagente)";
    $("lista-subagentes").replaceChildren(...(subs.length ? subs.map(cajaAgente) : [el("p", { class: "porconfirmar", text: "ningún subagente todavía" })]));
    $("rotulo-terminales").replaceChildren(...["abre terminales con nombre", terms.length ? " · " + terms.length : null].filter(Boolean));
    $("lista-terminales").replaceChildren(...(terms.length ? terms.map(cajaAgente) : [el("p", { class: "porconfirmar", text: "ninguna terminal abierta por esta obra" })]));
    const vuelta = el("div", { class: "caja", "data-rol": "vuelta", id: "vuelta" },
      el("p", { class: "caja__titulo-rol", text: `vuelve al principal${p && p.esfuerzo ? " · " + ESFUERZO[p.esfuerzo] : ""}` }),
      el("p", { class: "caja__linea", text: p && p.estado === "espera" ? (p.estadoTexto || "terminó su turno") : "revisa + integra" }));
    $("caja-vuelta").replaceChildren(vuelta);
    pintarAsesor();
    pintarEncabezado();
    pintarPie();
    requestAnimationFrame(dibujarConectores);
  }
  function pintarRitmo() {
    const datos = estado.ritmo.slice(-12);
    const max = Math.max(1, ...datos);
    const chispa = svg("svg", { class: "chispa", viewBox: "0 0 120 22", preserveAspectRatio: "none", "aria-hidden": "true" },
      ...datos.map((v, i) => svg("rect", { x: i * 10, y: 22 - Math.round((v / max) * 20), width: 9, height: Math.max(1, Math.round((v / max) * 20)), fill: "var(--principal)" })));
    const ultimo = datos.length ? datos[datos.length - 1] : null;
    $("caja-ritmo").replaceChildren(el("div", { class: "caja", "data-rol": "mini-p" },
      el("p", { class: "mini__titulo", text: "RITMO" }), chispa,
      el("p", { class: "mini__dato" }, span("k", "tok/10 s"), span(null, ultimo == null ? "—" : k(ultimo))),
      el("p", { class: "mini__dato" }, span("k", "agentes"), span(null, String(estado.agentes.size)))));
  }
  function totales() {
    const t = { leidos: 0, buscados: 0, cambiados: 0, comandos: 0, pruebas: 0, fallos: 0 };
    for (const a of estado.agentes.values()) for (const c in t) t[c] += (a.contadores && a.contadores[c]) || 0;
    return t;
  }
  function pintarActividad() {
    const t = totales();
    const filas = [["leyó archivos", t.leidos, "leidos"], ["cambió archivos", t.cambiados, "cambiados"], ["corrió comandos", t.comandos + t.pruebas, "comandos"], ["cosas que fallaron", t.fallos, "fallos"]];
    const max = Math.max(1, ...filas.map((f) => f[1]));
    const permisos = [...estado.agentes.values()].filter((a) => a.estado === "permiso").length;
    $("caja-actividad").replaceChildren(el("div", { class: "caja", "data-rol": "actividad" },
      el("p", { class: "act__cab" }, span(null, "OBRA · actividad"), el("span", null, span("k", "agentes "), String(estado.agentes.size), span("k", " · "), String([...estado.agentes.values()].filter((a) => a.estado === "trabajando").length), span("k", " trabajando"))),
      ...filas.map(([n, v, tipo]) => el("p", { class: "act__fila", "data-tipo": tipo },
        span(null, n), el("span", { class: "act__barra", "data-tipo": tipo, "aria-hidden": "true" }, barraAncho(v / max)), span("n", String(v)))),
      el("p", { class: "act__nota" }, permisos ? `◆ ${permisos} espera${permisos > 1 ? "n" : ""} tu permiso` : "sin permisos pendientes")));
  }
  function barraAncho(f) { const i = el("i"); i.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; return i; }
  function pintarPruebas() {
    const pr = estado.obra && estado.obra.pruebas;
    const puntos = el("p", { class: "puntos", "aria-hidden": "true" });
    if (pr && pr.total) {
      const n = Math.min(10, pr.total), ok = Math.round((pr.pasan / pr.total) * n);
      puntos.append(span(pr.pasan === pr.total ? "ok" : "error", "●".repeat(ok)), "·".repeat(n - ok));
    } else puntos.textContent = "··········";
    $("caja-pruebas").replaceChildren(el("div", { class: "caja", "data-rol": "mini-s" },
      el("p", { class: "mini__titulo", text: "PRUEBAS " + (pr && pr.total ? `${pr.pasan}/${pr.total}` : "—") }), puntos,
      el("p", { class: "mini__dato" }, span("k", pr && pr.quien ? pr.quien : "sin pruebas aún"))));
  }

  // ── pie: bitácora, tokens, prompt y barra de estado ────────
  function pintarPie() {
    const suma = (rol) => [...estado.agentes.values()].filter((a) => a.rol === rol).reduce((s, a) => s + (a.tokens || 0), 0);
    const filas = [["principal", suma("principal"), "principal"], ["subagentes", suma("subagente"), "subagente"], ["terminales", suma("terminal"), "terminal"], ["asesor", estado.asesor && estado.asesor.tokens, "asesor"]];
    const max = Math.max(1, ...filas.map((f) => f[1] || 0));
    $("caja-tokens").replaceChildren(el("h2", { class: "marco__titulo" }, span(null, "tokens · esta obra")),
      ...filas.flatMap(([n, v, c]) => {
        const b = el("div", { class: "tok__barra", "aria-hidden": "true" }, barraAncho((v || 0) / max)); b.style.setProperty("--c", `var(--${c})`);
        return [el("p", { class: "tok__fila" }, span("k", n), span("n", v == null ? "—" : k(v))), b];
      }));
    const o = estado.obra;
    $("prompt").replaceChildren(span("ruta", `~/${(o && o.proyecto) || "obra"} $`), " " + ((o && o.comando) || "esperando una skill…"), " ", span("cursor", "_"));
    const subs = lista("subagente"), terms = lista("terminal"), p = lista("principal")[0];
    const trab = (l) => l.filter((a) => a.estado === "trabajando" || a.estado === "permiso").length;
    const permisos = [...estado.agentes.values()].filter((a) => a.estado === "permiso").length;
    const eS = moda([...subs, ...terms].map((a) => a.esfuerzo));
    const par = (k, v, c) => el("span", null, k + " ", el("b", { class: c, text: `[${v}]` }));
    $("barra-estado").replaceChildren(
      par("esfuerzo", `${p && p.esfuerzo ? ESFUERZO[p.esfuerzo] : "—"}/${eS ? ESFUERZO[eS] : "—"}`, "c-principal"),
      par("subagentes", `${trab(subs)}/${subs.length}`, "c-subagente"),
      par("terminales", `${trab(terms)}/${terms.length}`, "c-terminal"),
      par("asesor", estado.asesor ? ASESOR_ESTADO[estado.asesor.estado] || estado.asesor.estado : "—", "c-asesor"),
      par("permisos", String(permisos), "c-permiso"),
      par("en segundo plano", String((estado.procesos || []).filter((x) => VIVO.has(x.estado)).length), "c-actividad"));
  }
  function bitacoraNodo(b, nueva) {
    return el("li", { class: nueva ? "nueva" : null }, span("hora", hora(b.t)), el("span", { class: "actor", "data-rol": b.rol, text: b.actor }), span("texto", b.texto));
  }
  function pintarBitacora() { const ol = $("bitacora"); ol.replaceChildren(...estado.bitacora.map((b) => bitacoraNodo(b, false))); ol.scrollTop = ol.scrollHeight; }

  // ── conectores SVG con puntos que viajan ───────────────────
  function dibujarConectores() {
    const lienzo = $("conectores");
    const tab = $("vista-tablero");
    if (tab.hidden || getComputedStyle(lienzo).display === "none") return;
    const R = tab.getBoundingClientRect();
    const caja = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height, cx: r.left - R.left + r.width / 2, b: r.bottom - R.top }; };
    const hijos = [];
    const linea = (d, { color = "var(--linea)", guion = null, punto = false, flecha = false, dur = 2.4 } = {}) => {
      hijos.push(svg("path", { d, fill: "none", stroke: color, "stroke-width": 1.2, ...(guion ? { "stroke-dasharray": guion } : {}), ...(flecha ? { "marker-end": "url(#flecha)" } : {}) }));
      if (punto && !quieto) hijos.push(svg("circle", { r: 3.2, fill: color === "var(--linea)" ? "#E8EAED" : color }, svg("animateMotion", { dur: dur + "s", repeatCount: "indefinite", path: d })));
    };
    const algunoTrabaja = (l) => l.some((a) => a.estado === "trabajando");
    const pc = caja($("caja-principal").firstElementChild), act = caja($("caja-actividad").firstElementChild);
    const rs = caja($("rotulo-subagentes")), rt = caja($("rotulo-terminales")), vu = caja($("vuelta"));
    const subs = [...$("lista-subagentes").querySelectorAll(".caja")].map(caja);
    const terms = [...$("lista-terminales").querySelectorAll(".caja")].map(caja);
    const p = lista("principal")[0];
    // principal → actividad → rótulo de subagentes
    if (pc && act) linea(`M${pc.cx},${pc.b} L${act.cx},${act.y}`, { guion: "2 4", punto: p && p.estado === "trabajando", color: "var(--principal)", dur: 1.6 });
    if (act && rs) linea(`M${act.cx},${act.b} L${rs.cx},${rs.y}`, { guion: "2 4" });
    // abanico hacia una fila de cajas y vuelta a un punto
    const abanico = (origen, filas, activo) => {
      if (!origen || !filas.length) return;
      const yb = origen.b + 10, y2 = filas[0].y - 4;
      linea(`M${origen.cx},${origen.b} L${origen.cx},${yb}`);
      const xs = filas.map((f) => f.cx);
      linea(`M${Math.min(...xs, origen.cx)},${yb} L${Math.max(...xs, origen.cx)},${yb}`);
      for (const f of filas) linea(`M${f.cx},${yb} L${f.cx},${y2}`, { flecha: true });
      if (activo) for (const f of filas) linea(`M${origen.cx},${yb} L${f.cx},${yb} L${f.cx},${y2}`, { punto: true, color: "var(--linea)", dur: 2.2 + Math.random() });
    };
    const recoger = (filas, destino) => {
      if (!filas.length || !destino) return;
      const yb = Math.max(...filas.map((f) => f.b)) + 12;
      const xs = filas.map((f) => f.cx);
      for (const f of filas) linea(`M${f.cx},${f.b} L${f.cx},${yb}`);
      linea(`M${Math.min(...xs, destino.cx)},${yb} L${Math.max(...xs, destino.cx)},${yb}`);
      linea(`M${destino.cx},${yb} L${destino.cx},${destino.y - 4}`, { flecha: true, color: "var(--principal)" });
    };
    abanico(rs, subs, algunoTrabaja(lista("subagente")));
    recoger(subs, terms.length ? rt : vu);
    if (!subs.length && rs && rt) linea(`M${rs.cx},${rs.b} L${rt.cx},${rt.y}`, { guion: "2 4" });
    abanico(rt, terms, algunoTrabaja(lista("terminal")));
    recoger(terms, vu);
    if (!terms.length && rt && vu) linea(`M${rt.cx},${rt.b} L${vu.cx},${vu.y - 4}`, { guion: "2 4", flecha: true });
    // asesor: flechas discontinuas desde cada momento hacia su caja; la activa lleva un punto morado
    const s = estado.asesor;
    const destinos = { plan: pc, error: subs[0] || terms[0] || act, fin: vu };
    for (const m of document.querySelectorAll(".momento")) {
      const o = caja(m), d = destinos[m.dataset.momento];
      if (!o || !d) continue;
      const activo = m.classList.contains("activo");
      const y = o.y + o.h / 2, yd = Math.min(Math.max(y, d.y + 8), d.y + d.h - 8);
      linea(`M${o.x + o.w + 4},${y} L${d.x - 30},${y} L${d.x - 30},${yd} L${d.x - 4},${yd}`, { guion: "4 4", color: activo ? "var(--asesor)" : "var(--linea)", flecha: true, punto: activo && s && s.estado !== "apagado", dur: 2 });
    }
    lienzo.setAttribute("viewBox", `0 0 ${R.width} ${R.height}`);
    lienzo.replaceChildren(svg("defs", null, svg("marker", { id: "flecha", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0,0 L8,4 L0,8 z", fill: "context-stroke" }))), ...hijos);
  }
  let pendienteConectores = 0;
  const pedirConectores = () => { cancelAnimationFrame(pendienteConectores); pendienteConectores = requestAnimationFrame(dibujarConectores); };

  // ── detalle ────────────────────────────────────────────────
  let detalleId = null, seguirFinal = true;
  function lineaNodo(l, nueva) { return el("li", { class: nueva ? "nueva" : null }, span("hora", hora(l.t)), span(l.clase || null, texto(l))); }
  function pintarDetalle() {
    if (detalleId === "asesor") return pintarDetalleAsesor();
    const a = estado.agentes.get(detalleId);
    if (!a) {
      $("detalle-nombre").textContent = "agente no encontrado";
      $("detalle-modelo").textContent = "puede que la obra ya se haya cerrado";
      for (const id of ["detalle-estado", "detalle-datos", "detalle-hecho", "detalle-terminal"]) $(id).replaceChildren();
      $("detalle-resultado").textContent = ""; return;
    }
    $("vista-detalle").style.setProperty("--rol", `var(--${a.rol})`);
    $("detalle-nombre").textContent = a.nombre;
    $("detalle-modelo").replaceChildren(modeloNodo(a), " · ", esfuerzoNodo(a));
    pintarEstado($("detalle-estado"), a);
    const dl = $("detalle-datos"); dl.replaceChildren();
    const filas = [["tarea que le dieron", null], ["la pidió", a.pidio || "—"], ["tipo", a.tipo || "—"], ["empezó", a.inicio ? hora(a.inicio) : "—"], ["tokens usados", a.tokens == null ? "desconocido" : k(a.tokens)]];
    if (a.inicio && a.fin) filas.push(["tardó", `${tardo(a.fin - a.inicio)} (de ${hora(a.inicio)} a ${hora(a.fin)})`]);
    if (a.rol !== "principal") {
      const e = a.evaluacion;
      filas.push(["autoevaluación", e ? `${e.nota}/10 · se la puso la propia IA` : a.fin ? "no se autoevaluó" : "al terminar"]);
      if (e && e.bien) filas.push(["le salió bien", e.bien]);
      if (e && e.mejorar) filas.push(["para mejorar", e.mejorar]);
    }
    for (const [t, v] of filas) { dl.append(el("dt", { text: t })); dl.append(v === null ? el("dd", { class: "tarea", text: a.tarea || "desconocida" }) : el("dd", { text: v })); }
    const c = a.contadores || {}, hecho = [];
    const pl = (n, s, p) => `${n} ${n > 1 ? p : s}`;
    if (c.leidos) hecho.push(`leyó ${pl(c.leidos, "archivo", "archivos")}`);
    if (c.buscados) hecho.push(`hizo ${pl(c.buscados, "búsqueda", "búsquedas")}`);
    if (c.cambiados) hecho.push(`cambió ${pl(c.cambiados, "archivo", "archivos")}`);
    if (c.comandos) hecho.push(`ejecutó ${pl(c.comandos, "comando", "comandos")}`);
    if (c.pruebas) hecho.push(`corrió las pruebas ${pl(c.pruebas, "vez", "veces")}`);
    if (c.fallos) hecho.push(`${pl(c.fallos, "cosa falló", "cosas fallaron")} por el camino`);
    const ul = $("detalle-hecho"); ul.replaceChildren(...hecho.map((h) => el("li", { text: h })));
    if (a.estado === "trabajando") ul.append(el("li", { class: "vivo", text: texto(a.ahora) || "trabajando" }));
    if (!ul.children.length) ul.append(el("li", { class: "vivo", text: "todavía nada" }));
    $("detalle-resultado").textContent = a.resultado || (["termino", "fallo", "detenido"].includes(a.estado) ? "sin mensaje final" : "aún sin terminar");
    pintarTerminalGrande(a);
  }
  function pintarTerminalGrande(a) {
    const ol = $("detalle-terminal");
    ol.replaceChildren(...(estado.lineas.get(a.id) || []).map((l) => lineaNodo(l, false)));
    if (a.estado === "trabajando") ol.append(el("li", null, span("hora", ""), span("cursor-linea", "▌")));
    if (seguirFinal) ol.scrollTop = ol.scrollHeight;
  }
  function pintarDetalleAsesor() {
    const s = estado.asesor || {};
    $("vista-detalle").style.setProperty("--rol", "var(--asesor)");
    $("detalle-nombre").textContent = "asesor (advisor)";
    $("detalle-modelo").textContent = s.modelo || "sin configurar";
    const e = $("detalle-estado"); e.dataset.estado = "espera"; e.replaceChildren(span(null, ASESOR_ESTADO[s.estado] || s.estado || "—"));
    $("detalle-datos").replaceChildren(
      el("dt", { text: "qué es" }), el("dd", { text: "un modelo más potente que Claude consulta en momentos clave; lee toda la conversación, opina y nunca escribe código" }),
      el("dt", { text: "consultas" }), el("dd", { text: String(s.consultas ?? 0) }),
      el("dt", { text: "tokens leídos" }), el("dd", { text: s.tokens == null ? "desconocido" : k(s.tokens) }));
    const l = (s.lista || []);
    $("detalle-hecho").replaceChildren(...(l.length ? l.map((q) => el("li", { text: `${hora(q.t)} · pidió ${q.quien} · ${q.resultado}${q.antes ? " · justo antes: " + q.antes : ""}` })) : [el("li", { class: "vivo", text: "todavía ninguna consulta" })]));
    $("detalle-resultado").textContent = s.nota || "";
    $("detalle-terminal").replaceChildren(...l.map((q) => lineaNodo({ t: q.t, simple: `${q.quien} consultó al asesor → ${q.resultado}`, clase: "ahora" }, false)));
  }

  // ── rutas ──────────────────────────────────────────────────
  function ruta() {
    const h = location.hash || "#/", m = h.match(/^#\/agente\/(.+)$/);
    detalleId = m ? decodeURIComponent(m[1]) : h === "#/asesor" ? "asesor" : null;
    $("vista-tablero").hidden = !!detalleId; $("vista-detalle").hidden = !detalleId; seguirFinal = true;
    if (detalleId) { pintarDetalle(); $("detalle-nombre").setAttribute("tabindex", "-1"); $("detalle-nombre").focus(); }
    else { pintarArbol(); $("lienzo").focus({ preventScroll: true }); }
    pintarEncabezado(); pintarPie();
  }
  function aplicarModo(m) {
    estado.modo = m === "tecnico" ? "tecnico" : "simple"; guardar("modo", estado.modo);
    for (const b of document.querySelectorAll(".modo__btn")) b.setAttribute("aria-pressed", String(b.dataset.modo === estado.modo));
    if (detalleId) pintarDetalle(); else pintarArbol();
  }

  // ── mensajes del servidor ──────────────────────────────────
  let repintar = 0;
  const pedirArbol = () => { if (repintar) return; repintar = requestAnimationFrame(() => { repintar = 0; if (!detalleId) pintarArbol(); else { pintarDetalle(); pintarEncabezado(); pintarPie(); } }); };
  function recibir(msg) {
    switch (msg.tipo) {
      case "snapshot":
        estado.desfase = (msg.servidorAhora || Date.now()) - Date.now();
        estado.simulacion = msg.modo === "simulacion"; estado.obra = msg.obra || null;
        estado.agentes = new Map((msg.agentes || []).map((a) => [a.id, a]));
        estado.lineas = new Map(Object.entries(msg.lineas || {}));
        estado.bitacora = (msg.bitacora || []).slice(-MAX_BITACORA); estado.asesor = msg.asesor || null;
        estado.procesos = msg.procesos || [];
        estado.ritmo = []; estado.ultimoTotal = null;
        pintarBitacora(); ruta(); break;
      case "obra": estado.obra = msg.obra; pedirArbol(); break;
      case "agente": {
        const previo = estado.agentes.get(msg.agente.id);
        estado.agentes.set(msg.agente.id, msg.agente);
        if (previo && previo.estado !== msg.agente.estado && ["termino", "fallo", "permiso"].includes(msg.agente.estado)) anunciar(`${msg.agente.nombre}: ${ESTADOS[msg.agente.estado].texto}`);
        pedirArbol(); break;
      }
      case "linea": {
        const arr = estado.lineas.get(msg.agenteId) || []; arr.push(msg.linea);
        if (arr.length > MAX_LINEAS) arr.splice(0, arr.length - MAX_LINEAS);
        estado.lineas.set(msg.agenteId, arr);
        if (detalleId === msg.agenteId) { const a = estado.agentes.get(msg.agenteId); if (a) pintarTerminalGrande(a); }
        else pedirArbol();
        setTimeout(() => latido(msg.agenteId), 30); break;
      }
      case "bitacora": {
        estado.bitacora.push(msg.item); if (estado.bitacora.length > MAX_BITACORA) estado.bitacora.shift();
        const ol = $("bitacora"); ol.append(bitacoraNodo(msg.item, true));
        while (ol.children.length > MAX_BITACORA) ol.firstChild.remove();
        ol.scrollTop = ol.scrollHeight; break;
      }
      case "asesor": estado.asesor = msg.asesor; pedirArbol(); break;
      case "procesos": {
        const antes = new Map((estado.procesos || []).map((p) => [p.id, p.estado]));
        estado.procesos = msg.procesos || [];
        for (const p of estado.procesos) if (antes.has(p.id) && antes.get(p.id) !== p.estado && !VIVO.has(p.estado)) anunciar(`Proceso en segundo plano: ${p.simple || "proceso"}, ${(PROC[p.estado] || [p.estado])[0]}`);
        pintarProcesos(); pintarPie(); break;
      }
    }
  }
  function conectar() {
    const c = $("conexion"); c.dataset.estado = "conectando"; c.textContent = "conectando…";
    const f = new EventSource("/events");
    f.onopen = () => { c.dataset.estado = "vivo"; c.textContent = "en vivo"; };
    f.onmessage = (ev) => { try { recibir(JSON.parse(ev.data)); } catch (e) { console.warn("mensaje ignorado", e); } };
    f.onerror = () => { c.dataset.estado = "caido"; c.textContent = "sin conexión · reintentando"; };
  }

  // ── temporizadores: iconos, relojes y ritmo de tokens ──────
  let paso = 0;
  setInterval(() => { paso = (paso + 1) % GIRO.length; for (const i of document.querySelectorAll('[data-gira="1"]')) i.textContent = GIRO[paso]; }, 220);
  setInterval(() => { for (const r of document.querySelectorAll(".estado__reloj")) reloj_(r); }, 1000);
  setInterval(() => {
    const total = [...estado.agentes.values()].reduce((s, a) => s + (a.tokens || 0), 0) + ((estado.asesor && estado.asesor.tokens) || 0);
    if (estado.ultimoTotal != null) { estado.ritmo.push(Math.max(0, total - estado.ultimoTotal)); if (estado.ritmo.length > 30) estado.ritmo.shift(); if (!detalleId) pintarRitmo(); }
    estado.ultimoTotal = total;
  }, 10000);

  document.addEventListener("DOMContentLoaded", () => {
    for (const b of document.querySelectorAll(".modo__btn")) b.addEventListener("click", () => aplicarModo(b.dataset.modo));
    const term = $("detalle-terminal"), boton = $("ir-al-final");
    term.addEventListener("scroll", () => { seguirFinal = term.scrollHeight - term.scrollTop - term.clientHeight < 24; boton.hidden = seguirFinal; });
    boton.addEventListener("click", () => { seguirFinal = true; term.scrollTop = term.scrollHeight; boton.hidden = true; });
    window.addEventListener("hashchange", ruta);
    new ResizeObserver(pedirConectores).observe($("vista-tablero"));
    aplicarModo(estado.modo); ruta(); conectar();
  });
})();
