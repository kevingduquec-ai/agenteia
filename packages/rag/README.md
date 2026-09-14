# @prefiero-ia/rag

Retrieval sobre la base de conocimiento (FAQ, crédito, garantía,
devoluciones, envíos de Prefiero ACR+/Crédito ACR) — el paquete más
pequeño en superficie, pero es la pieza que evita que el agente invente
política comercial.

## Qué hace

`search.ts` expone `searchKnowledge(query, options)`: búsqueda **híbrida**
que corre en paralelo (no una tras otra, para no sumar latencias):

- **Similitud vectorial** (pgvector) cuando hay un proveedor de embeddings
  (`options.embed`) — filtrada con `MIN_VECTOR_SCORE = 0.55`. Sin este
  umbral, la búsqueda vectorial "suave" siempre devuelve algo parecido en
  algún grado, aunque no sea realmente relevante (verificado en vivo: una
  pregunta sobre audífonos devolvía chunks de FAQ de inventario/cupo con
  score 0.40-0.45, que el LLM tomaba como información real).
- **Texto completo en español** (`to_tsvector('spanish', ...)`), siempre
  disponible, sin depender de ninguna API key — así el agente tiene una
  vía de respuesta razonable incluso antes de configurar embeddings.

Los resultados se combinan sin duplicados (`chunkId`), priorizando los
vectoriales.

## Cómo se usa

`apps/api/src/knowledge/knowledge.service.ts` lo expone en
`GET /knowledge/search?q=...`, y `AgentEngine` lo consulta antes de
responder cualquier intención que no sea de catálogo (FAQ, crédito,
garantía, devoluciones, charla general) — nunca deja que el LLM responda
esas preguntas sin pasar primero por aquí.
