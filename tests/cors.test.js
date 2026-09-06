import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cors from "cors";
import { origensPermitidas } from "../src/utils/corsOrigins.js";

test("preflight de login aceita os dois endereços locais sem liberar outros sites", async () => {
  const app = express();
  app.use(cors({ origin: origensPermitidas("http://localhost:5173", "development") }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}/login`;
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "https://outro.example"]) {
      const resposta = await fetch(base, { method: "OPTIONS", headers: {
        Origin: origin, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      } });
      assert.equal(resposta.headers.get("access-control-allow-origin"), origin.endsWith(":5173") ? origin : null);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("produção não acrescenta origens locais automaticamente", () => {
  assert.deepEqual(origensPermitidas("http://localhost:5173", "production"), ["http://localhost:5173"]);
});
