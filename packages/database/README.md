# @prefiero-ia/database

Único punto de acceso a Postgres/pgvector. Ningún otro paquete/app abre su
propia conexión ni escribe SQL fuera de aquí — todo pasa por un
repositorio de este paquete.

## Piezas principales

- **`pool.ts`** — `getPool()`, un solo `pg.Pool` compartido (reutiliza
  conexiones en vez de abrir una por request) y `closePool()` (para
  scripts CLI de vida corta, como los del worker).
- **`slugify.ts`** — genera slugs estables para categorías/marcas/vendedores.
- **`types.ts`** — tipos compartidos de fila/filtro (`ProductRow`,
  `ProductSearchFilters`, `CategoryPathSegment`, etc.) que consume
  `@prefiero-ia/catalog`.
- **`repositories/`** — un archivo por área del esquema:
  - `catalog.repository.ts` — `upsertProduct`/`upsertBrand`/`upsertSeller`/
    `upsertCategoryPath` (usados por el harvester), `updateInstallmentBySku`
    (segunda pasada de cuota, ver `apps/worker`), `listCategorySlugs`,
    `markStaleProductsInactive`.
  - `product-search.repository.ts` — el motor de búsqueda de texto:
    ranking por tiers (categoría exacta > match fuerte de nombre/marca >
    match débil de descripción), expansión de sinónimos, y el fallback que
    reintenta sin `categoryName`/`brandName` si esos filtros dejan la
    búsqueda en cero. Es el corazón de `search_products`,
    `find_products_by_budget`, `find_products_by_installment` y de la
    búsqueda literal detrás de `recommend_products`/`recommend_gift`.
  - `product-embedding.repository.ts` — CRUD de `product_embeddings`
    (backfill y búsqueda vectorial de producto).
  - `knowledge.repository.ts` — CRUD de `knowledge_documents`/
    `knowledge_chunks`/`knowledge_embeddings` y sus dos búsquedas
    (`searchKnowledgeByVector`, `searchKnowledgeByFullText`).
  - `chat.repository.ts` — sesiones anónimas, conversaciones, mensajes.
  - `support.repository.ts` — estados de conversación (`active` →
    `needs_support` → `resolved`/`closed`/`cancelled`), mensajes de
    agentes de soporte, métricas de tiempo de respuesta.
  - `admin-user.repository.ts` — cuentas `admin`/`soporte` (el `owner` NO
    vive aquí, es fijo por variables de entorno).
  - `feedback.repository.ts` — calificación de 1 a 5 de la atención
    (`RatingNotAllowedError` si la conversación no tiene ningún mensaje de
    usuario — evita calificaciones de sesiones vacías/falsas).
  - `analytics.repository.ts` — todo lo que alimenta el panel admin:
    visitantes en vivo, productos más consultados, reporte de impacto,
    desglose de intenciones.
  - `unmet-demand.repository.ts` — registro de búsquedas que el catálogo
    no pudo resolver (para saber qué le falta al catálogo).

## Esquema y migraciones

El esquema vive en `database/migrations/*.sql` (en la raíz del repo, no
dentro de este paquete) — se aplican a mano, en orden, una sola vez cada
una (no son idempotentes). Ver `docs/DEPLOYMENT.md` para el procedimiento
completo y `docs/FIXES-2026-09-14.md` para el historial de dos bugs reales
de esquema ya corregidos (dimensión de vector equivocada, índice `ivfflat`
mal calibrado para el volumen real de datos).
