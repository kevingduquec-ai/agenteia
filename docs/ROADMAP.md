# Roadmap de construcción

Orden técnico definido en `docs/PRODUCT.md` (sección 87). Marcar cada paso al
completarlo.

## Fase 0 — Fundación
- [x] 01. Crear repositorio
- [x] 02. Docker Compose
- [x] 03. PostgreSQL
- [x] 04. pgvector
- [x] 05. Redis
- [x] 06. NestJS (`apps/api`)
- [x] 07. Next.js (`apps/web`)
- [x] 08. Esquema de base de datos

## Fase 1 — Catálogo
- [x] 09. Catalog Harvester (`apps/worker/src/crawler`) — descubre los 1.782
      productos desde `sitemap.xml` y parsea cada ficha desde el payload RSC
      de Next.js (mas rico y estable que el DOM/CSS). Probado end-to-end
      (30 productos reales insertados sin errores).
- [x] 10. Catálogo local (productos, categorías con jerarquía completa,
      marcas, vendedores, precios, atributos, historial de precio) — la
      cuota ACR (`installment_value`/`installment_count`) se completa con
      `apps/worker/src/crawler/backfill-installments.ts` (14 sep 2026):
      recorre las 338 categorías conocidas y lee la cuota ya calculada por
      el servidor en las tarjetas de listado, matcheando por SKU. Cobertura
      real: 1.140 de 1.785 productos (64%) — el resto nunca aparece en la
      carga inicial de ninguna página de categoría visitada (paginación).
      Ver `docs/FIXES-2026-09-14.md`.

## Fase 2 — Knowledge Base
- [x] 11. Integración Qwen (`packages/llm`, vía SDK OpenAI-compatible)
- [x] 12. LLM Gateway (Qwen primario / DeepSeek fallback, `packages/llm`)
- [x] 13. Embeddings (`QwenEmbeddingProvider`, usado en `packages/rag` desde Fase 2)
- [x] 14. Knowledge Base (`apps/worker/src/knowledge`) — ingesta las 10
      paginas institucionales reales de ACR+ (FAQ, términos, políticas de
      envío/cambios/privacidad/cookies, solicitar crédito), con chunking
      jerárquico (párrafo → oración → palabra) que nunca genera un chunk
      gigante ni corta a mitad de palabra. Probado end-to-end: 78 chunks
      reales, sin fugas de CSS ni HTML, todos por debajo del límite de
      tamaño.
