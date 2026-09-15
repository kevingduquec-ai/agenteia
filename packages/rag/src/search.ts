import { searchKnowledgeByFullText, searchKnowledgeByVector, type KnowledgeSearchRow } from '@prefiero-ia/database';

export interface KnowledgeMatch extends KnowledgeSearchRow {
  matchType: 'vector' | 'fulltext';
}

export interface SearchKnowledgeOptions {
  limit?: number;
  /** Provisto por el caller (usa QwenEmbeddingProvider) — si se omite o falla, se sigue con full-text. */
  embed?: (text: string) => Promise<number[]>;
}

/**
 * Similitud coseno minima (1 - distancia) para aceptar un match vectorial.
 * Sin este filtro, `searchKnowledge` SIEMPRE devuelve `limit` resultados
 * aunque ninguno sea relevante — la similitud vectorial es "suave" y
 * siempre encuentra algo parecido en algun grado. Verificado en vivo: una
 * pregunta sobre audifonos (fuera del alcance de la base de conocimiento,
 * que es solo Prefiero ACR+/Credito ACR) devolvia chunks de FAQ sobre
 * inventario/cupo con score 0.40-0.45 — el LLM los tomo como "Informacion
 * verificada" y armo una respuesta confusa e irrelevante. Un match
 * realmente relevante (probado con la pregunta de Efecty) puntua 0.7+.
 * La busqueda de texto completo NO necesita este filtro: ya exige que al
 * menos una palabra de la consulta aparezca literalmente en el chunk (ver
 * el rewrite AND->OR en `searchKnowledgeByFullText`), asi que un match ahi
 * siempre implica una señal real, en una escala (ts_rank) que no es
 * comparable con la similitud coseno.
 */
const MIN_VECTOR_SCORE = 0.55;

/**
 * Busqueda hibrida sobre la base de conocimiento: similitud vectorial
 * cuando hay un proveedor de embeddings configurado, mas busqueda de texto
 * completo en español como respaldo siempre disponible. Esto asegura que
 * el agente encuentre una respuesta razonable incluso antes de tener una
 * API key de embeddings configurada, o si el proveedor falla.
 *
 * Las dos busquedas corren en paralelo (no una tras otra): la latencia
 * total queda acotada por la mas lenta de las dos en vez de la suma de
 * ambas, que es lo que mas le importa a una respuesta de chat en vivo.
 */
export async function searchKnowledge(tenantId: string, query: string, options: SearchKnowledgeOptions = {}): Promise<KnowledgeMatch[]> {
  const limit = options.limit ?? 5;

  const [vectorResult, fulltextResult] = await Promise.allSettled([
    searchByVector(tenantId, query, limit, options.embed),
    searchKnowledgeByFullText(tenantId, query, limit),
  ]);

  // `Promise.allSettled` no debe tragarse un fallo del embedding en
  // silencio: sin este log, un problema transitorio (timeout, cold-start
  // justo tras reiniciar el servidor) se ve identico a "no hay resultados
  // relevantes" y es indistinguible sin entrar a depurar a mano.
  if (vectorResult.status === 'rejected') {
    console.warn('[rag] busqueda vectorial fallo, se continua solo con texto completo:', vectorResult.reason);
  }

  const vectorMatches: KnowledgeMatch[] =
    vectorResult.status === 'fulfilled'
      ? vectorResult.value.filter((row) => row.score >= MIN_VECTOR_SCORE).map((row) => ({ ...row, matchType: 'vector' as const }))
      : [];

  const fulltextMatches: KnowledgeMatch[] =
    fulltextResult.status === 'fulfilled'
      ? fulltextResult.value.map((row) => ({ ...row, matchType: 'fulltext' as const }))
      : [];

  const seen = new Set(vectorMatches.map((match) => match.chunkId));
  const merged = [...vectorMatches];
  for (const match of fulltextMatches) {
    if (merged.length >= limit) break;
    if (!seen.has(match.chunkId)) {
      merged.push(match);
      seen.add(match.chunkId);
    }
  }

  return merged.slice(0, limit);
}

async function searchByVector(
  tenantId: string,
  query: string,
  limit: number,
  embed?: (text: string) => Promise<number[]>,
): Promise<KnowledgeSearchRow[]> {
  if (!embed) {
    return [];
  }
  const embedding = await embed(query);
  const vectorLiteral = `[${embedding.join(',')}]`;
  return searchKnowledgeByVector(tenantId, vectorLiteral, limit);
}
