import nodemailer from "nodemailer";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Caixa de saída local explícita para testes; nunca simula SMTP em produção.
function emailLocal() {
  return process.env.EMAIL_PROVIDER === "file" && process.env.NODE_ENV !== "production";
}

/**
 * Centraliza a configuração SMTP do BiblioConnect.
 *
 * Em desenvolvimento o padrão continua sendo Gmail. Para produção você pode
 * trocar de provedor sem alterar o código, usando EMAIL_PROVIDER=smtp e as
 * variáveis EMAIL_HOST/EMAIL_PORT/EMAIL_SECURE.
 */
export function emailConfigurado() {
  return emailLocal() || Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function senhaEmail() {
  const senha = String(process.env.EMAIL_PASS || "");
  const provider = String(process.env.EMAIL_PROVIDER || "gmail").toLowerCase();

  // O Google exibe a senha de app em grupos (xxxx xxxx xxxx xxxx). Remover os
  // espaços evita erro de autenticação quando ela é copiada exatamente assim.
  return provider === "gmail" ? senha.replace(/\s+/g, "") : senha;
}

export function criarTransporterEmail() {
  if (!emailConfigurado()) {
    throw new Error("EMAIL_USER ou EMAIL_PASS não configurados no .env");
  }

  const provider = String(process.env.EMAIL_PROVIDER || "gmail").toLowerCase();
  const auth = {
    user: process.env.EMAIL_USER,
    pass: senhaEmail(),
  };

  if (provider === "smtp") {
    const port = Number(process.env.EMAIL_PORT || 587);

    if (!process.env.EMAIL_HOST) {
      throw new Error("EMAIL_HOST é obrigatório quando EMAIL_PROVIDER=smtp");
    }

    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port,
      secure:
        String(process.env.EMAIL_SECURE || "false").toLowerCase() === "true",
      auth,
    });
  }

  // Gmail: porta 465 + TLS implícito. Para autenticação com senha use uma
  // Senha de App do Google (não a senha normal da conta).
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth,
  });
}

export function obterRemetenteEmail() {
  const endereco = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  return `"BiblioConnect" <${endereco}>`;
}

export function descreverErroEmail(error) {
  const codigo = error?.code || "";
  const responseCode = Number(error?.responseCode || 0);
  const resposta = String(error?.response || error?.message || "");

  if (codigo === "EAUTH" || responseCode === 534 || responseCode === 535) {
    return (
      "Falha de autenticação no servidor de email. Se estiver usando Gmail, " +
      "ative a verificação em duas etapas e use uma Senha de App de 16 caracteres em EMAIL_PASS."
    );
  }

  if (
    codigo === "ETIMEDOUT" ||
    codigo === "ECONNECTION" ||
    codigo === "ECONNREFUSED"
  ) {
    return "Não foi possível conectar ao servidor SMTP. Verifique internet, firewall, host e porta.";
  }

  if (/quota|limit|rate/i.test(resposta)) {
    return "O provedor de email recusou o envio por limite/cota de mensagens.";
  }

  return error?.message || "Falha desconhecida ao enviar email.";
}

export async function verificarConfiguracaoEmail() {
  if (emailLocal()) return { ok: true, mensagem: "Modo local: mensagens salvas em .emails, sem envio externo." };
  if (!emailConfigurado()) {
    return {
      ok: false,
      mensagem: "EMAIL_USER ou EMAIL_PASS não configurados.",
    };
  }

  try {
    await criarTransporterEmail().verify();
    return {
      ok: true,
      mensagem: "Conexão e autenticação SMTP verificadas com sucesso.",
    };
  } catch (error) {
    return {
      ok: false,
      mensagem: descreverErroEmail(error),
      codigo: error?.code || null,
      responseCode: error?.responseCode || null,
    };
  }
}

export async function enviarEmailHtml({ to, subject, html }) {
  if (!to) {
    throw new Error("Destinatário do email não informado.");
  }

  if (emailLocal()) {
    const dir = path.resolve(process.env.EMAIL_OUTPUT_DIR || ".emails");
    await fs.mkdir(dir, { recursive: true });
    const messageId = crypto.randomUUID();
    await fs.writeFile(path.join(dir, `${Date.now()}-${messageId}.html`), html, "utf8");
    return { messageId, accepted: [to] };
  }
  const transporter = criarTransporterEmail();

  const info = await transporter.sendMail({
    from: obterRemetenteEmail(),
    to,
    subject,
    html,
  });

  return info;
}
