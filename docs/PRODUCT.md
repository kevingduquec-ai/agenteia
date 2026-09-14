# Prefiero IA — Documento Maestro de Producto, Negocio y Arquitectura (v1.0)

> Fuente: documento maestro provisto por el autor del proyecto. Ver también
> `README.md` para el estado de avance y `docs/ROADMAP.md` para el checklist
> de fases derivado de la sección 69/87 de este documento.

## 1. Visión del producto

Prefiero IA será un agente inteligente integrado al marketplace Prefiero ACR+
capaz de conversar con los visitantes, responder preguntas, comprender
necesidades, consultar el catálogo, comparar productos, recomendar
alternativas y acompañar al usuario desde una intención inicial hasta la
selección de un producto.

No será un chatbot tradicional. Será una capa inteligente ubicada entre el
cliente, el catálogo, el conocimiento del marketplace y los servicios
comerciales.

De: `buscar → filtrar → revisar productos`
A: `conversar → descubrir → comparar → decidir → comprar`.

## 2. Idea de negocio

Construir una plataforma reutilizable de **Commerce AI Agent**: un agente de
ventas y atención que cualquier marketplace pueda integrar para convertir su
catálogo en una experiencia conversacional. Prefiero ACR+ es el primer caso
de uso; la misma infraestructura se reutilizaría luego cambiando catálogo,
marca, políticas, herramientas y reglas comerciales para otros verticales
(marketplaces, e-commerce, concesionarios, inmobiliarias, retail, B2B, etc.).

## 3. Problema que resuelve

