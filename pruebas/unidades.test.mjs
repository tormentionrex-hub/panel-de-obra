// Pruebas de las piezas sin estado: redacción, lenguaje simple y nombres de modelo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactar, limpiar, corto, esSensible } from "../plugin/servidor/redactar.mjs";
import { describir, resultado, nombreModelo } from "../plugin/servidor/interprete.mjs";

test("redacta secretos conocidos", () => {
  const s = redactar("clave sk-ant-api03-AbCdEf1234567890xyz y ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 y RESEND_KEY=re_123456789012345678901234 y Authorization: Bearer abc.def.ghi");
  assert.ok(!s.includes("sk-ant-api03"), s);
  assert.ok(!s.includes("ghp_ABC"), s);
  assert.ok(!s.includes("re_1234"), s);
  assert.ok(!/Bearer abc/.test(s), s);
});
test("redacta asignaciones *_KEY y cadenas de alta entropía", () => {
  const s = redactar("PHOTOS_ENCRYPTION_KEY=q8Zr2mK9vX4nB7tY1wE5aS3dF6gH0jL2pO9iU8yT7rE= otra Xq9Lm2Pz8Kw4Rt7Yv1Nb5Hc3Gd6Fs0Ja2Qe9Wu8Io7");
  assert.ok(!s.includes("q8Zr2m"), s);
  assert.ok(!s.includes("Xq9Lm2"), s);
});
test("no redacta hashes de git ni identificadores", () => {
  const sha = "a3f43b7c75b9a2591a3f43b7c75b9a2591abcdef";
  assert.ok(redactar(`commit ${sha}`).includes(sha.slice(0, 40)));
});
test("quita códigos de terminal y caracteres bidi", () => {
  assert.equal(limpiar("\x1b[31mrojo\x1b[0m \x1b]52;c;cGF5bG9hZA==\x07ok\u202E"), "rojo ok");
});
test("corto recorta y redacta", () => { assert.equal(corto("a".repeat(300), 10).length, 10); });
test("archivos sensibles", () => { assert.ok(esSensible("C:/x/.env.local")); assert.ok(esSensible("id_rsa")); assert.ok(!esSensible("pedidos.ts")); });

test("lenguaje simple de herramientas", () => {
  assert.equal(describir("Read", { file_path: "C:\\p\\src\\pedidos.ts" }).simple, "Leyendo pedidos.ts");
  assert.equal(describir("Write", { file_path: "a/b/nuevo.md" }).simple, "Creando nuevo.md");
  assert.equal(describir("Edit", { file_path: "a/b/x.ts" }).cuenta, "cambiados");
  assert.match(describir("Grep", { pattern: "descuento" }).simple, /Buscando "descuento"/);
  assert.equal(describir("Bash", { command: "npm test -- pedidos" }).simple, "Corriendo las pruebas");
  assert.equal(describir("PowerShell", { command: "git commit -m x" }).simple, "Guardando cambios con git");
  assert.equal(describir("Bash", { command: "ls -la", description: "Lista la carpeta" }).simple, "Lista la carpeta");
  assert.equal(describir("WebFetch", { url: "https://x" }).simple, "Consultando internet");
  assert.equal(describir("Agent", { description: "explorer" }).simple, 'Pidiéndole ayuda a "explorer"');
  assert.match(describir("mcp__supabase__execute_sql", {}).simple, /herramienta externa: supabase/);
  assert.equal(describir("Bash", { command: "wt -w 0 new-tab cmd /k claude --name backend-pedidos" }).terminal, "backend-pedidos");
});
test("resultados: pruebas solo si el comando era de pruebas", () => {
  const prueba = describir("Bash", { command: "npm test" });
  assert.deepEqual(resultado(prueba, false, "48 passed").pruebas, { pasan: 48, total: 48 });
  assert.equal(resultado(prueba, false, "1 failed, 47 passed").pruebas.total, 48);
  const grep = describir("Bash", { command: "grep passed log.txt" });
  assert.equal(resultado(grep, false, "24 passed"), null);
});
test("resultados: rechazo y error", () => {
  const d = describir("Write", { file_path: "a.txt" });
  assert.ok(resultado(d, true, "The user doesn't want to proceed with this tool use. The tool use was rejected").rechazo);
  assert.ok(resultado(d, true, "Exit code 3").fallo);
});
test("nombres de modelo", () => {
  assert.equal(nombreModelo("claude-opus-5-5"), "Opus 5.5");
  assert.equal(nombreModelo("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(nombreModelo("claude-sonnet-5-5"), "Sonnet 5.5");
  assert.equal(nombreModelo("opus[1m]"), "Opus");
  assert.equal(nombreModelo("sonnet"), "Sonnet");
});

test("solo se leen transcripts dentro de ~/.claude/projects", async () => {
  const { rutaPermitida } = await import("../plugin/servidor/transcripts.mjs");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  assert.equal(rutaPermitida("C:/Windows/win.ini"), false);
  assert.equal(rutaPermitida(join(homedir(), ".claude", "settings.json")), false);
  assert.equal(rutaPermitida(join(homedir(), ".claude", "projects", "..", "fuera.jsonl")), false);
  assert.equal(rutaPermitida(join(homedir(), ".claude", "projects", "algo", "s.jsonl")), false, "carpeta inexistente");
});
