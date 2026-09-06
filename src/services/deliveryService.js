/**
 * Cotação de entrega usando Google Maps Routes API.
 * A taxa é calculada por valor base + valor por quilômetro, ambos configuráveis.
 */
const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

function numeroEnv(nome, padrao) {
  const valor = process.env[nome]?.trim() ? Number(process.env[nome]) : NaN;
  return Number.isFinite(valor) ? valor : padrao;
}

export function getLinksEntregasTerceirizadas() {
  return [
    {
      nome: "GAMI Delivery",
      url: process.env.GAMI_DELIVERY_URL || "https://gamidelivery.com.br",
    },
    {
      nome: "99 Entrega",
      url: process.env.NOVENTA_NOVE_ENTREGA_URL || "https://99app.com/passageiro/99-entrega/",
    },
  ];
}

export function mapsConfigurado() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY && process.env.STORE_ADDRESS);
}

export async function calcularCotacaoEntrega(destino) {
  if (!destino?.trim()) throw new Error("Endereço de destino é obrigatório");
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY não configurado no .env");
  }
  if (!process.env.STORE_ADDRESS) {
    throw new Error("STORE_ADDRESS não configurado no .env");
  }

  const response = await fetch(GOOGLE_ROUTES_URL, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: { address: process.env.STORE_ADDRESS },
      destination: { address: destino.trim() },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      languageCode: "pt-BR",
      units: "METRIC",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Não foi possível calcular a rota de entrega");
  }

  const rota = data?.routes?.[0];
  if (!Number.isFinite(rota?.distanceMeters) || rota.distanceMeters < 0) {
    throw new Error("O Google Maps não encontrou uma rota para este endereço");
  }

  const distanciaKm = rota.distanceMeters / 1000;
  const taxaBase = numeroEnv("DELIVERY_BASE_FEE", 5);
  const valorPorKm = numeroEnv("DELIVERY_PRICE_PER_KM", 2.5);
  const valorEntrega = Math.max(0, taxaBase + distanciaKm * valorPorKm);

  return {
    origem: process.env.STORE_ADDRESS,
    destino: destino.trim(),
    distanciaKm: Number(distanciaKm.toFixed(2)),
    duracao: rota.duration || null,
    valorEntrega: Number(valorEntrega.toFixed(2)),
  };
}
