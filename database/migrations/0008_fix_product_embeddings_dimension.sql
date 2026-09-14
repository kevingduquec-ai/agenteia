-- Prefiero IA — corrige la dimension de product_embeddings.embedding
--
-- La migracion 0007 la creo como vector(1536) diciendo en su comentario
-- "mismo patron que knowledge_embeddings (dimension 1536, Qwen text
-- embedding)" — pero eso es incorrecto: la migracion 0002 ya habia
-- corregido knowledge_embeddings a vector(1024), justamente porque el
-- modelo real (`qwen3.7-text-embedding`, ver EMBEDDING_MODEL en .env)
-- devuelve vectores de 1024 dimensiones, no 1536 (esa es la dimension de
-- los modelos de OpenAI, no de Qwen). 0007 copio el numero equivocado del
-- comentario en vez del valor real ya corregido en 0002.
--
-- product_embeddings estaba vacia hasta ahora (bloqueada por una API key
-- de embeddings invalida — ver README.md) asi que no hay filas que migrar,
-- solo el tipo de columna.
DROP INDEX IF EXISTS idx_product_embeddings_vector;
ALTER TABLE product_embeddings ALTER COLUMN embedding TYPE vector(1024);
CREATE INDEX idx_product_embeddings_vector
  ON product_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
