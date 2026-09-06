/** Valida também chamadas diretas à API, independentemente do formulário React. */
export function validarLivro(dados = {}) {
  for (const campo of ["titulo", "autor", "redator", "categoria", "sinopse"]) {
    if (typeof dados[campo] !== "string" || !dados[campo].trim()) return `${campo} é obrigatório`;
    dados[campo] = dados[campo].trim();
  }
  for (const campo of ["precoCompra", "precoAluguel", "precoDiaExtra", "ano", "estoque", "diasInclusos"]) {
    const valor = Number(dados[campo]);
    if (dados[campo] === "" || dados[campo] == null || !Number.isFinite(valor) || valor < 0) {
      return `${campo} deve ser um número válido, maior ou igual a zero`;
    }
    if (["ano", "estoque", "diasInclusos"].includes(campo) && !Number.isSafeInteger(valor)) return `${campo} deve ser inteiro`;
  }
  if (Number(dados.ano) < 1 || Number(dados.ano) > new Date().getFullYear() + 1) return "Ano inválido";
  if (dados.imagemUrlExterna) {
    try { if (!["http:", "https:"].includes(new URL(dados.imagemUrlExterna).protocol)) return "URL da capa inválida"; }
    catch { return "URL da capa inválida"; }
  }
  return null;
}

export function validarSenha(senha) {
  return typeof senha === "string" && senha.length >= 8 && Buffer.byteLength(senha, "utf8") <= 72;
}
