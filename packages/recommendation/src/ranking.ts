import { formatCOP, type ProductSummary } from '@prefiero-ia/catalog';

/**
 * Motor de recomendacion determinístico (sección 31-32 del documento
 * maestro): el LLM nunca decide el orden — solo redacta la explicación
 * sobre este ranking ya calculado. Pesos: compatibilidad con necesidad 30%,
 * presupuesto 25%, características 20%, cuota requerida 10%, similitud
 * semántica 10%, promoción 5%.
 *
 * `features` sigue siendo honestamente un placeholder neutral: necesita
 * `product_attributes` poblado por el harvester, que hoy esta vacio para
 * todo el catalogo (specs no vienen en el payload scrapeado — ver nota de
 * Fase 1 en el roadmap). Vuelve a activarse solo con pasar `attributes` al
 * candidato.
 *
 * `semanticSimilarity` SI usa datos reales cuando el llamador los tiene
 * (ver `packages/catalog`'s `findSemanticProductMatches`, que consulta
 * `product_embeddings`) — queda en 0.5 (neutral, ni ayuda ni penaliza) solo
 * para un candidato que entro exclusivamente por coincidencia literal de
 * texto y nunca paso por busqueda vectorial.
 */
const WEIGHTS = {
  needMatch: 0.3,
  budgetFit: 0.25,
  features: 0.2,
  installmentFit: 0.1,
  semanticSimilarity: 0.1,
  promotion: 0.05,
} as const;

/**
 * Umbral bajo el cual una similitud semantica NO cuenta como relevancia
 * real — misma cifra y mismo razonamiento que `MIN_VECTOR_SCORE` en
 * `packages/rag` (verificado en vivo ahi: por debajo de esto la similitud
 * "suave" del vector siempre encuentra algo parecido en algun grado, sin
 * que eso implique relacion real con lo pedido).
 */
export const MIN_SEMANTIC_SCORE_FOR_RELEVANCE = 0.55;

export interface RankingCandidate {
  product: ProductSummary;
  /** texto de atributos disponibles del producto (nombre: valor, ...) — vacio mientras el harvester no los pueble. */
  attributeText?: string;
  /** Similitud coseno (0 a 1) contra la busqueda semantica, si el candidato vino de ahi — ver `findSemanticProductMatches`. Ausente = candidato encontrado solo por texto literal, no se sabe su similitud semantica real. */
  semanticScore?: number;
}

export interface RankingCriteria {
  need?: string;
  budget?: number | null;
  maxInstallment?: number | null;
  desiredFeatures?: string[];
}

export interface RankedProduct {
  product: ProductSummary;
  score: number;
  reasons: string[];
  /** Que tanto coincide el nombre/categoria/marca del producto con lo que se pidio (0 a 1) — expuesto para que quien llama pueda descartar candidatos que solo entraron por un match generico de descripcion (ej. una palabra de marketing repetida en productos sin relacion), en vez de mostrarlos igual solo porque llenan el cupo de 5. */
  needMatch: number;
  /** Similitud semantica real si el candidato traia `semanticScore`; 0.5 (neutral) si no — junto con `needMatch`, permite distinguir "no comparte palabras pero SI es semanticamente relevante" de "no tiene ninguna relacion". */
  semanticSimilarity: number;
}

export function rankProducts(criteria: RankingCriteria, candidates: RankingCandidate[]): RankedProduct[] {
  return candidates
    .map(({ product, attributeText, semanticScore }) => {
      const needMatch = scoreNeedMatch(criteria.need, product);
      const budgetFit = scoreBudgetFit(criteria.budget, product.price);
      const features = scoreFeatures(criteria.desiredFeatures, attributeText);
      const installmentFit = scoreInstallmentFit(criteria.maxInstallment, product.installmentValue);
      const semanticSimilarity = semanticScore ?? 0.5;
      const promotion = product.isOffer ? 1 : 0;

      const score =
        needMatch * WEIGHTS.needMatch +
        budgetFit * WEIGHTS.budgetFit +
        features * WEIGHTS.features +
        installmentFit * WEIGHTS.installmentFit +
        semanticSimilarity * WEIGHTS.semanticSimilarity +
        promotion * WEIGHTS.promotion;

      return {
        product,
        score,
        needMatch,
        semanticSimilarity,
        reasons: buildReasons(criteria, product, { needMatch, budgetFit, installmentFit }),
      };
    })
    .sort((a, b) => b.score - a.score);
}

// Misma normalizacion de tildes que ya usa product-search.repository.ts
// (`synonymVariants`) y rag/search.ts — sin esto, un "need" extraido por
// el LLM sin tilde (ej. "portatil") nunca matcheaba "Portátil" en el
// catalogo, degradando needMatch (30% del score) sin motivo real.
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function scoreNeedMatch(need: string | undefined, product: ProductSummary): number {
  const words = normalizeText(need ?? '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) {
    return 0.6;
  }
  const haystack = normalizeText(`${product.name} ${product.categoryName ?? ''} ${product.brandName ?? ''}`);
  const matches = words.filter((word) => haystack.includes(word)).length;
  return matches / words.length;
}

function scoreBudgetFit(budget: number | null | undefined, price: number): number {
  if (!budget) {
    return 0.7;
  }
  if (price > budget) {
    return Math.max(0, 1 - (price - budget) / budget);
  }
  // Mientras mas cerca del presupuesto sin pasarlo, mejor aprovecha el cupo disponible.
  return 0.7 + 0.3 * (price / budget);
}

function scoreInstallmentFit(maxInstallment: number | null | undefined, installmentValue: number | null): number {
  if (!maxInstallment || installmentValue === null) {
    return 0.5;
  }
  if (installmentValue > maxInstallment) {
    return Math.max(0, 1 - (installmentValue - maxInstallment) / maxInstallment);
  }
  return 0.7 + 0.3 * (installmentValue / maxInstallment);
}

function scoreFeatures(desiredFeatures: string[] | undefined, attributeText: string | undefined): number {
  if (!desiredFeatures || desiredFeatures.length === 0 || !attributeText) {
    return 0.5;
  }
  const haystack = attributeText.toLowerCase();
  const matches = desiredFeatures.filter((feature) => haystack.includes(feature.toLowerCase())).length;
  return matches / desiredFeatures.length;
}

function buildReasons(
  criteria: RankingCriteria,
  product: ProductSummary,
  scores: { needMatch: number; budgetFit: number; installmentFit: number },
): string[] {
  const reasons: string[] = [];
  if (scores.needMatch >= 0.5) {
    reasons.push('Coincide con lo que buscas');
  }
  if (criteria.budget && product.price <= criteria.budget) {
    reasons.push(`Dentro de tu presupuesto de ${formatCOP(criteria.budget)}`);
  }
  if (criteria.maxInstallment && product.installmentValue !== null && product.installmentValue <= criteria.maxInstallment) {
    reasons.push(`Su cuota (${formatCOP(product.installmentValue)}) cabe en lo que puedes pagar`);
  }
  if (product.isOffer) {
    reasons.push('Está en promoción');
  }
  return reasons;
}
