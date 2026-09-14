# @prefiero-ia/shared

**Placeholder — todavía sin implementar.** `src/index.ts` no exporta
nada. Reservado (Fase 0) para tipos y utilidades genéricas que en algún
momento se dupliquen entre `apps/*`/`packages/*` sin encajar en un
paquete de dominio existente.

Hasta ahora eso no ha hecho falta: cada tipo compartido vive en el
paquete de dominio al que pertenece (`ProductSummary` en
`@prefiero-ia/catalog`, `ChatMessage`/`ToolDefinition` en
`@prefiero-ia/llm`, etc.). Antes de agregar algo aquí, confirma que de
verdad no tiene un hogar más específico — este paquete existiendo vacío
es preferible a convertirse en un cajón de sastre.
