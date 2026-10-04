# F0b — Hallazgos con datos reales

**Fecha:** 2026-10-03/04 · **Documento:** normal (sin PIBER)

## Cómo se probó

- **Montaje:** carpeta de prueba `~\.claude\panel-agentes\f0\` con hooks que solo registraban, una skill falsa `prueba-panel` y un plugin de prueba. No se ejecutó ninguna de tus skills reales.
- **Superficies probadas:**
  - Claude Code de terminal **2.1.280**: 4 sesiones `-p`, una de ellas hija con `--name`.
  - App de escritorio **2.1.286**: una sesión guiada por ti.
- **Registros:** un «vigía» desacoplado anotó cuándo aparecía en disco cada línea de los transcripts.
- **Muestra para F2:** los payloads crudos se guardaron en `pruebas\datos-f0\eventos.jsonl` para repetirlos en las pruebas automáticas. Son solo de las sesiones de prueba y no contienen secretos.

## Las 14 preguntas

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Un hook asíncrono que falla, o un `http` sin servidor, muestra aviso? | **Escritorio: no lo viste.** Hubo un hook con exit 1 en Glob (dentro de un subagente) y un `http` a un puerto cerrado en Grep. En la terminal no se pudo ver (modo `-p`), y queda por confirmar en la terminal interactiva en F2. La decisión del plan (`command`, siempre exit 0) no cambia |
| 2 | ¿`UserPromptExpansion` en la app? ¿`command_name`? | **Sí**, en la app y en la terminal. `command_name: "prueba-panel"`, `command_args: "hola"`, `command_source: "projectSettings"`. Escribir `/skill` **no** dispara `PreToolUse` |
| 3 | ¿`tool_input` de `Skill` trae el nombre? | **Sí:** `{"skill": "prueba-panel", "args": "hola"}`. `tool_response`: `{"success": true, "commandName": …}` |
| 4 | ¿`SubagentStart`/`Stop` en segundo plano, anidados, forks y Workflow? ¿`agent_id` = archivo? ¿`parent_session_id`? ¿`agent_transcript_path`? | **Sí** en segundo plano, primer plano, anidados y Workflow (`agent_type: "workflow-subagent"`). **Forks: no existen** en tus sesiones de la app (la llamada falla). El `agent_id` coincide con `agent-<id>.jsonl`. **`parent_session_id` no llega** en ninguna versión probada. `agent_transcript_path` llega en `SubagentStop` |
| 5 | ¿`.meta.json` antes que el transcript? | Casi siempre, unos 0,1 s antes (una vez llegó 7 ms después). Trae `agentType`, `description`, `toolUseId`, `spawnDepth`, `requestShape`, el **modelo** pedido y, en anidados, **`parentAgentId`** |
| 6 | ¿`PermissionRequest` en subagente trae `agent_id`? ¿Rechazo a mano? | No hubo permisos dentro de subagentes, así que queda para F2. Rechazo a mano en la app: llega `PermissionRequest` y 7 s después `Notification permission_prompt`. **Después no llega ningún hook**, ni siquiera `Stop`. El transcript escribe al instante `tool_result` «The user doesn't want to proceed…», `toolUseResult: "User rejected tool use"` y «[Request interrupted by user for tool use]» |
| 7 | ¿Retraso hook → transcript < 2 s (p95)? | **Sí.** Terminal: mediana 0,05 s, p95 1,4 s. App: mediana 0,1 s, p95 1,4 s, máximo 2,1 s |
| 8 | ¿Llega `SessionEnd`? | **No es fiable.** En la terminal llegó en 1 de 4 sesiones `-p`; en la app llegó una vez (`reason: "other"`). Hace falta el cierre por inactividad |
| 9 | ¿Sobrevive un proceso desacoplado? | **Sí.** Sobrevive al fin de la sesión (terminal y app) y **al cierre completo de la app de escritorio**: el vigía lanzado desde la app siguió latiendo sin huecos de más de 5 s |
| 10 | ¿Hijos con `-p`, `wt` o tarea de VS Code disparan hooks y reciben `PANEL_OBRA`? | Hijo `-p --name`: **sí** dispara hooks y **sí** recibe `PANEL_OBRA`. `wt` y la tarea de VS Code no se probaron (son el mismo `claude`); quedan para F3 |
| 11 | ¿`agent-name` en las primeras líneas del hijo? | **Sí:** línea 0 `custom-title` y línea 1 `agent-name`, con el nombre de `--name` |
| 12 | ¿Cómo queda una consulta al asesor? | No se pudo provocar ninguna: la sesión de prueba no tenía asesor. Pendiente para F4 |
| 13 | ¿`${CLAUDE_PLUGIN_ROOT}` en `args`? ¿Ventanas de consola? | **Sí, se sustituye.** `CLAUDE_PLUGIN_DATA` depende de cómo se cargue el plugin (`…\plugins\data\plugin-prueba-inline`), así que se usará la ruta fija. **No viste ventanas de consola** |
| 14 | ¿Qué devuelve `/advisor`? | Se ejecutó `/advisor opus`: «Advisor set to Opus 5.5». Lo guardó en `~/.claude/settings.json` y **se aplicó al instante, también a sesiones ya abiertas**. Lo apagaste con `/advisor off` y quedó sin `advisorModel` |

## Otros hallazgos que cambian el diseño

1. **El campo `advisorModel` del transcript no indica que el asesor esté activo.** La sesión de prueba lo registraba como `claude-opus-5-5` sin tener la herramienta del asesor. El panel no lo usará para nada.
2. **El fin de un agente en segundo plano llega como hook.** Es un `UserPromptSubmit` cuyo `prompt` es `<task-notification>` con `<status>completed</status>`. Da el cierre al instante sin leer el transcript.
3. **Mensajes propios de la app:**
   - herramienta `SubagentHandback`;
   - un `UserPromptSubmit` con `<agent-message from="…">`;
   - **agentes internos con `agent_type: ""`**, que hay que ignorar.
4. **`session_title` en los eventos de la app:** da el nombre visible de la sesión.
5. **`SessionStart` tras `/compact`:** trae `source: "compact"` y el **modelo**. `PreCompact` y `PostCompact` también llegan.
6. **Workflow:**
   - transcript en `subagents/workflows/wf_*/agent-*.jsonl`, más `journal.jsonl`;
   - `PreToolUse(Workflow)` trae el script;
   - el `PostToolUse` llega al lanzarlo (no al terminar).
7. **`effort.level` es por agente** (por ejemplo, el principal en `high` y un subagente Opus en `medium`). Haiku no trae `effort`.
8. **Variables que Claude Code pone en el entorno de los hooks:** `CLAUDE_CODE_ENTRYPOINT` (`sdk-cli` o `claude-desktop`), `CLAUDE_EFFORT` y `CLAUDE_PROJECT_DIR`.
9. **Git Bash convierte `/comando` en una ruta de Windows** (`C:/Program Files/Git/comando`) si se lanza `claude -p "/x"` desde ahí. Afecta a scripts que lancen terminales hijas con un `/comando`: hay que usar `MSYS_NO_PATHCONV=1`.

## Decisiones que quedan confirmadas

- **Transcript como fuente principal y hooks para lo instantáneo.** El retraso es menor de 2 s.
- **Padre de cada agente:** el `agent_id` de quien llama a `Agent`, o el `parentAgentId` del `.meta.json`. Si `parent_session_id` apareciera en otra versión, también se usa.
- **Salida del ámbar del permiso:** el transcript («User rejected tool use» o el resultado), el siguiente `UserPromptSubmit`/`UserPromptExpansion`, o `Stop`/`idle_prompt`.
- **Cierre de agentes:** `SubagentStop` + `<task-notification>`. El cierre de sesión, por inactividad.
- **Terminales hijas:** por `agent-name` (línea 1) y, si se aprueba, por `PANEL_OBRA`.
- **Servidor desacoplado:** sobrevive al cierre de la app, y abrir el navegador desde él funciona.
- **Forks:** no se cubren de forma especial.

## Pendiente para fases siguientes

- **F2:**
  - aviso de hooks que fallan en la terminal **interactiva**;
  - `PermissionRequest` dentro de un subagente.
- **F3:** hijos lanzados con `wt` o con una tarea de VS Code.
- **F4:** forma real de una consulta al asesor en el transcript.
