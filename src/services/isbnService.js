/**
 * Busca metadados de livros por ISBN no Google Books.
 * Retorna dados já normalizados para o formulário do BiblioConnect.
 */
export function normalizarIsbn(isbn) {
  return String(isbn || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

export async function buscarLivroPorIsbn(isbnInformado) {
  const isbn = normalizarIsbn(isbnInformado);
  if (![10, 13].includes(isbn.length)) {
    throw new Error("Informe um ISBN-10 ou ISBN-13 válido");
  }

  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: "1",
    projection: "full",
  });
  if (process.env.GOOGLE_BOOKS_API_KEY) {
    params.set("key", process.env.GOOGLE_BOOKS_API_KEY);
  }

  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, { signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || "Erro ao consultar Google Books");
  }

  const volume = data?.items?.[0]?.volumeInfo;
  if (!volume) return null;

  const anoTexto = String(volume.publishedDate || "").slice(0, 4);
  const ano = Number(anoTexto);

  return {
    isbn,
    titulo: volume.title || "",
    autor: Array.isArray(volume.authors) ? volume.authors.join(", ") : "",
    redator: volume.publisher || "",
    ano: Number.isFinite(ano) ? ano : null,
    categoria: Array.isArray(volume.categories) ? volume.categories[0] : "",
    sinopse: volume.description || "",
    imagemUrl:
      volume.imageLinks?.thumbnail?.replace("http://", "https://") ||
      volume.imageLinks?.smallThumbnail?.replace("http://", "https://") ||
      "",
    paginas: volume.pageCount || null,
    idioma: volume.language || null,
  };
}
