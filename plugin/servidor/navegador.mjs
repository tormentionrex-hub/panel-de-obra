// Panel de Obra · abre una URL en el navegador por defecto, según el sistema.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { ES_WSL } from "./config.mjs";

export function abrirNavegador(url) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return false; // solo direcciones del propio panel
  let cmd, args;
  if (process.platform === "win32") { cmd = "rundll32"; args = ["url.dll,FileProtocolHandler", url]; }
  else if (process.platform === "darwin") { cmd = "open"; args = [url]; }
  else if (ES_WSL) {
    if (existsSync("/usr/bin/wslview")) { cmd = "wslview"; args = [url]; }
    else { cmd = "/mnt/c/Windows/explorer.exe"; args = [url]; }
  } else { cmd = "xdg-open"; args = [url]; }
  try { spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref(); return true; } catch { return false; }
}
