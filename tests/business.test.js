import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validarTransicao, criarPedidoComEstoque } from "../src/services/orderService.js";
import { validarLivro, validarSenha } from "../src/utils/validation.js";
import { assinaturaValida, aplicarPagamento } from "../src/services/paymentWebhook.js";

test("livro rejeita preços negativos, estoque fracionado e URL executável", () => {
  const livro = { titulo: "Livro", autor: "Autor", redator: "Editora", categoria: "Teste", sinopse: "Texto",
    ano: 2025, precoCompra: 10, precoAluguel: 2, precoDiaExtra: 1, diasInclusos: 7, estoque: 1 };
  assert.equal(validarLivro({ ...livro }), null);
  assert.ok(validarLivro({ ...livro, precoCompra: -1 }));
  assert.ok(validarLivro({ ...livro, estoque: 0.5 }));
  assert.ok(validarLivro({ ...livro, imagemUrlExterna: "javascript:alert(1)" }));
  assert.ok(validarLivro({ ...livro, precoCompra: "Infinity" }));
});

test("senha considera o limite em bytes do bcrypt", () => {
  assert.equal(validarSenha("12345678"), true);
  assert.equal(validarSenha("curta"), false);
  assert.equal(validarSenha("😀".repeat(20)), false);
});

test("pedido finalizado não reabre nem devolve estoque novamente", () => {
  for (const status of ["cancelado", "devolvido"]) {
    assert.throws(() => validarTransicao({ tipo: "aluguel", status, statusPagamento: "pago" }, "pendente"));
  }
  assert.throws(() => validarTransicao({ tipo: "compra", status: "pendente", statusPagamento: "pago", valor: 10 }, "cancelado"));
  assert.doesNotThrow(() => validarTransicao({ tipo: "reserva", status: "pendente", statusPagamento: "pago", valor: 0 }, "cancelado", true));
});

test("falha de estoque impede criar pedido", async () => {
  const prisma = { $transaction: callback => callback({ livro: { updateMany: async () => ({ count: 0 }) }, pedido: {
    create: () => assert.fail("Não deve criar pedido sem estoque"),
  } }) };
  await assert.rejects(criarPedidoComEstoque(prisma, { livroId: 1, tipo: "compra" }), /estoque/);
});

test("webhook exige assinatura válida para os dados da URL", () => {
  const secret = "segredo-apenas-do-teste";
  const ts = String(Date.now());
  const v1 = crypto.createHmac("sha256", secret).update(`id:123;request-id:teste;ts:${ts};`).digest("hex");
  const req = { query: { "data.id": "123" }, headers: { "x-request-id": "teste", "x-signature": `ts=${ts},v1=${v1}` } };
  assert.equal(assinaturaValida(req, secret), true);
  assert.equal(assinaturaValida(req, "outro"), false);
  assert.equal(assinaturaValida({ ...req, query: { "data.id": "999" } }, secret), false);
  assert.equal(assinaturaValida(req, ""), false);
});

test("webhook repetido aplica uma única extensão e rejeita valor divergente", async () => {
  let pagamento = { id: 2, pedidoId: 1, tipo: "extensao", valor: 4, status: "pendente" };
  let pedido = { id: 1, status: "pendente", diasExtensaoPendente: 2, devolucaoPrevista: new Date("2026-09-10T12:00:00Z") };
  let alteracoes = 0;
  const tx = { $queryRaw: async () => [],
    pagamento: { findUnique: async () => pagamento, update: async ({ data }) => { pagamento = { ...pagamento, ...data }; } },
    pedido: { findUnique: async () => pedido, update: async ({ data }) => { pedido = { ...pedido, ...data }; alteracoes++; } },
  };
  const prisma = { $transaction: cb => cb(tx) };
  const mp = { id: 123, external_reference: "1", metadata: { pagamento_local_id: 2 }, currency_id: "BRL", transaction_amount: 4, status: "approved" };
  assert.equal(await aplicarPagamento(prisma, mp), true);
  assert.equal(await aplicarPagamento(prisma, mp), false);
  assert.equal(alteracoes, 1);
  assert.equal(pedido.devolucaoPrevista.toISOString(), "2026-09-12T12:00:00.000Z");
  await assert.rejects(aplicarPagamento(prisma, { ...mp, transaction_amount: 0.01 }), /divergente/);
});
