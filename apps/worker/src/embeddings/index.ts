import { closePool, findProductsMissingEmbedding, upsertProductEmbedding } from '@prefiero-ia/database';
import { loadQwenEmbeddingConfig, QwenEmbeddingProvider } from '@prefiero-ia/llm';

export interface BackfillSummary {
  configured: boolean;
  processed: number;
  written: number;
  errors: Array<{ productId: string; message: string }>;
}

/**
 * Rellena `product_embeddings` para el catalogo actual (pedido explicito
 * del usuario: busqueda semantica real de producto). Mismo patron que
 * `apps/worker/src/knowledge/ingest.ts` para la base de conocimiento —
 * misma razon: sin esto, `recommend_products`/`recommend_gift` solo tienen
 * coincidencia literal de texto, que falla con descripciones libres que no
 * comparten palabras con el nombre real del producto.
 *
 * Nombre + descripcion es el texto que se embebe — son los dos campos que
 * un comprador real describe con sus propias palabras ("algo para dormir
 * mejor"), a diferencia de marca/categoria que son mas para filtros
 * exactos. Se corre en tandas para no disparar cientos de llamadas al
 * proveedor de embeddings de una sola vez si el catalogo es grande.
 */
export async function runProductEmbeddingBackfill(batchSize = 200): Promise<BackfillSummary> {
  const embeddingProvider = new QwenEmbeddingProvider(loadQwenEmbeddingConfig());
  const summary: BackfillSummary = { configured: embeddingProvider.isConfigured(), processed: 0, written: 0, errors: [] };

  if (!embeddingProvider.isConfigured()) {
    return summary;
  }

  const model = embeddingProvider.model;
  const pending = await findProductsMissingEmbedding(model, batchSize);

  for (const product of pending) {
    summary.processed += 1;
    try {
      const text = product.description ? `${product.name}\n${product.description}` : product.name;
      const result = await embeddingProvider.embed(text);
      const vectorLiteral = `[${result.embedding.join(',')}]`;
      await upsertProductEmbedding(product.id, vectorLiteral, result.model);
      summary.written += 1;
    } catch (error) {
      summary.errors.push({ productId: product.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return summary;
}

export async function runProductEmbeddingBackfillCli(): Promise<void> {
  const summary = await runProductEmbeddingBackfill();
  console.log('[backfill-product-embeddings] resumen:', JSON.stringify(summary, null, 2));
  await closePool();
  if (summary.errors.length > 0) {
    process.exitCode = 1;
  }
}
