export function formatarMoedaEmail(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatarDataEmail(data) {
  if (!data) return "Não informado";
  return new Date(data).toLocaleDateString("pt-BR");
}

export function montarEnderecoUsuario(usuario) {
  if (usuario?.endereco) return usuario.endereco;
  return [
    usuario?.rua,
    usuario?.numero ? `nº ${usuario.numero}` : null,
    usuario?.bairro,
    usuario?.cidade,
    usuario?.estado,
    usuario?.cep ? `CEP ${usuario.cep}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
