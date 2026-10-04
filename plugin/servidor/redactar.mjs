// Panel de Obra · limpia y redacta todo texto antes de guardarlo o mostrarlo.
const OCULTO = "•••";

const PATRONES = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bre_[A-Za-z0-9_]{20,}/g,
  /\bwhsec_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
];
const CABECERA = /\b(authorization|proxy-authorization)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+(\s+[^\s,;]+)?)/gi;
const BEARER = /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const ASIGNACION = /\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|PASS|CREDENTIAL)[A-Z0-9_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const LARGO = /[A-Za-z0-9+/_=-]{32,}/g;

function entropia(s) {
  const c = new Map(); for (const ch of s) c.set(ch, (c.get(ch) || 0) + 1);
  let h = 0; for (const n of c.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

/** Quita códigos de terminal (ANSI/OSC), caracteres de control y de dirección (bidi). */
export function limpiar(texto) {
  return String(texto)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/[‪-‮⁦-⁩‎‏]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Redacta secretos conocidos y cadenas largas de alta entropía. */
export function redactar(texto) {
  if (texto == null) return texto;
  let s = limpiar(texto);
  for (const p of PATRONES) s = s.replace(p, OCULTO);
  s = s.replace(CABECERA, (_, n) => `${n}: ${OCULTO}`);
  s = s.replace(BEARER, `Bearer ${OCULTO}`);
  s = s.replace(ASIGNACION, (_, n, sep) => `${n}${sep}${OCULTO}`);
  s = s.replace(LARGO, (m) => (/^[0-9a-f]{40}$/i.test(m) || /^[0-9a-f-]{36}$/i.test(m) ? m : entropia(m) > 4.2 ? OCULTO : m));
  return s;
}

/** Redacta y recorta a un largo máximo. */
export function corto(texto, max = 160) {
  if (texto == null) return null;
  const s = redactar(String(texto)).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Archivos cuyo contenido no se muestra nunca. */
export function esSensible(ruta) {
  const n = String(ruta || "").split(/[\\/]/).pop().toLowerCase();
  return /^\.env(\..*)?$/.test(n) || /\.(pem|key|p12|pfx)$/.test(n) || /^id_(rsa|ed25519|ecdsa)/.test(n) || /secret|credential|password/.test(n);
}
