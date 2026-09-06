import { origensPermitidas } from "./src/utils/corsOrigins.js";
import { assinaturaValida, aplicarPagamento } from "./src/services/paymentWebhook.js";
import { criarPedidoComEstoque, alterarStatusPedido } from "./src/services/orderService.js";
import { validarLivro, validarSenha } from "./src/utils/validation.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import {
  buscarPagamentoMercadoPago,
  buscarPreferenciaPagamento,
  criarPreferenciaPagamento,
  mapearStatusMercadoPago,
  pagamentoGatewayConfigurado,
} from "./src/services/paymentService.js";
import {
  calcularCotacaoEntrega,
  getLinksEntregasTerceirizadas,
  mapsConfigurado,
} from "./src/services/deliveryService.js";
import { buscarLivroPorIsbn, normalizarIsbn } from "./src/services/isbnService.js";
import { enviarNotificacao } from "./src/services/notificationService.js";
import {
  descreverErroEmail,
  emailConfigurado,
  enviarEmailHtml,
  verificarConfiguracaoEmail,
} from "./src/services/emailService.js";
import {
  formatarDataEmail,
  formatarMoedaEmail,
  montarEnderecoUsuario,
} from "./src/utils/orderUtils.js";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.disable("x-powered-by");
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = dados => json(JSON.parse(JSON.stringify(dados, (campo, valor) =>
    ["senha", "tokenResetSenha", "tokenResetSenhaExpira", "tokenConfirmacaoEmail", "tokenConfirmacaoExpira"].includes(campo) ? undefined : valor)));
  next();
});
app.use(cors({ origin: origensPermitidas(process.env.FRONTEND_URL || "http://localhost:5173", process.env.NODE_ENV) }));
app.use(express.json({ limit: "100kb" }));
// Garante erros JSON para IDs inválidos antes de consultar o banco.
app.param("id", (req, res, next, id) => {
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) return res.status(400).json({ erro: "ID inválido" });
  next();
});
app.use((req, res, next) => {
  req.body ??= {};
  if (["/comprar", "/alugar", "/reservar"].includes(req.path) &&
      (!Number.isSafeInteger(Number(req.body.livroId)) || Number(req.body.livroId) < 1)) {
    return res.status(400).json({ erro: "Livro inválido" });
  }
  next();
});

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production" ? null : "biblioconnect_secret_dev");

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET é obrigatório quando NODE_ENV=production");
}

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// ======================
// UPLOADS - IMAGENS DOS LIVROS
// ======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, "uploads", "livros");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const storageLivros = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extensao = ({ "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp" })[file.mimetype] || ".bin";
    const nomeOriginal = path
      .basename(file.originalname, extensao)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "-")
      .toLowerCase();

    const nomeArquivo = `${crypto.randomUUID()}-${nomeOriginal.slice(0, 80)}${extensao}`;

    cb(null, nomeArquivo);
  },
});

const filtroImagemLivro = (req, file, cb) => {
  const tiposPermitidos = ["image/jpeg", "image/png", "image/webp", "image/jpg"];

  if (!tiposPermitidos.includes(file.mimetype)) {
    return cb(new Error("Formato inválido. Envie uma imagem JPG, PNG ou WEBP."));
  }

  cb(null, true);
};

const uploadLivro = multer({
  storage: storageLivros,
  fileFilter: filtroImagemLivro,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

// ======================
// AUXILIARES PARA FORMULÁRIOS MULTIPART
// ======================
function converterBoolean(valor, padrao = false) {
  if (valor === undefined || valor === null || valor === "") {
    return padrao;
  }

  if (typeof valor === "boolean") {
    return valor;
  }

  return String(valor).toLowerCase() === "true";
}

function montarImagemUrl(req) {
  if (!req.file) return null;

  return `/uploads/livros/${req.file.filename}`;
}

// ======================
// buscarInsightsVendas
// ======================
async function buscarInsightsVendas() {
  const pedidosCompra = await prisma.pedido.findMany({
    where: {
      tipo: "compra",
      statusPagamento: "pago",
      status: {
        not: "cancelado",
      },
    },
    include: {
      livro: true,
    },
  });

  const vendasPorLivro = {};
  const vendasPorGenero = {};

  pedidosCompra.forEach((pedido) => {
    if (!pedido.livro) return;

    const livroId = pedido.livro.id;
    const genero = pedido.livro.categoria || "Sem categoria";

    if (!vendasPorLivro[livroId]) {
   vendasPorLivro[livroId] = {
  id: pedido.livro.id,
  titulo: pedido.livro.titulo,
  autor: pedido.livro.autor,
  categoria: pedido.livro.categoria,
  precoCompra: pedido.livro.precoCompra,
  precoAluguel: pedido.livro.precoAluguel,
  imagemUrl: pedido.livro.imagemUrl,
  quantidadeVendas: 0,
};
    }

    vendasPorLivro[livroId].quantidadeVendas += 1;

    if (!vendasPorGenero[genero]) {
      vendasPorGenero[genero] = {
        genero,
        quantidadeVendas: 0,
      };
    }

    vendasPorGenero[genero].quantidadeVendas += 1;
  });

  const livrosMaisVendidos = Object.values(vendasPorLivro)
    .sort((a, b) => b.quantidadeVendas - a.quantidadeVendas)
    .slice(0, 5);

  const generosMaisVendidos = Object.values(vendasPorGenero)
    .sort((a, b) => b.quantidadeVendas - a.quantidadeVendas)
    .slice(0, 5);

  return {
    livrosMaisVendidos,
    generosMaisVendidos,
    livroMaisVendido: livrosMaisVendidos[0] || null,
    generoMaisVendido: generosMaisVendidos[0] || null,
  };
}
// ======================
// HOME - INSIGHTS PÚBLICOS
// ======================
app.get("/public/home-insights", async (req, res) => {
  try {
    const insights = await buscarInsightsVendas();

    res.json(insights);
  } catch (error) {
    console.error("Erro ao buscar insights públicos:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar dados da página inicial",
      detalhe: error.message,
    });
  }
});

// ======================
// MIDDLEWARE AUTH
// ======================
async function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ erro: "Token não enviado" });
  }

  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ erro: "Token mal formatado" });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const usuario = await prisma.usuario.findUnique({
      where: {
        id: Number(decoded.id),
      },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        emailConfirmado: true,
        bloqueado: true,
      },
    });

    if (!usuario) {
      return res.status(401).json({
        erro: "Usuário do token não encontrado",
      });
    }

    if (usuario.role !== "ADMIN" && usuario.bloqueado) {
      return res.status(403).json({
        erro: "Usuário bloqueado. Entre em contato com a biblioteca.",
      });
    }

    if (usuario.role !== "ADMIN" && !usuario.emailConfirmado) {
      return res.status(403).json({
        erro: "Confirme seu email antes de acessar sua conta.",
        precisaConfirmarEmail: true,
        email: usuario.email,
      });
    }

    req.usuario = usuario;
    next();
  } catch (error) {
    return res.status(401).json({ erro: "Token inválido" });
  }
}

function somenteAdmin(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({
      erro: "Usuário não autenticado",
    });
  }

  if (req.usuario.role !== "ADMIN") {
    return res.status(403).json({
      erro: "Acesso permitido somente para administradores",
    });
  }

  next();
}
// ======================
// ADMIN PADRÃO
// ======================
async function criarAdminPadrao() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@biblioconnect.com";
  const adminSenha =
    process.env.ADMIN_PASSWORD ||
    (process.env.NODE_ENV === "production" ? null : "admin123");

  if (!adminSenha) {
    console.warn("ADMIN_PASSWORD não configurado. Admin automático não será criado em produção.");
    return;
  }

  const adminExiste = await prisma.usuario.findUnique({
    where: { email: adminEmail },
  });

  if (!adminExiste) {
    const senhaCriptografada = await bcrypt.hash(adminSenha, 10);

    await prisma.usuario.create({
      data: {
        nome: "Administrador",
        email: adminEmail,
        senha: senhaCriptografada,
        telefone: "00000000000",
        endereco: "BiblioConnect",
        role: "ADMIN",
        emailConfirmado: true,
      },
    });

    console.log("Admin padrão criado:");
    console.log(`Email: ${adminEmail}`);
    if (process.env.NODE_ENV !== "production") {
      console.log("Senha de desenvolvimento: admin123 (altere no .env)");
    }
  }
}



// ======================
// EMAIL - CONFIRMAÇÃO DE CADASTRO
// ======================
function gerarTokenConfirmacaoEmail() {
  return crypto.randomBytes(32).toString("hex");
}

function gerarDataExpiracaoToken() {
  const data = new Date();
  data.setHours(data.getHours() + 24);
  return data;
}

async function enviarEmailConfirmacaoCadastro(usuario, token) {
  const linkConfirmacao = `${BACKEND_URL}/confirmar-email/${token}`;

  if (!emailConfigurado()) {
    throw new Error("EMAIL_USER ou EMAIL_PASS não configurados no .env");
  }

  await enviarEmailHtml({
    to: usuario.email,
    subject: "Confirme seu email - BiblioConnect",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; background: #f7f7f7;">
        <div style="background: #ffffff; border-radius: 16px; padding: 28px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1E3A5F; margin-top: 0;">Confirme seu email</h2>

          <p style="color: #374151; font-size: 15px;">
            Olá, <strong>${usuario.nome}</strong>.
          </p>

          <p style="color: #374151; font-size: 15px;">
            Seu cadastro no <strong>BiblioConnect</strong> foi criado com sucesso.
            Para liberar o acesso à sua conta, confirme seu email clicando no botão abaixo.
          </p>

          <a
            href="${linkConfirmacao}"
            style="display: inline-block; margin-top: 18px; background: #E67E00; color: #ffffff; text-decoration: none; padding: 13px 20px; border-radius: 10px; font-weight: bold;"
          >
            Confirmar minha conta
          </a>

          <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
            Este link expira em 24 horas.
          </p>

          <p style="color: #6b7280; font-size: 13px;">
            Se o botão não funcionar, copie e cole este link no navegador:
          </p>

          <p style="word-break: break-all; color: #1E3A5F; font-size: 13px;">
            ${linkConfirmacao}
          </p>
        </div>
      </div>
    `,
  });
}


// ======================
// EMAIL - REDEFINIÇÃO DE SENHA
// ======================
function gerarTokenResetSenha() {
  return crypto.randomBytes(32).toString("hex");
}

function gerarDataExpiracaoResetSenha() {
  const data = new Date();
  data.setMinutes(data.getMinutes() + 30);
  return data;
}

async function enviarEmailResetSenha(usuario, token) {
  const linkReset = `${FRONTEND_URL}/redefinir-senha/${token}`;

  if (!emailConfigurado()) {
    throw new Error("EMAIL_USER ou EMAIL_PASS não configurados no .env");
  }

  await enviarEmailHtml({
    to: usuario.email,
    subject: "Redefinição de senha - BiblioConnect",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; background: #f7f7f7;">
        <div style="background: #ffffff; border-radius: 16px; padding: 28px; border: 1px solid #e5e7eb;">
          <h2 style="color: #1E3A5F; margin-top: 0;">Redefinir senha</h2>

          <p style="color: #374151; font-size: 15px;">
            Olá, <strong>${usuario.nome}</strong>.
          </p>

          <p style="color: #374151; font-size: 15px;">
            Recebemos uma solicitação para redefinir a senha da sua conta no <strong>BiblioConnect</strong>.
          </p>

          <a
            href="${linkReset}"
            style="display: inline-block; margin-top: 18px; background: #E67E00; color: #ffffff; text-decoration: none; padding: 13px 20px; border-radius: 10px; font-weight: bold;"
          >
            Redefinir minha senha
          </a>

          <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
            Este link expira em 30 minutos.
          </p>

          <p style="color: #6b7280; font-size: 13px;">
            Se você não solicitou essa alteração, ignore este email.
          </p>

          <p style="word-break: break-all; color: #1E3A5F; font-size: 13px;">
            ${linkReset}
          </p>
        </div>
      </div>
    `,
  });
}


