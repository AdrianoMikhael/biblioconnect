import useInitialLoad from "../components/useInitialLoad.js";
import { useCallback, useState } from "react";
import api from "../api/api.js";

function AdminReviews() {
  const [avaliacoes, setAvaliacoes] = useState([]);
  const [filtro, setFiltro] = useState("todos");
  const [feedback, setFeedback] = useState("");

  const carregar = useCallback(async () => {
    try {
      const url = filtro === "todos" ? "/admin/avaliacoes" : `/admin/avaliacoes?status=${filtro}`;
      const response = await api.get(url);
      setAvaliacoes(response.data || []);
      setFeedback("");
    } catch (error) {
      setFeedback(error.response?.data?.erro || "Erro ao carregar avaliações.");
    }
  }, [filtro]);

  async function alterarStatus(id, status) {
    try {
    await api.patch(`/admin/avaliacoes/${id}/status`, { status });
    carregar();
    } catch (error) { setFeedback(error.response?.data?.erro || "Não foi possível salvar a alteração."); }
  }

  async function remover(id) {
    if (!window.confirm("Remover definitivamente este comentário?")) return;
    try {
      await api.delete(`/admin/avaliacoes/${id}`);
      await carregar();
    } catch (error) { setFeedback(error.response?.data?.erro || "Erro ao remover avaliação."); }
  }

  useInitialLoad(carregar);

  return (
    <main className="page">
      <div className="container feature-page">
        <div className="form-page-header">
          <div>
            <span className="section-kicker">Moderação</span>
            <h1 className="page-title">Avaliações e comentários</h1>
            <p className="page-subtitle">Aprove, oculte ou remova comentários enviados pelos clientes.</p>
          </div>
          <select value={filtro} onChange={(event) => setFiltro(event.target.value)}>
            <option value="todos">Todos</option>
            <option value="pendente">Pendentes</option>
            <option value="aprovado">Aprovados</option>
            <option value="oculto">Ocultos</option>
          </select>
        </div>
        {feedback && <p className="feedback-banner error">{feedback}</p>}
        <div className="feature-list">
          {avaliacoes.map((item) => (
            <article className="feature-card" key={item.id}>
              <div className="review-heading">
                <div><strong>{item.livro?.titulo}</strong><small>{item.usuario?.nome} · {item.usuario?.email}</small></div>
                <span>{item.nota}/5 · {item.status}</span>
              </div>
              <p>{item.comentario}</p>
              <div className="feature-actions">
                <button className="btn btn-primary" onClick={() => alterarStatus(item.id, "aprovado")}>Aprovar</button>
                <button className="btn btn-outline" onClick={() => alterarStatus(item.id, "oculto")}>Ocultar</button>
                <button className="btn btn-danger" onClick={() => remover(item.id)}>Excluir</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}

export default AdminReviews;
