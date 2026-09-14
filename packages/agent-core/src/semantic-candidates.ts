import { findSemanticProductMatches, type ProductSummary, type SemanticMatch } from '@prefiero-ia/catalog';
import type { RankingCandidate } from '@prefiero-ia/recommendation';

export type EmbedFn = (text: string) => Promise<number[]>;

/**
 * Wrapper seguro sobre `findSemanticProductMatches`: si no hay proveedor de
 * embeddings configurado (`embed` ausente) o la busqueda falla por
 * cualquier razon (catalogo sin `product_embeddings` poblado todavia,
 * proveedor caido), simplemente no aporta candidatos extra — nunca rompe
 * una recomendacion por falta de una pieza opcional.
 */
export async function safeSemanticMatches(queryText: string, embed: EmbedFn | undefined): Promise<SemanticMatch[]> {
  if (!embed) {
    return [];
  }
  try {
    return await findSemanticProductMatches(queryText, embed);
  } catch {
    return [];
  }
}

/**
 * Combina los candidatos de busqueda literal con los de busqueda semantica
 * en una sola lista para el motor de ranking — un producto que aparece en
 * ambas listas conserva su `semanticScore` real en vez de duplicarse.
 */
export function mergeSemanticCandidates(literalCandidates: ProductSummary[], semanticMatches: SemanticMatch[]): RankingCandidate[] {
  const semanticScoreById = new Map(semanticMatches.map((match) => [match.product.id, match.score]));
  const candidates: RankingCandidate[] = literalCandidates.map((product) => ({
    product,
    semanticScore: semanticScoreById.get(product.id),
  }));

  const seenIds = new Set(literalCandidates.map((product) => product.id));
  for (const match of semanticMatches) {
    if (!seenIds.has(match.product.id)) {
      candidates.push({ product: match.product, semanticScore: match.score });
      seenIds.add(match.product.id);
    }
  }

  return candidates;
}