// ======================
// FUNÇÕES AUXILIARES
// ======================
function calcularAluguel(livro, dias) {
  const diasExtras = Math.max(0, dias - livro.diasInclusos);
  return livro.precoAluguel + diasExtras * livro.precoDiaExtra;
}

function calcularMultaReserva(dataRetirada) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const prazoGratis = new Date();
  prazoGratis.setDate(prazoGratis.getDate() + 7);
  prazoGratis.setHours(0, 0, 0, 0);

  const retiradaEscolhida = new Date(dataRetirada);
  retiradaEscolhida.setHours(0, 0, 0, 0);

  const diferencaMs = retiradaEscolhida - prazoGratis;

  const diasAtraso = Math.max(
    0,
    Math.ceil(diferencaMs / (1000 * 60 * 60 * 24)),
  );

  const multaPorDia = 2;
  const multa = diasAtraso * multaPorDia;

  return {
    diasAtraso,
    multa,
  };
}
function calcularDiasAtraso(data) {
  if (!data) return 0;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const dataComparada = new Date(data);
  dataComparada.setHours(0, 0, 0, 0);

  const diferencaMs = hoje - dataComparada;

  return Math.max(0, Math.floor(diferencaMs / (1000 * 60 * 60 * 24)));
}

function calcularMultaPedido(pedido) {
  if (pedido.status !== "pendente") return 0;

  if (pedido.tipo === "aluguel" && pedido.devolucaoPrevista) {
    const diasAtraso = calcularDiasAtraso(pedido.devolucaoPrevista);
    return diasAtraso * Number(pedido.livro?.precoDiaExtra || 0);
  }

  if (pedido.tipo === "reserva" && pedido.retiradaLimite) {
    const diasAtraso = calcularDiasAtraso(pedido.retiradaLimite);
    return diasAtraso * 2;
  }

  return 0;
}

// ======================
// ROTA TESTE
// ======================
app.get("/", (req, res) => {
  res.send("Servidor rodando 🚀");
});

// ======================
// DIAGNÓSTICO DE EMAIL - ADMIN
// ======================
// Não expõe senha. Serve para confirmar se o backend consegue autenticar no
// SMTP antes de testar cadastro, recuperação de senha ou notificações.
app.get("/admin/email/status", autenticar, somenteAdmin, async (req, res) => {
  const diagnostico = await verificarConfiguracaoEmail();

  res.status(diagnostico.ok ? 200 : 503).json({
    ...diagnostico,
    provider: process.env.EMAIL_PROVIDER || "gmail",
    emailUser: process.env.EMAIL_USER || null,
  });
});

app.post("/admin/email/teste", autenticar, somenteAdmin, async (req, res) => {
  try {
    const destinatario = String(req.body?.email || req.usuario?.email || "").trim();

    if (!destinatario) {
      return res.status(400).json({ erro: "Informe o email que receberá o teste." });
    }

    await enviarEmailHtml({
      to: destinatario,
      subject: "Teste de email - BiblioConnect",
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px">
          <h2>Configuração de email funcionando ✅</h2>
          <p>O backend do BiblioConnect conseguiu enviar esta mensagem pelo SMTP configurado.</p>
        </div>`,
    });

    return res.json({
      mensagem: `Email de teste enviado para ${destinatario}.`,
    });
  } catch (error) {
    console.error("Erro no teste de email:", error);
    return res.status(error.status || 500).json({
      erro: "Não foi possível enviar o email de teste.",
      detalhe: descreverErroEmail(error),
      codigo: error?.code || null,
      responseCode: error?.responseCode || null,
    });
  }
});

// ======================
// CADASTRO USUÁRIO
// ======================
app.post("/usuarios", async (req, res) => {
  try {
    const {
      nome,
      email,
      senha,
      telefone,
      cep,
      rua,
      bairro,
      cidade,
      estado,
      numero,
      complemento,
      pontoReferencia,
    } = req.body;

    if (!nome || !email || !senha) {
      return res.status(400).json({
        erro: "Nome, email e senha são obrigatórios",
      });
    }

    if (!cep || !rua || !bairro || !cidade || !estado || !numero) {
      return res.status(400).json({
        erro: "CEP, rua, bairro, cidade, estado e número são obrigatórios",
      });
    }

    if (!validarSenha(senha) || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ erro: "Informe um email válido e senha de 8 caracteres ou mais (máximo 72 bytes)." });
    }
    const emailNormalizado = String(email).trim().toLowerCase();

    const existe = await prisma.usuario.findUnique({
      where: { email: emailNormalizado },
    });

    if (existe) {
      return res.status(400).json({ erro: "Email já cadastrado" });
    }

    const enderecoCompleto = [
      rua,
      numero ? `nº ${numero}` : "",
      bairro,
      cidade,
      estado,
      cep ? `CEP: ${cep}` : "",
      complemento ? `Complemento: ${complemento}` : "",
      pontoReferencia ? `Referência: ${pontoReferencia}` : "",
    ]
      .filter(Boolean)
      .join(", ");

    const senhaCriptografada = await bcrypt.hash(senha, 10);
    const tokenConfirmacaoEmail = gerarTokenConfirmacaoEmail();
    const tokenConfirmacaoExpira = gerarDataExpiracaoToken();

    const usuarioCriado = await prisma.usuario.create({
      data: {
        nome,
        email: emailNormalizado,
        senha: senhaCriptografada,
        telefone,

        endereco: enderecoCompleto,
        cep,
        rua,
        bairro,
        cidade,
        estado,
        numero,
        complemento,
        pontoReferencia,

        role: "CLIENTE",
        emailConfirmado: false,
        tokenConfirmacaoEmail,
        tokenConfirmacaoExpira,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,

        endereco: true,
        cep: true,
        rua: true,
        bairro: true,
        cidade: true,
        estado: true,
        numero: true,
        complemento: true,
        pontoReferencia: true,

        role: true,
        emailConfirmado: true,
      },
    });

    try {
      await enviarEmailConfirmacaoCadastro(
        usuarioCriado,
        tokenConfirmacaoEmail
      );
    } catch (emailError) {
      console.error("Erro ao enviar email de confirmação:", emailError);

      return res.status(201).json({
        mensagem:
          "Usuário cadastrado, mas o email de confirmação não foi enviado.",
        usuario: usuarioCriado,
        emailEnviado: false,
        avisoEmail: descreverErroEmail(emailError),
      });
    }

    res.status(201).json({
      mensagem:
        "Usuário cadastrado com sucesso. Verifique seu email para confirmar a conta.",
      usuario: usuarioCriado,
      emailEnviado: true,
    });
  } catch (error) {
    console.error("Erro ao cadastrar usuário:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao cadastrar usuário",
      detalhe: error.message,
    });
  }
});

// ======================
// CONFIRMAR EMAIL
// ======================
app.get("/confirmar-email/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const usuario = await prisma.usuario.findFirst({
      where: {
        tokenConfirmacaoEmail: token,
      },
    });

    if (!usuario) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial; padding: 40px;">
            <h2>Link inválido</h2>
            <p>Este link de confirmação não existe ou já foi utilizado.</p>
            <a href="${FRONTEND_URL}/login">Voltar para o login</a>
          </body>
        </html>
      `);
    }

    if (
      usuario.tokenConfirmacaoExpira &&
      new Date(usuario.tokenConfirmacaoExpira) < new Date()
    ) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial; padding: 40px;">
            <h2>Link expirado</h2>
            <p>Este link de confirmação expirou. Solicite um novo link pela tela de login.</p>
            <a href="${FRONTEND_URL}/login">Voltar para o login</a>
          </body>
        </html>
      `);
    }

    await prisma.usuario.update({
      where: {
        id: usuario.id,
      },
      data: {
        emailConfirmado: true,
        tokenConfirmacaoEmail: null,
        tokenConfirmacaoExpira: null,
      },
    });

    res.send(`
      <html>
        <head>
          <meta http-equiv="refresh" content="3;url=${FRONTEND_URL}/login" />
        </head>

        <body style="font-family: Arial; padding: 40px; background: #f8fafc;">
          <div style="max-width: 560px; margin: 0 auto; background: white; padding: 32px; border-radius: 16px; border: 1px solid #e5e7eb;">
            <h2 style="color: #15803d;">Email confirmado com sucesso</h2>
            <p>Sua conta foi ativada. Você já pode fazer login no BiblioConnect.</p>
            <p>Você será redirecionado em alguns segundos.</p>
            <a href="${FRONTEND_URL}/login" style="color: #E67E00; font-weight: bold;">Ir para o login</a>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Erro ao confirmar email:", error);

    res.status(500).send(`
      <html>
        <body style="font-family: Arial; padding: 40px;">
          <h2>Erro ao confirmar email</h2>
          <p>Ocorreu um erro interno ao confirmar sua conta.</p>
          <a href="${FRONTEND_URL}/login">Voltar para o login</a>
        </body>
      </html>
    `);
  }
});


// ======================
// ESQUECI MINHA SENHA
// ======================
app.post("/esqueci-senha", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        erro: "Email é obrigatório",
      });
    }

    const emailNormalizado = String(email).trim().toLowerCase();

    const usuario = await prisma.usuario.findUnique({
      where: {
        email: emailNormalizado,
      },
    });

    // Segurança: não revela se o email existe ou não.
    if (!usuario) {
      return res.json({
        mensagem:
          "Se este email estiver cadastrado, enviaremos um link de redefinição.",
      });
    }

    const tokenResetSenha = gerarTokenResetSenha();
    const tokenResetSenhaExpira = gerarDataExpiracaoResetSenha();

    const usuarioAtualizado = await prisma.usuario.update({
      where: {
        id: usuario.id,
      },
      data: {
        tokenResetSenha,
        tokenResetSenhaExpira,
      },
      select: {
        id: true,
        nome: true,
        email: true,
      },
    });

    await enviarEmailResetSenha(usuarioAtualizado, tokenResetSenha);

    res.json({
      mensagem:
        "Se este email estiver cadastrado, enviaremos um link de redefinição.",
    });
  } catch (error) {
    console.error("Erro ao solicitar redefinição de senha:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao solicitar redefinição de senha",
      detalhe: error.message,
    });
  }
});

