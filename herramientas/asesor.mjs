// Panel de Obra · activación del asesor (F4, opción A: Opus solo en las terminales Sonnet de «subagentes»).
// Uso:  node herramientas/asesor.mjs diff   → muestra los cambios propuestos, sin tocar nada
//       node herramientas/asesor.mjs on     → los aplica (copia de seguridad antes)
//       node herramientas/asesor.mjs off    → restaura las copias (deshace todo)
//       node herramientas/asesor.mjs estado → dice si está aplicado
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DATOS } from "../plugin/servidor/config.mjs";

const SKILLS = join(homedir(), ".claude", "skills");
const COPIAS = join(DATOS, "copias-asesor");
const MARCA = "panel-asesor";

const REGLA = (extra) => `

<!-- ${MARCA}: inicio (añadido por el Panel de Obra; se quita con «node herramientas/asesor.mjs off») -->
## Asesor (advisor)

${extra}

Si el asesor está activo en tu sesión, consúltalo solo en estos tres momentos:
1. Antes de aprobar un plan grande.
2. Cuando el mismo error se repite 2 veces.
3. Antes de dar por terminada una tarea larga.

En el resto de los turnos no lo consultes: cada consulta lee toda la conversación y gasta del plan.
<!-- ${MARCA}: fin -->
`;

const CAMBIOS = [
  {
    archivo: join(SKILLS, "subagentes", "scripts", "abrir-subagente.ps1"),
    aplicar(t) {
      if (t.includes(MARCA)) return t;
      return t
        .replace("    [switch]$PowerShellShell\n)", "    [string]$Modelo = '',\n\n    [string]$Asesor = '',\n\n    [switch]$PowerShellShell\n)\n\n# " + MARCA + ": modelo y asesor opcionales para la terminal\n$extraClaude = ''\nif ($Modelo) { $extraClaude += \" --model $Modelo\" }\nif ($Asesor) { $extraClaude += \" --advisor $Asesor\" }")
        .split("claude --name '$Nombre'").join("claude --name '$Nombre'$extraClaude")
        .split("claude --name $Nombre").join("claude --name $Nombre$extraClaude")
        .replace("  .\\abrir-subagente.ps1 -Nombre \"frontend\" -Ruta \"C:\\proyectos\\app\" -PowerShellShell", "  .\\abrir-subagente.ps1 -Nombre \"frontend\" -Ruta \"C:\\proyectos\\app\" -PowerShellShell\n  .\\abrir-subagente.ps1 -Nombre \"backend\" -Ruta \"C:\\proyectos\\app\" -Modelo sonnet -Asesor opus");
    },
  },
  {
    archivo: join(SKILLS, "subagentes", "SKILL.md"),
    aplicar: (t) => (t.includes(MARCA) ? t : t.replace(/\s*$/, "") + REGLA("Al abrir una terminal que trabajará con **Sonnet**, lánzala con el asesor Opus: añade `--advisor opus` a su comando `claude` (o usa `scripts/abrir-subagente.ps1 -Modelo sonnet -Asesor opus`). A las terminales **Opus** no se lo pongas: sería Opus aconsejando a Opus.") + "\n"),
  },
  {
    archivo: join(SKILLS, "director-de-obra", "SKILL.md"),
    aplicar: (t) => (t.includes(MARCA) ? t : t.replace(/\s*$/, "") + REGLA("En el motor B (terminales de `subagentes`), las terminales Sonnet llevan el asesor Opus según la regla de esa skill. En el motor A no se activa: los subagentes internos heredan el asesor de la sesión principal.") + "\n"),
  },
  {
    archivo: join(SKILLS, "escalera-de-ejecucion", "SKILL.md"),
    aplicar: (t) => (t.includes(MARCA) ? t : t.replace(/\s*$/, "") + REGLA("Esta skill no activa el asesor; solo indica cuándo consultarlo si ya está activo.") + "\n"),
  },
];

const modo = process.argv[2] || "diff";
const copiaDe = (f) => join(COPIAS, f.replace(/[:\\/]+/g, "_"));

function diff(antes, despues) {
  const a = antes.split("\n"), d = despues.split("\n");
  let i = 0; while (i < a.length && i < d.length && a[i] === d[i]) i++;
  let ja = a.length - 1, jd = d.length - 1; while (ja >= i && jd >= i && a[ja] === d[jd]) { ja--; jd--; }
  const out = [`@@ línea ${i + 1} @@`];
  for (let k = Math.max(0, i - 2); k < i; k++) out.push("  " + a[k]);
  for (let k = i; k <= ja; k++) out.push("- " + a[k]);
  for (let k = i; k <= jd; k++) out.push("+ " + d[k]);
  for (let k = ja + 1; k < Math.min(a.length, ja + 3); k++) out.push("  " + a[k]);
  return out.join("\n");
}

if (modo === "estado") {
  for (const c of CAMBIOS) console.log(`${existsSync(c.archivo) && readFileSync(c.archivo, "utf8").includes(MARCA) ? "✓ aplicado " : "· sin aplicar"}  ${c.archivo}`);
} else if (modo === "diff" || modo === "on") {
  if (modo === "on") mkdirSync(COPIAS, { recursive: true });
  for (const c of CAMBIOS) {
    if (!existsSync(c.archivo)) { console.log(`· no existe: ${c.archivo}`); continue; }
    const antes = readFileSync(c.archivo, "utf8").replace(/\r\n/g, "\n");
    const despues = c.aplicar(antes);
    if (antes === despues) { console.log(`· sin cambios: ${c.archivo}`); continue; }
    if (modo === "diff") { console.log(`\n=== ${c.archivo}\n${diff(antes, despues)}`); continue; }
    if (!existsSync(copiaDe(c.archivo))) copyFileSync(c.archivo, copiaDe(c.archivo));
    const crlf = /\r\n/.test(readFileSync(c.archivo, "utf8"));
    writeFileSync(c.archivo, crlf ? despues.replace(/\n/g, "\r\n") : despues);
    console.log(`✓ aplicado: ${c.archivo}  (copia en ${copiaDe(c.archivo)})`);
  }
} else if (modo === "off") {
  for (const c of CAMBIOS) {
    const copia = copiaDe(c.archivo);
    if (existsSync(copia)) { copyFileSync(copia, c.archivo); console.log(`✓ restaurado: ${c.archivo}`); }
    else console.log(`· sin copia (no se había aplicado): ${c.archivo}`);
  }
} else console.log("Uso: node herramientas/asesor.mjs diff | on | off | estado");
