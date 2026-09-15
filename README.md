# Prefi

Agente comercial inteligente para marketplaces, desarrollado por Qubit.
Primer caso de uso: [Prefiero ACR+](https://www.prefieroacr.com).

El producto de cara al cliente se llama **Prefi** ("agente inteligente",
nunca "IA" en la marca — ver sección de branding más abajo). El nombre
interno del monorepo y de los paquetes (`@prefiero-ia/*`) quedó como
`prefiero-ia` a propósito: es el identificador técnico original del
proyecto, no la marca comercial, y renombrarlo ahora sería un cambio
mecánico grande (cada `package.json`, cada import) sin ningún beneficio
para quien usa el producto. Si en algún momento se quiere alinear también
el nombre técnico, es un refactor aparte — decisión del equipo, no algo a
hacer de pasada.

Ver el documento maestro completo en [`docs/PRODUCT.md`](docs/PRODUCT.md),
el checklist de construcción en [`docs/ROADMAP.md`](docs/ROADMAP.md), el
manual de despliegue a producción en
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), y la arquitectura multi-tenant
(una sola instalación atendiendo a varios clientes, distinguidos por URL)
en [`docs/MULTI-TENANCY.md`](docs/MULTI-TENANCY.md).

## Stack

Next.js + NestJS + PostgreSQL/pgvector + Redis + BullMQ, LLM Gateway
(Qwen 3.7 Flash principal, DeepSeek V4 Flash fallback), monorepo pnpm.

## Estructura

Cada app y cada paquete tiene su propio README con el detalle real de qué
hace cada archivo — esta tabla es solo el mapa de un vistazo.

```
apps/
  web/      Next.js — chat, panel admin, embed.js       → apps/web/README.md
  api/      NestJS — API REST/streaming                 → apps/api/README.md
  worker/   Crawler, ingesta de conocimiento, embeddings → apps/worker/README.md
packages/
  agent-core/       Intent router, agent engine, tools de catálogo
  llm/              LLM Gateway (Qwen / DeepSeek, interfaz LLMProvider)
  database/         Cliente de base de datos y esquema compartido
  rag/              Retrieval hibrido sobre la base de conocimiento
  catalog/          Modelos y acceso al catálogo de productos
  recommendation/   Motor de ranking determinístico
  security/         Placeholder — la seguridad real vive en apps/api
  observability/    Placeholder — sin implementar todavía
  shared/           Placeholder — sin implementar todavía
infrastructure/
  docker/, nginx/, postgres/, redis/    → docs/DEPLOYMENT.md
database/
  migrations/, seeds/, schema/          → packages/database/README.md
```

Cada `packages/*` enlaza su propio `README.md` (`packages/agent-core/README.md`,
`packages/catalog/README.md`, etc.) — ahí está el detalle de qué hace cada
archivo y cómo encaja con el resto.

## Desarrollo local

```bash
cp .env.example .env
pnpm install
pnpm docker:up      # Postgres (pgvector) + Redis
pnpm dev:api
pnpm dev:web
```

## LLM Gateway (Qwen / DeepSeek)

`packages/llm` ya implementa el gateway completo (`generate`, `stream`,
`callTools`, `healthCheck`) sobre el SDK de OpenAI, ya que tanto Qwen
(DashScope compatible-mode) como DeepSeek exponen una API compatible con
Chat Completions. No hace falta tocar código para activarlo: solo pega tus
API keys en `.env`:

```bash
QWEN_API_KEY=tu-api-key-de-alibaba-cloud
DEEPSEEK_API_KEY=tu-api-key-de-deepseek   # opcional, es el fallback
```

Sin esas keys, la aplicación arranca igual y `/llm/health` reporta cada
proveedor como `configured: false` en vez de fallar. Para probar:

```bash
pnpm run build:llm   # compila packages/llm (se ejecuta solo antes de dev:api)
pnpm dev:api

curl http://localhost:3001/llm/health
curl -X POST http://localhost:3001/llm/chat -H "Content-Type: application/json" -d '{"message":"hola"}'
```

