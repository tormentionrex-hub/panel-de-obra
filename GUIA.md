# Panel de Obra — guía de uso

Página local que muestra **en vivo y en lenguaje simple** qué hacen los agentes cuando trabajan tus skills `escalera-de-ejecucion`, `subagentes` y `director-de-obra`.

Todo ocurre en tu computador: el panel solo escucha en `127.0.0.1`, no usa internet y no gasta tokens.

---

## 1. Cómo se usa (no hay que hacer nada)

1. **Abres Claude Code** (la app de escritorio, la terminal o VS Code). El panel se levanta solo en segundo plano.
2. **Activas `director-de-obra` o `subagentes`**, escribiéndolas (`/director-de-obra …`) o porque Claude las invoca. La página se abre sola en tu navegador.
   - Con `escalera-de-ejecucion`, la página se abre solo cuando reparte trabajo a otro agente.
   - Si ya tienes la página abierta, no se abre otra.
3. **Para abrirla a mano:**
   - escribe `/panel-agentes:panel` en Claude Code (al escribir `/panel` el autocompletado te lo propone). Además de abrir la página, **el panel empieza a seguir ese chat**, aunque no use tus skills de obra;
   - o haz doble clic en `herramientas\abrir-panel.cmd`.

   El enlace que se abre es de un solo uso. Si reinicias el navegador, vuelve a pedirlo con `/panel-agentes:panel`.

## 2. Qué ves

| Parte | Qué muestra |
|---|---|
| **Caja naranja** (arriba) | El agente principal: modelo, esfuerzo, cuánta memoria lleva usada (contexto), qué hace ahora y cuánto lleva |
| **Caja verde** | Actividad de toda la obra: archivos leídos y cambiados, comandos y lo que falló |
| **Cajas turquesa** | Subagentes que lanza la sesión principal |
| **Cajas azules** | Terminales con nombre que abre `subagentes` |
| **Columna morada** | El asesor (advisor): configuración, consultas, quién consultó, tokens y lo que pasó justo antes de cada consulta |
| **Bitácora** (abajo) | Todo lo que pasa, en orden y con hora |
| **Tokens · esta obra** | Gasto por rol |

**Estados de una caja:**

| Estado | Significado |
|---|---|
| ◐◓◑◒ trabajando | El icono gira |
| ◆ espera tu permiso | Ámbar |
| ✓ terminó | Verde |
| ✗ falló | Rojo |
| ■ detenido | Lo paraste tú o se cerró la sesión |
| ○ esperando instrucciones | Terminó su turno |

**Para ver más:**
- Haz clic en una caja para ver **«Ver más»**: la tarea que le dieron, quién la pidió, lo que ha hecho, el resultado y su terminal en vivo. «◂ volver al tablero» te regresa.
- **Simple / Técnico** (arriba a la derecha): «Leyendo pedidos.ts» frente a `Read src/pedidos.ts`.

Lo que todavía no se sabe dice «por confirmar»; lo que no se puede saber dice «desconocido». **Nunca se inventa un dato.**

## 3. Apagar, encender y desinstalar

