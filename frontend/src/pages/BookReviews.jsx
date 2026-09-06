import useInitialLoad from "../components/useInitialLoad.js";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api/api.js";
import { useAuth } from "../context/auth.js";

function BookReviews() {
  const { id } = useParams();
  const { isAuthenticated } = useAuth();
  const [livro, setLivro] = useState(null);
  const [dados, setDados] = useState({ media: 0, total: 0, avaliacoes: [] });
  const [nota, setNota] = useState(5);
  const [comentario, setComentario] = useState("");
  const [feedback, setFeedback] = useState({ type: "", text: "" });

  const carregar = useCallback(async () => {
    try {
      const [livroResponse, avaliacoesResponse] = await Promise.all([
        api.get(`/livros/${id}`),
        api.get(`/livros/${id}/avaliacoes`),
      ]);
      setLivro(livroResponse.data);
      setDados(avaliacoesResponse.data);
    } catch (error) {
      setFeedback({ type: "error", text: error.response?.data?.erro || "Erro ao carregar avaliações." });
    }
  }, [id]);

  async function enviar(event) {
    event.preventDefault();
    try {
      await api.post(`/livros/${id}/avaliacoes`, { nota: Number(nota), comentario });
      setComentario("");
      setFeedback({
        type: "success",
        text: "Avaliação enviada. Ela aparecerá publicamente após a aprovação do administrador.",
      });
    } catch (error) {
      setFeedback({ type: "error", text: error.response?.data?.erro || "Erro ao enviar avaliação." });
    }
  }

  useInitialLoad(carregar);

  return (
    <main className="page">
      <div className="container feature-page">
        <div className="form-page-header">
          <div>
            <span className="section-kicker">Avaliações</span>
            <h1 className="page-title">{livro?.titulo || "Livro"}</h1>
            <p className="page-subtitle">
              Média {Number(dados.media || 0).toFixed(1)} / 5 · {dados.total} avaliação(ões) aprovada(s)
            </p>
          </div>
          <Link className="btn btn-outline" to="/livros">Voltar ao catálogo</Link>
        </div>

        {feedback.text && <p className={`feedback-banner ${feedback.type}`}>{feedback.text}</p>}

        {isAuthenticated ? (
          <form className="feature-card review-form" onSubmit={enviar}>
            <h2>Avaliar este livro</h2>
            <div className="form-group">
              <label>Nota</label>
              <select value={nota} onChange={(event) => setNota(event.target.value)}>
                <option value="5">5 - Excelente</option>
                <option value="4">4 - Muito bom</option>
                <option value="3">3 - Bom</option>
                <option value="2">2 - Regular</option>
                <option value="1">1 - Ruim</option>
              </select>
            </div>
            <div className="form-group">
              <label>Comentário</label>
              <textarea
                value={comentario}
                onChange={(event) => setComentario(event.target.value)}
                minLength="3"
                maxLength="1500"
                required
                placeholder="Conte o que achou do livro..."
              />
            </div>
            <button className="btn btn-primary" type="submit">Enviar para moderação</button>
          </form>
        ) : (
          <div className="feature-card">
            <p>Entre na sua conta para publicar uma avaliação.</p>
            <Link className="btn btn-primary" to="/login">Fazer login</Link>
          </div>
        )}

        <section className="feature-list">
          {dados.avaliacoes?.length ? dados.avaliacoes.map((avaliacao) => (
            <article className="feature-card" key={avaliacao.id}>
              <div className="review-heading">
                <strong>{avaliacao.usuario?.nome || "Leitor"}</strong>
                <span>{"★".repeat(avaliacao.nota)}{"☆".repeat(5 - avaliacao.nota)}</span>
              </div>
              <p>{avaliacao.comentario}</p>
              <small>{new Date(avaliacao.createdAt).toLocaleDateString("pt-BR")}</small>
            </article>
          )) : <div className="empty-state"><p>Ainda não há avaliações aprovadas.</p></div>}
        </section>
      </div>
    </main>
  );
}

export default BookReviews;
