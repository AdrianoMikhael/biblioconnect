import useInitialLoad from "../components/useInitialLoad.js";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api/api.js";

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarData(data) {
  if (!data) return "Não informado";
  return new Date(data).toLocaleDateString("pt-BR");
}

function traduzirTipo(tipo) {
  return { compra: "Compra", reserva: "Reserva", aluguel: "Aluguel" }[tipo] || tipo;
}

function traduzirPagamento(status) {
  return {
    pendente: "Pagamento pendente",
    pago: "Pagamento aprovado",
    cancelado: "Pagamento cancelado",
    estornado: "Pagamento estornado",
  }[status] || status || "Pagamento pendente";
}

function OrderSuccess() {
  const { id } = useParams();
  const [pedido, setPedido] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({ type: "", text: "" });
  const [pagando, setPagando] = useState(false);
  const [simulacao, setSimulacao] = useState(false);

  const carregarPedido = useCallback(async () => {
    try {
      const response = await api.get(`/pedidos/${id}`);
      setPedido(response.data);
      const integracoes = await api.get("/integracoes/status");
      setSimulacao(Boolean(integracoes.data.simulacao));
    } catch (error) {
      setFeedback({ type: "error", text: error.response?.data?.erro || "Erro ao carregar pedido." });
    } finally {
      setLoading(false);
    }
  }, [id]);

  async function iniciarPagamento() {
    try {
      setPagando(true);
      setFeedback({ type: "", text: "" });
      const response = await api.post(`/pedidos/${id}/pagamento`);
      window.location.assign(response.data.checkoutUrl);
    } catch (error) {
      setFeedback({
        type: "error",
        text: error.response?.data?.erro || error.response?.data?.detalhe || "Erro ao iniciar pagamento.",
      });
      setPagando(false);
    }
  }

  useInitialLoad(carregarPedido);

  // O redirecionamento do checkout pode ocorrer antes da chegada do webhook.
  useEffect(() => {
    if (!pedido || pedido.statusPagamento === "pago" || pedido.status === "cancelado") return;
    const timer = setInterval(() => {
      api.get(`/pedidos/${id}`).then(r => setPedido(r.data)).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [id, pedido]);

  async function simularPagamento() {
    setPagando(true);
    try {
      await api.patch(`/pedidos/${id}/simular-pagamento`);
      await carregarPedido();
    } catch (error) { setFeedback({ type: "error", text: error.response?.data?.erro || "Erro na simulação" }); }
    finally { setPagando(false); }
  }

  if (loading) {
    return <main className="page"><div className="container"><p className="page-subtitle">Carregando pedido...</p></div></main>;
  }

  if (!pedido) {
    return (
      <main className="page"><div className="container">
        {feedback.text && <p className={`feedback-banner ${feedback.type}`}>{feedback.text}</p>}
        <Link to="/livros" className="btn btn-primary">Voltar ao catálogo</Link>
      </div></main>
    );
  }

  const pagamentoPago = pedido.statusPagamento === "pago";
  const precisaPagamento = !pagamentoPago && pedido.status !== "cancelado" && Number(pedido.valor) > 0;

  return (
    <main className="page checkout-page">
      <div className="container">
        <section className="checkout-hero">
          <div>
            <span className="section-kicker">Pedido registrado</span>
            <h1>Pedido #{pedido.id}</h1>
            <p>Confira os dados do pedido e finalize o pagamento pelo gateway seguro.</p>
          </div>
          <div className={pagamentoPago ? "payment-status-card paid" : "payment-status-card pending"}>
            <span>Status de pagamento</span>
            <strong>{traduzirPagamento(pedido.statusPagamento)}</strong>
          </div>
        </section>

        {feedback.text && <p className={`feedback-banner ${feedback.type}`}>{feedback.text}</p>}

        <section className="checkout-grid">
          <article className="checkout-card">
            <h2>Resumo do pedido</h2>
            <div className="checkout-details">
              <div><span>Tipo</span><strong>{traduzirTipo(pedido.tipo)}</strong></div>
              <div><span>Livro</span><strong>{pedido.livro?.titulo}</strong></div>
              <div><span>Autor</span><strong>{pedido.livro?.autor}</strong></div>
              <div><span>Valor total</span><strong>{formatarMoeda(pedido.valor)}</strong></div>
              <div><span>Status do pedido</span><strong>{pedido.status}</strong></div>
              <div><span>Pagamento</span><strong>{traduzirPagamento(pedido.statusPagamento)}</strong></div>
              <div><span>Data do pedido</span><strong>{formatarData(pedido.createdAt)}</strong></div>
              <div><span>Retirada</span><strong>{formatarData(pedido.retiradaLimite)}</strong></div>

              {pedido.tipo === "aluguel" && (
                <>
                  <div><span>Dias de aluguel</span><strong>{pedido.diasAluguel} dias</strong></div>
                  <div><span>Devolução prevista</span><strong>{formatarData(pedido.devolucaoPrevista)}</strong></div>
                </>
              )}

              {pedido.modalidadeEntrega === "entrega" && (
                <>
                  <div><span>Modalidade</span><strong>Entrega</strong></div>
                  <div><span>Frete</span><strong>{formatarMoeda(pedido.valorEntrega)}</strong></div>
                  <div><span>Distância</span><strong>{pedido.distanciaEntregaKm || 0} km</strong></div>
                  <div><span>Status da entrega</span><strong>{pedido.statusEntrega?.replaceAll("_", " ")}</strong></div>
                </>
              )}
            </div>

            {pedido.modalidadeEntrega === "entrega" && (
              <div className="delivery-address-card">
                <span>Endereço de entrega</span>
                <strong>{pedido.enderecoEntrega}</strong>
              </div>
            )}
          </article>

          <article className="checkout-card payment-card">
            <h2>Pagamento</h2>
            <p>
              O BiblioConnect abre o checkout do Mercado Pago. Os meios disponíveis na sua conta do gateway podem incluir cartão e Pix.
              Dados sensíveis de cartão não passam pelo servidor da biblioteca.
            </p>

            {simulacao && precisaPagamento && <button className="btn btn-outline" disabled={pagando} onClick={simularPagamento}>Simular pagamento (demonstração)</button>}

            {precisaPagamento ? (
              <button className="btn btn-primary" onClick={iniciarPagamento} disabled={pagando}>
                {pagando ? "Abrindo pagamento..." : "Pagar com cartão ou Pix"}
              </button>
            ) : pagamentoPago ? (
              <div className="payment-approved-box"><strong>Pagamento aprovado</strong><span>O pagamento deste pedido está registrado.</span></div>
            ) : (
              <div className="payment-approved-box"><strong>Sem cobrança agora</strong><span>Este pedido não possui valor pendente para pagamento.</span></div>
            )}

            <div className="checkout-actions">
              <Link to={`/comprovante/${pedido.id}`} className="btn btn-primary">Ver comprovante</Link>
              <Link to="/meus-pedidos" className="btn btn-outline">Ver meus pedidos</Link>
              <Link to="/livros" className="btn btn-dark">Voltar ao catálogo</Link>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}

export default OrderSuccess;
