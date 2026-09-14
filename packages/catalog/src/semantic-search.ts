import { getProductsByIds, searchProductsByVector } from '@prefiero-ia/database';
import { toProductSummary, type ProductSummary } from './types.js';

export interface SemanticMatch {
  product: ProductSummary;
  /** Similitud coseno (0 a 1) contra el texto de busqueda — insumo real de `semanticSimilarity` en el motor de ranking (antes fijo en 0.5). */
  score: number;
}

/**
 * Busqueda semantica de producto (pedido explicito del usuario): encuentra
 * candidatos por SIGNIFICADO, no solo por palabra literal — el complemento
 * de `searchProducts` (que exige coincidencia de texto). Util sobre todo
 * para `recommend_products`/`recommend_gift`, donde el "need" del usuario
 * es una descripcion libre ("algo para dormir mejor") que puede no
 * compartir ninguna palabra con el nombre real del producto.
 *
 * Requiere que `product_embeddings` este poblado (ver
 * `apps/worker/src/jobs/backfill-product-embeddings.ts`) — si el catalogo
 * todavia no tiene embeddings, simplemente no aporta candidatos extra y el
 * llamador sigue con lo que ya tenia de la busqueda literal.
 */
export async function findSemanticProductMatches(
  queryText: string,
  embed: (text: string) => Promise<number[]>,
  limit = 20,
): Promise<SemanticMatch[]> {
  const trimmed = queryText.trim();
  if (!trimmed) {
    return [];
  }
  const embedding = await embed(trimmed);
  const vectorLiteral = `[${embedding.join(',')}]`;
  const matches = await searchProductsByVector(vectorLiteral, limit);
  if (matches.length === 0) {
    return [];
  }

  const products = await getProductsByIds(matches.map((match) => match.productId));
  const productById = new Map(products.map((product) => [product.id, toProductSummary(product)]));

  return matches
    .map((match) => ({ product: productById.get(match.productId), score: match.score }))
    .filter((match): match is SemanticMatch => match.product !== undefined);
}
