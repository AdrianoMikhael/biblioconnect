# BiblioConnect — alterações implementadas

Esta versão adiciona os requisitos de comércio, atendimento e automação solicitados, preservando as funcionalidades que já existiam.

## Funcionalidades

1. **Pagamento real** com Mercado Pago Checkout Pro para meios habilitados na conta (crédito, débito e Pix), com preferência criada no backend e confirmação por webhook.
2. **Entrega com Google Maps Routes API**, cálculo do frete no servidor e painel administrativo com status de entrega e links de parceiros terceirizados.
3. **Avaliações e comentários** por livro, com moderação do administrador.
4. **Chat cliente x empresa** persistido no PostgreSQL.
5. **Extensão de aluguel** com cobrança dos dias extras e alteração do prazo somente após pagamento aprovado.
6. **Notificações por e-mail** para eventos de pedido, pagamento, entrega, extensão e atrasos, mantendo confirmação de e-mail e recuperação de senha.
7. **Autopreenchimento por ISBN** com Google Books no cadastro e edição do livro.

## Melhorias técnicas

- Novas integrações isoladas em `src/services`.
- Utilitários de pedidos/e-mail em `src/utils`.
- Novos modelos Prisma para pagamentos, avaliações, conversas e mensagens.
- Migration SQL incluída.
- Segredos e chaves externas movidos para variáveis de ambiente.
- Senha padrão de administrador e JWT endurecidos para produção.
- Simulação antiga de pagamento desativada por padrão.
- Pagamentos confirmados consultando a API do gateway, sem confiar apenas no corpo do webhook.
- Cancelamento automático de pedidos pagos bloqueado para evitar devolução ao estoque sem estorno.
- Atualizações de estoque no cancelamento do cliente feitas em transação e com incremento atômico.
- Frontend usando `VITE_API_URL` em vez de URL fixa.
- Testes unitários básicos para ISBN, mapeamento de pagamento e montagem de endereço.

## Configuração inicial

Copie `.env.example` para `.env` e configure pelo menos:

```env
DATABASE_URL="postgresql://..."
JWT_SECRET="..."
ADMIN_EMAIL="..."
ADMIN_PASSWORD="..."
EMAIL_USER="..."
EMAIL_PASS="..."
MERCADO_PAGO_ACCESS_TOKEN="..."
GOOGLE_MAPS_API_KEY="..."
STORE_ADDRESS="..."
```

No frontend, copie `frontend/.env.example` para `frontend/.env`:

```env
VITE_API_URL="http://localhost:3000"
```

Depois execute no backend:

```bash
npm install
npx prisma migrate dev
npx prisma generate
npm run dev
```

E no frontend:

```bash
cd frontend
npm install
npm run dev
```

## Validação realizada nesta entrega

- `node --check server.js`: aprovado.
- Checagem de sintaxe dos novos serviços/utilitários/testes: aprovada.
- `npm test`: 3 testes aprovados.

O build do frontend deve ser executado no ambiente local após `npm install`, pois esta sessão não conseguiu concluir a instalação das dependências NPM do frontend.

## Correção do envio de email de cadastro

- O frontend agora diferencia **conta criada** de **email realmente enviado**.
- Quando o SMTP falha, a tela mostra o motivo e oferece **Reenviar email de confirmação**.
- A tela de login também oferece reenvio quando a conta ainda não foi confirmada.
- O SMTP foi centralizado em `src/services/emailService.js`.
- Gmail usa `smtp.gmail.com:465` com TLS e aceita Senha de App com ou sem espaços.
- Ao iniciar o backend, o console informa se a autenticação SMTP foi validada.
- Rotas administrativas de diagnóstico:
  - `GET /admin/email/status`
  - `POST /admin/email/teste` com `{ "email": "destino@exemplo.com" }`
