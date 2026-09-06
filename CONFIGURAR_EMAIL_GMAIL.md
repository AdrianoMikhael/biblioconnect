# Configurar email do BiblioConnect com Gmail

O BiblioConnect usa SMTP para confirmação de cadastro, recuperação de senha e notificações.

## 1. Ative a verificação em duas etapas

Na Conta Google usada como remetente, ative a verificação em duas etapas.

## 2. Gere uma Senha de App

Crie uma Senha de App para o BiblioConnect. Ela possui 16 caracteres.
Não use a senha normal da sua conta Gmail em `EMAIL_PASS`.

## 3. Configure o `.env`

Copie `.env.example` para `.env` e ajuste:

```env
EMAIL_PROVIDER="gmail"
EMAIL_USER="seuemail@gmail.com"
EMAIL_PASS="sua-senha-de-app-de-16-caracteres"
EMAIL_FROM="seuemail@gmail.com"
```

O código remove automaticamente os espaços da Senha de App caso você a copie no formato mostrado pelo Google.

## 4. Reinicie o backend

```bash
npm run dev
```

Ao iniciar, procure uma destas mensagens:

- `✅ SMTP de email autenticado com sucesso.`
- `❌ Falha na configuração de email: ...`

## 5. Teste sem criar usuário

```bash
npm run email:test -- destinatario@gmail.com
```

Se o envio funcionar, o terminal exibirá o `Message ID`.

## 6. Reenvio pelo sistema

A tela de cadastro agora avisa quando a conta foi criada mas o email falhou.
A tela de login também mostra o botão **Reenviar email de confirmação** quando necessário.

## Diagnóstico pelo admin

Com um token de administrador:

- `GET /admin/email/status` valida conexão/autenticação SMTP.
- `POST /admin/email/teste` envia um teste. Body:

```json
{
  "email": "destinatario@gmail.com"
}
```

## Erros comuns

- `EAUTH`, `535`: usuário/senha rejeitados. No Gmail, normalmente é senha normal em vez de Senha de App.
- `534 5.7.90`: o Google está exigindo uma Senha de App.
- `ETIMEDOUT` / `ECONNECTION`: conexão SMTP bloqueada ou indisponível.
- Envio aceito, mas não aparece na caixa de entrada: confira Spam/Lixo eletrônico e a pasta Enviados da conta remetente.