| Quiero… | Cómo |
|---|---|
| Apagarlo un rato | Crea un archivo vacío llamado `apagado` en `%USERPROFILE%\.claude\panel-agentes\`. Para encenderlo, bórralo |
| Desactivarlo en Claude Code | `/plugin` → `panel-agentes` → desactivar (o `claude plugin disable panel-agentes@panel-agentes-local`) |
| Quitar el asesor de tus skills | `node herramientas\asesor.mjs off` (restaura tus archivos originales) |
| Volver a poner el asesor | `node herramientas\asesor.mjs on` (ver antes: `node herramientas\asesor.mjs diff`) |
| Desinstalar todo | `node herramientas\desinstalar.mjs`: quita el asesor, el plugin, su copia y los datos. La carpeta del código no se toca |
| Instalar de nuevo | `node herramientas\instalar.mjs --registrar` (hace copia de tu `settings.json` antes) |

Los comandos con `node` se corren dentro de la carpeta donde descargaste este proyecto (por ejemplo `panel-de-obra`).

## 4. El asesor (advisor)

- **Dónde está activo:** solo en las **terminales Sonnet** que abre `subagentes` (`--advisor opus`). Tu sesión principal Opus no lo usa, porque sería Opus aconsejándose a sí mismo.
- **Cuándo se consulta:** tus tres skills tienen ahora una sección «Asesor (advisor)» con la regla: antes de aprobar un plan grande, cuando el mismo error se repite 2 veces y antes de dar por terminada una tarea larga.
- **Qué gasta:** cada consulta hace que el asesor lea toda la conversación. Cuenta en los límites de tu plan.
- **Qué no se puede ver:** el texto del consejo llega **cifrado** (Claude Code no deja leerlo). El panel muestra que revisó, quién lo pidió y cuántos tokens usó.

## 5. Datos y privacidad

- **Qué guarda en tu computador:** el panel lee los registros que Claude Code ya escribe (`~\.claude\projects`) **solo de las sesiones de una obra** y desde el momento en que empezó. De las demás sesiones solo llega al panel un aviso mínimo al empezar (carpeta y ruta del registro, sin contenido). Sirve para reconocer las terminales que abre una obra, y se olvida a los 10 minutos.
- **Qué guarda en memoria:** todo vive mientras el servidor esté encendido; se apaga solo tras 30 min sin obras ni pestañas.
- **Qué guarda en disco:** en `%USERPROFILE%\.claude\panel-agentes\` solo quedan:
  - marcas pequeñas de las obras activas, que se borran al cerrarlas;
  - un secreto para firmar los avisos;
  - un registro de diagnóstico sin contenido.
- **Protección:**
  - se borran claves y contraseñas antes de mostrar nada;
  - la página no puede ejecutar nada externo;
  - ninguna otra página web puede leer ni enviar datos al panel.

## 6. Si algo no va bien

| Síntoma | Qué hacer |
|---|---|
| La página está vacía («esperando a que una de tus skills empiece») | Ese chat no ha activado ninguna de tus skills de obra. Escribe `/panel-agentes:panel` en ese chat para que el panel lo siga |
| La página no se abrió | Escribe `/panel-agentes:panel`. Comprueba que no exista el archivo `apagado` |
| «Este enlace ya se usó o caducó» | Pide uno nuevo con `/panel-agentes:panel` |
| Una caja dice «por confirmar» mucho rato | En la terminal (`claude -p`), Claude Code escribe el registro del agente principal en tandas: se completa al avanzar. En la app de escritorio es inmediato |
| Una terminal de `subagentes` no aparece | Se reconoce por el nombre (`claude --name X`) que la obra anuncia. Si se abrió con otro nombre, no se muestra para no mezclar obras |
| Algo raro | Mira `%USERPROFILE%\.claude\panel-agentes\registro\servidor.log` |

## 7. Lo que se sabe y lo que falta

- **Probado en Windows:** app de escritorio 2.1.286 y terminal 2.1.280, con hooks reales, subagentes de tres modelos, permisos, fallos, terminales con nombre, una consulta real al asesor, desinstalación y reinstalación. Hay 30 pruebas automáticas (`node --test pruebas/seguridad.test.mjs pruebas/unidades.test.mjs pruebas/episodios.test.mjs`).
- **Pendiente:**
  - **Mac:** el código lo contempla, pero no se ha probado.
  - **WSL:** el código lo contempla, pero WSL no arrancó en este equipo durante las pruebas.
- **Dato curioso:** en tu terminal (Claude Code 2.1.280), el alias `sonnet` es **Sonnet 5**, no 5.5. El panel muestra el modelo real.
- **Costo para Claude Code:** cada aviso es un proceso corto (unos 170 ms), sin esperas, porque el envío lo hace un proceso aparte. En reposo, el servidor ocupa unos 60 MB de memoria.
