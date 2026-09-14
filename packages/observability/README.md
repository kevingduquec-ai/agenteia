# @prefiero-ia/observability

**Placeholder — todavía sin implementar.** Existe en el monorepo (Fase 0)
como el lugar reservado para logging estructurado y métricas de costo de
las corridas del agente (tokens consumidos por proveedor, latencia,
tasa de fallback), pero `src/index.ts` no exporta nada todavía.

Mientras tanto:

- El costo/estado de cada proveedor de LLM se ve de forma manual en
  `GET /llm/health` (`packages/llm`) y en el panel `Impacto` del admin
  (`GET /admin/owner/health`).
- Los `console.warn`/`console.error` puntuales (ej. en
  `packages/rag/src/search.ts` cuando falla la búsqueda vectorial) son la
  única observabilidad real hoy — no hay agregación ni alertas.

Si vas a implementar esto, el punto de enganche natural es
`LLMGateway` (`packages/llm/src/gateway.ts`), que ya recibe un callback
opcional `onUsage` pensado para esto.
