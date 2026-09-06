# BiblioConnect — versão revisada

Sistema React + Express + Prisma para catálogo, compra, reserva, aluguel, avaliações moderadas, atendimento e administração. Este pacote contém a versão revisada do código recebido. Comentários em português explicam principalmente as regras de negócio, transações e integrações.

## Começar rapidamente no Windows

Instale Node.js 22.12 ou superior. Abra um terminal nesta pasta e execute:

```powershell
npm run setup
npm run demo
```

Abra http://localhost:5173. A primeira instalação precisa de internet.

- Administrador de demonstração: `admin@biblioconnect.com`
- Senha de demonstração: `admin123`
- O catálogo começa vazio: entre como administrador e use **Novo Livro**.
- Banco persistente da demonstração: `.local/database`.
- E-mails de demonstração: `.local/emails`. Abra o HTML mais recente e use o link de confirmação ou recuperação.
- Na página de detalhes do pedido, use **Simular pagamento (demonstração)** para testar sem cobrança. Em Meus Pedidos, clique em **Detalhes e pagamento**.
- Encerre o terminal com Ctrl+C. Ao reiniciar a demonstração, faça login novamente.
- As portas 3000, 5173 e 55440 precisam estar livres. A demonstração usa um banco isolado e não acessa seu PostgreSQL existente.

A demonstração usa PGlite, uma implementação local de PostgreSQL. E-mails são arquivos e pagamentos são simulações explicitamente identificadas. Google Maps e checkout real exigem a configuração abaixo.

## Usar PostgreSQL e integrações reais

1. Crie um banco PostgreSQL vazio chamado `biblioconnect`.
2. Copie `.env.example` para `.env` e configure `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
3. Execute:

```powershell
npm run setup
npm run prisma:deploy
npm start
```

Em outro terminal:

```powershell
cd frontend
npm run dev
```

O frontend usa `http://localhost:3000`; para mudar, copie `frontend/.env.example` para `frontend/.env` e ajuste `VITE_API_URL`. Para gerar os arquivos de distribuição: `npm --prefix frontend run build`. Não use `npm run demo` com a intenção de conectar ao banco real: esse comando sempre inicia o ambiente isolado.

### E-mail

Para Gmail, configure `EMAIL_PROVIDER=gmail`, `EMAIL_USER` e uma senha de app em `EMAIL_PASS`. Para outro SMTP, use `EMAIL_PROVIDER=smtp`, `EMAIL_HOST`, `EMAIL_PORT` e `EMAIL_SECURE`. O comando `npm run email:test` verifica a configuração; leia `CONFIGURAR_EMAIL_GMAIL.md` para os detalhes. Para testes sem envio, use `EMAIL_PROVIDER=file` apenas em desenvolvimento. Mensagens locais contêm links de autenticação e não devem ser publicadas.

### Mercado Pago

Configure `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET`. Configure a notificação `payment` para `BACKEND_URL/webhooks/mercadopago` usando uma URL pública HTTPS. Use também uma URL HTTPS em `FRONTEND_URL` para o retorno automático. A aprovação é conferida na API do provedor, com assinatura, moeda, valor e referência local; o retorno do navegador sozinho não aprova um pagamento.

As novas preferências incluem a referência local necessária para a validação. Checkouts criados em versões anteriores precisam ser conciliados ou recriados; não serão automaticamente aceitos sem essa referência. Estornos reais são realizados no provedor: alterar o status administrativo apenas registra a informação no sistema. Pagamentos tardios de pedidos cancelados e cobranças duplicadas exigem conciliação administrativa.

### Entrega e ISBN

Para cotação real, configure `GOOGLE_MAPS_API_KEY`, habilite a Routes API e informe `STORE_ADDRESS`, `DELIVERY_BASE_FEE` e `DELIVERY_PRICE_PER_KM`. O backend recalcula o frete na compra. Os botões dos parceiros de entrega são links externos, não contratam entregadores automaticamente. O preenchimento por ISBN usa Google Books, podendo usar `GOOGLE_BOOKS_API_KEY`.

## Regras corrigidas

- Criação de pedido e baixa condicional de estoque ocorrem na mesma transação.
- Cancelamentos e finalizações são serializados: o estoque retorna uma única vez.
- Pedidos finalizados não reabrem. Compras concluídas consomem a unidade; concluir reservas ou aluguéis encerra a operação e devolve a unidade ao acervo. Use a finalização somente quando a unidade já puder voltar ao estoque.
- Cancelamento de pedido pago requer providenciar o estorno antes; reservas sem cobrança podem ser canceladas pelo cliente.
- Aluguel ativo permanece pendente até sua finalização. Extensões pagas são aplicadas uma vez após confirmação; extensões de custo zero são imediatas. Uma extensão pendente pode ter seu checkout retomado.
- Valores e campos dos livros são validados no servidor, inclusive quando a API é chamada diretamente.
- Campos de senha e tokens de recuperação/validação não são devolvidos nas respostas de usuários ou pedidos.
- O chat administrativo consulta as mensagens da conversa aberta, trata erros e bloqueia envio repetido durante uma requisição.

## Testes

```powershell
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
```

O teste integrado fica desativado por padrão para não inserir dados em um banco de uso real. Com `npm run demo` aberto em outro terminal:

```powershell
$env:API_TEST_URL='http://127.0.0.1:3000'
$env:EMAIL_OUTPUT_DIR='.local/emails'
npm test
```

O teste integrado insere registros identificados como teste, usa apenas localhost e inclui compras e cancelamentos concorrentes. Consulte `RELATORIO_DE_TESTES.md` para evidências e limites da validação.

## Arquivos principais

- `server.js`: API, autenticação, administração e integração dos serviços.
- `src/services/orderService.js`: estoque e transições de pedidos, com transações.
- `src/services/paymentWebhook.js`: assinatura e aplicação idempotente de pagamentos.
- `src/services/emailService.js`: SMTP e caixa de saída local.
- `src/utils/validation.js`: validação de livros e senhas.
- `scripts/demo.js`: ambiente local completo e persistente.
- `frontend/src`: telas, componentes e comunicação com a API.
- `tests`: testes unitários e de integração.

## Produção

Defina `NODE_ENV=production`, um segredo JWT aleatório, senha administrativa forte e `ALLOW_PAYMENT_SIMULATION=false`. Utilize PostgreSQL, HTTPS, backups e credenciais reais. O modo de demonstração não é uma configuração de produção. Antes de receber cobranças, valide o checkout e os webhooks na conta do provedor. A rotina de atraso depende de o backend permanecer ativo.

## Créditos do projeto original

Projeto acadêmico BiblioConnect. Equipe informada no material recebido: Lucas Soares Silva, Adriano Mikhael e João Lucas. Esta revisão corrige e documenta o código recebido.
