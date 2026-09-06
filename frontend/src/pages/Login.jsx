import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth.js";

function Login() {
  const { login, resendConfirmation } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [precisaConfirmarEmail, setPrecisaConfirmarEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reenviandoEmail, setReenviandoEmail] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    setErro("");
    setMensagem("");
    setPrecisaConfirmarEmail(false);
    setLoading(true);

    try {
      await login(email, senha);
      navigate("/");
    } catch (error) {
      const dadosErro = error.response?.data || {};
      setErro(dadosErro.erro || (error.response
        ? "Não foi possível entrar. Tente novamente."
        : "Não foi possível conectar ao servidor. Confira se npm run demo está aberto e acesse http://localhost:5173/login."));
      setPrecisaConfirmarEmail(Boolean(dadosErro.precisaConfirmarEmail));
    } finally {
      setLoading(false);
    }
  }

  async function handleReenviarConfirmacao() {
    if (!email.trim()) {
      setErro("Digite o email da conta antes de reenviar a confirmação.");
      return;
    }

    setErro("");
    setMensagem("");
    setReenviandoEmail(true);

    try {
      const resultado = await resendConfirmation(email.trim());
      setMensagem(resultado.mensagem || "Email de confirmação reenviado com sucesso.");
    } catch (error) {
      setErro(
        error.response?.data?.detalhe ||
          error.response?.data?.erro ||
          "Não foi possível reenviar o email de confirmação."
      );
    } finally {
      setReenviandoEmail(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <span className="auth-mark">BC</span>
          <h1>Entrar na plataforma</h1>
          <p>Acesse sua conta para reservar, alugar ou comprar livros.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              placeholder="Digite seu email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <div className="password-label-row">
              <label>Senha</label>

              <Link to="/esqueci-senha" className="forgot-password-link">
                Esqueci minha senha
              </Link>
            </div>

            <div className="password-input-box">
              <input
                type={mostrarSenha ? "text" : "password"}
                placeholder="Digite sua senha"
                value={senha}
                onChange={(event) => setSenha(event.target.value)}
                required
              />

              <button
                type="button"
                className="password-eye-btn"
                onClick={() => setMostrarSenha((prev) => !prev)}
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
              >
                {mostrarSenha ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>

          {erro && <p className="feedback-banner error">{erro}</p>}
          {mensagem && <p className="feedback-banner success">{mensagem}</p>}

          {precisaConfirmarEmail && (
            <button
              type="button"
              className="btn btn-secondary auth-btn"
              onClick={handleReenviarConfirmacao}
              disabled={reenviandoEmail}
            >
              {reenviandoEmail ? "Reenviando..." : "Reenviar email de confirmação"}
            </button>
          )}

          <button className="btn btn-primary auth-btn" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        {import.meta.env.DEV && <div className="admin-login-info">
          <strong>Acesso administrativo de teste</strong>
          <span>admin@biblioconnect.com</span>
          <span>admin123</span>
        </div>}

        <p className="auth-footer">
          Ainda não tem conta? <Link to="/cadastro">Criar cadastro</Link>
        </p>
      </div>
    </main>
  );
}

export default Login;