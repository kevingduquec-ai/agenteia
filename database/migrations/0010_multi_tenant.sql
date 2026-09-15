-- Prefiero IA — arquitectura multi-tenant
--
-- Pedido explicito del usuario: la misma instalacion (un solo despliegue
-- de apps/web + apps/api) debe poder atender a mas de un cliente,
-- distinguiendo cual es cual por la URL (subdominio) con la que se accede,
-- en vez de necesitar un despliegue Docker completo por cliente nuevo.
--
-- Diseño: cada tenant es un cliente/marketplace independiente, con su
-- propio catalogo, su propia base de conocimiento, sus propias
-- conversaciones y sus propias cuentas "admin"/"soporte". El rol "owner"
-- SIGUE siendo global y fijo por variables de entorno (sin cambios en esa
-- decision de seguridad, ver README) — es Qubit, el operador de la
-- plataforma, quien crea tenants y administra las cuentas admin/soporte
-- de CUALQUIER tenant, nunca al reves.

CREATE TABLE tenants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  -- Subdominio/host publico con el que se resuelve este tenant (ej.
  -- "acr.prefi.io") — ver apps/api/src/tenant/tenant.middleware.ts.
  host                  text NOT NULL UNIQUE,
  -- Sitio real del cliente que este tenant cosecha (reemplaza el antiguo
  -- CRAWLER_BASE_URL global, que solo podia apuntar a un sitio).
  crawler_base_url      text NOT NULL,
  -- Origenes adicionales (el sitio del cliente, donde se embebe el widget)
  -- permitidos por CORS ademas del propio `host` de este tenant — lista
  -- separada por comas, igual formato que el viejo CORS_ORIGINS.
  extra_cors_origins    text,
  max_admin_seats       integer NOT NULL DEFAULT 1,
  max_support_seats     integer NOT NULL DEFAULT 1,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Catalogo: cada tenant tiene su propio catalogo completo, aislado del
-- de cualquier otro. Los UNIQUE globales de antes (un solo cliente) pasan
-- a ser UNIQUE por tenant — dos tenants distintos SI pueden tener, cada
-- uno, una marca "Samsung" o una categoria "Celulares" con el mismo slug.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE brands ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE categories ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE sellers ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE products ADD COLUMN tenant_id uuid REFERENCES tenants(id);

ALTER TABLE brands DROP CONSTRAINT brands_name_key;
ALTER TABLE brands DROP CONSTRAINT brands_slug_key;
ALTER TABLE categories DROP CONSTRAINT categories_slug_key;
ALTER TABLE sellers DROP CONSTRAINT sellers_slug_key;
ALTER TABLE products DROP CONSTRAINT products_external_id_key;

-- ─────────────────────────────────────────────────────────────────────────
-- Conversaciones: sesion/conversacion quedan atadas a un tenant. Los
-- mensajes NO llevan su propio tenant_id — siempre se acceden via
-- conversation_id, que ya esta scopeado.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE sessions ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE conversations ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE sessions DROP CONSTRAINT sessions_anonymous_session_id_key;

-- ─────────────────────────────────────────────────────────────────────────
-- Base de conocimiento: un documento (FAQ, garantia, etc.) pertenece a un
-- tenant — chunks/embeddings se acceden siempre via document_id/chunk_id,
-- ya scopeados transitivamente.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE knowledge_documents ADD COLUMN tenant_id uuid REFERENCES tenants(id);

-- ─────────────────────────────────────────────────────────────────────────
-- Cuentas admin/soporte: cada una pertenece a un tenant especifico. El
-- limite de cupos (MAX_ADMIN_SEATS/MAX_SUPPORT_SEATS) ahora se lee de
-- tenants.max_admin_seats/max_support_seats, no de variables de entorno.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE admin_users ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE admin_users DROP CONSTRAINT admin_users_username_key;

-- ─────────────────────────────────────────────────────────────────────────
-- Analitica: se filtran directo por tenant_id en vez de siempre pasar por
-- un JOIN a conversations, tanto por simplicidad de las queries del panel
-- admin como por seguridad (una query que olvide el JOIN no puede filtrar
-- mal ni mezclar tenants).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE unmet_demands ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE feedback ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE search_events ADD COLUMN tenant_id uuid REFERENCES tenants(id);
ALTER TABLE product_impressions ADD COLUMN tenant_id uuid REFERENCES tenants(id);

-- ─────────────────────────────────────────────────────────────────────────
-- Migracion de los datos existentes: todo lo que ya esta en la base
-- (el catalogo/conversaciones de Prefiero ACR+, cosechados antes de que
-- existiera este concepto) pasa a ser el primer tenant.
-- ─────────────────────────────────────────────────────────────────────────

-- "prefiero-acr.localhost" (no "localhost" a secas): los navegadores y
-- Node resuelven cualquier "*.localhost" a 127.0.0.1 sin configuracion
-- extra (RFC 6761) — asi el tenant ya tiene un host real y probable para
-- desarrollo con subdominios. La resolucion de tenant (ver
-- apps/api/src/tenant/tenant.middleware.ts) trata "localhost"/"127.0.0.1"
-- a secas (sin subdominio) como caso especial de conveniencia, para no
-- romper el flujo de desarrollo ya existente.
INSERT INTO tenants (slug, name, host, crawler_base_url, max_admin_seats, max_support_seats)
VALUES ('prefiero-acr', 'Prefiero ACR+', 'prefiero-acr.localhost', 'https://prefieroacr.com', 1, 1);

DO $$
DECLARE
  default_tenant_id uuid;
BEGIN
  SELECT id INTO default_tenant_id FROM tenants WHERE slug = 'prefiero-acr';

  UPDATE brands SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE categories SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE sellers SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE products SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE sessions SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE conversations SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE knowledge_documents SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE admin_users SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE unmet_demands SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE feedback SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE search_events SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE product_impressions SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
END $$;

-- Ahora que todo tiene tenant_id, se puede exigir NOT NULL y crear los
-- indices/constraints compuestos que reemplazan a los globales de antes.

ALTER TABLE brands ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sellers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sessions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE knowledge_documents ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE admin_users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE unmet_demands ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE feedback ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE search_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE product_impressions ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE brands ADD CONSTRAINT brands_tenant_slug_key UNIQUE (tenant_id, slug);
ALTER TABLE categories ADD CONSTRAINT categories_tenant_slug_key UNIQUE (tenant_id, slug);
ALTER TABLE sellers ADD CONSTRAINT sellers_tenant_slug_key UNIQUE (tenant_id, slug);
ALTER TABLE products ADD CONSTRAINT products_tenant_external_id_key UNIQUE (tenant_id, external_id);
ALTER TABLE sessions ADD CONSTRAINT sessions_tenant_anonymous_id_key UNIQUE (tenant_id, anonymous_session_id);
ALTER TABLE admin_users ADD CONSTRAINT admin_users_tenant_username_key UNIQUE (tenant_id, username);

CREATE INDEX idx_brands_tenant ON brands(tenant_id);
CREATE INDEX idx_categories_tenant ON categories(tenant_id);
CREATE INDEX idx_sellers_tenant ON sellers(tenant_id);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_sessions_tenant ON sessions(tenant_id);
CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);
CREATE INDEX idx_knowledge_documents_tenant ON knowledge_documents(tenant_id);
CREATE INDEX idx_admin_users_tenant ON admin_users(tenant_id);