// ======================
// REDEFINIR SENHA
// ======================
app.patch("/redefinir-senha/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { novaSenha } = req.body;

    if (!validarSenha(novaSenha)) {
      return res.status(400).json({
        erro: "A senha deve ter pelo menos 8 caracteres e no máximo 72 bytes.",
      });
    }

    const usuario = await prisma.usuario.findFirst({
      where: {
        tokenResetSenha: token,
      },
    });

    if (!usuario) {
      return res.status(400).json({
        erro: "Link inválido ou já utilizado.",
      });
    }

    if (
      usuario.tokenResetSenhaExpira &&
      new Date(usuario.tokenResetSenhaExpira) < new Date()
    ) {
      return res.status(400).json({
        erro: "Link expirado. Solicite uma nova redefinição de senha.",
      });
    }

    const senhaCriptografada = await bcrypt.hash(novaSenha, 10);

    await prisma.usuario.update({
      where: {
        id: usuario.id,
      },
      data: {
        senha: senhaCriptografada,
        tokenResetSenha: null,
        tokenResetSenhaExpira: null,
      },
    });

    res.json({
      mensagem: "Senha redefinida com sucesso. Faça login novamente.",
    });
  } catch (error) {
    console.error("Erro ao redefinir senha:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao redefinir senha",
      detalhe: error.message,
    });
  }
});


// ======================
// REENVIAR CONFIRMAÇÃO DE EMAIL
// ======================
app.post("/reenviar-confirmacao", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        erro: "Email é obrigatório",
      });
    }

    const emailNormalizado = String(email).trim().toLowerCase();

    const usuario = await prisma.usuario.findUnique({
      where: {
        email: emailNormalizado,
      },
    });

    if (!usuario) {
      return res.status(404).json({
        erro: "Usuário não encontrado",
      });
    }

    if (usuario.emailConfirmado) {
      return res.status(400).json({
        erro: "Este email já foi confirmado.",
      });
    }

    const novoToken = gerarTokenConfirmacaoEmail();
    const novaExpiracao = gerarDataExpiracaoToken();

    const usuarioAtualizado = await prisma.usuario.update({
      where: {
        id: usuario.id,
      },
      data: {
        tokenConfirmacaoEmail: novoToken,
        tokenConfirmacaoExpira: novaExpiracao,
      },
      select: {
        id: true,
        nome: true,
        email: true,
      },
    });

    await enviarEmailConfirmacaoCadastro(usuarioAtualizado, novoToken);

    res.json({
      mensagem: "Novo email de confirmação enviado com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao reenviar confirmação:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao reenviar email de confirmação",
      detalhe: descreverErroEmail(error),
    });
  }
});


// ======================
// LOGIN
// ======================
app.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({
        erro: "Email e senha são obrigatórios",
      });
    }

    const emailNormalizado = String(email).trim().toLowerCase();

    const usuario = await prisma.usuario.findUnique({
      where: { email: emailNormalizado },
    });

    if (!usuario) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

    if (!senhaCorreta) {
      return res.status(401).json({ erro: "Senha incorreta" });
    }

    if (usuario.role !== "ADMIN" && !usuario.emailConfirmado) {
      return res.status(403).json({
        erro: "Confirme seu email antes de fazer login.",
        precisaConfirmarEmail: true,
        email: usuario.email,
      });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
      },
      JWT_SECRET,
      { expiresIn: "1d" },
    );

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        emailConfirmado: usuario.emailConfirmado,
      },
    });
  } catch (error) {
    console.error("Erro no login:", error);

    res.status(error.status || 500).json({
      erro: "Erro no login",
      detalhe: error.message,
    });
  }
});

// ======================
// ME
// ======================
app.get("/me", autenticar, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: Number(req.usuario.id) },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        emailConfirmado: true,
        telefone: true,
        endereco: true,
        cep: true,
        rua: true,
        bairro: true,
        cidade: true,
        estado: true,
        numero: true,
        complemento: true,
        pontoReferencia: true,
      },
    });

    if (!usuario) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    res.json(usuario);
  } catch (error) {
    console.error("Erro ao buscar usuário logado:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar usuário logado",
      detalhe: error.message,
    });
  }
});
// ======================
// ADMIN - LISTAR USUÁRIOS
// ======================
app.get("/admin/usuarios", autenticar, somenteAdmin, async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: {
        role: "CLIENTE",
      },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,

        endereco: true,
        cep: true,
        rua: true,
        bairro: true,
        cidade: true,
        estado: true,
        numero: true,
        complemento: true,
        pontoReferencia: true,

        bloqueado: true,
        emailConfirmado: true,
        createdAt: true,
        pedidos: {
          include: {
            livro: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const usuariosFormatados = usuarios.map((usuario) => {
      const multaTotal = usuario.pedidos.reduce((total, pedido) => {
        return total + calcularMultaPedido(pedido);
      }, 0);

      return {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        telefone: usuario.telefone,

        endereco: usuario.endereco,
        cep: usuario.cep,
        rua: usuario.rua,
        bairro: usuario.bairro,
        cidade: usuario.cidade,
        estado: usuario.estado,
        numero: usuario.numero,
        complemento: usuario.complemento,
        pontoReferencia: usuario.pontoReferencia,

        bloqueado: usuario.bloqueado,
        emailConfirmado: usuario.emailConfirmado,
        createdAt: usuario.createdAt,
        totalPedidos: usuario.pedidos.length,
        multaTotal,
      };
    });

    res.json(usuariosFormatados);
  } catch (error) {
    console.error("Erro ao listar usuários:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao listar usuários",
      detalhe: error.message,
    });
  }
});

// ======================
// ADMIN - CONGELAR / DESCONGELAR USUÁRIO
// ======================
app.patch(
  "/admin/usuarios/:id/bloqueio",
  autenticar,
  somenteAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { bloqueado } = req.body;

      const usuario = await prisma.usuario.findUnique({
        where: {
          id: Number(id),
        },
      });

      if (!usuario) {
        return res.status(404).json({
          erro: "Usuário não encontrado",
        });
      }

      if (usuario.role === "ADMIN") {
        return res.status(400).json({
          erro: "Não é permitido congelar um administrador",
        });
      }

      const usuarioAtualizado = await prisma.usuario.update({
        where: {
          id: Number(id),
        },
        data: {
          bloqueado: Boolean(bloqueado),
        },
        select: {
          id: true,
          nome: true,
          email: true,
          bloqueado: true,
        },
      });

      res.json(usuarioAtualizado);
    } catch (error) {
      console.error("Erro ao alterar bloqueio:", error);

      res.status(error.status || 500).json({
        erro: "Erro ao alterar status do usuário",
        detalhe: error.message,
      });
    }
  },
);

// ======================
// ADMIN - REMOVER USUÁRIO
// ======================
app.delete(
  "/admin/usuarios/:id",
  autenticar,
  somenteAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      const usuario = await prisma.usuario.findUnique({
        where: {
          id: Number(id),
        },
        include: {
          pedidos: true,
        },
      });

      if (!usuario) {
        return res.status(404).json({
          erro: "Usuário não encontrado",
        });
      }

      if (usuario.role === "ADMIN") {
        return res.status(400).json({
          erro: "Não é permitido remover um administrador",
        });
      }

      if (usuario.pedidos.length > 0) {
        return res.status(400).json({
          erro: "Este usuário possui pedidos vinculados. Congele o usuário em vez de removê-lo.",
        });
      }

      await prisma.usuario.delete({
        where: {
          id: Number(id),
        },
      });

      res.json({
        mensagem: "Usuário removido com sucesso",
      });
    } catch (error) {
      console.error("Erro ao remover usuário:", error);

      res.status(error.status || 500).json({
        erro: "Erro ao remover usuário",
        detalhe: error.message,
      });
    }
  },
);

// ======================
// ADMIN - ATRASOS E MULTAS
// ======================
app.get("/admin/atrasos", autenticar, somenteAdmin, async (req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      where: {
        status: {
          not: "cancelado",
        },
        OR: [
          {
            tipo: "aluguel",
            devolucaoPrevista: {
              lt: new Date(),
            },
          },
          {
            tipo: "reserva",
            retiradaLimite: {
              lt: new Date(),
            },
          },
        ],
      },
      include: {
        usuario: true,
        livro: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const atrasos = pedidos
      .map((pedido) => {
        const dataReferencia =
          pedido.tipo === "aluguel"
            ? pedido.devolucaoPrevista
            : pedido.retiradaLimite;

        const diasAtraso = calcularDiasAtraso(dataReferencia);
        const multa = calcularMultaPedido(pedido);

        return {
          id: pedido.id,
          tipo: pedido.tipo,
          status: pedido.status,
          valorOriginal: pedido.valor,
          dataPedido: pedido.createdAt,
          dataReferencia,
          diasAtraso,
          multa,
          usuario: {
            id: pedido.usuario.id,
            nome: pedido.usuario.nome,
            email: pedido.usuario.email,
            telefone: pedido.usuario.telefone,
            endereco: pedido.usuario.endereco,
            bloqueado: pedido.usuario.bloqueado,
          },
          livro: {
            id: pedido.livro.id,
            titulo: pedido.livro.titulo,
            autor: pedido.livro.autor,
            precoDiaExtra: pedido.livro.precoDiaExtra,
          },
        };
      })
      .filter((pedido) => pedido.diasAtraso > 0);

    res.json(atrasos);
  } catch (error) {
    console.error("Erro ao buscar atrasos:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar atrasos",
      detalhe: error.message,
    });
  }
});
// ======================
// CRIAR LIVRO - SOMENTE ADMIN
// ======================
app.post(
  "/livros",
  autenticar,
  somenteAdmin,
  uploadLivro.single("imagem"),
  (req, res, next) => {
    const erro = validarLivro(req.body);
    if (erro) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ erro });
    }
    next();
  },
  async (req, res) => {
    try {
      if (!req.body) {
        return res.status(400).json({
          erro: "Dados do formulário não recebidos. Verifique se o envio está sendo feito como multipart/form-data.",
        });
      }

      const {
        isbn,
        imagemUrlExterna,
        titulo,
        autor,
        redator,
        ano,
        categoria,
        sinopse,
        precoCompra,
        precoAluguel,
        diasInclusos,
        precoDiaExtra,
        estoque,
        isDoado,
        destaque,
        disponivel,
      } = req.body;

      if (!titulo || !autor || !categoria || !sinopse) {
        return res.status(400).json({
          erro: "Título, autor, categoria e sinopse são obrigatórios",
        });
      }

      // A capa enviada manualmente tem prioridade. O ISBN pode fornecer uma URL externa.
      const imagemUrl = montarImagemUrl(req) || imagemUrlExterna || null;

      const livro = await prisma.livro.create({
        data: {
          isbn: isbn ? normalizarIsbn(isbn) : null,
          titulo,
          autor,
          redator,
          ano: Number(ano),
          categoria,
          sinopse,
          precoCompra: Number(precoCompra),
          precoAluguel: Number(precoAluguel),
          diasInclusos: Number(diasInclusos),
          precoDiaExtra: Number(precoDiaExtra),
          estoque: Number(estoque),
          isDoado: converterBoolean(isDoado, false),
          destaque: converterBoolean(destaque, false),
          disponivel: converterBoolean(disponivel, true),
          imagemUrl,
        },
      });

      res.status(201).json(livro);
    } catch (error) {
      console.error("Erro ao criar livro:", error);

      res.status(error.status || 500).json({
        erro: "Erro ao criar livro",
        detalhe: error.message,
      });
    }
  },
);

