/**
 * Integração de pagamentos.
 *
 * O BiblioConnect não recebe número de cartão, CVV ou dados sensíveis.
 * Criamos uma preferência do Mercado Pago e redirecionamos o cliente para o
 * Checkout Pro. O status definitivo chega pelo webhook e é conferido na API.
 */
const MERCADO_PAGO_API = "https://api.mercadopago.com";

function getAccessToken() {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error("MERCADO_PAGO_ACCESS_TOKEN não configurado no .env");
  }
  return token;
}

async function mercadoPagoRequest(path, options = {}) {
  const response = await fetch(`${MERCADO_PAGO_API}${path}`, {
    signal: AbortSignal.timeout(15000),
    ...options,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detalhe = data?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(`Mercado Pago: ${detalhe}`);
  }
  return data;
}

export function pagamentoGatewayConfigurado() {
  return Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN);
}

export async function criarPreferenciaPagamento({ pedido, descricao, valor, tipo = "pedido", pagamentoLocalId }) {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";

  if (!Number.isFinite(Number(valor)) || Number(valor) <= 0) throw new Error("O valor do pagamento deve ser maior que zero");
  const body = {
    items: [
      {
        id: `pedido-${pedido.id}-${tipo}`,
        title: descricao,
        quantity: 1,
        currency_id: "BRL",
        unit_price: Number(Number(valor).toFixed(2)),
      },
    ],
    external_reference: String(pedido.id),
    metadata: {
      pedido_id: pedido.id,
      pagamento_local_id: pagamentoLocalId,
      tipo_pagamento: tipo,
    },
    back_urls: {
      success: `${frontendUrl}/pedido-confirmado/${pedido.id}?pagamento=sucesso`,
      pending: `${frontendUrl}/pedido-confirmado/${pedido.id}?pagamento=pendente`,
      failure: `${frontendUrl}/pedido-confirmado/${pedido.id}?pagamento=falha`,
    },
    ...(frontendUrl.startsWith("https://") ? { auto_return: "approved" } : {}),
    notification_url: `${backendUrl}/webhooks/mercadopago`,
    statement_descriptor: "BIBLIOCONNECT",
  };

  // Checkout Pro já apresenta os meios habilitados na conta (cartões/Pix etc.).
  return mercadoPagoRequest("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function buscarPagamentoMercadoPago(paymentId) {
  return mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

export function mapearStatusMercadoPago(status) {
  const mapa = {
    approved: "pago",
    pending: "pendente",
    in_process: "pendente",
    authorized: "pendente",
    rejected: "cancelado",
    cancelled: "cancelado",
    refunded: "estornado",
    charged_back: "estornado",
  };
  return mapa[status] || "pendente";
}

// Permite retomar o checkout de uma extensão ainda pendente.
export async function buscarPreferenciaPagamento(id) {
  return mercadoPagoRequest(`/checkout/preferences/${encodeURIComponent(id)}`);
}
