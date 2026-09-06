/** Regras compartilhadas: transações evitam pedidos parciais e estoque duplicado. */
export function erroNegocio(mensagem, status = 400) {
  return Object.assign(new Error(mensagem), { status });
}

export async function criarPedidoComEstoque(prisma, data) {
  return prisma.$transaction(async (tx) => {
    // O predicado é reavaliado pelo banco após aguardar qualquer venda concorrente.
    const baixa = await tx.livro.updateMany({
      where: { id: data.livroId, disponivel: true, estoque: { gt: 0 },
        ...(data.tipo === "reserva" ? { isDoado: false } : {}) },
      data: { estoque: { decrement: 1 } },
    });
    if (baixa.count !== 1) throw erroNegocio("Livro indisponível ou sem estoque", 409);
    return tx.pedido.create({ data, include: { livro: true } });
  });
}

export function validarTransicao(pedido, status, cliente = false) {
  const transicoes = {
    compra: { pendente: ["concluido", "cancelado"] },
    reserva: { pendente: ["concluido", "cancelado"] },
    aluguel: { pendente: ["concluido", "devolvido", "cancelado"] },
  };
  if (!transicoes[pedido.tipo]?.[pedido.status]?.includes(status)) {
    throw erroNegocio("Esta mudança de status não é permitida");
  }
  if (cliente && (status !== "cancelado" || pedido.status !== "pendente")) {
    throw erroNegocio("Somente pedidos pendentes podem ser cancelados pelo cliente");
  }
  if (status === "cancelado" && pedido.statusPagamento === "pago" && pedido.valor > 0) {
    throw erroNegocio("Providencie o estorno pelo atendimento antes de cancelar o pedido pago");
  }
  if (["concluido", "devolvido"].includes(status) && pedido.statusPagamento !== "pago") {
    throw erroNegocio("O pedido precisa estar pago para concluir ou devolver");
  }
}

export async function alterarStatusPedido(prisma, id, status, usuarioId) {
  return prisma.$transaction(async (tx) => {
    // Bloqueia a linha para serializar cancelamentos, devoluções e pagamentos.
    await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${id} FOR UPDATE`;
    const pedido = await tx.pedido.findUnique({ where: { id } });
    if (!pedido || (usuarioId !== undefined && pedido.usuarioId !== usuarioId)) {
      throw erroNegocio("Pedido não encontrado", 404);
    }
    validarTransicao(pedido, status, usuarioId !== undefined);
    const retornaEstoque = status === "cancelado" || status === "devolvido" ||
      (["reserva", "aluguel"].includes(pedido.tipo) && status === "concluido");
    if (retornaEstoque) await tx.livro.update({
      where: { id: pedido.livroId }, data: { estoque: { increment: 1 } },
    });
    return tx.pedido.update({ where: { id }, data: { status }, include: {
      livro: true, usuario: { select: { id: true, nome: true, email: true } },
    } });
  });
}