// ======================
// LISTAR LIVROS
// ======================
app.get("/livros", async (req, res) => {
  try {
    const livros = await prisma.livro.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(livros);
  } catch (error) {
    console.error("Erro ao buscar livros:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar livros",
      detalhe: error.message,
    });
  }
});

// ======================
// BUSCAR LIVRO POR ID
// ======================
app.get("/livros/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const livro = await prisma.livro.findUnique({
      where: {
        id: Number(id),
      },
    });

    if (!livro) {
      return res.status(404).json({ erro: "Livro não encontrado" });
    }

    res.json(livro);
  } catch (error) {
    console.error("Erro ao buscar livro:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar livro",
      detalhe: error.message,
    });
  }
});

// ======================
// EDITAR LIVRO - SOMENTE ADMIN
// ======================
app.put(
  "/livros/:id",
  autenticar,
  somenteAdmin,
  uploadLivro.single("imagem"),
  (req, res, next) => {
    const erro = validarLivro(req.body);
    if (erro) {
      if (req.file) fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ erro });
    }
    next();
  },
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!req.body) {
        return res.status(400).json({
          erro: "Dados do formulário não recebidos. Verifique se o envio está sendo feito como multipart/form-data.",
        });
      }

      const {
        isbn,
        imagemUrlExterna,
        titulo,
        autor,
        redator,
        ano,
        categoria,
        sinopse,
        precoCompra,
        precoAluguel,
        diasInclusos,
        precoDiaExtra,
        estoque,
        isDoado,
        destaque,
        disponivel,
      } = req.body;

      const livroExiste = await prisma.livro.findUnique({
        where: {
          id: Number(id),
        },
      });

      if (!livroExiste) {
        return res.status(404).json({ erro: "Livro não encontrado" });
      }

      const novaImagemUrl = montarImagemUrl(req);

      const livro = await prisma.livro.update({
        where: {
          id: Number(id),
        },
        data: {
          isbn: isbn ? normalizarIsbn(isbn) : null,
          titulo,
          autor,
          redator,
          ano: Number(ano),
          categoria,
          sinopse,
          precoCompra: Number(precoCompra),
          precoAluguel: Number(precoAluguel),
          diasInclusos: Number(diasInclusos),
          precoDiaExtra: Number(precoDiaExtra),
          estoque: Number(estoque),
          isDoado: converterBoolean(isDoado, false),
          destaque: converterBoolean(destaque, false),
          disponivel: converterBoolean(disponivel, true),
          imagemUrl: novaImagemUrl || imagemUrlExterna || livroExiste.imagemUrl,
        },
      });

      res.json(livro);
    } catch (error) {
      console.error("Erro ao editar livro:", error);

      res.status(error.status || 500).json({
        erro: "Erro ao editar livro",
        detalhe: error.message,
      });
    }
  },
);

// ======================
// PAUSAR / ATIVAR LIVRO - SOMENTE ADMIN
// ======================
app.patch(
  "/livros/:id/disponibilidade",
  autenticar,
  somenteAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { disponivel } = req.body;

      const livro = await prisma.livro.update({
        where: {
          id: Number(id),
        },
        data: {
          disponivel: Boolean(disponivel),
        },
      });

      res.json(livro);
    } catch (error) {
      console.error("Erro ao alterar disponibilidade:", error);

      res.status(error.status || 500).json({
        erro: "Erro ao alterar disponibilidade do livro",
        detalhe: error.message,
      });
    }
  },
);

// ======================
// ALTERAR DESTAQUE - SOMENTE ADMIN
// ======================
app.patch(
  "/livros/:id/destaque",
  autenticar,
  somenteAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { destaque } = req.body;

      const livro = await prisma.livro.update({
        where: {
          id: Number(id),
        },
        data: {
          destaque: Boolean(destaque),
        },
      });

      res.json(livro);
    } catch (error) {
      console.error("Erro ao alterar destaque:", error);

      res.status(error.status || 500).json({
        erro: "Erro ao alterar destaque do livro",
        detalhe: error.message,
      });
    }
  },
);

// ======================
// EXCLUIR LIVRO - SOMENTE ADMIN
// ======================
app.delete("/livros/:id", autenticar, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const livroExiste = await prisma.livro.findUnique({
      where: {
        id: Number(id),
      },
    });

    if (!livroExiste) {
      return res.status(404).json({ erro: "Livro não encontrado" });
    }

    await prisma.livro.delete({
      where: {
        id: Number(id),
      },
    });

    res.json({ mensagem: "Livro excluído com sucesso" });
  } catch (error) {
    console.error("Erro ao excluir livro:", error);

    if (error.code === "P2003") {
      return res.status(400).json({
        erro: "Este livro possui pedidos vinculados e não pode ser excluído. Pause o livro em vez disso.",
      });
    }

    res.status(error.status || 500).json({
      erro: "Erro ao excluir livro",
      detalhe: error.message,
    });
  }
});

// ======================
// RESERVA - USUÁRIO LOGADO COM DATA DE RETIRADA
// ======================
app.post("/reservar", autenticar, async (req, res) => {
  try {
    const usuarioId = Number(req.usuario.id);
    const { livroId, dataRetirada } = req.body;

    if (!livroId || !dataRetirada) {
      return res.status(400).json({
        erro: "Livro e data de retirada são obrigatórios",
      });
    }

    const user = await prisma.usuario.findUnique({
      where: { id: usuarioId },
    });
    if (user?.bloqueado) {
      return res.status(403).json({
        erro: "Usuário congelado. Regularize sua situação com a biblioteca para fazer novas ações.",
      });
    }

    if (!user) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    const livro = await prisma.livro.findUnique({
      where: { id: Number(livroId) },
    });

    if (!livro || livro.estoque <= 0 || livro.isDoado || !livro.disponivel) {
      return res.status(400).json({ erro: "Livro indisponível" });
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const retiradaEscolhida = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dataRetirada) ? `${dataRetirada}T12:00:00` : NaN);
    retiradaEscolhida.setHours(0, 0, 0, 0);

    if (Number.isNaN(retiradaEscolhida.getTime())) {
      return res.status(400).json({
        erro: "Data de retirada inválida",
      });
    }

    if (retiradaEscolhida < hoje) {
      return res.status(400).json({
        erro: "A data de retirada não pode ser anterior ao dia atual",
      });
    }

    const { diasAtraso, multa } = calcularMultaReserva(retiradaEscolhida);

    const pedido = await criarPedidoComEstoque(prisma, {
        tipo: "reserva",
        status: "pendente",
        statusPagamento: multa > 0 ? "pendente" : "pago",
        valor: multa,
        retiradaLimite: retiradaEscolhida,
        usuarioId,
        livroId: Number(livroId),
      });

    await enviarEmail(user.email, livro, pedido);

    res.json({
      ...pedido,
      multaReserva: multa,
      diasAtrasoReserva: diasAtraso,
    });
  } catch (error) {
    console.error("Erro na reserva:", error);

    res.status(error.status || 500).json({
      erro: "Erro na reserva",
      detalhe: error.message,
    });
  }
});

// ======================
// COMPRA - USUÁRIO LOGADO
// ======================
app.post("/comprar", autenticar, async (req, res) => {
  try {
    const usuarioId = Number(req.usuario.id);
    const { livroId, modalidadeEntrega = "retirada", enderecoEntrega } = req.body;

    if (!livroId) {
      return res.status(400).json({ erro: "Livro é obrigatório" });
    }

    if (!["retirada", "entrega"].includes(modalidadeEntrega)) {
      return res.status(400).json({ erro: "Modalidade de entrega inválida" });
    }

    const user = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!user) return res.status(404).json({ erro: "Usuário não encontrado" });
    if (user.bloqueado) {
      return res.status(403).json({
        erro: "Usuário congelado. Regularize sua situação com a biblioteca para fazer novas ações.",
      });
    }

    const livro = await prisma.livro.findUnique({ where: { id: Number(livroId) } });
    if (!livro || livro.estoque <= 0 || !livro.disponivel) {
      return res.status(400).json({ erro: "Livro indisponível" });
    }

    let cotacao = null;
    let enderecoFinal = null;

    if (modalidadeEntrega === "entrega") {
      enderecoFinal = (enderecoEntrega || montarEnderecoUsuario(user)).trim();
      if (!enderecoFinal) {
        return res.status(400).json({ erro: "Informe o endereço para entrega" });
      }
      // O frete sempre é recalculado no servidor para impedir alteração do preço no frontend.
      cotacao = await calcularCotacaoEntrega(enderecoFinal);
    }

    const valorEntrega = Number(cotacao?.valorEntrega || 0);
    const valorTotal = Number(livro.precoCompra) + valorEntrega;
    const retiradaLimite = new Date();
    retiradaLimite.setDate(retiradaLimite.getDate() + 7);

    const pedido = await criarPedidoComEstoque(prisma, {
          tipo: "compra",
          status: "pendente",
          statusPagamento: valorTotal > 0 ? "pendente" : "pago",
          valor: valorTotal,
          retiradaLimite,
          modalidadeEntrega,
          enderecoEntrega: enderecoFinal,
          distanciaEntregaKm: cotacao?.distanciaKm || null,
          valorEntrega,
          statusEntrega: modalidadeEntrega === "entrega" ? "aguardando_pagamento" : "nao_aplicavel",
          usuarioId,
          livroId: Number(livroId),
        });

    await enviarEmail(user.email, livro, pedido);

    if (modalidadeEntrega === "entrega") {
      await enviarNotificacao({
        to: user.email,
        subject: "Entrega solicitada - BiblioConnect",
        titulo: "Recebemos seu pedido para entrega",
        mensagem: "O frete foi calculado e será preparado após a confirmação do pagamento.",
        detalhes: [
          { label: "Livro", valor: livro.titulo },
          { label: "Endereço", valor: enderecoFinal },
          { label: "Frete", valor: formatarMoedaEmail(valorEntrega) },
        ],
      }).catch((error) => console.log("Aviso de email de entrega:", error.message));
    }

    res.json(pedido);
  } catch (error) {
    console.error("Erro na compra:", error);
    res.status(error.status || 500).json({ erro: "Erro na compra", detalhe: error.message });
  }
});

