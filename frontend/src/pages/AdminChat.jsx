import { useRef, useCallback, useEffect, useState } from "react";
import api from "../api/api.js";

function AdminChat() {
  const [conversas, setConversas] = useState([]);
  const [selecionada, setSelecionada] = useState(null);
  const [texto, setTexto] = useState("");
  const [feedback, setFeedback] = useState("");
  const [enviando, setEnviando] = useState(false);
  const selecionadaRef = useRef(null);

  const carregarConversas = useCallback(async () => {
    try {
      const response = await api.get("/admin/chat/conversas");
      setConversas(response.data || []);
    } catch (error) {
      setFeedback(error.response?.data?.erro || "Erro ao carregar conversas.");
    }
  }, []);

  async function abrir(id) {
    selecionadaRef.current = id;
    try {
      const response = await api.get(`/admin/chat/conversas/${id}`);
      if (selecionadaRef.current === id) setSelecionada(response.data);
    } catch (error) { setFeedback(error.response?.data?.erro || "Erro ao abrir conversa."); }
  }

  async function responder(event) {
    event.preventDefault();
    if (!selecionada || !texto.trim() || enviando) return;
    setEnviando(true);
    try {
      await api.post(`/admin/chat/conversas/${selecionada.id}/mensagens`, { texto: texto.trim() });
      setTexto("");
      setFeedback("");
      if (selecionadaRef.current === selecionada.id) await abrir(selecionada.id);
      await carregarConversas();
    } catch (error) { setFeedback(error.response?.data?.erro || "Erro ao responder."); }
    finally { setEnviando(false); }
  }

  async function encerrar() {
    if (!selecionada || enviando) return;
    setEnviando(true);
    try {
      await api.patch(`/admin/chat/conversas/${selecionada.id}/status`, { status: "encerrada" });
      selecionadaRef.current = null;
      setSelecionada(null);
      await carregarConversas();
    } catch (error) { setFeedback(error.response?.data?.erro || "Erro ao encerrar."); }
    finally { setEnviando(false); }
  }

  useEffect(() => {
    let ativo = true;
    // Consulta também a conversa selecionada; antes só a lista lateral era atualizada.
    async function atualizar() {
      await carregarConversas();
      const id = selecionadaRef.current;
      if (!id) return;
      try {
        const response = await api.get(`/admin/chat/conversas/${id}`);
        if (ativo && selecionadaRef.current === id) setSelecionada(response.data);
      } catch (error) { if (ativo) setFeedback(error.response?.data?.erro || "Falha ao atualizar mensagens."); }
    }
    Promise.resolve().then(() => { if (ativo) return atualizar(); });
    const timer = setInterval(atualizar, 8000);
    return () => { ativo = false; clearInterval(timer); };
  }, [carregarConversas]);

  return (
    <main className="page">
      <div className="container admin-chat-layout">
        <aside className="chat-conversations">
          <h1>Atendimentos</h1>
          {feedback && <p className="feedback-banner error">{feedback}</p>}
          {conversas.map((conversa) => (
            <button key={conversa.id} onClick={() => abrir(conversa.id)} className="conversation-button">
              <strong>{conversa.usuario?.nome}</strong>
              <span>{conversa.status}</span>
              <small>{conversa.mensagens?.[0]?.texto || "Sem mensagens"}</small>
            </button>
          ))}
        </aside>

        <section className="chat-shell admin-chat-shell">
          {!selecionada ? <p className="chat-empty">Selecione uma conversa.</p> : (
            <>
              <div className="admin-chat-header">
                <div><strong>{selecionada.usuario?.nome}</strong><small>{selecionada.usuario?.email}</small></div>
                {selecionada.status === "aberta" && <button className="btn btn-outline" onClick={encerrar}>Encerrar</button>}
              </div>
              <div className="chat-messages">
                {selecionada.mensagens?.map((mensagem) => (
                  <div className={`chat-message ${mensagem.remetenteRole === "ADMIN" ? "company" : "client"}`} key={mensagem.id}>
                    <strong>{mensagem.remetente?.nome}</strong>
                    <p>{mensagem.texto}</p>
                    <small>{new Date(mensagem.createdAt).toLocaleString("pt-BR")}</small>
                  </div>
                ))}
              </div>
              {selecionada.status === "aberta" && (
                <form className="chat-compose" onSubmit={responder}>
                  <textarea aria-label="Resposta ao cliente" maxLength={2000} disabled={enviando} value={texto} onChange={(event) => setTexto(event.target.value)} required />
                  <button className="btn btn-primary" disabled={enviando}>{enviando ? "Enviando..." : "Responder"}</button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default AdminChat;
