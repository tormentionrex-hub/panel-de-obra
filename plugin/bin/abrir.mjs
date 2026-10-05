// Panel de Obra · abre la página a mano (lo usa /panel y abrir-panel.cmd).
// Uso: node abrir.mjs            → abre el navegador con un enlace de un solo uso
//      node abrir.mjs --imprimir → solo imprime el enlace (para pruebas)
import { enviar, asegurarServidor, esperarServidor } from "./comun.mjs";

const imprimir = process.argv.includes("--imprimir"), nueva = process.argv.includes("--nueva");
let r = await enviar("/abrir", JSON.stringify({ imprimir, nueva }));
if (r === null) { asegurarServidor(); await esperarServidor(3000); r = await enviar("/abrir", JSON.stringify({ imprimir, nueva })); }
if (!r || r.codigo !== 200) { console.log("No pude hablar con el panel. Prueba otra vez en unos segundos."); process.exit(0); }
const datos = (() => { try { return JSON.parse(r.cuerpo); } catch { return {}; } })();
if (imprimir) console.log(datos.enlace);
else if (datos.yaAbierta) console.log("El Panel de Obra ya estaba abierto: la misma pestaña se actualiza en vivo con esta sesión.");
else console.log("Panel de Obra abierto en tu navegador.");