- [x] 15. RAG (`packages/rag`, expuesto en `GET /knowledge/search`) —
      búsqueda **híbrida**: similitud vectorial (pgvector) cuando hay
      embeddings, más texto completo en español (con reescritura AND→OR
      del `tsquery`, para que una pregunta con fraseo distinto al de la
      respuesta igual encuentre resultado) como respaldo siempre activo.
      Verificado con preguntas reales tipo usuario ("¿cuánto tarda el
      envío?", "¿puedo devolver un producto?") — todas devuelven la
      respuesta correcta como primer resultado, incluso sin ninguna API
      key de embeddings configurada.

## Fase 3 — Chat
- [x] 16. Chat (`apps/api/src/chat`) — `POST /chat/message` y `POST /chat/stream`
      (streaming real vía SSE), con el LLM Gateway + la base de conocimiento
      (RAG) inyectada como contexto verificado en el system prompt. Interfaz
      3D en `apps/web` (orbe animado con react-three-fiber, burbujas de
      mensaje, acciones rápidas) — ver sección "Interfaz de chat" del README.
      Probado end-to-end sin API key: responde con un mensaje honesto en
      vez de fallar, y lo persiste igual que una respuesta real.
- [x] 17. Sesiones (`sessions`/`conversations` — `POST /chat/session`,
      id anónimo generado y guardado en localStorage del navegador, sin
      login) + el usuario puede **reiniciar** la conversación en cualquier
      momento (`POST /chat/conversations/new`, botón siempre visible, sin
      diálogo de confirmación — nada se pierde, la anterior queda
      guardada) y **cerrar** el chat cuando está embebido como widget
      (botón visible solo dentro del iframe, avisa a `embed.js` por
      `postMessage`).
- [x] 18. Memoria corta (últimos 10 mensajes enviados como contexto al LLM,
      historial completo recuperado al reabrir la conversación) —
      **pendiente**: resumen de conversaciones largas y estado estructurado
      (categoría/presupuesto/marca detectados) llegan con el Intent Router
      (paso 19), que es donde tiene sentido extraerlos.

## Fase 4 — Agent Engine
- [x] 19. Intent Router (`packages/agent-core/src/intent-router.ts`) — clasifica
      cada mensaje en una de las 17 intenciones de la sección 28 con una
      llamada al LLM aparte (temperatura 0). Si no se configura un
      presupuesto de tokens generoso, DeepSeek (modelo de razonamiento) gasta
      todo el limite pensando y corta antes de emitir la palabra visible —
      degradar a `GENERAL_CHAT` en ese caso, nunca fallar.
- [x] 20. Agent Engine (`packages/agent-core/src/agent-engine.ts`) — decide
      el flujo segun la intencion: las de catalogo (busqueda/recomendacion/
      comparacion de productos, Fase 5, aun no construida) y
      `PRIVATE_CUSTOMER_DATA` (no hay autenticacion todavia) cortan **antes**
      de generar con el LLM y responden con un mensaje fijo y honesto — todo
      lo demas (FAQ, credito, garantia, devoluciones, soporte) sigue el flujo
      RAG + LLM ya probado en Fase 2-3. Wireado en `ChatService` para
      `/chat/message` y `/chat/stream`; el intent detectado se persiste en
      `messages.intent`.
- [x] 21. Tool Registry (`packages/agent-core/src/tool-registry.ts`) — registro
      generico de tools (definicion + handler) que el LLM invoca por nombre,
      nunca directamente. Primera tool real: `register_unmet_demand`
      (`packages/agent-core/src/tools/register-unmet-demand.tool.ts`): cuando
      el Agent Engine corta por falta de catalogo, usa un tool call forzado
      para que el LLM extraiga categoria/marca/presupuesto del mensaje y los
      guarda en `unmet_demands` — el texto que ve el usuario nunca depende de
      esa extraccion, solo la analitica. Probado end-to-end: clasificacion,
      corte determinista y fila en `unmet_demands` con los datos correctos.

## Fase 5 — Commerce Tools
Nuevas capas: `packages/database`'s `product-search.repository.ts` (lectura
tipada del catalogo — `searchProducts` con filtros combinables, sin SQL
crudo del LLM), `packages/catalog` (capa de dominio: `ProductSummary`,
`resolveProduct`/`resolveProducts` por nombre o id, `findSimilarProducts`,
`findCheaperAlternatives`), `packages/recommendation` (`rankProducts` —
scoring determinístico de la sección 31-32). Cada tool en
`packages/agent-core/src/tools/` + mapeadas por intencion en
`catalog-tools.ts`, reemplazando el corte fijo de la Fase 4 en
`AgentEngine`: ahora (1) un tool call extrae los parametros del mensaje,
(2) se ejecuta la tool real contra el catalogo, (3) un segundo llamado al
LLM redacta la respuesta usando SOLO ese resultado JSON como fuente de
verdad. Probado end-to-end con las 9 intenciones contra el catalogo real
(1,788 productos tras la cosecha completa del 2026-09-12).
- [x] 22. Search Products (`search_products`) — texto libre + categoria/
      marca/precio maximo.
- [x] 23. Budget Search (`find_products_by_budget`).
- [x] 24. Installment Search (`find_products_by_installment`) — reactivado
      de verdad (14 sep 2026) tras el backfill de la Fase 1: filtra sobre
      `installment_value` real para el 64% del catalogo que lo tiene.
      Probado en vivo ("cuota maxima 70 mil al mes" trae celulares reales
      con su cuota real). Ante cero resultados sigue devolviendo una `note`
      honesta, ahora reconociendo que la cobertura es parcial, no total.
- [x] 25. Comparison (`compare_products`) — trae el detalle real de 2+
      productos por nombre; si no tiene atributos/specs de alguno, lo dice
      en vez de inventarlos (probado con dos AirPods reales).
- [x] 26. Recommendation Engine (`packages/recommendation/src/ranking.ts`)
      — pesos exactos de la sección 31-32 (compatibilidad 30%, presupuesto
      25%, caracteristicas 20%, cuota 10%, similitud semantica 10%,
      promocion 5%). Dos dimensiones son un placeholder neutral (0.5)
      documentado en el codigo, no inventado: "caracteristicas" necesita
      `product_attributes` poblado (hoy vacio en todo el catalogo — el
      harvester no trae specs en el payload scrapeado) y "similitud
      semantica" necesita embeddings de producto (no existen aun, solo los
      de la base de conocimiento). Cada producto recomendado trae
      `reasons[]` generadas deterministicamente para que el LLM explique el
      "por que" sin inventar justificaciones.