// ======================
// ALUGUEL - USUÁRIO LOGADO
// ======================
app.post("/alugar", autenticar, async (req, res) => {
  try {
    const usuarioId = Number(req.usuario.id);
    const { livroId, dias } = req.body;

    if (!livroId) {
      return res.status(400).json({
        erro: "Livro é obrigatório",
      });
    }

    const diasAluguel = Number(dias);

    if (!Number.isInteger(diasAluguel) || diasAluguel < 1 || diasAluguel > 365) {
      return res.status(400).json({ erro: "Dias de aluguel inválido" });
    }

    const user = await prisma.usuario.findUnique({
      where: { id: usuarioId },
    });
    if (user?.bloqueado) {
      return res.status(403).json({
        erro: "Usuário congelado. Regularize sua situação com a biblioteca para fazer novas ações.",
      });
    }

    if (!user) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    const livro = await prisma.livro.findUnique({
      where: { id: Number(livroId) },
    });

    if (!livro || livro.estoque <= 0 || !livro.disponivel) {
      return res.status(400).json({ erro: "Livro indisponível" });
    }

    const valor = calcularAluguel(livro, diasAluguel);

    const retiradaLimite = new Date();
    retiradaLimite.setDate(retiradaLimite.getDate() + 7);

    const devolucao = new Date();
    devolucao.setDate(devolucao.getDate() + diasAluguel);

    const pedido = await criarPedidoComEstoque(prisma, {
        tipo: "aluguel",
        status: "pendente",
        statusPagamento: valor > 0 ? "pendente" : "pago",
        valor,
        diasAluguel,
        retiradaLimite,
        devolucaoPrevista: devolucao,
        usuarioId,
        livroId: Number(livroId),
      });

    await enviarEmail(user.email, livro, pedido);

    res.json(pedido);
  } catch (error) {
    console.error("Erro no aluguel:", error);

    res.status(error.status || 500).json({
      erro: "Erro no aluguel",
      detalhe: error.message,
    });
  }
});

// ======================
// MEUS PEDIDOS - USUÁRIO LOGADO
// ======================
app.get("/me/pedidos", autenticar, async (req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      where: {
        usuarioId: Number(req.usuario.id),
      },
      include: {
        livro: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(pedidos);
  } catch (error) {
    console.error("Erro ao buscar pedidos:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar pedidos do usuário",
      detalhe: error.message,
    });
  }
});

// ======================
// CANCELAR PEDIDO - USUÁRIO LOGADO
// ======================
app.patch("/me/pedidos/:id/cancelar", autenticar, async (req, res) => {
  try {
    const usuarioId = Number(req.usuario.id);
    const { id } = req.params;

    const pedido = await prisma.pedido.findFirst({
      where: {
        id: Number(id),
        usuarioId,
      },
      include: {
        livro: true,
      },
    });

    if (!pedido) {
      return res.status(404).json({
        erro: "Pedido não encontrado",
      });
    }

    if (pedido.status === "cancelado") {
      return res.status(400).json({
        erro: "Este pedido já foi cancelado",
      });
    }

    // Um pedido com cobrança real já aprovada não deve ser simplesmente cancelado,
    // porque isso devolveria o item ao estoque sem estornar o pagamento no gateway.
    // Reservas gratuitas continuam podendo ser canceladas normalmente.
    if (pedido.statusPagamento === "pago" && Number(pedido.valor || 0) > 0) {
      return res.status(400).json({
        erro: "Pedido já pago. Solicite o cancelamento pelo atendimento para que o estorno seja tratado corretamente.",
      });
    }

    const pedidoAtualizado = await alterarStatusPedido(prisma, Number(id), "cancelado", usuarioId);

    res.json({
      mensagem: "Pedido cancelado com sucesso",
      pedido: pedidoAtualizado,
    });
  } catch (error) {
    console.error("Erro ao cancelar pedido:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao cancelar pedido",
      detalhe: error.message,
    });
  }
});

// ======================
// ADMIN - LISTAR TODOS OS PEDIDOS
// ======================
app.get("/admin/pedidos", autenticar, somenteAdmin, async (req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      include: {
        usuario: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            endereco: true,
            bloqueado: true,
          },
        },
        livro: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const pedidosFormatados = pedidos.map((pedido) => {
      const multaAtual = calcularMultaPedido(pedido);

      return {
        ...pedido,
        multaAtual,
      };
    });

    res.json(pedidosFormatados);
  } catch (error) {
    console.error("Erro ao listar pedidos:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao listar pedidos",
      detalhe: error.message,
    });
  }
});

// ======================
// ADMIN - ALTERAR STATUS DO PEDIDO
// ======================
app.patch("/admin/pedidos/:id/status", autenticar, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const statusPermitidos = ["pendente", "concluido", "devolvido", "cancelado"];

    if (!statusPermitidos.includes(status)) {
      return res.status(400).json({
        erro: "Status inválido",
      });
    }

    const pedido = await prisma.pedido.findUnique({
      where: {
        id: Number(id),
      },
      include: {
        livro: true,
      },
    });

    if (!pedido) {
      return res.status(404).json({
        erro: "Pedido não encontrado",
      });
    }

    if (pedido.status === status) {
      return res.status(400).json({
        erro: "O pedido já está com este status",
      });
    }

    const statusFinalizaPedido = status === "concluido" || status === "devolvido";

    if (statusFinalizaPedido && pedido.statusPagamento !== "pago") {
      return res.status(400).json({
        erro: "Não é possível concluir ou devolver um pedido sem pagamento aprovado.",
      });
    }

    const pedidoAtualizado = await alterarStatusPedido(prisma, Number(id), status);

    await enviarNotificacao({
      to: pedidoAtualizado.usuario?.email,
      subject: "Atualização do pedido - BiblioConnect",
      titulo: "Seu pedido foi atualizado",
      mensagem: `O pedido #${pedidoAtualizado.id} agora está com status ${status}.`,
      detalhes: [
        { label: "Livro", valor: pedidoAtualizado.livro?.titulo },
        { label: "Tipo", valor: pedidoAtualizado.tipo },
      ],
    }).catch((emailError) => console.log("Aviso email status pedido:", emailError.message));

    res.json({
      mensagem: "Status atualizado com sucesso",
      pedido: pedidoAtualizado,
    });
  } catch (error) {
    console.error("Erro ao alterar status do pedido:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao alterar status do pedido",
      detalhe: error.message,
    });
  }
});

// ======================
// DASHBOARD - SOMENTE ADMIN
// ======================
app.get("/admin/dashboard", autenticar, somenteAdmin, async (req, res) => {
  try {
    const reservas = await prisma.pedido.count({
      where: { tipo: "reserva" },
    });

    const vendas = await prisma.pedido.count({
      where: { tipo: "compra" },
    });

    const alugueis = await prisma.pedido.count({
      where: { tipo: "aluguel" },
    });

    const usuarios = await prisma.usuario.count({
      where: {
        role: "CLIENTE",
      },
    });

    const usuariosBloqueados = await prisma.usuario.count({
      where: {
        role: "CLIENTE",
        bloqueado: true,
      },
    });

    const livros = await prisma.livro.count();

    const atrasosPedidos = await prisma.pedido.findMany({
      where: {
        status: "pendente",
        OR: [
          {
            tipo: "aluguel",
            devolucaoPrevista: {
              lt: new Date(),
            },
          },
          {
            tipo: "reserva",
            retiradaLimite: {
              lt: new Date(),
            },
          },
        ],
      },
      include: {
        livro: true,
      },
    });

    const multasPendentes = atrasosPedidos.reduce((total, pedido) => {
      return total + calcularMultaPedido(pedido);
    }, 0);

    const insights = await buscarInsightsVendas();

    res.json({
      reservas,
      vendas,
      alugueis,
      usuarios,
      usuariosBloqueados,
      livros,
      atrasos: atrasosPedidos.length,
      multasPendentes,
      ...insights,
    });
  } catch (error) {
    console.error("Erro ao buscar dashboard:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar dados do dashboard",
      detalhe: error.message,
    });
  }
});
// ======================
// EMAIL PEDIDO
// ======================
async function enviarEmail(email, livro, pedido) {
  try {
    if (!emailConfigurado()) {
      console.log("EMAIL_USER ou EMAIL_PASS não configurados. Email de pedido não enviado.");
      return;
    }

    await enviarEmailHtml({
      to: email,
      subject: "Confirmação de Pedido - BiblioConnect",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; background: #f7f7f7;">
          <div style="background: #ffffff; border-radius: 16px; padding: 28px; border: 1px solid #e5e7eb;">
            <h2 style="color: #1E3A5F; margin-top: 0;">Pedido confirmado</h2>

            <p style="color: #374151;"><strong>Livro:</strong> ${livro.titulo}</p>
            <p style="color: #374151;"><strong>Tipo:</strong> ${pedido.tipo}</p>
            <p style="color: #374151;"><strong>Valor:</strong> R$ ${Number(
              pedido.valor || 0
            ).toFixed(2)}</p>
            <p style="color: #374151;"><strong>Retirada até:</strong> ${new Date(
              pedido.retiradaLimite
            ).toLocaleDateString("pt-BR")}</p>

            <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">
              Acesse o BiblioConnect para acompanhar o status do pedido.
            </p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.log("Erro no email:", error.message);
  }
}
// ======================
// BUSCAR PEDIDO POR ID - USUÁRIO LOGADO OU ADMIN
// ======================
app.get("/pedidos/:id", autenticar, async (req, res) => {
  try {
    const { id } = req.params;

    const pedido = await prisma.pedido.findUnique({
      where: {
        id: Number(id),
      },
      include: {
        livro: true,
        usuario: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            endereco: true,
            role: true,
          },
        },
      },
    });

    if (!pedido) {
      return res.status(404).json({
        erro: "Pedido não encontrado",
      });
    }

    const isAdmin = req.usuario.role === "ADMIN";
    const isOwner = pedido.usuarioId === Number(req.usuario.id);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        erro: "Você não tem permissão para acessar este pedido",
      });
    }

    res.json(pedido);
  } catch (error) {
    console.error("Erro ao buscar pedido:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar pedido",
      detalhe: error.message,
    });
  }
});

