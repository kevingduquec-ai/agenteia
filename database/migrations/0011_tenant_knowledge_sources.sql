-- Prefiero IA — fuentes de la base de conocimiento por tenant
--
-- Hueco documentado en docs/MULTI-TENANCY.md al cerrar el retrofit
-- multi-tenant: `apps/worker/src/knowledge/sources.ts` era una lista fija
-- de URLs de prefieroacr.com/creditoacr.com en el codigo, sin ningun
-- parametro de tenant — correr `ingest-knowledge --tenant=<otro-cliente>`
-- terminaria ingestando el contenido institucional de Prefiero ACR+ bajo
-- el tenant_id de ese otro cliente.
--
-- Esta migracion mueve esa lista a una tabla por tenant. Se siembra con
-- exactamente las mismas 14 fuentes que ya tenia `sources.ts` para
-- "prefiero-acr" — su `ingest-knowledge` sigue trayendo lo mismo que
-- antes, ahora leido de la base en vez de hardcodeado. Un cliente nuevo
-- se da de alta con `pnpm run add-knowledge-source` (ver
-- apps/worker/src/knowledge/add-source-cli.ts).

CREATE TABLE tenant_knowledge_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  -- Pagina o endpoint a pedir. Si `kind = 'frequent-questions-api'`, es el
  -- endpoint JSON real (ver accordion-parser.ts), no la pagina HTML que el
  -- visitante ve — por eso existe `source_url` aparte.
  url         text NOT NULL,
  kind        text NOT NULL DEFAULT 'heading' CHECK (kind IN ('heading', 'frequent-questions-api')),
  -- URL a guardar/mostrar como `source_url` del documento — solo difiere
  -- de `url` cuando `url` es un endpoint de API.
  source_url  text,
  -- Cabeceras HTTP adicionales para pedir `url` (ej. las que exige la API
  -- de preguntas frecuentes de creditoacr.com) — nunca credenciales
  -- privadas, solo lo que la propia pagina ya expone a cualquier visitante.
  headers     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, url)
);

CREATE INDEX idx_tenant_knowledge_sources_tenant ON tenant_knowledge_sources(tenant_id);

INSERT INTO tenant_knowledge_sources (tenant_id, url, kind, source_url, headers)
SELECT (SELECT id FROM tenants WHERE slug = 'prefiero-acr'), v.url, v.kind, v.source_url, v.headers::jsonb
FROM (VALUES
  ('https://prefieroacr.com/preguntas-frecuentes', 'heading', NULL, NULL),
  ('https://prefieroacr.com/quien-es-prefiero', 'heading', NULL, NULL),
  ('https://prefieroacr.com/solicitar-credito', 'heading', NULL, NULL),
  ('https://prefieroacr.com/terminos-y-condiciones-de-uso', 'heading', NULL, NULL),
  ('https://prefieroacr.com/politica-de-envio-despacho-y-entrega', 'heading', NULL, NULL),
  ('https://prefieroacr.com/politica-de-cambios-devoluciones-y-derecho-de-retracto', 'heading', NULL, NULL),
  ('https://prefieroacr.com/politica-cookies', 'heading', NULL, NULL),
  ('https://prefieroacr.com/politicas-de-privacidad', 'heading', NULL, NULL),
  ('https://prefieroacr.com/cuidamos-tus-datos', 'heading', NULL, NULL),
  ('https://prefieroacr.com/ofertas-y-promociones', 'heading', NULL, NULL),
  ('https://creditoacr.com/conocenos/', 'heading', NULL, NULL),
  ('https://creditoacr.com/corresponsales-de-pago/', 'heading', NULL, NULL),
  ('https://creditoacr.com/politicas-de-privacidad/', 'heading', NULL, NULL),
  (
    'https://desarrollos.aliadosacr.com/api/app/frequent_questions',
    'frequent-questions-api',
    'https://creditoacr.com/contacto/',
    '{"Token-Client":"fdca1d0611e5969317cdbe0898a13537e9ada7c321330758e6b8d73752e56a14","ID-Client":"MQ=="}'
  )
) AS v(url, kind, source_url, headers);