- [x] 27. Similar Products (`find_similar_products`) — misma categoria,
      precio ±40%.
- [x] 28. Cheaper Alternatives (`find_cheaper_alternatives`) — misma
      categoria, precio menor o igual.
- [x] 29. Gift Assistant (`recommend_gift`) — mismo motor de ranking que
      Recommendation Engine, `need` = descripcion del destinatario.
      Probado con un caso realista sin match (regalo de maquillaje sin
      productos de esa categoria en el catalogo): respondio honestamente
      que ninguno de los resultados encontrados sirve como ese regalo, en
      vez de forzar una recomendacion irrelevante.
- [x] 30. Product Question (`get_product`) — detalle completo + atributos
      de un producto especifico por nombre.

**Bug real encontrado y arreglado durante las pruebas**: `find_similar_products`/
`find_cheaper_alternatives` solo devolvian la lista de resultados, nunca el
producto de referencia que si se encontro — como ese producto se excluye a
proposito de su propia lista de "similares", el LLM veia una lista sin el
nombre buscado y concluia (incorrectamente) que no estaba registrado,
aunque la busqueda si funciono. Fix: ambas tools ahora devuelven tambien
`referenceProduct` en el JSON, y el prompt de redaccion (`CATALOG_RESPONSE_
PROMPT` en `agent-engine.ts`) explica esa distincion explicitamente.

