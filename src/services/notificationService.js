import { emailConfigurado, enviarEmailHtml } from "./emailService.js";

// Dados como título de livro, código de rastreio e mensagens podem vir do banco
// ou de formulários. Escapar HTML evita que conteúdo do usuário seja interpretado
// como marcação dentro do e-mail.
function escaparHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function enviarNotificacao({ to, subject, titulo, mensagem, detalhes = [] }) {
  if (!emailConfigurado() || !to) {
    console.log(`[email ignorado] ${subject} -> ${to || "sem destinatário"}`);
    return false;
  }

  const detalhesHtml = detalhes
    .filter((item) => item?.label && item?.valor !== undefined && item?.valor !== null)
    .map(
      (item) =>
        `<p style="margin:6px 0;color:#374151"><strong>${escaparHtml(item.label)}:</strong> ${escaparHtml(item.valor)}</p>`,
    )
    .join("");

  await enviarEmailHtml({
    to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;background:#f7f7f7">
        <div style="background:white;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
          <h2 style="color:#1E3A5F;margin-top:0">${escaparHtml(titulo)}</h2>
          <p style="color:#374151">${escaparHtml(mensagem)}</p>
          ${detalhesHtml}
          <p style="color:#6b7280;font-size:13px;margin-top:20px">BiblioConnect</p>
        </div>
      </div>`,
  });

  return true;
}
