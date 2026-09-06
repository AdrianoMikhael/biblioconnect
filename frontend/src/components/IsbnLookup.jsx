import { useState } from "react";
import api from "../api/api.js";

/**
 * Campo reutilizável de ISBN para cadastro/edição.
 * A consulta é feita pelo backend para manter chaves de API fora do navegador.
 */
function IsbnLookup({ value, onChange, onFound }) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function buscar() {
    const isbn = String(value || "").trim();
    if (!isbn) {
      setFeedback("Informe o ISBN antes de buscar.");
      return;
    }

    try {
      setLoading(true);
      setFeedback("");
      const response = await api.get(`/isbn/${encodeURIComponent(isbn)}`);
      onFound(response.data);
      setFeedback("Dados encontrados. Confira os campos antes de salvar.");
    } catch (error) {
      setFeedback(error.response?.data?.erro || "Não foi possível consultar o ISBN.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="isbn-lookup">
      <div className="form-group">
        <label>ISBN</label>
        <div className="inline-field-action">
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Ex: 9788535914849"
          />
          <button type="button" className="btn btn-outline" onClick={buscar} disabled={loading}>
            {loading ? "Buscando..." : "Preencher por ISBN"}
          </button>
        </div>
        {feedback && <small className="input-hint">{feedback}</small>}
      </div>
    </div>
  );
}

export default IsbnLookup;
