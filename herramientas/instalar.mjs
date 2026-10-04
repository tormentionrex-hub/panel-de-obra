// Panel de Obra · instalador.
// Uso:  node herramientas/instalar.mjs              → prepara hooks.json y la carpeta de datos (no toca tus ajustes)
//       node herramientas/instalar.mjs --registrar  → además instala el plugin en Claude Code
//                                                    (copia de seguridad de ~/.claude/settings.json antes)
import { existsSync, writeFileSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { asegurarCarpetas, leerOCrearSecreto, DATOS } from "../plugin/servidor/config.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS = join(RAIZ, "plugin", "hooks", "hooks.json");
const AJUSTES = join(homedir(), ".claude", "settings.json");

// 1) Un node estable (no el temporal de fnm/nvm de una consola).
function nodeEstable() {
  const candidatos = [process.execPath];
  if (process.platform === "win32") candidatos.unshift("C:\\Program Files\\nodejs\\node.exe");
  else candidatos.unshift("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node");
  for (const c of candidatos) if (existsSync(c) && !/fnm_multishells|\.nvm|fnm[\\/]node-versions/i.test(c)) return c;
  return process.execPath;
}
const NODE = nodeEstable();
const version = execFileSync(NODE, ["--version"], { encoding: "utf8" }).trim();
if (Number(version.replace(/^v/, "").split(".")[0]) < 20) { console.error(`Hace falta Node 20 o superior (encontré ${version} en ${NODE}).`); process.exit(1); }

// 2) hooks.json con la ruta absoluta de node (así funciona aunque la app no tenga node en su PATH).
const h = () => [{ type: "command", command: NODE, args: ["${CLAUDE_PLUGIN_ROOT}/bin/reenviar.mjs"], async: true }];
const evento = (matcher) => (matcher ? [{ matcher, hooks: h() }] : [{ hooks: h() }]);
const hooks = {
  description: "Panel de Obra: avisa al panel local de lo que hacen tus agentes. Silencioso y sin bloquear.",
  hooks: {
    SessionStart: evento(), SessionEnd: evento(),
    UserPromptExpansion: evento("escalera-de-ejecucion|subagentes|director-de-obra|panel|panel-agentes:panel"),
    PreToolUse: evento("Skill|Agent|Task|Workflow"),
    PermissionRequest: evento(), PermissionDenied: evento(),
    Notification: evento("permission_prompt|idle_prompt"),
    SubagentStart: evento(), SubagentStop: evento(), Stop: evento(), StopFailure: evento(),
  },
};
mkdirSync(dirname(HOOKS), { recursive: true });
writeFileSync(HOOKS, JSON.stringify(hooks, null, 2) + "\n");
console.log(`✓ hooks.json listo (node ${version}: ${NODE})`);

// 3) Carpeta de datos y secreto (solo tu usuario puede leerlo).
asegurarCarpetas(); leerOCrearSecreto();
console.log(`✓ datos en ${DATOS}`);

if (!process.argv.includes("--registrar")) {
  console.log("\nPara instalarlo en Claude Code:  node herramientas/instalar.mjs --registrar");
  process.exit(0);
}

// 4) Instalar como plugin local (con copia de seguridad de tus ajustes).
const sello = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const copia = `${AJUSTES}.bak-panel-${sello}`;
if (existsSync(AJUSTES)) { copyFileSync(AJUSTES, copia); console.log(`✓ copia de seguridad: ${copia}`); }
const antes = existsSync(AJUSTES) ? JSON.parse(readFileSync(AJUSTES, "utf8")) : {};
const entorno = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE_CODE_|^CLAUDECODE$/.test(k)));
const claude = (args) => execFileSync(process.platform === "win32" ? "claude.cmd" : "claude", args, { encoding: "utf8", env: entorno, shell: process.platform === "win32" });
console.log(claude(["plugin", "marketplace", "add", RAIZ]).trim());
console.log(claude(["plugin", "install", "panel-agentes@panel-agentes-local"]).trim());
const despues = JSON.parse(readFileSync(AJUSTES, "utf8"));
console.log("\nCambios en tu settings.json:");
for (const k of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
  const a = JSON.stringify(antes[k]), d = JSON.stringify(despues[k]);
  if (a !== d) console.log(`  ${k}:\n    antes:   ${a}\n    después: ${d}`);
}
console.log("\nListo. Las sesiones nuevas de Claude Code ya avisan al panel. Ábrelo cuando quieras con /panel.");
