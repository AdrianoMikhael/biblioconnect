-- Novas funcionalidades BiblioConnect: ISBN, entrega, pagamentos reais, avaliações e chat.
ALTER TABLE "Livro" ADD COLUMN "isbn" TEXT;
CREATE UNIQUE INDEX "Livro_isbn_key" ON "Livro"("isbn");

ALTER TABLE "Pedido"
  ADD COLUMN "modalidadeEntrega" TEXT NOT NULL DEFAULT 'retirada',
  ADD COLUMN "enderecoEntrega" TEXT,
  ADD COLUMN "distanciaEntregaKm" DOUBLE PRECISION,
  ADD COLUMN "valorEntrega" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "statusEntrega" TEXT NOT NULL DEFAULT 'nao_aplicavel',
  ADD COLUMN "transportadoraEntrega" TEXT,
  ADD COLUMN "codigoRastreio" TEXT,
  ADD COLUMN "valorExtensaoPendente" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "diasExtensaoPendente" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ultimaNotificacaoAtraso" TIMESTAMP(3),
  ADD COLUMN "preferenciaPagamentoId" TEXT,
  ADD COLUMN "linkPagamento" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "Pagamento" (
  "id" SERIAL NOT NULL,
  "gateway" TEXT NOT NULL DEFAULT 'mercadopago',
  "gatewayPaymentId" TEXT,
  "gatewayPreferenceId" TEXT,
  "metodo" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pendente',
  "tipo" TEXT NOT NULL DEFAULT 'pedido',
  "valor" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "pedidoId" INTEGER NOT NULL,
  CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Pagamento_gatewayPaymentId_idx" ON "Pagamento"("gatewayPaymentId");
CREATE INDEX "Pagamento_gatewayPreferenceId_idx" ON "Pagamento"("gatewayPreferenceId");
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Avaliacao" (
  "id" SERIAL NOT NULL,
  "nota" INTEGER NOT NULL,
  "comentario" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pendente',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  "livroId" INTEGER NOT NULL,
  CONSTRAINT "Avaliacao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Avaliacao_usuarioId_livroId_key" ON "Avaliacao"("usuarioId", "livroId");
CREATE INDEX "Avaliacao_livroId_status_idx" ON "Avaliacao"("livroId", "status");
ALTER TABLE "Avaliacao" ADD CONSTRAINT "Avaliacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Avaliacao" ADD CONSTRAINT "Avaliacao_livroId_fkey" FOREIGN KEY ("livroId") REFERENCES "Livro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Conversa" (
  "id" SERIAL NOT NULL,
  "assunto" TEXT,
  "status" TEXT NOT NULL DEFAULT 'aberta',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  CONSTRAINT "Conversa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Conversa_usuarioId_status_idx" ON "Conversa"("usuarioId", "status");
ALTER TABLE "Conversa" ADD CONSTRAINT "Conversa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MensagemChat" (
  "id" SERIAL NOT NULL,
  "texto" TEXT NOT NULL,
  "remetenteRole" TEXT NOT NULL,
  "lida" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "conversaId" INTEGER NOT NULL,
  "remetenteId" INTEGER NOT NULL,
  CONSTRAINT "MensagemChat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MensagemChat_conversaId_createdAt_idx" ON "MensagemChat"("conversaId", "createdAt");
ALTER TABLE "MensagemChat" ADD CONSTRAINT "MensagemChat_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "Conversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MensagemChat" ADD CONSTRAINT "MensagemChat_remetenteId_fkey" FOREIGN KEY ("remetenteId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
