// Panel de Obra · abre la página a mano (lo usa /panel y abrir-panel.cmd).
// Uso: node abrir.mjs            → abre el navegador con un enlace de un solo uso
//      node abrir.mjs --imprimir → solo imprime el enlace (para pruebas)
import { enviar, asegurarServidor, esperarServidor } from "./comun.mjs";

const imprimir = process.argv.includes("--imprimir");
let r = await enviar("/abrir", JSON.stringify({ imprimir }));
if (r === null) { asegurarServidor(); await esperarServidor(3000); r = await enviar("/abrir", JSON.stringify({ imprimir })); }
if (!r || r.codigo !== 200) { console.log("No pude hablar con el panel. Prueba otra vez en unos segundos."); process.exit(0); }
if (imprimir) console.log(JSON.parse(r.cuerpo).enlace);
else console.log("Panel de Obra abierto en tu navegador.");
