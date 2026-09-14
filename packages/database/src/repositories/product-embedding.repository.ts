import { getPool } from '../pool.js';

/**
 * Embeddings de producto (pedido explicito del usuario) — mismo patron que
 * `knowledge.repository.ts` para la base de conocimiento: guarda un vector
 * por producto y permite ordenar por similitud coseno (`<=>` de pgvector).
 * Resuelve el hueco que ya estaba documentado en
 * `packages/recommendation/src/ranking.ts` (`semanticSimilarity` fijo en
 * 0.5 "hasta que se construya ese pipeline").
 */
export async function upsertProductEmbedding(productId: string, vectorLiteral: string, model: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO product_embeddings (product_id, embedding, model) VALUES ($1, $2::vector, $3)
     ON CONFLICT (product_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, created_at = now()`,
    [productId, vectorLiteral, model],
  );
}

/** Productos activos que todavia no tienen embedding, o cuyo embedding quedo de un modelo distinto al actual — para el job de backfill (`apps/worker`). */
export async function findProductsMissingEmbedding(model: string, limit: number): Promise<Array<{ id: string; name: string; description: string | null }>> {
  const pool = getPool();
  const result = await pool.query<{ id: string; name: string; description: string | null }>(
    `SELECT p.id, p.name, p.description
     FROM products p
     LEFT JOIN product_embeddings pe ON pe.product_id = p.id AND pe.model = $1
     WHERE p.is_active AND pe.product_id IS NULL
     ORDER BY p.updated_at DESC
     LIMIT $2`,
    [model, limit],
  );
  return result.rows;
}

export interface ProductVectorMatch {
  productId: string;
  /** Similitud coseno (1 = identico, 0 = sin relacion) — igual convencion que `searchKnowledgeByVector`. */
  score: number;
}

/** Busqueda semantica pura — el llamador (packages/catalog) decide como mezclarla con la busqueda literal y con los filtros de precio/categoria. */
export async function searchProductsByVector(vectorLiteral: string, limit: number): Promise<ProductVectorMatch[]> {
  const pool = getPool();
  const result = await pool.query<{ product_id: string; score: string }>(
    `SELECT pe.product_id, 1 - (pe.embedding <=> $1::vector) AS score
     FROM product_embeddings pe
     JOIN products p ON p.id = pe.product_id
     WHERE p.is_active
     ORDER BY pe.embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral, limit],
  );
  return result.rows.map((row) => ({ productId: row.product_id, score: Number(row.score) }));
}
