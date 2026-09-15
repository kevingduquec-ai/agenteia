import { searchProducts, type ProductSummary } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import { MIN_SEMANTIC_SCORE_FOR_RELEVANCE, rankProducts, type RankingCandidate } from '@prefiero-ia/recommendation';
import type { ToolHandler } from '../tool-registry.js';
import { mergeSemanticCandidates, safeSemanticMatches, type EmbedFn } from '../semantic-candidates.js';

export const RECOMMEND_PRODUCTS_TOOL_NAME = 'recommend_products';

export const recommendProductsToolDefinition: ToolDefinition = {
  name: RECOMMEND_PRODUCTS_TOOL_NAME,
  description: 'Recomienda productos del catalogo segun lo que el usuario necesita, con presupuesto y categoria opcionales.',
  parameters: {
    type: 'object',
    properties: {
      need: { type: 'string', description: 'Que necesita o para que va a usar el producto (ej. "algo para hacer ejercicio al aire libre").' },
      budget: { type: 'number', description: 'Presupuesto en COP, si lo menciona. Omitir si no.' },
      maxInstallment: { type: 'number', description: 'Cuota mensual maxima en COP, si la menciona. Omitir si no.' },
      categoryName: { type: 'string', description: 'Categoria mencionada, si aplica. Omitir si no.' },
    },
    required: ['need'],
  },
};

export interface RecommendProductsArgs {
  need: string;
  budget?: number;
  maxInstallment?: number;
  categoryName?: string;
}

export interface RecommendedProductResult {
  product: ProductSummary;
  reasons: string[];
}

export interface RecommendProductsResult {
  count: number;
  recommendations: RecommendedProductResult[];
}

/**
 * Trae un conjunto amplio de candidatos por texto/presupuesto, los enriquece
 * con busqueda semantica cuando hay un proveedor de embeddings disponible
 * (pedido explicito del usuario), y deja que el ranking deterministico
 * (sección 31-32) decida el orden — el LLM nunca elige, solo redacta la
 * explicación sobre `reasons`.
 *
 * `embed` es opcional a proposito: si el proveedor de embeddings no esta
 * configurado o el catalogo todavia no tiene `product_embeddings` poblado,
 * la funcion sigue funcionando solo con la busqueda literal de siempre —
 * nunca bloquea una recomendacion por falta de una pieza opcional.
 */
export function createRecommendProductsHandler(embed?: EmbedFn): ToolHandler<RecommendProductsArgs, RecommendProductsResult> {
  return async (args, ctx) => {
    const [literalCandidates, semanticMatches] = await Promise.all([
      searchProducts(ctx.tenantId, { text: args.need, categoryName: args.categoryName, maxPrice: args.budget, limit: 20 }),
      safeSemanticMatches(ctx.tenantId, args.need, embed),
    ]);

    const candidates: RankingCandidate[] = mergeSemanticCandidates(literalCandidates, semanticMatches);

    const ranked = rankProducts({ need: args.need, budget: args.budget, maxInstallment: args.maxInstallment }, candidates);

    // Un candidato solo entra si comparte al menos una palabra real con lo
    // pedido (needMatch > 0) O si la busqueda semantica lo respalda con
    // suficiente confianza — sin esto, una palabra de marketing generica en
    // una descripcion larga ("ideal para el dia a dia") rellenaba el cupo
    // de 5 con productos sin relacion real (bug real encontrado en pruebas).
    const relevant = ranked.filter((r) => r.needMatch > 0 || r.semanticSimilarity >= MIN_SEMANTIC_SCORE_FOR_RELEVANCE);

    const top = relevant.slice(0, 5);
    return {
      count: top.length,
      recommendations: top.map(({ product, reasons }) => ({ product, reasons })),
    };
  };
}
