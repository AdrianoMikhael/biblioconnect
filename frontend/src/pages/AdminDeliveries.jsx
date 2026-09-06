import useInitialLoad from "../components/useInitialLoad.js";
import { useCallback, useMemo, useState } from "react";
import api from "../api/api.js";

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function AdminDeliveries() {
  const [pedidos, setPedidos] = useState([]);
  const [links, setLinks] = useState([]);
  const [feedback, setFeedback] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [pedidosResponse, linksResponse] = await Promise.all([
        api.get("/admin/pedidos"),
        api.get("/admin/entregas/terceirizadas"),
      ]);
      setPedidos(pedidosResponse.data || []);
      setLinks(linksResponse.data || []);
    } catch (error) {
      setFeedback(error.response?.data?.erro || "Erro ao carregar entregas.");
    }
  }, []);

  async function atualizar(id, statusEntrega) {
    try {
    await api.patch(`/admin/pedidos/${id}/entrega`, { statusEntrega });
    carregar();
    } catch (error) { setFeedback(error.response?.data?.erro || "Não foi possível salvar a alteração."); }
  }

  const entregas = useMemo(() => pedidos.filter((pedido) => pedido.modalidadeEntrega === "entrega"), [pedidos]);

  useInitialLoad(carregar);

  return (
    <main className="page">
      <div className="container feature-page">
        <div>
          <span className="section-kicker">Logística</span>
          <h1 className="page-title">Entregas</h1>
          <p className="page-subtitle">Acompanhe entregas próprias ou abra um parceiro terceirizado quando não houver entregador disponível.</p>
        </div>
        {feedback && <p className="feedback-banner error">{feedback}</p>}
        <div className="third-party-links">
          {links.map((link) => <a className="btn btn-outline" href={link.url} target="_blank" rel="noreferrer" key={link.nome}>{link.nome}</a>)}
        </div>
        <div className="feature-list">
          {entregas.map((pedido) => (
            <article className="feature-card" key={pedido.id}>
              <div className="review-heading"><strong>Pedido #{pedido.id} · {pedido.livro?.titulo}</strong><span>{pedido.statusEntrega}</span></div>
              <p><strong>Cliente:</strong> {pedido.usuario?.nome}</p>
              <p><strong>Endereço:</strong> {pedido.enderecoEntrega}</p>
              <p><strong>Distância:</strong> {pedido.distanciaEntregaKm || 0} km · <strong>Frete:</strong> {formatarMoeda(pedido.valorEntrega)}</p>
              <div className="feature-actions">
                <button className="btn btn-outline" onClick={() => atualizar(pedido.id, "preparando")}>Preparando</button>
                <button className="btn btn-outline" onClick={() => atualizar(pedido.id, "aguardando_entregador")}>Aguardando entregador</button>
                <button className="btn btn-primary" onClick={() => atualizar(pedido.id, "em_transporte")}>Em transporte</button>
                <button className="btn btn-dark" onClick={() => atualizar(pedido.id, "entregue")}>Entregue</button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}

export default AdminDeliveries;