Con las keys puestas, `/llm/chat` debe responder usando Qwen; si Qwen falla
o no tiene key, el gateway reintenta automáticamente con DeepSeek según
`LLM_PRIMARY` / `LLM_FALLBACK` en `.env`.

## Catalog Harvester

`apps/worker/src/crawler` trae el catálogo público de Prefiero ACR+ sin
necesitar Playwright ni credenciales: `sitemap.xml` ya lista los ~1.782
productos (`/p/<slug>`), y cada ficha de producto trae sus propios datos
estructurados (precio, categoría completa, marca, vendedor, imágenes,
descripción) incrustados por Next.js — el parser los lee de ahí en vez de
depender de clases CSS que cambian con cada deploy del sitio.

```bash
pnpm docker:up
pnpm run harvest -- --limit=30        # prueba acotada (recomendado primero)
pnpm run harvest                      # catálogo completo (~1.782 productos)
```

`--delay=<ms>` controla la pausa entre requests (por defecto `CRAWLER_DELAY_MS`
o 800ms) — súbelo si vas a correr el catálogo completo, para no
sobrecargar el sitio (ver sección 21 del documento maestro: antes de
operar este crawler de forma recurrente/permanente sobre `prefieroacr.com`
debe existir autorización del propietario y una política de consumo
acordada).

**Resuelto (14 sep 2026):** `installment_value` / `installment_count` (la
cuota ACR) quedaban en `null` — la ficha de producto la calcula en el
navegador y nunca la sirve el servidor. `apps/worker/src/crawler/
listing-parser.ts` + `backfill-installments.ts` completan esos dos campos
leyendo las tarjetas de las páginas de listado por categoría (que sí
traen la cuota ya calculada por el servidor), matcheando por SKU:

```bash
pnpm run backfill-installments -- --limit=3   # prueba acotada primero
pnpm run backfill-installments                # todas las categorías conocidas
```

Ver `docs/FIXES-2026-09-14.md` para el detalle completo.

## Knowledge Base / RAG

`apps/worker/src/knowledge` ingesta las paginas institucionales reales de
ACR+ (preguntas frecuentes, quién es Prefiero, cómo solicitar el cupo,
términos y condiciones, políticas de envío/cambios/privacidad/cookies) —
no son URLs inventadas: están enlazadas desde el footer del sitio. Cada
página se divide en chunks por sección/pregunta (con un fallback que sigue
dividiendo por oración y por palabra si una página no usa `<p>` por
párrafo, para nunca guardar un chunk gigante).

```bash
pnpm docker:up
pnpm run ingest-knowledge
```

