-- Prefiero IA — esquema inicial (Fase 0, paso 08)
-- Requiere pgvector (ver infrastructure/postgres/init/001_extensions.sql)

-- ─────────────────────────────────────────────────────────────────────────
-- Catalogo
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE brands (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  slug          TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  parent_id     UUID REFERENCES categories(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sellers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id           TEXT NOT NULL UNIQUE,

  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL,
  description           TEXT,

  url                   TEXT NOT NULL,
  image_url             TEXT,

  brand_id              UUID REFERENCES brands(id),
  category_id           UUID REFERENCES categories(id),
  seller_id             UUID REFERENCES sellers(id),

  price                 NUMERIC(14, 2) NOT NULL,
  original_price        NUMERIC(14, 2),
  discount_percentage   NUMERIC(5, 2),

  installment_value     NUMERIC(14, 2),
  installment_count     INTEGER,

  currency              TEXT NOT NULL DEFAULT 'COP',

  is_active             BOOLEAN NOT NULL DEFAULT true,
  is_offer              BOOLEAN NOT NULL DEFAULT false,

  content_hash          TEXT,
  last_seen_at          TIMESTAMPTZ,
  last_scraped_at       TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_seller ON products(seller_id);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_installment_value ON products(installment_value);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active;

CREATE TABLE product_attributes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_key     TEXT NOT NULL,
  attribute_name    TEXT NOT NULL,
  attribute_value   TEXT NOT NULL,
  normalized_value  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_attributes_product ON product_attributes(product_id);
CREATE INDEX idx_product_attributes_key ON product_attributes(attribute_key);

CREATE TABLE product_price_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price               NUMERIC(14, 2) NOT NULL,
  original_price      NUMERIC(14, 2),
  installment_value   NUMERIC(14, 2),
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_history_product ON product_price_history(product_id, observed_at);

-- ─────────────────────────────────────────────────────────────────────────
-- Base de conocimiento (RAG)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE knowledge_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url    TEXT,
  title         TEXT NOT NULL,
  content_hash  TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  section       TEXT,
  content       TEXT NOT NULL,
  content_hash  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dimension 1536 por defecto (Qwen text embedding); ajustar si cambia el modelo.
CREATE TABLE knowledge_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id      UUID NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  embedding     vector(1536) NOT NULL,
  model         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_embeddings_vector
  ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ─────────────────────────────────────────────────────────────────────────
-- Conversaciones y memoria
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_session_id  UUID NOT NULL UNIQUE,
  page_context          JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  structured_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content           TEXT NOT NULL,
  intent            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE conversation_summaries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summary           TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Recomendaciones
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recommendation_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id   UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  score               NUMERIC(5, 4) NOT NULL,
  score_breakdown     JSONB,
  rank                INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- Analitica
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE search_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  query             TEXT NOT NULL,
  intent            TEXT,
  result_count      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_impressions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_clicks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE unmet_demands (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query               TEXT NOT NULL,
  normalized_intent   TEXT,
  requested_brand     TEXT,
  requested_category  TEXT,
  budget              NUMERIC(14, 2),
  conversation_id     UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  rating            SMALLINT,
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Agent runs y observabilidad
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE agent_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  intent            TEXT,
  provider          TEXT,
  model             TEXT,
  latency_ms        INTEGER,
  status            TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'fallback')),
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_tool_calls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id  UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,
  arguments     JSONB,
  result        JSONB,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE llm_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id      UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE llm_costs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  llm_usage_id      UUID NOT NULL REFERENCES llm_usage(id) ON DELETE CASCADE,
  cost_usd          NUMERIC(12, 6) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Crawler
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE crawl_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crawl_pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_job_id  UUID NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  status_code   INTEGER,
  content_hash  TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE crawl_errors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_job_id  UUID NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  url           TEXT,
  message       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Configuracion y prompts
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE prompt_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  version       INTEGER NOT NULL,
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at  TIMESTAMPTZ,
  UNIQUE (name, version)
);

CREATE TABLE system_settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
