# @prefiero-ia/worker

Todo lo que alimenta al catálogo y a la base de conocimiento desde
fuentes externas — crawler, ingesta de conocimiento, embeddings. Se
ejecuta como comandos puntuales (CLI), no como un servidor HTTP.

`src/index.ts` es hoy un placeholder — la descripción original ("BullMQ")
apuntaba a un futuro consumidor de cola de larga duración que todavía no
existe. Todo lo real está en los scripts de `package.json`.

## Comandos

```bash
pnpm run harvest -- --limit=30   # cosecha acotada (prueba)
pnpm run harvest                 # catálogo completo

pnpm run backfill-installments -- --limit=3   # prueba acotada
pnpm run backfill-installments                # todas las categorías conocidas

pnpm run ingest-knowledge

pnpm --filter @prefiero-ia/worker run backfill-product-embeddings
```

## `src/crawler/` — Catalog Harvester

- **`sitemap.ts`** — `discoverProductUrls()`: `sitemap.xml` lista tanto
  categorías como los ~1.785 productos publicados (`/p/<slug>`) en una
  sola lista plana.
- **`next-flight.ts`** — el mecanismo compartido de lectura: Next.js App
  Router incrusta el árbol de React Server Components como
  `self.__next_f.push([1,"<id>:<json>"])` en el HTML — ahí viaja, sin
  transformar, el objeto completo que el backend de ACR+ le entrega al
  componente (precio, categoría, vendedor, cuota). `extractNextFlightValues()`
  extrae esos chunks; `findInFlightValues()`/`findAllInFlightValues()`
  buscan en profundidad el objeto (o todos los objetos) que cumplan un
  predicado. Mucho más rico y estable que leer clases CSS del DOM, que
  cambian con cada deploy del sitio.
- **`detail-parser.ts`** — `parseProductDetailPage()`: la ficha individual
  de un producto (`/p/<slug>`). La cuota ACR queda en `null` aquí a
  propósito — se calcula client-side en esa página y nunca viaja en este
  payload (ver `listing-parser.ts` abajo).
- **`listing-parser.ts`** — `parseListingPage()`: las tarjetas de una
  página de listado/categoría, que SÍ traen la cuota ya calculada por el
  servidor (`creditInstallment`, `installments`, `sku`). Complementa a
  `detail-parser.ts`.
- **`harvest.ts`** — orquesta la cosecha completa: por cada URL de
  producto, parsea, resuelve marca/categoría/vendedor
  (`@prefiero-ia/database`) y hace upsert. Solo en una corrida SIN
  `--limit` desactiva productos que ya no aparecieron (`markStaleProductsInactive`)
  — con `--limit` la mayoría del catálogo queda fuera a propósito, marcarlo
  como "desaparecido" sería un falso positivo masivo.
- **`backfill-installments.ts`** — la segunda pasada (14 sep 2026, ver
  `docs/FIXES-2026-09-14.md`): recorre los slugs de categoría ya
  conocidos (`listCategorySlugs()`, de la cosecha normal) y actualiza
  `installment_value`/`installment_count` por SKU. Cobertura parcial
  (~64% del catálogo) — un producto cuyo SKU nunca aparece en la carga
  inicial de ninguna categoría visitada se queda sin cuota.
- **`http.ts`** — `politeFetch()`: un solo request en vuelo, con pausa
  mínima entre peticiones (`CRAWLER_DELAY_MS`). Antes de operar este
  crawler de forma recurrente/permanente sobre `prefieroacr.com` debe
  existir autorización del propietario y una política de consumo
  acordada (ver `docs/PRODUCT.md`, sección 21).
- **`hash.ts`** — `contentHash()`: detecta si un producto cambió de
  verdad (precio, nombre, cuota, imagen) para no reescribir/generar
  historial de precio en cada corrida si nada cambió.

## `src/knowledge/` — Knowledge Base / RAG

- **`sources.ts`** — las páginas institucionales reales de ACR+ a
  ingestar (FAQ, quién es Prefiero, crédito, garantía, devoluciones,
  envíos, privacidad, cookies) — enlazadas desde el footer del sitio real,
  no URLs inventadas.
- **`page-parser.ts`** / **`accordion-parser.ts`** — extraen el contenido
  real de cada página (algunas son acordeones de preguntas/respuestas).
- **`chunk.ts`** — divide cada página en chunks por sección/pregunta, con
  fallback a dividir por oración/palabra si una página no usa `<p>` por
  párrafo (nunca guarda un chunk gigante).
- **`ingest.ts`** / **`ingest-cli.ts`** — guarda los documentos/chunks
  (`@prefiero-ia/database`) y calcula el embedding faltante de cada uno
  si hay `QWEN_API_KEY` configurada (no repite los que ya lo tienen).

## `src/embeddings/`

- **`backfill-cli.ts`** / `index.ts` — `runProductEmbeddingBackfill()`:
  completa `product_embeddings` en tandas de 200 (para no disparar
  cientos de llamadas al proveedor de golpe si el catálogo es grande) —
  con ~1.785 productos hacen falta varias corridas seguidas hasta que
  reporte `processed: 0`. Nombre + descripción es el texto que se
  embebe — los dos campos que un comprador real describe con sus propias
  palabras, a diferencia de marca/categoría que son más para filtros
  exactos.

## `src/catalog/`, `src/indexing/`

Placeholders reservados, sin implementar todavía.
