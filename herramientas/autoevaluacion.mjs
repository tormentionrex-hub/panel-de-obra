// Panel de Obra · autoevaluación de los agentes al terminar.
// Añade a tus skills de obra una sección corta: cada agente cierra con «AUTOEVALUACIÓN: N/10 · Bien · Mejorar»,
// el panel la muestra y la guarda, y la skill lee las lecciones guardadas antes de repartir trabajo.
// Uso:  node herramientas/autoevaluacion.mjs diff   → muestra los cambios propuestos, sin tocar nada
//       node herramientas/autoevaluacion.mjs on     → los aplica (copia de seguridad antes)
//       node herramientas/autoevaluacion.mjs off    → quita solo esta sección (no toca lo demás)
//       node herramientas/autoevaluacion.mjs estado → dice si está aplicada
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DATOS } from "../plugin/servidor/config.mjs";

const SKILLS = join(homedir(), ".claude", "skills");
const COPIAS = join(DATOS, "copias-autoevaluacion");
const MARCA = "panel-autoevaluacion";

const SECCION = (quien) => `

<!-- ${MARCA}: inicio (añadido por el Panel de Obra; se quita con «node herramientas/autoevaluacion.mjs off») -->
## Autoevaluación al terminar

**Antes de repartir:** si existe \`~/.claude/panel-agentes/lecciones.md\`, léelo. Pasa a cada agente los «Mejorar» que apliquen a su tarea: máximo 3, una línea cada uno.

**En cada encargo** (${quien}) añade al final esta instrucción, tal cual:

> Al terminar, cierra tu último mensaje con tu autoevaluación. Que sea honesta y se base en hechos: pruebas, errores, retrabajo y tiempo.
> AUTOEVALUACIÓN: N/10
> Bien: una frase.
> Mejorar: una frase concreta que te sirva la próxima vez.

Tú también cierras así tu informe final. El Panel de Obra muestra la nota, la guarda junto con lo que tardó cada agente y resume las lecciones en \`lecciones.md\`.
<!-- ${MARCA}: fin -->
`;

const CAMBIOS = [
  { archivo: join(SKILLS, "subagentes", "SKILL.md"), quien: "el prompt de cada terminal" },
  { archivo: join(SKILLS, "director-de-obra", "SKILL.md"), quien: "el prompt de cada constructor, lente o redactor, y el de cada terminal del motor B" },
  { archivo: join(SKILLS, "escalera-de-ejecucion", "SKILL.md"), quien: "el prompt de cada subagente que lances" },
];

const quitar = (t) => t.replace(new RegExp(`\\n*<!-- ${MARCA}: inicio[\\s\\S]*?<!-- ${MARCA}: fin -->\\n?`), "\n");
const poner = (t, quien) => (t.includes(MARCA) ? t : t.replace(/\s*$/, "") + SECCION(quien) + "\n");
const copiaDe = (f) => join(COPIAS, f.replace(/[:\\/]+/g, "_"));

function diff(antes, despues) {
  const a = antes.split("\n"), d = despues.split("\n");
  let i = 0; while (i < a.length && i < d.length && a[i] === d[i]) i++;
  let ja = a.length - 1, jd = d.length - 1; while (ja >= i && jd >= i && a[ja] === d[jd]) { ja--; jd--; }
  const out = [`@@ línea ${i + 1} @@`];
  for (let k = Math.max(0, i - 2); k < i; k++) out.push("  " + a[k]);
  for (let k = i; k <= ja; k++) out.push("- " + a[k]);
  for (let k = i; k <= jd; k++) out.push("+ " + d[k]);
  return out.join("\n");
}

const modo = process.argv[2] || "diff";
if (!["diff", "on", "off", "estado"].includes(modo)) { console.log("Uso: node herramientas/autoevaluacion.mjs diff | on | off | estado"); process.exit(0); }
if (modo === "on") mkdirSync(COPIAS, { recursive: true });
for (const c of CAMBIOS) {
  if (!existsSync(c.archivo)) { console.log(`· no existe: ${c.archivo}`); continue; }
  const original = readFileSync(c.archivo, "utf8");
  const crlf = /\r\n/.test(original);
  const antes = original.replace(/\r\n/g, "\n");
  if (modo === "estado") { console.log(`${antes.includes(MARCA) ? "✓ aplicada " : "· sin aplicar"}  ${c.archivo}`); continue; }
  const despues = modo === "off" ? quitar(antes) : poner(antes, c.quien);
  if (antes === despues) { console.log(`· sin cambios: ${c.archivo}`); continue; }
  if (modo === "diff") { console.log(`\n=== ${c.archivo}\n${diff(antes, despues)}`); continue; }
  if (modo === "on" && !existsSync(copiaDe(c.archivo))) copyFileSync(c.archivo, copiaDe(c.archivo));
  writeFileSync(c.archivo, crlf ? despues.replace(/\n/g, "\r\n") : despues);
  console.log(`✓ ${modo === "on" ? "aplicada" : "quitada"}: ${c.archivo}${modo === "on" ? `  (copia en ${copiaDe(c.archivo)})` : ""}`);
}
