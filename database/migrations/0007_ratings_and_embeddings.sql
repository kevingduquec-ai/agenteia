-- Prefiero IA — calificacion de atencion, tiempos de respuesta de soporte
-- y embeddings de producto
--
-- Tres pedidos explicitos del usuario en esta ronda:
--   1) "que al final califiquen la atencion" — visible solo para admin/owner.
--   2) "verifica los tiempos en que llegan esas respuestas, debe ser
--      inmediato" — sin una marca de cuando la conversacion paso a pedir
--      soporte, no hay forma de medir cuanto tardo el agente en contestar.
--   3) Embeddings de producto — busqueda semantica real, no solo palabras
--      literales (ver packages/recommendation, semanticSimilarity fijo en
--      0.5 hasta ahora).

-- La tabla `feedback` ya existia desde el esquema inicial (Fase 0) pero
-- nunca se uso — se reutiliza en vez de crear una nueva. Una conversacion
-- se califica una sola vez (evita que un doble clic o un reintento de red
-- infle el promedio), y el rating es obligatorio si se registra la fila.
ALTER TABLE feedback
  ADD CONSTRAINT feedback_conversation_unique UNIQUE (conversation_id);
ALTER TABLE feedback
  ALTER COLUMN rating SET NOT NULL;
ALTER TABLE feedback
  ADD CONSTRAINT feedback_rating_range CHECK (rating BETWEEN 1 AND 5);

-- Momento exacto en que la conversacion paso a 'needs_support' — la
-- diferencia entre esto y el primer mensaje de rol 'support_agent' despues
-- de esa marca ES el tiempo de respuesta real del equipo humano.
ALTER TABLE conversations ADD COLUMN needs_support_at timestamptz;

-- Embeddings de producto — mismo patron que knowledge_embeddings (dimension
-- 1536, Qwen text embedding). Un producto tiene como maximo un embedding
-- vigente (se reemplaza al regenerar, no se acumulan versiones viejas).
CREATE TABLE product_embeddings (
  product_id    uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  embedding     vector(1536) NOT NULL,
  model         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_embeddings_vector
  ON product_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
