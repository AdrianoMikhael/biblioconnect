import { useEffect } from "react";

/** Agenda a carga após montar e cancela a tarefa se o componente já tiver saído.
 * Isso também evita a primeira carga descartada pelo StrictMode em desenvolvimento.
 * A função recebida deve ser estável (useCallback).
 */
export default function useInitialLoad(carregar) {
  useEffect(() => {
    let ativo = true;
    Promise.resolve().then(() => { if (ativo) return carregar(); });
    return () => { ativo = false; };
  }, [carregar]);
}