Los filtros tradicionales exigen que el usuario sepa qué está buscando. Los
usuarios reales piensan en necesidades ("un portátil para trabajar y
estudiar", "$150.000 mensuales", "¿este computador me sirve para AutoCAD?").
Prefiero IA interpreta esas necesidades en lenguaje natural.

## 4. Oportunidad concreta en Prefiero ACR+

ACR+ publica ~1.733 productos, categorías, marcas y compra por cuotas ACR+.
La v1 puede construirse sobre información pública del marketplace, sin
acceso al backend privado (sin cupo, historial crediticio, pedidos privados,
datos bancarios).

## 5. Propuesta de valor

- **Comprador**: hablar con el marketplace en lenguaje natural en vez de
  navegar filtros.
- **Marketplace**: más descubrimiento y clics a producto, más intención de
  compra, menos abandono y consultas repetitivas, e inteligencia comercial
  (conversaciones → datos).

## 6. Nombre del producto

"Prefiero IA — Tu asesor inteligente de compras" para esta implementación.
Una versión independiente futura podría llamarse Commerce Agent AI, ShopMind,
Nexo Commerce, Mercato AI, etc., sobre la misma tecnología.

## 7-8. Objetivo general y específicos

Diseñar e implementar un agente conversacional que asista el descubrimiento,
evaluación y selección de productos usando información verificable del
marketplace, IA generativa y herramientas especializadas, con arquitectura
económica, escalable y preparada para integraciones transaccionales futuras.

Específicos: FAQ del marketplace, búsqueda en lenguaje natural, recomendación
por necesidad/presupuesto/cuota, comparación, alternativas, detección de
intención comercial, registro de demanda no satisfecha, analítica, costos de
inferencia mínimos (modelos económicos), y arquitectura lista para
integraciones privadas de ACR.

## 9. Principio fundamental

**El modelo de IA NO es la fuente de verdad.** La fuente de verdad es la
base de datos, el catálogo y los documentos. La IA solo interpreta, decide
qué herramienta usar, organiza información y redacta la respuesta. Ningún
precio, cuota o característica se inventa: siempre viene de una tool call.

## 10. Alcance v1.0

Atención conversacional (FAQ, políticas, garantías, devoluciones), búsqueda
inteligente en lenguaje natural, compra por presupuesto, compra por cuota,
recomendaciones, comparaciones, alternativas más económicas, productos
similares, preguntas sobre un producto concreto ("pregúntale al producto"),
asesor de regalos, asesor por categoría (preguntas dirigidas según tipo de
producto), y registro de demanda no atendida.

## 11. Fuera de alcance inicial

Aprobación de crédito, cupos personales, centrales de riesgo, modificación de
pedidos, pagos, información bancaria, devoluciones ejecutadas, cambios de
cuenta, compra automática, promesas de inventario no verificable, acciones
financieras. Automatización de pruebas queda excluida de este documento.

## 12. Niveles de evolución

1. **Assistant** — responde (pregunta → conocimiento → respuesta).
2. **Shopper** — investiga (necesidad → buscar → filtrar → comparar →
   recomendar). **La v1 cubre Nivel 1 + Nivel 2 completos.**
3. **Agent** — ejecuta (cupo → carrito → pedido → seguimiento). La
   arquitectura queda preparada para este nivel, no implementado en v1.

## 13-16. Motor de IA

- **Principal**: Qwen 3.7 Flash (Alibaba Cloud Model Studio, Singapore).
  Function calling, salida estructurada, API compatible con OpenAI, contexto
  amplio. Precio de referencia (≤32K tokens, ~sep-2026): entrada
  ~US$0,030/M tokens, salida ~US$0,130/M tokens.
- **Fallback**: DeepSeek V4 Flash (contexto hasta 1M, JSON y tool calls,
  tarifas peak/off-peak). Se usa si Qwen falla, hay timeout, la consulta
  necesita más razonamiento, o para validar respuestas críticas.
- **Embeddings**: Qwen 3.7 Text Embedding (~US$0,07/M tokens, +200 idiomas),
  con posibilidad futura de migrar a embeddings locales.

La plataforma no depende directamente de ningún proveedor: todo pasa por el
**LLM Gateway** (`packages/llm`), con interfaz `LLMProvider { generate,
stream, callTools, healthCheck }` y variables `LLM_PRIMARY` / `LLM_FALLBACK`.

## 17-19. Arquitectura y stack

Ver diagrama completo en el documento original. Componentes: UI (Next.js) →
API Gateway → Conversation Engine (sesión/contexto/intent/memoria) → Agent
Engine → {Tools, RAG, Recommender} → PostgreSQL+pgvector → LLM Gateway →
{Qwen, DeepSeek}. En paralelo, Catalog Harvester (HTTP/Cheerio, Playwright
solo si hace falta JS) → Normalizer → PostgreSQL.

**Stack**: Next.js + React + TypeScript (web), NestJS + TypeScript (api),
PostgreSQL + pgvector, Redis, BullMQ, Cheerio/Playwright, Docker + Nginx,
almacenamiento S3-compatible. Monorepo modular (pnpm workspaces).

Estructura de repo objetivo:

```
prefiero-ia/
├── apps/{web,api,worker}
├── packages/{agent-core,llm,database,rag,catalog,recommendation,security,observability,shared}
├── infrastructure/{docker,nginx,postgres,redis}
├── database/{migrations,seeds,schema}
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

## 20-24. Catalog Harvester y modelo de producto

Pipeline: Discovery → URLs → Fetch (HTTP/Cheerio, Playwright si hace falta) →
Parse → Normalize → Validate → Store → Index. Actualización incremental vía
`last_seen_at` / `last_scraped_at` / `content_hash` (solo se reindexa si
cambia el hash). **Antes de operar el crawler de forma permanente sobre un
sitio ajeno debe existir autorización del propietario y una política
razonable de consumo.**

`Product`: id, external_id, name, slug, description, url, image_url,
brand_id, category_id, seller_id, price, original_price,
discount_percentage, installment_value, installment_count, currency,
is_active, is_offer, last_seen_at, last_scraped_at, timestamps.

`product_attributes` (clave/valor dinámico por categoría) y
`product_price_history` (para detectar bajadas/subidas de precio).

## 25. Modelo de datos (tablas principales)

products, product_attributes, product_price_history, categories, brands,
sellers, knowledge_documents, knowledge_chunks, knowledge_embeddings,
sessions, conversations, messages, conversation_summaries, recommendations,
recommendation_items, search_events, product_impressions, product_clicks,
unmet_demands, agent_runs, agent_tool_calls, llm_usage, llm_costs, feedback,
crawl_jobs, crawl_pages, crawl_errors, prompt_versions, system_settings.

## 26-27. RAG y base de conocimiento

RAG custom sobre PostgreSQL/pgvector: pregunta → embedding → similarity
search → 3 fragmentos relevantes → LLM → respuesta (nunca se envía todo el
conocimiento). Contenido: cómo funciona ACR+, solicitud de cupo, FAQ,
garantías, cambios, devoluciones, envíos, métodos, políticas, vendedores,
soporte. Cada fragmento guarda `source_url`, `document`, `section`,
`content`, `content_hash`, `updated_at` para trazabilidad.

## 28. Intent Router

GENERAL_CHAT, FAQ, PRODUCT_SEARCH, PRODUCT_RECOMMENDATION,
PRODUCT_COMPARISON, PRODUCT_QUESTION, BUDGET_SEARCH, INSTALLMENT_SEARCH,
CHEAPER_ALTERNATIVE, SIMILAR_PRODUCT, GIFT_RECOMMENDATION,
CREDIT_INFORMATION, WARRANTY_INFORMATION, RETURN_INFORMATION,
HUMAN_SUPPORT, PRIVATE_CUSTOMER_DATA, UNKNOWN.

## 29-30. Herramientas del agente (tool calling)

Catálogo: `search_products`, `get_product`, `get_product_attributes`,
`get_categories`, `get_brands`, `get_sellers`.
Presupuesto: `find_products_by_budget`, `find_products_by_installment`.
Comparación: `compare_products`.
Recomendación: `recommend_products`, `find_similar_products`,
`find_cheaper_alternatives`, `recommend_gift`.
Conocimiento: `search_knowledge`, `get_policy`, `get_credit_information`.
Analítica: `register_unmet_demand`, `register_product_interest`.
Soporte: `request_human_assistance`.

El LLM **no** tiene acceso directo a SQL, consola, shell, SO, crawler ni URLs
arbitrarias — solo a estas tools autorizadas.

## 31-32. Motor de recomendación y explicabilidad

Ranking determinístico propio (no decide el LLM solo):
compatibilidad con necesidad 30%, presupuesto 25%, características 20%,
cuota requerida 10%, similitud semántica 10%, promoción 5%. El LLM redacta
la explicación sobre ese ranking, siempre justificando el "por qué".

## 33-34. Memoria conversacional y contexto de página

Tres niveles: memoria corta (últimos mensajes), estado estructurado (JSON de
categoría/marca/presupuesto/cuota/uso) y resumen (tras conversaciones
largas, se descartan mensajes viejos del contexto del LLM para ahorrar
costo). Si el usuario abre el chat desde una ficha de producto o categoría,
el agente recibe `{ pageType, productId }` como contexto inicial.

## 35-40. Experiencia de usuario

Pantalla inicial con accesos rápidos (buscar, cuota, presupuesto, comparar,
regalo, dudas). Tarjetas de producto (imagen, nombre, precio, cuota, marca,
características, motivo de recomendación). Comparador en tabla. Flujo
"Ayúdame a elegir" (personal shopper conversacional) y asesor de regalos
(destinatario → edad → intereses → presupuesto → categoría → recomendación).

## 41-46. Inteligencia comercial y KPIs

Demanda no satisfecha (búsquedas con 0 resultados → dashboard de "lo que
buscan y no tenemos"), dashboard admin, dashboard "voz del cliente"
(agrupación de objeciones/quejas anónimas), funnel del agente. KPIs: >85%
consultas resueltas, >98% respuestas sustentadas, engagement, conversión,
cobertura, costo por conversación, tiempo a primera respuesta, CTR,
demanda no atendida.

## 47-52. Anti-alucinación, seguridad y privacidad

Jerarquía de fuentes: herramienta transaccional > BD de catálogo > base de
conocimiento > información estructurada > razonamiento del modelo — el
conocimiento interno del LLM nunca reemplaza precios/políticas/condiciones.
Todo contenido scrapeado se trata como `UNTRUSTED CONTENT` (se limpian
scripts/estilos/iframes/contenido oculto; nunca puede modificar el system
prompt). No se envían a proveedores LLM datos personales sensibles (cédula,
cuenta, cupo, info crediticia, teléfonos, correos, direcciones). Cada sesión
usa `anonymous_session_id` (pseudonimización). Antes de habilitar
información privada vía proveedores fuera de Colombia debe revisarse
formalmente el régimen de protección de datos aplicable (transferencia vs.
transmisión internacional, responsabilidad demostrada).

## 53-56. Redis, ahorro de tokens y routing de modelos

Redis para sesiones, contexto corto, rate limiting, cache de FAQ/búsquedas/
productos, locks y colas. Reglas de ahorro: nunca enviar el catálogo
completo al modelo, máximo 5-8 productos por respuesta, RAG máximo 3-5
fragmentos, system prompt compacto, resumir conversaciones largas, cachear
preguntas frecuentes, resolver con código cuando no haga falta IA (mín/orden
SQL), Qwen Flash para todo lo cotidiano, escalar a DeepSeek solo cuando sea
necesario. Estimación ilustrativa: ~10k conversaciones/mes ≈ US$2,74/mes de
inferencia (sin infra/embeddings/fallback).

## 57-61. API, streaming y seguridad

Endpoints REST iniciales para chat, productos, comparación, recomendaciones,
categorías/marcas/vendedores, feedback y admin/analytics. Respuestas del
chat vía streaming. Seguridad de API: rate limiting, CORS, CSRF donde
aplique, CSP, validación de input, límites de payload, auth admin, secrets
management, logs sanitizados, sanitización HTML, control de tool calls.
Variables de entorno completas en `.env.example` — nunca se versionan
claves.

## 62-65. Infraestructura y configuración

MVP en un solo VPS con Docker Compose (Nginx + web + api + worker +
Postgres/pgvector + Redis) — sin Kubernetes. Escalamiento futuro con load
balancer, múltiples instancias de API, Redis Cluster y workers (el LLM ya es
externo, no hay que escalar GPU propia). Panel admin para editar mensaje
inicial, personalidad, tono, límites, prompts, modelo principal/fallback,
temperatura, reglas comerciales, mensajes de escalamiento y funciones
habilitadas, todo versionado en `prompt_versions`.

## 66-68. Identidad del agente

Amable, directa, comercial sin ser agresiva, clara, español colombiano
neutral, orientada a resolver — nunca sobre-vendedora ("¡producto
perfecto!"). Nunca presiona innecesariamente; su objetivo es ayudar a
decidir, no forzar la venta. Escala a humano ante solicitud explícita,
consulta no resuelta, reclamo, situación sensible, dato privado requerido o
conflicto comercial.

## 69-70. Roadmap y MVP mínimo lanzable

Fases 0-10: Fundación, Catálogo, Knowledge Base, Chat, Agent Engine,
Commerce Tools, Recommendation Engine, Experiencia comercial, Analytics,
Seguridad/endurecimiento, Piloto. Ver checklist operativo en
`docs/ROADMAP.md`. MVP comercial mínimo: chat + Qwen + catálogo + FAQ/RAG +
búsqueda + presupuesto + cuota + recomendaciones + comparación +
alternativas + preguntas sobre producto + dashboard básico + analítica +
demanda no atendida.

## 71-75. Modelo de negocio y reutilización

SaaS B2B: implementación + licencia mensual + consumo de IA (incluido o
adicional) + módulos premium (WhatsApp, CRM, carrito, pedidos, voz,
integraciones, analítica avanzada, multiagente). La ventaja competitiva no
es el LLM (cualquiera puede llamar a Qwen) sino el Commerce Engine,
Recommendation Engine, arquitectura de tools, catalog intelligence,
analítica de negocio, inteligencia de conversación y detección de demanda.
El código se organiza desde ya separando `core/` (plataforma) de
`tenants/<cliente>/` (branding, prompts, políticas, tools, catálogo) para
preparar multitenancy futura.

## 76-81. Evolución futura

Cuando ACR habilite APIs oficiales: `get_credit_limit`, `get_available_credit`,
`get_customer`, `get_orders`, `get_order_status`, `add_to_cart`,
`create_cart`, `create_order`, `get_payment_status`, `request_return` — el
agente pasa de asesor a agente transaccional (Nivel 3). Canales futuros:
WhatsApp (mismo Agent Engine vía Channel Adapter), voz (Qwen ASR/TTS),
imágenes (búsqueda visual por similitud), comportamiento proactivo y
recuperación de oportunidad (con consentimiento) cuando baja el precio de un
producto visto.

## 82-85. Métrica norte y principios

Métrica norte: conversaciones que generan acciones comerciales útiles (clic,
comparación, exploración, intención de compra, solicitud de cupo, contacto
comercial) — no el volumen de conversaciones.

Principios permanentes del proyecto:
1. IA barata donde sea suficiente.
2. Código tradicional donde la IA no sea necesaria.
3. Datos verificables antes que conocimiento del modelo.
4. Herramientas controladas antes que agentes libres.
5. Privacidad desde el diseño.
6. Arquitectura independiente del proveedor LLM.
7. El catálogo es fuente de verdad.
8. Cada recomendación debe ser explicable.
9. Toda interacción debe producir valor para el usuario o el negocio.
10. Lo construido para Prefiero ACR+ debe poder convertirse en un producto
    SaaS reutilizable.

## 86-87. Decisión tecnológica final y orden de construcción

Ver `docs/ROADMAP.md` para el checklist de las 40 tareas de la sección 87
(repositorio → Docker → Postgres → pgvector → Redis → NestJS → Next.js →
esquema BD → Catalog Harvester → ... → piloto → optimización).
