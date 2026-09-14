# @prefiero-ia/catalog

Capa de dominio sobre el catálogo de productos. Traduce las filas crudas
de `@prefiero-ia/database` a los tipos que el agente y el frontend
realmente usan, y ofrece las operaciones de búsqueda de más alto nivel.
Nada aquí toca SQL directamente — eso vive en `@prefiero-ia/database`.

## Piezas principales

- **`types.ts`** — `ProductSummary`, el tipo de producto que ve el
  LLM/frontend (nunca la fila cruda de la DB: sin `content_hash`, sin ids
  de FK). `toProductSummary()` convierte un `ProductRow` a esto.
- **`search.ts`** — `searchProducts(filters)`, wrapper delgado sobre la
  búsqueda de `@prefiero-ia/database` que devuelve `ProductSummary[]`.
- **`product-detail.ts`** — `resolveProduct(idOrName)` (acepta un UUID o
  el nombre más parecido — así sirve tanto si el LLM trae el id exacto de
  una búsqueda previa como si solo tiene el nombre que escribió el
  usuario), `findSimilarProducts()` (misma categoría, precio ±40%),
  `findCheaperAlternatives()`.
- **`semantic-search.ts`** — `findSemanticProductMatches(queryText, embed)`:
  búsqueda por significado usando `product_embeddings` (pgvector). Es el
  complemento de `searchProducts` (que exige coincidencia de texto) —
  fundamental para `recommend_products`/`recommend_gift`, donde lo que
  pide el comprador es una descripción libre que puede no compartir
  ninguna palabra con el nombre real del producto. Si `product_embeddings`
  no está poblado, simplemente no aporta candidatos extra.
- **`page-context.ts`** — `resolveProductFromPageContext()`: si el
  comprador abrió el chat desde una ficha de producto real del sitio
  (`embed.js` manda la ruta), resuelve el producto real correspondiente
  para que el agente entienda referencias ambiguas ("esto", "este
  producto").

## Cómo se usa

`@prefiero-ia/agent-core` es el consumidor principal (cada tool de
catálogo pasa por aquí). `apps/api` también lo usa directo para construir
el "contexto de página" del chat.
