/** localhost e 127.0.0.1 são origens diferentes para o navegador.
 * Em desenvolvimento, permite ambos para a mesma porta local configurada.
 * Em produção, mantém somente as origens explicitamente configuradas.
 */
export function origensPermitidas(frontendUrl, ambiente) {
  const origens = new Set(frontendUrl.split(",").map(url => new URL(url.trim()).origin));
  if (ambiente !== "production") {
    for (const origem of [...origens]) {
      const url = new URL(origem);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) continue;
      for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
        url.hostname = hostname;
        origens.add(url.origin);
      }
    }
  }
  return [...origens];
}
