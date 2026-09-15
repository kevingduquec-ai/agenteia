# @prefiero-ia/agent-core

El cerebro del agente: decide qué hacer con cada mensaje del comprador y
orquesta las herramientas de catálogo. Ningún otro paquete/app debería
hablarle al LLM directamente para responder un chat — todo pasa por aquí.

## Piezas principales

- **`intent.ts`** — la taxonomía cerrada de intenciones (`PRODUCT_SEARCH`,
  `GIFT_RECOMMENDATION`, `HUMAN_SUPPORT`, `UNKNOWN`, etc.). `CATALOG_DEPENDENT_INTENTS`
  marca cuáles necesitan una tool de catálogo real.
- **`intent-router.ts`** — clasifica el último mensaje del usuario en una
  de esas intenciones con una llamada barata al LLM (`temperature: 0`). Si
  el LLM no está configurado o responde algo inválido, degrada a
  `GENERAL_CHAT` en vez de romper la conversación.
- **`agent-engine.ts`** (`AgentEngine`) — el orquestador. Dado un mensaje
  ya clasificado, decide el flujo: ejecutar una tool de catálogo, cortar
  con un mensaje fijo (soporte humano, dato privado, fuera de tema), o
  seguir con RAG + generación libre. Nunca deja que el LLM "busque" o
  "recomiende" sin pasar por una tool real — el LLM solo redacta la
  respuesta final a partir de un resultado JSON verificado.
- **`tool-registry.ts`** (`ToolRegistry`) — el único lugar donde el LLM
  puede pedir "ejecuta la tool X con estos argumentos". Nunca expone SQL,
  shell ni URLs arbitrarias como tool. Multi-tenant: el registro se
  construye una sola vez (con la función `embed`), pero cada `execute()`
  recibe un `ToolContext = { tenantId }` aparte — así ningún tenant puede
  quedarse "pegado" en el registro entre requests de clientes distintos.
- **`catalog-tools.ts`** — arma el mapa `Intent → tool` (una tool real por
  cada intención de catálogo) y el prompt de extracción de cada una.
- **`semantic-candidates.ts`** — combina candidatos de búsqueda literal
  con los de búsqueda semántica (embeddings) para el motor de ranking;
  nunca rompe una recomendación si no hay proveedor de embeddings
  configurado.
- **`tools/*.tool.ts`** — una tool por cada intención dependiente de
  catálogo: `search_products`, `find_products_by_budget`,
  `find_products_by_installment`, `compare_products`, `get_product`,
  `find_similar_products`, `find_cheaper_alternatives`,
  `recommend_products`, `recommend_gift`, `register_unmet_demand`. Cada
  archivo define su propio `ToolDefinition` (el schema que ve el LLM) y su
  `ToolHandler` (la función real que consulta `@prefiero-ia/catalog`/
  `@prefiero-ia/database`). Todo handler recibe `(args, ctx: ToolContext)`
  y pasa `ctx.tenantId` a cada llamada de catálogo/base de datos — jamás
  filtra un resultado sin ese `tenantId`.

## Cómo se usa

`apps/api/src/chat/chat.service.ts` crea un único `AgentEngine` (con el
`LLMGateway` y, si hay proveedor de embeddings configurado, la función
`embed`) y le delega cada mensaje entrante vía `run()`/`runStream()`,
pasando el `tenantId` resuelto para esa request en `RunAgentInput`.

## Multi-tenant: `ToolContext`

`ToolHandler<TArgs, TResult> = (args: TArgs, ctx: ToolContext) => Promise<TResult>`,
con `ToolContext = { tenantId: string }`. El `ToolRegistry` se construye
una sola vez por proceso (no por tenant) — lo que cambia por request es
el `tenantId` que se le pasa a `execute(call, ctx)`. Esto permite que un
solo despliegue de `apps/api` atienda a todos los tenants sin necesitar
una instancia de `AgentEngine`/`ToolRegistry` por cliente. Ver
`docs/MULTI-TENANCY.md` para cómo se resuelve ese `tenantId` desde el
header `X-Tenant-Host`.

## Convenciones a respetar si agregas una tool nueva

1. Definir `ToolDefinition` + `ToolHandler` en `tools/<nombre>.tool.ts`,
   con la firma `(args, ctx: ToolContext) => ...` y usando `ctx.tenantId`
   en cada consulta a `@prefiero-ia/catalog`/`@prefiero-ia/database`.
2. Registrarla en `catalog-tools.ts` bajo su `Intent` correspondiente
   (agregar la intención a `intent.ts`/`CATALOG_DEPENDENT_INTENTS` si es
   nueva).
3. El handler nunca debe dejar que el LLM invente datos: si no hay
   resultado, devolver una `note` honesta (el LLM la usa tal cual, ver
   `CATALOG_RESPONSE_PROMPT` en `agent-engine.ts`) — nunca lanzar un error
   genérico que termine en "no tengo una respuesta clara".
