import crypto from "node:crypto";
import { mapearStatusMercadoPago } from "./paymentService.js";

/** Confere a assinatura antes de consultar a API; o segredo nunca vai ao navegador. */
export function assinaturaValida(req, secret) {
  if (!secret) return false;
  const partes = Object.fromEntries(String(req.headers["x-signature"] || "").split(",").map(p => p.trim().split("=")));
  const id = req.query["data.id"];
  const requestId = req.headers["x-request-id"];
  if (!id || !requestId || !/^\d+$/.test(partes.ts || "") || !/^[a-f0-9]{64}$/i.test(partes.v1 || "")) return false;
  const manifesto = `id:${String(id).toLowerCase()};request-id:${requestId};ts:${partes.ts};`;
  const esperado = crypto.createHmac("sha256", secret).update(manifesto).digest();
  return crypto.timingSafeEqual(esperado, Buffer.from(partes.v1, "hex"));
}

/** Persiste o evento e seu efeito juntos. Repetir um webhook não estende o aluguel novamente. */
export async function aplicarPagamento(prisma, mp) {
  const pedidoId = Number(mp.external_reference);
  const localId = Number(mp.metadata?.pagamento_local_id);
  if (!Number.isSafeInteger(pedidoId) || !Number.isSafeInteger(localId)) throw new Error("Pagamento sem referência local");
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${pedidoId} FOR UPDATE`;
    const pedido = await tx.pedido.findUnique({ where: { id: pedidoId } });
    const pagamento = await tx.pagamento.findUnique({ where: { id: localId } });
    if (!pedido || !pagamento || pagamento.pedidoId !== pedidoId ||
        mp.currency_id !== "BRL" || Math.round(Number(mp.transaction_amount) * 100) !== Math.round(pagamento.valor * 100)) {
      throw new Error("Referência, moeda ou valor do pagamento divergente");
    }
    if (pagamento.gatewayPaymentId && pagamento.gatewayPaymentId !== String(mp.id)) {
      throw new Error("Outro pagamento já está associado a esta cobrança; requer conciliação");
    }
    const status = mapearStatusMercadoPago(mp.status);
    if (pagamento.status === status || pagamento.status === "estornado" ||
        (pagamento.status === "pago" && status !== "estornado")) return false;
    await tx.pagamento.update({ where: { id: localId }, data: {
      status, gatewayPaymentId: String(mp.id), metodo: mp.payment_type_id || mp.payment_method_id,
    } });
    if (pagamento.tipo === "extensao") {
      if (status === "pago" && pedido.diasExtensaoPendente > 0 &&
          !["cancelado", "devolvido"].includes(pedido.status)) {
        const prazo = new Date(pedido.devolucaoPrevista);
        prazo.setDate(prazo.getDate() + pedido.diasExtensaoPendente);
        await tx.pedido.update({ where: { id: pedidoId }, data: {
          devolucaoPrevista: prazo, diasAluguel: { increment: pedido.diasExtensaoPendente },
          valor: { increment: pagamento.valor }, diasExtensaoPendente: 0, valorExtensaoPendente: 0,
        } });
      }
    } else if (pedido.status !== "cancelado") {
      // Uma tentativa recusada não pode apagar a aprovação de outra tentativa.
      if (pedido.statusPagamento !== "pago" || status === "estornado") {
        await tx.pedido.update({ where: { id: pedidoId }, data: {
          statusPagamento: status,
          ...(status === "pago" && pedido.modalidadeEntrega === "entrega" && pedido.statusEntrega === "aguardando_pagamento" ? { statusEntrega: "preparando" } : {}),
        } });
      }
    }
    return status === "pago";
  });
}
