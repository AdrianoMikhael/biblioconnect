import dotenv from "dotenv";
import {
  descreverErroEmail,
  enviarEmailHtml,
  verificarConfiguracaoEmail,
} from "../src/services/emailService.js";

dotenv.config();

const destinatario =
  process.argv[2] || process.env.EMAIL_TEST_TO || process.env.EMAIL_USER;

if (!destinatario) {
  console.error("Informe um destinatário: npm run email:test -- email@exemplo.com");
  process.exit(1);
}

const diagnostico = await verificarConfiguracaoEmail();

if (!diagnostico.ok) {
  console.error(`Falha no SMTP: ${diagnostico.mensagem}`);
  process.exit(1);
}

try {
  const info = await enviarEmailHtml({
    to: destinatario,
    subject: "Teste de email - BiblioConnect",
    html: `
      <div style="font-family:Arial,sans-serif;padding:24px">
        <h2>BiblioConnect - teste de email</h2>
        <p>Se você recebeu esta mensagem, a configuração SMTP está funcionando.</p>
      </div>`,
  });

  console.log(`Email enviado para ${destinatario}.`);
  console.log(`Message ID: ${info.messageId}`);
} catch (error) {
  console.error(`Falha ao enviar: ${descreverErroEmail(error)}`);
  process.exit(1);
}
