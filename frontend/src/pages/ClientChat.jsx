import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/api.js";

function ClientChat() {
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState("");
  const [feedback, setFeedback] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef(null);

  const carregar = useCallback(async (silencioso = false) => {
    try {
      const response = await api.get("/chat");
      setMensagens(response.data?.mensagens || []);
      if (!silencioso) setFeedback("");
    } catch (error) {
      if (!silencioso) setFeedback(error.response?.data?.erro || "Erro ao carregar chat.");
    }
  }, []);

  async function enviar(event) {
    event.preventDefault();
    const mensagem = texto.trim();
    if (!mensagem || enviando) return;
    setEnviando(true);
    try {
      await api.post("/chat/mensagens", { texto: mensagem });
      setTexto("");
      carregar(true);
    } catch (error) {
      setFeedback(error.response?.data?.erro || "Erro ao enviar mensagem.");
    } finally { setEnviando(false); }
  }

  useEffect(() => {
    let ativo = true;
    Promise.resolve().then(() => { if (ativo) return carregar(); });
    const timer = setInterval(() => carregar(true), 8000);
    return () => { ativo = false; clearInterval(timer); };
  }, [carregar]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens.length]);

  return (
    <main className="page">
      <div className="container chat-page">
        <div>
          <span className="section-kicker">Atendimento</span>
          <h1 className="page-title">Chat com a BiblioConnect</h1>
          <p className="page-subtitle">Envie dúvidas, solicitações ou feedback. As mensagens ficam registradas no sistema.</p>
        </div>
        {feedback && <p className="feedback-banner error">{feedback}</p>}

        <section className="chat-shell">
          <div className="chat-messages">
            {mensagens.length === 0 && <p className="chat-empty">Envie a primeira mensagem para iniciar o atendimento.</p>}
            {mensagens.map((mensagem) => (
              <div
                className={`chat-message ${mensagem.remetenteRole === "ADMIN" ? "company" : "client"}`}
                key={mensagem.id}
              >
                <strong>{mensagem.remetenteRole === "ADMIN" ? "BiblioConnect" : "Você"}</strong>
                <p>{mensagem.texto}</p>
                <small>{new Date(mensagem.createdAt).toLocaleString("pt-BR")}</small>
              </div>
            ))}
            <div ref={fimRef} />
          </div>
          <form className="chat-compose" onSubmit={enviar}>
            <textarea
              aria-label="Mensagem para a biblioteca"
              disabled={enviando}
              value={texto}
              onChange={(event) => setTexto(event.target.value)}
              placeholder="Digite sua mensagem..."
              maxLength="2000"
              required
            />
            <button className="btn btn-primary" type="submit" disabled={enviando}>{enviando ? "Enviando..." : "Enviar"}</button>
          </form>
        </section>
      </div>
    </main>
  );
}

export default ClientChat;
