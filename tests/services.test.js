import test from "node:test";
import assert from "node:assert/strict";
import { normalizarIsbn } from "../src/services/isbnService.js";
import { mapearStatusMercadoPago } from "../src/services/paymentService.js";
import { montarEnderecoUsuario } from "../src/utils/orderUtils.js";

test("normaliza ISBN removendo máscara", () => {
  assert.equal(normalizarIsbn("978-85-359-1484-9"), "9788535914849");
});

test("mapeia status aprovado do Mercado Pago", () => {
  assert.equal(mapearStatusMercadoPago("approved"), "pago");
  assert.equal(mapearStatusMercadoPago("refunded"), "estornado");
});

test("monta endereço quando campo completo não existe", () => {
  assert.equal(
    montarEnderecoUsuario({
      rua: "Rua A",
      numero: "10",
      bairro: "Centro",
      cidade: "Maceió",
      estado: "AL",
      cep: "57000-000",
    }),
    "Rua A, nº 10, Centro, Maceió, AL, CEP 57000-000",
  );
});