// ======================
// ADMIN - RESUMO FINANCEIRO
// ======================
app.get("/admin/financeiro", autenticar, somenteAdmin, async (req, res) => {
  try {
    const pedidos = await prisma.pedido.findMany({
      where: {
        status: {
          not: "cancelado",
        },
      },
      include: {
        usuario: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
          },
        },
        livro: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const pedidosPagosLista = pedidos.filter(
      (pedido) => pedido.statusPagamento === "pago"
    );

    const pedidosPendentesLista = pedidos.filter(
      (pedido) => pedido.statusPagamento === "pendente"
    );

    const pedidosCanceladosPagamentoLista = pedidos.filter(
      (pedido) => pedido.statusPagamento === "cancelado"
    );

    const pedidosEstornadosLista = pedidos.filter(
      (pedido) => pedido.statusPagamento === "estornado"
    );

    const totalRecebido = pedidosPagosLista.reduce((total, pedido) => {
      return total + Number(pedido.valor || 0);
    }, 0);

    const totalPendente = pedidosPendentesLista.reduce((total, pedido) => {
      return total + Number(pedido.valor || 0);
    }, 0);

    const totalCompras = pedidosPagosLista.reduce((total, pedido) => {
      if (pedido.tipo === "compra") {
        return total + Number(pedido.valor || 0);
      }

      return total;
    }, 0);

    const totalAlugueis = pedidosPagosLista.reduce((total, pedido) => {
      if (pedido.tipo === "aluguel") {
        return total + Number(pedido.valor || 0);
      }

      return total;
    }, 0);

    const totalReservasMultas = pedidosPagosLista.reduce((total, pedido) => {
      if (pedido.tipo === "reserva") {
        return total + Number(pedido.valor || 0);
      }

      return total;
    }, 0);

    const pedidosPagos = pedidosPagosLista.length;
    const pedidosPendentes = pedidosPendentesLista.length;
    const pedidosCanceladosPagamento = pedidosCanceladosPagamentoLista.length;
    const pedidosEstornados = pedidosEstornadosLista.length;

    const totalEstornado = pedidosEstornadosLista.reduce((total, pedido) => {
      return total + Number(pedido.valor || 0);
    }, 0);

    const totalCanceladoPagamento = pedidosCanceladosPagamentoLista.reduce(
      (total, pedido) => {
        return total + Number(pedido.valor || 0);
      },
      0
    );

    const porTipo = [
      {
        nome: "Compras pagas",
        valor: totalCompras,
      },
      {
        nome: "Aluguéis pagos",
        valor: totalAlugueis,
      },
      {
        nome: "Reservas/Multas pagas",
        valor: totalReservasMultas,
      },
    ];

    const porPagamento = [
      {
        nome: "Pago",
        quantidade: pedidosPagos,
      },
      {
        nome: "Pendente",
        quantidade: pedidosPendentes,
      },
      {
        nome: "Cancelado",
        quantidade: pedidosCanceladosPagamento,
      },
      {
        nome: "Estornado",
        quantidade: pedidosEstornados,
      },
    ];

    res.json({
      totalRecebido,
      totalPendente,
      totalCompras,
      totalAlugueis,
      totalReservasMultas,
      totalEstornado,
      totalCanceladoPagamento,
      pedidosPagos,
      pedidosPendentes,
      pedidosCanceladosPagamento,
      pedidosEstornados,
      porTipo,
      porPagamento,
      pedidosRecentes: pedidos.slice(0, 12),
    });
  } catch (error) {
    console.error("Erro ao buscar financeiro:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao buscar dados financeiros",
      detalhe: error.message,
    });
  }
});

// ======================
// ADMIN - ALTERAR STATUS DE PAGAMENTO
// ======================
app.patch(
  "/admin/pedidos/:id/pagamento",
  autenticar,
  somenteAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { statusPagamento } = req.body;

      const statusPermitidos = ["pendente", "pago", "cancelado", "estornado"];

      if (!statusPermitidos.includes(statusPagamento)) {
        return res.status(400).json({
          erro: "Status de pagamento inválido",
        });
      }

      const pedido = await prisma.pedido.findUnique({
        where: {
          id: Number(id),
        },
      });

      if (!pedido) {
        return res.status(404).json({
          erro: "Pedido não encontrado",
        });
      }

      const pedidoAtualizado = await prisma.pedido.update({
        where: {
          id: Number(id),
        },
        data: {
          statusPagamento,
        },
        include: {
          usuario: true,
          livro: true,
        },
      });

      res.json({
        mensagem: "Status de pagamento atualizado com sucesso",
        pedido: pedidoAtualizado,
      });
    } catch (error) {
      console.error("Erro ao alterar status de pagamento:", error);

      res.status(error.status || 500).json({
        erro: "Erro ao alterar status de pagamento",
        detalhe: error.message,
      });
    }
  }
);

// ======================
// SIMULAR PAGAMENTO APROVADO - USUÁRIO LOGADO
// ======================
app.patch("/pedidos/:id/simular-pagamento", autenticar, async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_PAYMENT_SIMULATION !== "true") {
      return res.status(403).json({
        erro: "Simulação de pagamento desativada. Use o gateway configurado.",
      });
    }
    const { id } = req.params;

    const pedido = await prisma.pedido.findUnique({
      where: {
        id: Number(id),
      },
      include: {
        livro: true,
        usuario: true,
      },
    });

    if (!pedido) {
      return res.status(404).json({
        erro: "Pedido não encontrado",
      });
    }

    const isAdmin = req.usuario.role === "ADMIN";
    const isOwner = pedido.usuarioId === Number(req.usuario.id);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        erro: "Você não tem permissão para pagar este pedido",
      });
    }

    if (pedido.status === "cancelado") {
      return res.status(400).json({
        erro: "Pedido cancelado não pode ser pago",
      });
    }

    if (pedido.statusPagamento === "pago") {
      return res.status(400).json({
        erro: "Este pedido já está pago",
      });
    }

    const pedidoAtualizado = await prisma.pedido.update({
      where: {
        id: Number(id),
      },
      data: {
        statusPagamento: "pago",
      },
      include: {
        livro: true,
        usuario: true,
      },
    });

    res.json({
      mensagem: "Pagamento simulado com sucesso",
      pedido: pedidoAtualizado,
    });
  } catch (error) {
    console.error("Erro ao simular pagamento:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao simular pagamento",
      detalhe: error.message,
    });
  }
});



// ============================================================
// INTEGRAÇÕES: STATUS, ISBN E ENTREGA
// ============================================================
app.get("/integracoes/status", autenticar, async (req, res) => {
  res.json({
    mercadoPago: pagamentoGatewayConfigurado(),
    googleMaps: mapsConfigurado(),
    googleBooks: true,
    email: emailConfigurado(),
    simulacao: process.env.NODE_ENV !== "production" && process.env.ALLOW_PAYMENT_SIMULATION === "true",
  });
});

// Autopreenchimento do formulário do livro a partir do ISBN.
app.get("/isbn/:isbn", autenticar, somenteAdmin, async (req, res) => {
  try {
    const livro = await buscarLivroPorIsbn(req.params.isbn);
    if (!livro) {
      return res.status(404).json({ erro: "ISBN não encontrado no Google Books" });
    }
    res.json(livro);
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

// Prévia de frete. A compra recalcula novamente o valor para não confiar no frontend.
app.post("/entrega/cotacao", autenticar, async (req, res) => {
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: Number(req.usuario.id) } });
    const destino = req.body?.endereco || montarEnderecoUsuario(usuario);
    const cotacao = await calcularCotacaoEntrega(destino);
    res.json(cotacao);
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.get("/admin/entregas/terceirizadas", autenticar, somenteAdmin, async (req, res) => {
  res.json(getLinksEntregasTerceirizadas());
});

app.patch("/admin/pedidos/:id/entrega", autenticar, somenteAdmin, async (req, res) => {
  try {
    const { statusEntrega, transportadoraEntrega, codigoRastreio } = req.body;
    const permitidos = [
      "aguardando_pagamento",
      "preparando",
      "aguardando_entregador",
      "em_transporte",
      "entregue",
      "cancelada",
    ];
    if (!permitidos.includes(statusEntrega)) {
      return res.status(400).json({ erro: "Status de entrega inválido" });
    }

    const atual = await prisma.pedido.findUnique({
      where: { id: Number(req.params.id) },
      include: { usuario: true, livro: true },
    });
    if (!atual) return res.status(404).json({ erro: "Pedido não encontrado" });
    if (["cancelado", "devolvido"].includes(atual.status) || (["preparando", "aguardando_entregador", "em_transporte", "entregue"].includes(statusEntrega) && atual.statusPagamento !== "pago")) {
      return res.status(400).json({ erro: "Verifique o status do pedido e o pagamento antes de avançar a entrega" });
    }
    if (atual.modalidadeEntrega !== "entrega") {
      return res.status(400).json({ erro: "Este pedido não possui entrega" });
    }

    const pedido = await prisma.pedido.update({
      where: { id: atual.id },
      data: {
        statusEntrega,
        transportadoraEntrega: transportadoraEntrega || atual.transportadoraEntrega,
        codigoRastreio: codigoRastreio || atual.codigoRastreio,
      },
      include: { usuario: true, livro: true },
    });

    await enviarNotificacao({
      to: pedido.usuario.email,
      subject: "Atualização da entrega - BiblioConnect",
      titulo: "Seu pedido teve uma atualização de entrega",
      mensagem: `Novo status: ${statusEntrega.replaceAll("_", " ")}.`,
      detalhes: [
        { label: "Livro", valor: pedido.livro.titulo },
        { label: "Transportadora", valor: pedido.transportadoraEntrega },
        { label: "Rastreio", valor: pedido.codigoRastreio },
      ],
    }).catch((error) => console.log("Aviso email entrega:", error.message));

    res.json(pedido);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao atualizar entrega", detalhe: error.message });
  }
});

// ============================================================
// AVALIAÇÕES E COMENTÁRIOS
// ============================================================
app.get("/livros/:id/avaliacoes", async (req, res) => {
  try {
    const avaliacoes = await prisma.avaliacao.findMany({
      where: { livroId: Number(req.params.id), status: "aprovado" },
      include: { usuario: { select: { id: true, nome: true } } },
      orderBy: { createdAt: "desc" },
    });
    const media = avaliacoes.length
      ? avaliacoes.reduce((total, item) => total + item.nota, 0) / avaliacoes.length
      : 0;
    res.json({ media: Number(media.toFixed(1)), total: avaliacoes.length, avaliacoes });
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao buscar avaliações", detalhe: error.message });
  }
});

app.post("/livros/:id/avaliacoes", autenticar, async (req, res) => {
  try {
    const livroId = Number(req.params.id);
    const nota = Number(req.body?.nota);
    const comentario = String(req.body?.comentario || "").trim();
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ erro: "A nota deve ser um número inteiro entre 1 e 5" });
    }
    if (comentario.length < 3 || comentario.length > 1500) {
      return res.status(400).json({ erro: "O comentário deve ter entre 3 e 1500 caracteres" });
    }

    // Avaliação é permitida para quem já teve algum pedido não cancelado do livro.
    const pedidoAnterior = await prisma.pedido.findFirst({
      where: {
        usuarioId: Number(req.usuario.id),
        livroId,
        status: { not: "cancelado" },
      },
    });
    if (!pedidoAnterior) {
      return res.status(403).json({ erro: "Você precisa ter um pedido deste livro para avaliá-lo" });
    }

    const avaliacao = await prisma.avaliacao.upsert({
      where: { usuarioId_livroId: { usuarioId: Number(req.usuario.id), livroId } },
      create: {
        nota,
        comentario,
        status: "pendente",
        usuarioId: Number(req.usuario.id),
        livroId,
      },
      update: { nota, comentario, status: "pendente" },
    });

    res.status(201).json({
      mensagem: "Avaliação enviada para moderação do administrador.",
      avaliacao,
    });
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao salvar avaliação", detalhe: error.message });
  }
});

