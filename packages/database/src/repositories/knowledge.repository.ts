import { getPool } from '../pool.js';

export interface DocumentUpsertInput {
  sourceUrl: string | null;
  title: string;
  contentHash: string;
}

export interface DocumentUpsertResult {
  id: string;
  changed: boolean;
}

export async function upsertKnowledgeDocument(tenantId: string, input: DocumentUpsertInput): Promise<DocumentUpsertResult> {
  const pool = getPool();
  const existing = await pool.query<{ id: string; content_hash: string | null }>(
    'SELECT id, content_hash FROM knowledge_documents WHERE tenant_id = $1 AND source_url = $2',
    [tenantId, input.sourceUrl],
  );

  if (existing.rows.length === 0) {
    const insert = await pool.query<{ id: string }>(
      'INSERT INTO knowledge_documents (tenant_id, source_url, title, content_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [tenantId, input.sourceUrl, input.title, input.contentHash],
    );
    return { id: insert.rows[0].id, changed: true };
  }

  const doc = existing.rows[0];
  const changed = doc.content_hash !== input.contentHash;
  if (changed) {
    await pool.query('UPDATE knowledge_documents SET title = $2, content_hash = $3, updated_at = now() WHERE id = $1', [
      doc.id,
      input.title,
      input.contentHash,
    ]);
  }
  return { id: doc.id, changed };
}

export interface ChunkInput {
  section: string | null;
  content: string;
  contentHash: string;
}

/**
 * Reemplaza todos los chunks de un documento. Es mas simple y seguro que
 * hacer diffing chunk-a-chunk: al borrar se eliminan en cascada sus
 * embeddings, asi que un chunk viejo nunca queda respondiendo con
 * contenido desactualizado.
 */
export async function replaceKnowledgeChunks(documentId: string, chunks: ChunkInput[]): Promise<string[]> {
  const pool = getPool();
  await pool.query('DELETE FROM knowledge_chunks WHERE document_id = $1', [documentId]);

  const ids: string[] = [];
  for (const chunk of chunks) {
    const result = await pool.query<{ id: string }>(
      'INSERT INTO knowledge_chunks (document_id, section, content, content_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [documentId, chunk.section, chunk.content, chunk.contentHash],
    );
    ids.push(result.rows[0].id);
  }
  return ids;
}

export interface ChunkWithoutEmbedding {
  id: string;
  content: string;
}

export async function getChunksWithoutEmbeddings(tenantId: string, limit = 500): Promise<ChunkWithoutEmbedding[]> {
  const pool = getPool();
  const result = await pool.query<ChunkWithoutEmbedding>(
    `SELECT kc.id, kc.content
     FROM knowledge_chunks kc
     JOIN knowledge_documents kd ON kd.id = kc.document_id
     LEFT JOIN knowledge_embeddings ke ON ke.chunk_id = kc.id
     WHERE kd.tenant_id = $1 AND ke.id IS NULL
     LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows;
}

export async function upsertKnowledgeEmbedding(chunkId: string, embedding: number[], model: string): Promise<void> {
  const pool = getPool();
  const vectorLiteral = `[${embedding.join(',')}]`;
  await pool.query(
    `INSERT INTO knowledge_embeddings (chunk_id, embedding, model) VALUES ($1, $2::vector, $3)
     ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
    [chunkId, vectorLiteral, model],
  );
}

export interface KnowledgeSearchRow {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceUrl: string | null;
  section: string | null;
  content: string;
  score: number;
}

interface RawSearchRow {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceUrl: string | null;
  section: string | null;
  content: string;
  score: string | number;
}

/** Acotada al tenant: sin este filtro, el chat de un cliente podria citar FAQ/politicas de otro cliente por pura similitud de embedding. */
export async function searchKnowledgeByVector(tenantId: string, vectorLiteral: string, limit: number): Promise<KnowledgeSearchRow[]> {
  const pool = getPool();
  const result = await pool.query<RawSearchRow>(
    `SELECT kc.id AS "chunkId", kc.document_id AS "documentId", kd.title AS "documentTitle",
            kd.source_url AS "sourceUrl", kc.section, kc.content,
            1 - (ke.embedding <=> $2::vector) AS score
     FROM knowledge_embeddings ke
     JOIN knowledge_chunks kc ON kc.id = ke.chunk_id
     JOIN knowledge_documents kd ON kd.id = kc.document_id
     WHERE kd.tenant_id = $1
     ORDER BY ke.embedding <=> $2::vector
     LIMIT $3`,
    [tenantId, vectorLiteral, limit],
  );
  return result.rows.map((row) => ({ ...row, score: Number(row.score) }));
}

export async function searchKnowledgeByFullText(tenantId: string, query: string, limit: number): Promise<KnowledgeSearchRow[]> {
  if (!query.trim()) {
    return [];
  }

  const pool = getPool();
  const result = await pool.query<RawSearchRow>(
    `WITH query AS (
       -- plainto_tsquery combina los terminos con AND, lo que es demasiado
       -- estricto para una pregunta en lenguaje natural (si la respuesta no
       -- repite cada palabra de la pregunta, no encuentra nada). Se
       -- reescribe a OR para traer cualquier chunk que toque al menos un
       -- termino relevante, y se deja que ts_rank ordene por cuantos
       -- terminos coinciden.
       -- NULLIF+to_tsquery(NULL) evita el error de to_tsquery('') cuando
       -- la consulta es solo stopwords (ej. "el la de").
       SELECT to_tsquery('spanish', NULLIF(replace(plainto_tsquery('spanish', $2)::text, ' & ', ' | '), '')) AS q
     )
     SELECT kc.id AS "chunkId", kc.document_id AS "documentId", kd.title AS "documentTitle",
            kd.source_url AS "sourceUrl", kc.section, kc.content,
            ts_rank(to_tsvector('spanish', kc.content), query.q) AS score
     FROM knowledge_chunks kc
     JOIN knowledge_documents kd ON kd.id = kc.document_id
     CROSS JOIN query
     WHERE kd.tenant_id = $1 AND to_tsvector('spanish', kc.content) @@ query.q
     ORDER BY score DESC
     LIMIT $3`,
    [tenantId, query, limit],
  );
  return result.rows.map((row) => ({ ...row, score: Number(row.score) }));
}
