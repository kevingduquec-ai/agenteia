# @prefiero-ia/recommendation

Motor de ranking **determinístico** para productos. El LLM nunca decide
el orden de una recomendación — solo redacta la explicación en lenguaje
natural sobre un ranking ya calculado aquí. Esto es deliberado: un ranking
que depende de que el modelo "elija bien" no es auditable ni reproducible.

## Qué hace

`ranking.ts` expone `rankProducts(criteria, candidates)`. Cada candidato
se puntúa con estos pesos fijos:

| Dimensión | Peso | Estado |
|---|---|---|
| Compatibilidad con la necesidad (`needMatch`) | 30% | real |
| Ajuste de presupuesto (`budgetFit`) | 25% | real |
| Características (`features`) | 20% | **placeholder neutral (0.5)** — necesita `product_attributes` poblado, que el harvester aún no completa |
| Ajuste de cuota (`installmentFit`) | 10% | real |
| Similitud semántica (`semanticSimilarity`) | 10% | real cuando el candidato vino de búsqueda vectorial; neutral (0.5) si solo entró por texto literal |
| Promoción (`promotion`) | 5% | real |

`MIN_SEMANTIC_SCORE_FOR_RELEVANCE = 0.55` es el mismo umbral y el mismo
razonamiento que `MIN_VECTOR_SCORE` en `@prefiero-ia/rag` — por debajo de
esa similitud, un match vectorial no implica relación real con lo pedido.

Cada `RankedProduct` trae `needMatch` por separado del score final —
`recommend_products`/`recommend_gift` lo usan para descartar candidatos
que solo entraron por una palabra genérica de descripción (ej. "ideal
para el día a día"), en vez de rellenar el cupo de 5 resultados con
productos sin relación real.

## Cómo se usa

Solo lo consume `@prefiero-ia/agent-core`, en `recommend_products.tool.ts`
y `recommend_gift.tool.ts` — nunca directo desde `apps/api`.