app.get("/admin/avaliacoes", autenticar, somenteAdmin, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const avaliacoes = await prisma.avaliacao.findMany({
      where: status ? { status } : undefined,
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        livro: { select: { id: true, titulo: true, autor: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(avaliacoes);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao listar avaliações", detalhe: error.message });
  }
});

app.patch("/admin/avaliacoes/:id/status", autenticar, somenteAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || "");
    if (!["pendente", "aprovado", "oculto"].includes(status)) {
      return res.status(400).json({ erro: "Status de avaliação inválido" });
    }
    const avaliacao = await prisma.avaliacao.update({
      where: { id: Number(req.params.id) },
      data: { status },
    });
    res.json(avaliacao);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao moderar avaliação", detalhe: error.message });
  }
});

app.delete("/admin/avaliacoes/:id", autenticar, somenteAdmin, async (req, res) => {
  try {
    await prisma.avaliacao.delete({ where: { id: Number(req.params.id) } });
    res.json({ mensagem: "Avaliação removida" });
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao remover avaliação", detalhe: error.message });
  }
});

// ============================================================
// CHAT CLIENTE <-> EMPRESA
// ============================================================
async function buscarOuCriarConversaCliente(usuarioId, assunto = "Atendimento") {
  let conversa = await prisma.conversa.findFirst({
    where: { usuarioId, status: "aberta" },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversa) {
    conversa = await prisma.conversa.create({ data: { usuarioId, assunto } });
  }
  return conversa;
}

app.get("/chat", autenticar, async (req, res) => {
  try {
    const conversa = await prisma.conversa.findFirst({
      where: { usuarioId: Number(req.usuario.id), status: "aberta" },
      include: {
        mensagens: {
          include: { remetente: { select: { id: true, nome: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!conversa) return res.json({ conversa: null, mensagens: [] });

    await prisma.mensagemChat.updateMany({
      where: { conversaId: conversa.id, remetenteRole: "ADMIN", lida: false },
      data: { lida: true },
    });
    res.json({ conversa, mensagens: conversa.mensagens });
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao carregar chat", detalhe: error.message });
  }
});

app.post("/chat/mensagens", autenticar, async (req, res) => {
  try {
    const texto = String(req.body?.texto || "").trim();
    if (!texto || texto.length > 2000) {
      return res.status(400).json({ erro: "Mensagem vazia ou acima de 2000 caracteres" });
    }
    const conversa = await buscarOuCriarConversaCliente(
      Number(req.usuario.id),
      String(req.body?.assunto || "Atendimento").slice(0, 120),
    );
    const mensagem = await prisma.mensagemChat.create({
      data: {
        texto,
        remetenteRole: req.usuario.role,
        conversaId: conversa.id,
        remetenteId: Number(req.usuario.id),
      },
      include: { remetente: { select: { id: true, nome: true, role: true } } },
    });
    await prisma.conversa.update({ where: { id: conversa.id }, data: { updatedAt: new Date() } });
    res.status(201).json(mensagem);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao enviar mensagem", detalhe: error.message });
  }
});

app.get("/admin/chat/conversas", autenticar, somenteAdmin, async (req, res) => {
  try {
    const conversas = await prisma.conversa.findMany({
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        mensagens: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { mensagens: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(conversas);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao listar conversas", detalhe: error.message });
  }
});

app.get("/admin/chat/conversas/:id", autenticar, somenteAdmin, async (req, res) => {
  try {
    const conversa = await prisma.conversa.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        usuario: { select: { id: true, nome: true, email: true } },
        mensagens: {
          include: { remetente: { select: { id: true, nome: true, role: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada" });
    await prisma.mensagemChat.updateMany({
      where: { conversaId: conversa.id, remetenteRole: "CLIENTE", lida: false },
      data: { lida: true },
    });
    res.json(conversa);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao abrir conversa", detalhe: error.message });
  }
});

app.post("/admin/chat/conversas/:id/mensagens", autenticar, somenteAdmin, async (req, res) => {
  try {
    const texto = String(req.body?.texto || "").trim();
    if (!texto || texto.length > 2000) {
      return res.status(400).json({ erro: "Mensagem vazia ou acima de 2000 caracteres" });
    }
    const conversa = await prisma.conversa.findUnique({ where: { id: Number(req.params.id) } });
    if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada" });
    const mensagem = await prisma.mensagemChat.create({
      data: {
        texto,
        remetenteRole: "ADMIN",
        conversaId: conversa.id,
        remetenteId: Number(req.usuario.id),
      },
      include: { remetente: { select: { id: true, nome: true, role: true } } },
    });
    await prisma.conversa.update({ where: { id: conversa.id }, data: { updatedAt: new Date() } });
    res.status(201).json(mensagem);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao responder conversa", detalhe: error.message });
  }
});

app.patch("/admin/chat/conversas/:id/status", autenticar, somenteAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || "");
    if (!["aberta", "encerrada"].includes(status)) {
      return res.status(400).json({ erro: "Status da conversa inválido" });
    }
    const conversa = await prisma.conversa.update({
      where: { id: Number(req.params.id) },
      data: { status },
    });
    res.json(conversa);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao alterar conversa", detalhe: error.message });
  }
});

// ============================================================
// PAGAMENTO REAL - MERCADO PAGO CHECKOUT PRO
// ============================================================
app.post("/pedidos/:id/pagamento", autenticar, async (req, res) => {
  try {
    if (!pagamentoGatewayConfigurado()) {
      return res.status(503).json({
        erro: "Gateway de pagamento ainda não configurado. Adicione MERCADO_PAGO_ACCESS_TOKEN no .env.",
      });
    }

    const pedido = await prisma.pedido.findUnique({
      where: { id: Number(req.params.id) },
      include: { livro: true, usuario: true },
    });
    if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado" });

    const isAdmin = req.usuario.role === "ADMIN";
    if (!isAdmin && pedido.usuarioId !== Number(req.usuario.id)) {
      return res.status(403).json({ erro: "Sem permissão para pagar este pedido" });
    }
    if (pedido.status === "cancelado") {
      return res.status(400).json({ erro: "Pedido cancelado não pode ser pago" });
    }
    if (pedido.statusPagamento === "pago") {
      return res.status(400).json({ erro: "Este pedido já está pago" });
    }

    const pagamentoLocal = await prisma.pagamento.create({ data: { pedidoId: pedido.id, tipo: "pedido", valor: pedido.valor } });
    const preferencia = await criarPreferenciaPagamento({
      pagamentoLocalId: pagamentoLocal.id,
      pedido,
      descricao: `${pedido.tipo} - ${pedido.livro.titulo}`,
      valor: pedido.valor,
      tipo: "pedido",
    });

    await prisma.$transaction([
      prisma.pagamento.update({
        where: { id: pagamentoLocal.id },
        data: {
          pedidoId: pedido.id,
          gateway: "mercadopago",
          gatewayPreferenceId: preferencia.id,
          status: "pendente",
          tipo: "pedido",
          valor: pedido.valor,
        },
      }),
      prisma.pedido.update({
        where: { id: pedido.id },
        data: {
          preferenciaPagamentoId: preferencia.id,
          linkPagamento: preferencia.init_point,
        },
      }),
    ]);

    res.json({
      gateway: "mercadopago",
      preferenceId: preferencia.id,
      checkoutUrl: preferencia.init_point,
      sandboxUrl: preferencia.sandbox_init_point || null,
    });
  } catch (error) {
    res.status(502).json({ erro: "Erro ao iniciar pagamento", detalhe: error.message });
  }
});

app.get("/pedidos/:id/pagamentos", autenticar, async (req, res) => {
  try {
    const pedido = await prisma.pedido.findUnique({ where: { id: Number(req.params.id) } });
    if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado" });
    if (req.usuario.role !== "ADMIN" && pedido.usuarioId !== Number(req.usuario.id)) {
      return res.status(403).json({ erro: "Sem permissão" });
    }
    const pagamentos = await prisma.pagamento.findMany({
      where: { pedidoId: pedido.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(pagamentos);
  } catch (error) {
    res.status(error.status || 500).json({ erro: "Erro ao listar pagamentos", detalhe: error.message });
  }
});

// Webhook público: o ID recebido nunca é aceito como prova de pagamento.
// O backend consulta o pagamento diretamente no Mercado Pago antes de atualizar o pedido.
app.post("/webhooks/mercadopago", async (req, res) => {
  if (!assinaturaValida(req, process.env.MERCADO_PAGO_WEBHOOK_SECRET)) {
    return res.status(401).json({ erro: "Assinatura do webhook inválida" });
  }
  try {
    const pagamentoMp = await buscarPagamentoMercadoPago(req.query["data.id"]);
    const aprovado = await aplicarPagamento(prisma, pagamentoMp);
    if (aprovado) {
      const pedido = await prisma.pedido.findUnique({ where: { id: Number(pagamentoMp.external_reference) }, include: { usuario: true } });
      await enviarNotificacao({ to: pedido.usuario.email, subject: "Pagamento aprovado - BiblioConnect",
        titulo: "Pagamento confirmado", mensagem: "O pagamento foi registrado. Consulte os detalhes e os prazos em Meus Pedidos." }).catch(error => console.error("Email de pagamento:", error.message));
    }
    // Só confirma depois do commit; uma falha permite nova tentativa do gateway.
    res.sendStatus(200);
  } catch (error) {
    console.error("Falha no webhook:", error.message);
    res.status(500).json({ erro: "Não foi possível processar a notificação" });
  }
});

// ============================================================
// EXTENSÃO DE ALUGUEL
// ============================================================
app.post("/me/pedidos/:id/estender-aluguel", autenticar, async (req, res) => {
  try {
    const diasExtras = Number(req.body?.diasExtras);
    if (!Number.isInteger(diasExtras) || diasExtras < 1 || diasExtras > 30) {
      return res.status(400).json({ erro: "Escolha de 1 a 30 dias extras" });
    }

    const pedido = await prisma.pedido.findFirst({
      where: { id: Number(req.params.id), usuarioId: Number(req.usuario.id) },
      include: { livro: true, usuario: true },
    });
    if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado" });
    if (pedido.tipo !== "aluguel") {
      return res.status(400).json({ erro: "Somente aluguéis podem ser estendidos" });
    }
    if (["cancelado", "devolvido", "concluido"].includes(pedido.status)) {
      return res.status(400).json({ erro: "Este aluguel já foi finalizado" });
    }
    if (pedido.statusPagamento !== "pago") {
      return res.status(400).json({ erro: "Pague o aluguel atual antes de solicitar uma extensão" });
    }
    if (pedido.diasExtensaoPendente > 0) {
      const pendente = await prisma.pagamento.findFirst({ where: { pedidoId: pedido.id, tipo: "extensao", gatewayPreferenceId: { not: null } }, orderBy: { id: "desc" } });
      if (!pendente) return res.status(409).json({ erro: "Extensão em processamento. Tente novamente em alguns segundos." });
      const preferencia = await buscarPreferenciaPagamento(pendente.gatewayPreferenceId);
      return res.json({ checkoutUrl: preferencia.init_point, valor: pendente.valor, diasExtras: pedido.diasExtensaoPendente });
    }
    if (pedido.devolucaoPrevista && new Date(pedido.devolucaoPrevista) < new Date()) {
      return res.status(400).json({ erro: "Aluguel em atraso. Regularize antes de solicitar extensão" });
    }

    const custoExtensao = diasExtras * Number(pedido.livro.precoDiaExtra || 0);
    if (custoExtensao === 0) {
      const atualizado = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Pedido" WHERE id = ${pedido.id} FOR UPDATE`;
        const atual = await tx.pedido.findUnique({ where: { id: pedido.id } });
        if (atual.status !== "pendente" || atual.diasExtensaoPendente > 0) throw new Error("Aluguel indisponível para extensão");
        const prazo = new Date(atual.devolucaoPrevista);
        prazo.setDate(prazo.getDate() + diasExtras);
        return tx.pedido.update({ where: { id: pedido.id }, data: { devolucaoPrevista: prazo, diasAluguel: { increment: diasExtras } } });
      });
      return res.json({ mensagem: "Extensão gratuita aplicada", pedido: atualizado, checkoutUrl: null });
    }
    if (!pagamentoGatewayConfigurado()) return res.status(503).json({ erro: "Gateway de pagamento não configurado" });
    const pagamentoLocal = await prisma.pagamento.create({ data: { pedidoId: pedido.id, tipo: "extensao", valor: custoExtensao } });
    const reserva = await prisma.pedido.updateMany({ where: { id: pedido.id, diasExtensaoPendente: 0 }, data: { diasExtensaoPendente: diasExtras, valorExtensaoPendente: custoExtensao } });
    if (!reserva.count) return res.status(409).json({ erro: "Já existe uma extensão pendente" });
    const preferencia = await criarPreferenciaPagamento({
      pagamentoLocalId: pagamentoLocal.id,
      pedido,
      descricao: `Extensão de ${diasExtras} dia(s) - ${pedido.livro.titulo}`,
      valor: custoExtensao,
      tipo: "extensao",
    }).catch(async error => {
      await prisma.pedido.update({ where: { id: pedido.id }, data: { diasExtensaoPendente: 0, valorExtensaoPendente: 0 } });
      throw error;
    });

    await prisma.$transaction([
      prisma.pedido.update({
        where: { id: pedido.id },
        data: {
          valorExtensaoPendente: custoExtensao,
          diasExtensaoPendente: diasExtras,
        },
      }),
      prisma.pagamento.update({
        where: { id: pagamentoLocal.id },
        data: {
          pedidoId: pedido.id,
          gateway: "mercadopago",
          gatewayPreferenceId: preferencia.id,
          status: "pendente",
          tipo: "extensao",
          valor: custoExtensao,
        },
      }),
    ]);

    res.json({
      mensagem: "Extensão criada. Ela será aplicada após o pagamento.",
      diasExtras,
      valor: custoExtensao,
      checkoutUrl: preferencia.init_point,
      sandboxUrl: preferencia.sandbox_init_point || null,
    });
  } catch (error) {
    res.status(502).json({ erro: "Erro ao solicitar extensão", detalhe: error.message });
  }
});

// ============================================================
// NOTIFICAÇÕES AUTOMÁTICAS DE ATRASO
// ============================================================
async function notificarAtrasosPendentes() {
  try {
    const limite = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pedidos = await prisma.pedido.findMany({
      where: {
        status: "pendente",
        OR: [
          { tipo: "aluguel", devolucaoPrevista: { lt: new Date() } },
          { tipo: "reserva", retiradaLimite: { lt: new Date() } },
        ],
        AND: [
          {
            OR: [
              { ultimaNotificacaoAtraso: null },
              { ultimaNotificacaoAtraso: { lt: limite } },
            ],
          },
        ],
      },
      include: { usuario: true, livro: true },
    });

    for (const pedido of pedidos) {
      const multa = calcularMultaPedido(pedido);
      await enviarNotificacao({
        to: pedido.usuario.email,
        subject: "Pendência em atraso - BiblioConnect",
        titulo: "Existe uma pendência no seu pedido",
        mensagem:
          pedido.tipo === "aluguel"
            ? "O prazo de devolução do aluguel venceu."
            : "O prazo da sua reserva venceu.",
        detalhes: [
          { label: "Livro", valor: pedido.livro.titulo },
          { label: "Multa atual", valor: formatarMoedaEmail(multa) },
        ],
      });
      await prisma.pedido.update({
        where: { id: pedido.id },
        data: { ultimaNotificacaoAtraso: new Date() },
      });
    }
  } catch (error) {
    console.error("Erro na rotina de notificações de atraso:", error.message);
  }
}

// Executa periodicamente enquanto o backend estiver online. Em produção, um cron externo
// também pode chamar essa rotina para ter maior garantia de execução.
if (process.env.DISABLE_DELAY_EMAIL_JOB !== "true") {
  setTimeout(notificarAtrasosPendentes, 30_000).unref();
  setInterval(notificarAtrasosPendentes, 6 * 60 * 60 * 1000).unref();
}

// ======================
// ADMIN - RESETAR SISTEMA
// ======================
app.post("/admin/resetar-sistema", autenticar, somenteAdmin, async (req, res) => {
  try {
    const { senhaAdmin, confirmacao } = req.body;

    if (!senhaAdmin) {
      return res.status(400).json({
        erro: "Senha do administrador é obrigatória.",
      });
    }

    if (confirmacao !== "RESETAR") {
      return res.status(400).json({
        erro: 'Digite exatamente "RESETAR" para confirmar a ação.',
      });
    }

    const admin = await prisma.usuario.findUnique({
      where: {
        id: Number(req.usuario.id),
      },
    });

    if (!admin || admin.role !== "ADMIN") {
      return res.status(403).json({
        erro: "Administrador inválido.",
      });
    }

    const senhaCorreta = await bcrypt.compare(senhaAdmin, admin.senha);

    if (!senhaCorreta) {
      return res.status(401).json({
        erro: "Senha do administrador incorreta.",
      });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      // Limpa primeiro as tabelas dependentes para manter a integridade referencial.
      await tx.mensagemChat.deleteMany({});
      await tx.conversa.deleteMany({});
      await tx.avaliacao.deleteMany({});
      await tx.pagamento.deleteMany({});

      const pedidosApagados = await tx.pedido.deleteMany({});

      const livrosApagados = await tx.livro.deleteMany({});

      const usuariosApagados = await tx.usuario.deleteMany({
        where: {
          role: "CLIENTE",
        },
      });

      await tx.usuario.update({
        where: {
          id: admin.id,
        },
        data: {
          emailConfirmado: true,
          bloqueado: false,
          tokenConfirmacaoEmail: null,
          tokenConfirmacaoExpira: null,
          tokenResetSenha: null,
          tokenResetSenhaExpira: null,
        },
      });

      return {
        pedidosApagados: pedidosApagados.count,
        livrosApagados: livrosApagados.count,
        usuariosApagados: usuariosApagados.count,
      };
    });

    try {
      const pastaUploadsLivros = path.join(__dirname, "uploads", "livros");

      if (fs.existsSync(pastaUploadsLivros)) {
        const arquivos = fs.readdirSync(pastaUploadsLivros);

        arquivos.forEach((arquivo) => {
          const caminhoArquivo = path.join(pastaUploadsLivros, arquivo);

          if (fs.existsSync(caminhoArquivo)) {
            fs.unlinkSync(caminhoArquivo);
          }
        });
      }
    } catch (uploadError) {
      console.log("Aviso: dados resetados, mas houve erro ao limpar uploads:", uploadError.message);
    }

    res.json({
      mensagem: "Sistema resetado com sucesso.",
      resultado,
    });
  } catch (error) {
    console.error("Erro ao resetar sistema:", error);

    res.status(error.status || 500).json({
      erro: "Erro ao resetar sistema",
      detalhe: error.message,
    });
  }
});


// ======================
// START SERVER
// ======================
// Respostas previsíveis para uploads, JSON malformado e rotas inexistentes.
app.use((req, res) => res.status(404).json({ erro: "Rota não encontrada" }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof multer.MulterError || error.type === "entity.parse.failed" || /Formato inválido/.test(error.message) ? 400 : error.status || 500;
  res.status(status).json({ erro: status < 500 ? (error.code === "LIMIT_FILE_SIZE" ? "A imagem deve ter no máximo 5 MB" : error.message) : "Erro interno do servidor" });
});

const PORT = process.env.PORT || 3000;

await prisma.$connect();
await criarAdminPadrao();
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT} 🚀`);

  // O diagnóstico no startup evita que uma configuração SMTP inválida passe
  // despercebida até o primeiro usuário tentar se cadastrar.
  if (!emailConfigurado()) {
    console.warn("⚠️ Email desativado: configure EMAIL_USER e EMAIL_PASS no .env.");
  } else {
    verificarConfiguracaoEmail().then((resultado) => {
      if (resultado.ok) {
        console.log(resultado.mensagem);
      } else {
        console.error(`❌ Falha na configuração de email: ${resultado.mensagem}`);
      }
    });
  }
});

async function encerrarServidor(signal) {
  console.log(`\n${signal} recebido. Encerrando BiblioConnect...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => encerrarServidor("SIGINT"));
process.on("SIGTERM", () => encerrarServidor("SIGTERM"));