**Pulimiento de precision — el catalogo cambia constantemente, el sistema
debe estar preparado** (2026-09-12, tras terminar los 9 tools):
- **Productos descontinuados**: nada marcaba `products.is_active = false`
  cuando un producto dejaba de existir en el sitio real — el catalogo local
  se habria ido desincronizando del real para siempre. Fix: `packages/
  database`'s `markStaleProductsInactive(since)` marca inactivo cualquier
  producto con `last_seen_at` anterior al inicio de la cosecha; se llama al
  final de `runHarvest` **solo** en una corrida SIN `--limit` (una corrida
  acotada dejaria fuera la mayoria del catalogo a proposito). Simetricamente,
  `upsertProduct` ahora siempre pone `is_active = true` al re-scrapear con
  exito (antes nunca lo reactivaba, asi que un producto marcado inactivo se
  quedaba asi para siempre aunque volviera a aparecer). `ProductRow`/
  `ProductSummary` exponen `isActive`; `get_product`/`compare_products`
  resuelven productos inactivos igual (para poder decir "ya no esta
  disponible" en vez de fingir que nunca existieron) mientras que
  `search_products`/similares/recomendaciones los siguen excluyendo siempre.
- **Busqueda insensible a tildes**: "audifonos" y "audífonos" devolvian
  conteos distintos (ILIKE es insensible a mayusculas pero no a tildes,
  verificado: 12 vs 11 resultados reales) — un comprador tipico no escribe
  tildes. Fix: migracion `0004_unaccent_search.sql` instala `unaccent`;
  `product-search.repository.ts` compara con `unaccent(columna) ILIKE
  unaccent($n)` en texto/categoria/marca, y `findProductByName` tambien en
  la similitud de pg_trgm.
- **Ruido en el RAG causaba respuestas confusas cuando el Intent Router se
  equivocaba**: el clasificador de intencion NO es perfectamente
  deterministico incluso con `temperature: 0` (reproducido en vivo: la
  misma pregunta salio `GENERAL_CHAT` una vez de tres intentos idénticos,
  un rasgo conocido de los modelos de razonamiento alojados). Cuando eso
  pasaba con una pregunta de catalogo, caia al flujo normal RAG+LLM, que
  inyectaba los 2 chunks "mas parecidos" de la base de conocimiento aunque
  ninguno fuera realmente relevante (verificado: chunks sobre
  inventario/cupo con score vectorial 0.40-0.45 para una pregunta sobre
  audifonos — un match real anda en 0.6-0.76). El LLM armaba una respuesta
  confusa citando esa "informacion verificada" fuera de tema. Fix:
  `packages/rag/src/search.ts` descarta matches vectoriales con score
  menor a `MIN_VECTOR_SCORE = 0.55` — la busqueda de texto completo no
  necesita este filtro porque ya exige superposicion literal de palabras.
  Esto no elimina la clasificacion incorrecta ocasional (es ruido inherente
  del LLM), pero evita que una mala clasificacion produzca una respuesta
  incoherente: ahora cae en el mensaje honesto y generico en vez de una
  narrativa inventada.

## Fase 7 — Experiencia comercial
- [x] 31. Cards de productos — `AgentEngine` normaliza el resultado de
      cualquier tool de catalogo (`products`, `recommendations[].product`,
      `product` singular o `found[]`) a una lista de `ProductSummary` en
      `RunAgentResult.products`. `/chat/message` la devuelve en la
      respuesta; `/chat/stream` manda un evento SSE final con `products`
      despues del ultimo chunk de texto (el texto ya pudo cerrar con
      `done:true` sin ellas). `apps/web`: `MessageBubble.tsx` pinta una fila
      de tarjetas (imagen, nombre, precio, precio tachado si hay descuento,
      "Ya no disponible" si `isActive:false`) debajo del mensaje, cada una
      linkeando al producto real. Verificado con datos reales del catalogo
      completo (nombres, precios, links a prefieroacr.com) via inspeccion
      directa del DOM — ver nota de herramientas mas abajo.
- [x] 32. Contexto de página — `embed.js` manda la ruta de la pagina host
      (`?path=/p/<slug>`) al iframe; `apps/web/src/app/widget/page.tsx` la
      lee del lado del servidor y la pasa a `ChatPanel` → `POST /chat/
      session`. Se guarda en `sessions.page_context` (columna ya existia
      desde Fase 0, sin usar hasta ahora) y se relee en cada mensaje
      (`getPageContextForConversation`, JOIN conversations→sessions — el
      contexto vive a nivel de sesion, no de conversacion). `packages/
      catalog`'s `resolveProductFromPageContext` resuelve `/p/<slug>`
      contra el catalogo real (nunca confia en nombre/precio que mandara el
      host). `AgentEngine` inyecta una nota en el Intent Router, en la
      extraccion de cada tool de catalogo y en el prompt general: probado
      en vivo que "¿cuánto cuesta esto?" y "¿hay algo más económico?" sin
      nombrar el producto se resuelven correctamente contra el producto de
      la pagina.
- [x] 32b. Widget embebible (`apps/web/public/embed.js` + ruta `/widget`)
      — burbuja flotante que abre el chat en un `<iframe>`, sin ocupar
      espacio hasta que se usa; pantalla completa en celulares
      (≤480px). Probado con una página de prueba
      (`apps/web/public/test-embed.html`) que simula un sitio externo.

**Bug real encontrado y arreglado durante las pruebas de esta fase**:
`getOrCreateSession` hacia SELECT-luego-INSERT — dos llamadas concurrentes
con el mismo `anonymousSessionId` (reproducido en vivo con React
StrictMode montando `ChatPanel` dos veces) chocaban contra el UNIQUE
constraint y devolvian un 500 real al usuario. Fix: `INSERT ... ON
CONFLICT (anonymous_session_id) DO UPDATE`, atomico. (`getOrCreateConversation`
tiene la misma forma pero sin UNIQUE constraint — en el peor caso crearia
una conversacion de mas, no un error; se deja para una futura pasada).

**Nota de herramientas**: la verificacion visual de las cards de producto
se hizo por inspeccion directa del DOM (`read_page`/`get_page_text`/
`getBoundingClientRect` via `javascript_exec`) en vez de por screenshot —
el screenshot de este panel de prueba devolvia una imagen no actualizada
tras interacciones (posiblemente el panel de navegador se comparte entre
sesiones concurrentes de Claude Code). El DOM confirmo la estructura y los
datos reales (nombres, precios, descuentos, links a prefieroacr.com)
correctos igual.

**Segundo bug real, encontrado probando la busqueda contra el catalogo
completo ya cosechado**: `searchProducts` exigia que TODAS las palabras de
`query` aparecieran literalmente en nombre/descripcion/categoria/marca
(AND) — una consulta tan normal como "busco un celular samsung economico"
devolvia CERO resultados a pesar de existir Samsung Galaxy A07 reales en
el catalogo, porque "busco"/"un"/"economico" nunca aparecen literalmente
en ningun producto. Es el mismo error de `packages/rag`'s busqueda de
texto completo, nunca aplicado al catalogo. Fix en `product-search.
repository.ts`: se filtran primero verbos/articulos de relleno
(`SPANISH_STOPWORDS`), y las palabras restantes se buscan con OR (no AND)
con relevancia = cuantas matchearon, ordenando por esa relevancia primero.
Verificado: la misma consulta ahora devuelve los Samsung Galaxy A07 reales
ordenados por precio, y las busquedas que ya funcionaban (ej. "audífonos
inalámbricos") no se degradaron.

**Pulimiento de presentacion visual** (2026-09-12, pedido explicito del
usuario: "que la informacion este bien presentada con una presentacion
moderna llamativa intuitiva"):
- **Bug real encontrado**: `MessageBubble.tsx` mostraba el contenido del
  LLM como texto plano (`whitespace-pre-wrap`) — el LLM responde en
  Markdown (`**negrita**`, listas con `-`), asi que el usuario veia los
  asteriscos y guiones crudos en vez de texto formateado. Fix: `react-
  markdown` + `remark-gfm`, con componentes propios para que las listas,
  negritas y links sean del mismo estilo visual que el resto del chat (no
  un `prose` generico que no combina).
- Rediseño visual: titulo con gradiente violeta→fucsia, boton de enviar
  con el mismo gradiente y sombra a juego, header separado con un borde
  sutil, animacion de entrada suave para cada mensaje nuevo
  (`animate-message-in` en `globals.css`), badge de descuento en las cards
  de producto, hover con elevacion sutil en cards y quick actions.
- Verificado en el navegador (viewport 420×750, similar al del widget
  real): Markdown se ve como texto formateado real (listas con viñetas,
  sin asteriscos), cards con imagenes reales del catalogo cargando
  correctamente, badge de descuento visible, sin errores nuevos en
  consola.

**Qwen resuelto (2026-09-12)** — cierra el problema que quedo pendiente
desde Fase 2: el usuario compro el Token Plan y genero la clave dedicada
(`sk-sp-`) desde el enlace "Obtenga una clave API dedicada" en el panel de
uso del plan (no la pagina normal de "Claves API", que solo tiene claves
`sk-ws-` de pago por uso). Con `QWEN_API_KEY=sk-sp-...` + `QWEN_BASE_URL`
apuntando al dominio `token-plan`, `/llm/health` confirma `qwen: ok:true`,
y se verifico en vivo que tanto `generate()` (preguntas de conocimiento)
como `callTools()` (los 9 tools de catalogo de Fase 5) funcionan
correctamente con Qwen como proveedor primario — sin caer a DeepSeek. Qwen
usa notablemente menos tokens de salida que DeepSeek para la misma tarea
(no es un modelo de razonamiento, no gasta tokens ocultos "pensando").
**Bug de observabilidad encontrado de paso**: la primera llamada a
`/knowledge/search` tras reiniciar el servidor devolvio `usedVectorSearch:
false` (fallback silencioso a solo texto completo) sin ningun error en
logs — un timeout/cold-start transitorio del embedding, invisible porque
`packages/rag`'s `Promise.allSettled` nunca logueaba el motivo del
rechazo. Se agrego un `console.warn` cuando la busqueda vectorial falla,
para que un fallo real (no solo este blip transitorio) sea diagnosticable
en el futuro sin tener que reproducirlo a mano.

## Fase 8 — Analytics
Pedido explicito del usuario: "un mini login... para tener usuario
administrador y que ese administrador pueda ver por ejemplo personas que
visitan la pagina en vivo, los productos mas consultados y cosas que
podrian generar interes a los dueños del marketplace" — mapea directo a
la sección 41-46 del documento maestro.
- [x] 33. Analytics (eventos) — `packages/database/src/repositories/
      analytics.repository.ts`: `touchSessionByConversationId` (se llama
      en cada mensaje, no solo al abrir el chat, para que "en vivo"
      signifique algo real), `recordProductImpressions` (una fila por
      producto mostrado en una card), `recordSearchEvent` (una fila por
      busqueda de catalogo con su `result_count`). Las tablas
      `product_impressions`/`search_events` ya existian desde el esquema
      de Fase 0 pero nunca se habian usado.
- [x] 34. Unmet demand — ya estaba construido desde Fase 4/5
      (`register_unmet_demand`); esta fase solo lo expone en el dashboard
      (`getUnmetDemandSummary`, agrupado por categoria+marca pedida).
- [x] 35. Dashboard — panel `/admin` en `apps/web` con login propio
      (`apps/api/src/admin/`): JWT en cookie httpOnly (`bcryptjs` +
      `jsonwebtoken` + `cookie-parser`), un solo usuario fijo via
      `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` (nunca texto plano), rate
      limit de 5/min en el login. Muestra: visitantes en vivo (sesiones
      activas en los ultimos 5 min, se refresca cada 15s), conversaciones/
      mensajes de hoy, productos mas consultados (con imagen y precio),
      demanda no atendida, y de que intenciones habla la gente. Verificado
      en el navegador: login, dashboard con datos reales, logout, y que
      `/admin` sin sesion redirige a `/admin/login` (no expone nada sin
      autenticar).

## Soporte humano + roles de administrador (pedido explicito del usuario)
No es un paso numerado del documento original, pero implementa directo la
seccion 28 (intencion `HUMAN_SUPPORT`, ya existia) y la 41-46 (bandeja para
el dueño del negocio) con un flujo completo de handoff a un agente real:

- **Escalamiento** (`packages/agent-core/src/agent-engine.ts`): la primera
  vez que el Intent Router detecta `HUMAN_SUPPORT` en una conversacion
  activa, `AgentEngine` marca `conversations.status = 'needs_support'`
  (migracion `0005_support_tickets.sql`) y responde con un mensaje fijo
  pidiendo el detalle — a partir de ahi, **mientras el status siga en
  `needs_support`, la IA nunca vuelve a llamar al LLM**: cada mensaje
  nuevo del cliente solo se guarda y se responde con un acuse fijo. Un
  agente humano es quien realmente atiende desde el panel.
- **Bandeja de soporte** (`apps/api/src/admin/admin-support.controller.ts`
  + `apps/web/src/app/admin/support/page.tsx`): lista conversaciones en
  `needs_support`, muestra el hilo completo (incluye lo que ya hablo con
  la IA antes de escalar, para contexto), permite responder
  (`messages.role = 'support_agent'`, rol nuevo agregado en la migracion)
  y tres acciones — **Resolver / Cerrar / Cancelar** — que cambian el
  status de la conversacion.
- **Reinicio automatico del chat del cliente**: `GET /chat/status` (nuevo
  endpoint, sin LLM, limite normal no el estricto de chat) — el widget lo
  consulta cada 6s mientras hay una conversacion activa. Trae el hilo
  completo (para pintar respuestas nuevas del agente) y el status; si el
  status es `resolved`/`closed`/`cancelled`, el widget muestra un aviso
  breve y arranca una conversacion nueva solo, sin que el cliente tenga
  que hacer nada — pedido explicito del usuario.
- **Dos roles, sin tabla de usuarios** (`ADMIN_USERNAME`/
  `SUPPORT_USERNAME` + sus `_PASSWORD_HASH` en `.env`): "admin" ve
  dashboards + bandeja de soporte; "soporte" **solo** ve y responde la
  bandeja — `AdminOnlyGuard` (aplicado a `/admin/stats/*`) devuelve 403 si
  el rol no es "admin", verificado en vivo. El JWT de sesion ahora carga
  el rol (`{sub, role}`); `/admin/auth/login` redirige a `/admin/support`
  directo si el rol es "soporte" (nunca ve el dashboard ni el boton para
  llegar a el).
- Verificado end-to-end en el navegador con dos pestañas simultaneas
  (cliente + agente de soporte): mensaje de escalamiento → aparece en la
  bandeja → agente responde → el cliente lo ve por polling con una
  etiqueta "AGENTE DE SOPORTE" visualmente distinta → agente resuelve →
  el chat del cliente se reinicia solo a los pocos segundos.

## Fase 9 — Seguridad y endurecimiento
- [x] 36a. Rate limiting (`@nestjs/throttler`, límite más estricto en los
      endpoints que llaman al LLM) e input validation (`class-validator`
      + `ValidationPipe` global) — ver sección "Seguridad" del README.
- [ ] 36b. CORS restringido a dominios reales (queda en `CORS_ORIGINS`,
      por definir cuando haya un dominio de producción), CSP
      `frame-ancestors` en `/widget`, manejo de PII.
- [ ] 37. Observabilidad

## Fase 10 — Piloto
- [ ] 38. Despliegue
- [ ] 39. Piloto
- [ ] 40. Optimización

---

Principios permanentes a respetar en cada fase (ver sección 85 del documento
maestro): la IA nunca es fuente de verdad de precios/políticas, las
herramientas están controladas (sin SQL/shell libre para el LLM), y toda la
arquitectura debe permanecer independiente del proveedor de LLM (vía
`packages/llm`).
