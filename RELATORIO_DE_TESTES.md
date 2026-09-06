# Relatório de validação

## Executado

- Instalação das dependências a partir dos lockfiles.
- Dez migrações aplicadas em banco vazio isolado, sem erro.
- Geração do Prisma Client 5.22.0.
- Dez testes automatizados aprovados quando o teste integrado é habilitado: nove unitários e um fluxo integrado.
- Fluxo integrado com 39 respostas HTTP verificadas, além de sete requisições concorrentes e asserções de estoque e conteúdo.
- Cadastro, bloqueio do login antes da confirmação, confirmação por link de e-mail local, login, autorização administrativa, livro válido/inválido, compra, reserva, aluguel, pagamento administrativo, devolução, cancelamento repetido, concorrência, moderação de avaliações, chat, dashboard, financeiro, atrasos, recuperação e reutilização inválida de token.
- Testes unitários de assinatura, valor divergente e repetição de webhook de extensão, usando objetos de teste; não envolvem cobrança real.
- Frontend: ESLint sem erros ou avisos e compilação de produção concluída.
- Navegador: página inicial, login administrativo e painel renderizados na demonstração local.
- `npm run demo`: banco persistente, API e Vite inicializados juntos.

## Melhorias verificadas

O arquivo JavaScript principal da compilação passou de aproximadamente 797 kB para 277 kB sem compressão. Telas e gráficos são carregados sob demanda. Os arquivos de páginas adicionais continuam sendo baixados quando necessários.

## Limites

Os testes de banco usaram PGlite com uma conexão Prisma. A concorrência foi verificada nas chamadas HTTP, mas isso não substitui teste de carga com várias conexões PostgreSQL em produção. SMTP Gmail, cobranças/estornos Mercado Pago, notificações públicas HTTPS, rotas Google Maps, pesquisa ISBN ao vivo e contratação de entregadores não foram homologados com contas reais. E-mails dos testes foram salvos localmente. A verificação visual não cobre cada combinação de tela e tamanho de dispositivo.

Documentação consultada para as integrações:

- Mercado Pago Webhooks: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
- PGlite Socket: https://pglite.dev/docs/pglite-socket

O pacote não inclui credenciais, banco, mensagens locais, dados de teste ou node_modules. A instalação cria esses arquivos no computador em que o projeto será executado.
