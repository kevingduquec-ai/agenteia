-- Prefiero IA — ajustes para busqueda hibrida en la base de conocimiento (Fase 2)

-- Qwen text-embedding-v3/v4 devuelve por defecto vectores de 1024
-- dimensiones (no 1536 como OpenAI). Si cambias EMBEDDING_MODEL por uno con
-- otra dimension, esta columna debe migrarse de nuevo para que coincida.
DROP INDEX IF EXISTS idx_knowledge_embeddings_vector;
ALTER TABLE knowledge_embeddings ALTER COLUMN embedding TYPE vector(1024);
CREATE INDEX idx_knowledge_embeddings_vector
  ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Un chunk tiene a lo sumo un embedding vigente (se reemplaza, no se acumula).
ALTER TABLE knowledge_embeddings ADD CONSTRAINT knowledge_embeddings_chunk_id_key UNIQUE (chunk_id);

-- Busqueda de texto completo en español: funciona sin necesidad de
-- embeddings/API key, para que el agente siempre tenga una via de
-- respuesta aunque el proveedor de IA no este configurado todavia.
CREATE INDEX idx_knowledge_chunks_fts
  ON knowledge_chunks USING gin (to_tsvector('spanish', content));