La búsqueda (`packages/rag`, expuesta en `GET /knowledge/search?q=...`) es
**híbrida**: usa similitud vectorial (pgvector) cuando hay embeddings
generados, y siempre además hace una búsqueda de texto completo en español
como respaldo — con una particularidad importante: `plainto_tsquery`
normalmente exige que TODAS las palabras de la pregunta aparezcan en la
respuesta (AND), lo cual falla seguido en lenguaje natural (p. ej.
"¿cuánto tarda el envío?" no encuentra nada si la respuesta dice "tiempo de
entrega" en vez de "envío"). Por eso se reescribe a OR, dejando que
`ts_rank` ordene por relevancia — así el usuario **siempre** obtiene el
mejor resultado disponible en vez de una lista vacía, incluso antes de
tener una API key de embeddings:

```bash
curl "http://localhost:3001/knowledge/search?q=puedo%20devolver%20un%20producto"
```

Para activar también la búsqueda semántica, pega `QWEN_API_KEY` en `.env`
y vuelve a correr `pnpm run ingest-knowledge` — calculará el embedding
faltante de cada chunk (no repite los que ya lo tienen) usando
`QwenEmbeddingProvider` de `packages/llm`.

**Nota sobre el índice vectorial:** la migración `0002` creó un índice
`ivfflat` pensado para un catálogo de conocimiento grande (`lists = 100`).
Con pocos chunks (decenas o cientos, como al día de hoy) ese índice
aproximado en realidad *empeora* la precisión — con tan pocas filas por
"lista" y el `ivfflat.probes` por defecto (1), la búsqueda revisa una
fracción mínima del espacio y puede saltarse el resultado correcto
(verificado en vivo: para "¿cuánto tarda el envío?" devolvía un chunk de
privacidad de datos antes que el de tiempos de entrega). La migración
`0003` lo eliminó — con este volumen, un scan secuencial exacto es igual
de rápido y siempre encuentra el vecino más cercano real. Reactivar un
índice aproximado (ivfflat con `lists ≈ filas/1000`, o `hnsw`) solo tiene
sentido cuando `knowledge_chunks` crezca a varios miles de filas.

## Interfaz de chat

`apps/web` es la experiencia completa de Prefi: un chat con un orbe
3D (react-three-fiber) como "rostro" del asistente — gira despacio en
reposo y se acelera cuando está pensando o respondiendo, dando una señal
visual de estado sin necesidad de leer texto. Pantalla de bienvenida con
accesos rápidos (buscar producto, comprar por cuota, comparar, regalo,
dudas), sin login (sesión anónima guardada en el navegador), pensada para
alguien que no usa mucho la tecnología: un solo campo de texto grande,
botón de enviar bien visible, avisos en lenguaje simple.

```bash
pnpm docker:up
pnpm run predev:api  # o simplemente pnpm dev:api, que lo hace solo
pnpm dev:api
pnpm dev:web
# abrir http://localhost:3000
```

El backend (`apps/api/src/chat`) guarda cada conversación
(`sessions`/`conversations`/`messages`) y responde por streaming real
(`POST /chat/stream`, Server-Sent Events) combinando el LLM Gateway con la
base de conocimiento: antes de responder, busca en `packages/rag` y le pasa
al modelo solo los fragmentos verificados relevantes — igual que
`/knowledge/search`, nunca inventa política ni dato comercial. Sin
`QWEN_API_KEY` configurada, el chat sigue funcionando: responde con un
mensaje honesto explicando que el modelo aún no está conectado, en vez de
fallar o quedarse en silencio.

## Widget embebible (burbuja de chat)

Para el marketplace en producción, el chat no vive en una página aparte:
se instala como una burbuja flotante en cualquier página del sitio (o de
un aliado), igual que Intercom/Crisp — no ocupa espacio hasta que alguien
la abre, y es responsive en cualquier resolución.

```html
<!-- justo antes de </body>, en cualquier página del marketplace -->
<script src="https://TU-DOMINIO-DE-APPS-WEB/embed.js" defer></script>
```

- **Desktop/tablet**: un panel flotante de 380×620px en la esquina
  inferior derecha.
- **Celular** (≤480px de ancho): el chat ocupa toda la pantalla al abrirse
  — más cómodo para usar con el dedo que un recuadro pequeño.
- Es un `<script>` plano sin dependencias (no requiere React ni nada del
  sitio anfitrión): crea la burbuja y, al hacer clic, monta un `<iframe>`
  apuntando a `/widget` — la misma app de chat, sin el padding de página
  completa. El `<iframe>` aísla completamente el CSS/JS del chat del sitio
  anfitrión, evitando conflictos de estilos.
- `apps/web/public/test-embed.html` es una página de prueba que simula un
  sitio externo con el widget instalado — ábrela para probar la burbuja
  sin tocar el sitio real.

**"Usable con una API"**: todo lo que hace el widget (crear sesión,
enviar mensaje, recibir la respuesta en streaming) pasa por la API REST
normal (`/chat/session`, `/chat/message`, `/chat/stream` — ver sección
"Interfaz de chat"). Cualquier otro cliente (app móvil nativa, otro sitio,
un backend propio) puede integrarse contra esos mismos endpoints sin
depender del widget ni del iframe.

## Panel de administración (`/admin`)

Tres roles, un solo dueño real:

- **owner**: fijo por variables de entorno (`OWNER_USERNAME` /
  `OWNER_PASSWORD_HASH`), nunca vive en la base de datos. Es quien despliega
  el sistema — el cliente del marketplace nunca tiene esta cuenta. Crea y
  borra cuentas `admin`/`soporte` desde `/admin/users`, y es el único que
  puede resetearles la contraseña (ninguno de los dos roles tiene forma de
  cambiar la propia — decisión deliberada, no un descuido: evita que una
  contraseña débil o compartida del lado del cliente se convierta en un
  problema de soporte para nosotros).
- **admin**: ve el dashboard completo (analítica, bandeja de soporte,
  reporte de calificaciones) — es el rol que usa el dueño del marketplace.
- **soporte**: solo ve y responde la bandeja de soporte humano, nunca
  analítica ni gestión de cuentas.

Cupos por plan (`MAX_ADMIN_SEATS` / `MAX_SUPPORT_SEATS` en `.env`): crear
una cuenta por encima del límite del plan devuelve un mensaje claro en vez
de fallar en silencio.

### Calificación de la atención y métricas de soporte

Al terminar una conversación (reinicio manual o cierre por parte de
soporte), el widget pide una calificación de 1 a 5 antes de limpiar el
chat (`RatingPrompt`, `POST /chat/rating`) — nunca a mitad de una
conversación activa. Solo `admin`/`owner` la ven, nunca el comprador ni
`soporte`.

El dashboard también mide, en tiempo real: cuántas conversaciones atendió
el equipo de soporte hoy y el tiempo real de respuesta (desde que la
conversación pasó a `needs_support` hasta la primera respuesta humana —
columna `conversations.needs_support_at`, migración `0007`). Un tiempo
mayor a 10 minutos se marca en rojo en el panel; menos de 2, en verde.

### Reporte de impacto (`/admin/impact`, solo owner)

Pensado para que el owner le muestre a Prefiero (o a cualquier cliente)
cifras concretas del valor del servicio por semana/mes/año: conversaciones
atendidas, preguntas fuera de tema descartadas sin gastar IA (prueba de
ahorro de costo), oportunidades de catálogo detectadas, escalaciones a
soporte con su tiempo de respuesta, y calificación promedio. La misma
página incluye un panel de diagnóstico de solo lectura (`GET
/admin/owner/health`): estado de cada proveedor de IA configurado y de la
base de datos — para revisar el sistema sin tocar nada del cliente.

## Búsqueda semántica de producto (embeddings)

`product_embeddings` (migración `0007`) guarda un embedding por producto,
mismo patrón que `knowledge_embeddings`. `recommend_products` y
`recommend_gift` combinan la búsqueda literal de siempre con esta búsqueda
semántica (`packages/catalog`'s `findSemanticProductMatches`) cuando hay un
proveedor de embeddings configurado — si no, siguen funcionando solo con
texto literal, sin romper nada.

```bash
pnpm --filter @prefiero-ia/worker run backfill-product-embeddings
```

**Resuelto (14 sep 2026):** `QWEN_EMBEDDING_API_KEY` ya es una key de
workspace pay-as-you-go válida, y el catálogo completo tiene embeddings
generados (`SELECT count(*) FROM product_embeddings` = total de
productos). De paso se encontró y corrigió un segundo problema, este de
esquema: `product_embeddings.embedding` se había creado como
`vector(1536)` por un comentario incorrecto en la migración `0007`
("mismo patrón que `knowledge_embeddings`, 1536") — pero `knowledge_
embeddings` ya se había corregido a `vector(1024)` en la migración `0002`,
porque el modelo real de Qwen devuelve 1024 dimensiones, no 1536. Ver
migraciones `0008`/`0009` y `docs/FIXES-2026-09-14.md` para el detalle
completo. Verificado en vivo: "televisores" ya no devuelve soportes de
pared para TV, solo televisores reales.

## Seguridad

Cambios de esta ronda de revisión, pensados para un chat público expuesto
a internet:

- **Rate limiting** (`@nestjs/throttler`): 60 requests/min por IP en toda
  la API, y un límite más estricto (15/min) en los endpoints que llaman al
  LLM (`/chat/message`, `/chat/stream`, `/llm/chat`) — son los que cuestan
  dinero por token, así que son el objetivo más probable de abuso.
- **Validación de entrada** (`class-validator` + `ValidationPipe` global
  con `whitelist`/`forbidNonWhitelisted`): todo body/query se valida por
  tipo y longitud (ej. el mensaje del chat no puede superar 2000
  caracteres) y cualquier campo no declarado en el DTO se descarta en vez
  de pasar silenciosamente al resto del código.
- **Cabeceras de seguridad** (`helmet`) en la API.
- **CORS configurable** vía `CORS_ORIGINS` en `.env` (lista separada por
  coma) — sin configurar, acepta cualquier origen (cómodo en desarrollo,
  pero debe fijarse a los dominios reales antes de producción).
- **Defensa contra prompt injection**: el system prompt (`apps/api/src/
  chat/prompt.ts`) instruye explícitamente al modelo a tratar la sección
  "Información verificada" (el contenido recuperado por RAG) como
  referencia, nunca como instrucciones — ignora cualquier texto ahí que
  intente darle una orden o cambiarle las reglas (ver sección 49 del
  documento maestro).
- **Escalamiento a soporte sin depender del LLM**: la tarjeta "Problemas
  con tu compra o tu pedido" del widget manda `forceHumanSupport: true`,
  que `AgentEngine` revisa ANTES de clasificar la intención — un comprador
  frustrado por un pedido dañado nunca queda a merced de que el
  clasificador adivine bien.
- **Ninguna cuenta gestiona su propia contraseña**: `admin`/`soporte` no
  tienen endpoint de cambio de contraseña — solo `OwnerOnlyGuard` puede
  resetearla (`PATCH /admin/users/:id/password`). Reduce la superficie de
  ataque de credenciales del lado del cliente a una sola cuenta (`owner`).
- Cada calificación de atención está atada 1:1 a su conversación
  (`feedback_conversation_unique`, migración `0007`) — un reintento de red
  o doble clic actualiza la calificación existente en vez de inflar el
  promedio con filas duplicadas.
- Ya cubierto desde antes: SQL parametrizado en todo `packages/database`
  (sin concatenar strings en queries), sin `dangerouslySetInnerHTML` en el
  frontend (React escapa el contenido del chat automáticamente), secretos
  fuera del repo (`.env` en `.gitignore`).
- **Pendiente antes de producción** (no bloqueante para seguir
  desarrollando, pero anotado para no olvidarlo): fijar `CORS_ORIGINS` a
  los dominios reales; si se conocen de antemano los dominios que
  embeberán el widget, agregar una cabecera `Content-Security-Policy:
  frame-ancestors` en `/widget` restringiéndolos explícitamente.

## Rendimiento

- La búsqueda de conocimiento (`packages/rag`) corre la similitud
  vectorial y la búsqueda de texto completo **en paralelo**
  (`Promise.allSettled`) en vez de una tras otra — la latencia total queda
  acotada por la más lenta de las dos, no por la suma.
- El chat responde por **streaming real** (Server-Sent Events): el primer
  token le llega al usuario apenas el modelo empieza a generarlo, no
  cuando termina toda la respuesta.
- Un solo `pg.Pool` compartido (`packages/database`) reutiliza conexiones
  en vez de abrir una por request.
- Índices ya creados donde importan: `ivfflat` sobre
  `knowledge_embeddings.embedding` (búsqueda vectorial) y `gin` sobre
  `to_tsvector('spanish', content)` (búsqueda de texto completo).

## Principio fundamental

El modelo de IA **no** es la fuente de verdad. La fuente de verdad es la
base de datos, el catálogo y los documentos de conocimiento — el LLM solo
interpreta, elige qué herramienta ejecutar, y redacta la respuesta a partir
de datos verificables. Ver sección 9 y 47-48 de `docs/PRODUCT.md`.
