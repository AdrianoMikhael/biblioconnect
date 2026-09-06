import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/** Ambiente de demonstração persistente, separado de qualquer PostgreSQL existente. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".local");

// Verifica as portas antes de abrir o banco: uma segunda execução não deve
// acessar os mesmos arquivos nem terminar com uma exceção EADDRINUSE.
async function portaDisponivel(port) {
  return new Promise((resolve, reject) => {
    const teste = net.createServer();
    teste.once("error", error => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    teste.listen(port, "127.0.0.1", () => teste.close(() => resolve(true)));
  });
}
const portas = [3000, 5173, 55440];
const disponibilidade = await Promise.all(portas.map(portaDisponivel));
const ocupadas = portas.filter((_, indice) => !disponibilidade[indice]);
if (ocupadas.length) {
  console.error(`\nNão foi iniciada outra demonstração. Portas em uso: ${ocupadas.join(", ")}.`);
  console.error("Se o BiblioConnect já estiver aberto, acesse http://localhost:5173.");
  console.error("Para reiniciar, encerre a demonstração no terminal anterior com Ctrl+C e execute npm run demo novamente.");
  console.error("Nenhum processo foi encerrado e o banco desta pasta não foi aberto.\n");
  process.exit(1);
}
await fs.mkdir(local, { recursive: true });
const db = await PGlite.create(path.join(local, "database"));
await db.exec('CREATE TABLE IF NOT EXISTS "_DemoMigration" (nome TEXT PRIMARY KEY)');
const migrations = path.join(root, "prisma", "migrations");
for (const entrada of (await fs.readdir(migrations, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
  const existe = await db.query('SELECT nome FROM "_DemoMigration" WHERE nome = $1', [entrada.name]);
  if (existe.rows.length) continue;
  const sql = await fs.readFile(path.join(migrations, entrada.name, "migration.sql"), "utf8");
  await db.transaction(async tx => {
    await tx.exec(sql);
    await tx.query('INSERT INTO "_DemoMigration" (nome) VALUES ($1)', [entrada.name]);
  });
}
const socket = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 55440 });
try {
  await socket.start();
} catch (error) {
  await db.close();
  console.error(error.code === "EADDRINUSE"
    ? "A porta 55440 foi ocupada por outro processo durante a inicialização. Encerre a outra instância e tente novamente."
    : `Não foi possível iniciar o banco local: ${error.message}`);
  process.exit(1);
}
const env = { ...process.env,
  NODE_ENV: "development", PORT: "3000", BACKEND_URL: "http://localhost:3000", FRONTEND_URL: "http://localhost:5173",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55440/postgres?connection_limit=1",
  JWT_SECRET: crypto.randomBytes(32).toString("hex"), EMAIL_PROVIDER: "file",
  EMAIL_OUTPUT_DIR: path.join(local, "emails"), ALLOW_PAYMENT_SIMULATION: "true", DISABLE_DELAY_EMAIL_JOB: "true",
  ADMIN_EMAIL: "admin@biblioconnect.com", ADMIN_PASSWORD: "admin123",
  MERCADO_PAGO_ACCESS_TOKEN: "", GOOGLE_MAPS_API_KEY: "",
};
const backend = spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: "inherit", windowsHide: true });
// Abre o endereço canônico no navegador padrão ao iniciar a demonstração.
const frontend = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--strictPort", "--open", "http://localhost:5173/login"], {
  cwd: path.join(root, "frontend"), env: { ...env, VITE_API_URL: "http://localhost:3000" }, stdio: "inherit", windowsHide: true,
});
console.log("\nDEMONSTRAÇÃO LOCAL: http://localhost:5173");
console.log("Administrador: admin@biblioconnect.com / admin123");
console.log("Emails de confirmação e senha ficam em .local/emails (abra o HTML). Não há envio nem cobrança real.\n");
let encerrando = false;
async function encerrar(code = 0) {
  if (encerrando) return;
  encerrando = true;
  backend.kill(); frontend.kill();
  await socket.stop(); await db.close();
  process.exit(code);
}
backend.on("exit", code => encerrar(code || 0));
frontend.on("exit", code => encerrar(code || 0));
process.on("SIGINT", () => encerrar());
process.on("SIGTERM", () => encerrar());
