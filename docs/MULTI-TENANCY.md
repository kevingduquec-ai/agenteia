# Arquitectura multi-tenant

Pedido explicito del usuario: la misma instalación (un solo despliegue de
`apps/web` + `apps/api`) debe poder atender a más de un cliente/marketplace,
distinguiendo cuál es cuál por la URL con la que se accede — sin necesitar
un despliegue Docker completo por cliente nuevo (que era el diseño
original, documentado en `docs/DEPLOYMENT.md` antes de este cambio).

## El modelo

Cada cliente es un **tenant**: fila en la tabla `tenants`
(`packages/database/src/repositories/tenant.repository.ts`) con su propio
`slug`, `host` público, `crawler_base_url`, cupos de cuentas admin/soporte
y orígenes CORS extra. Todo lo que antes era una sola instancia global
(catálogo, base de conocimiento, conversaciones, cuentas `admin`/`soporte`)
ahora tiene una columna `tenant_id` y queda aislado por tenant — ver la
migración `database/migrations/0010_multi_tenant.sql` para la lista
completa de tablas afectadas y el razonamiento de cada `UNIQUE` que pasó
de global a `(tenant_id, ...)`.

**El rol `owner` sigue siendo global**, sin cambios en esa decisión de
seguridad (ver README principal): es Qubit, el operador de la plataforma,
quien crea tenants nuevos y administra las cuentas `admin`/`soporte`
*dentro* de un tenant específico. El owner no tiene fila propia por
tenant — inicia sesión con las mismas credenciales globales
(`OWNER_USERNAME`/`OWNER_PASSWORD_HASH`) desde el subdominio del cliente
que quiera operar en ese momento.

## Cómo se resuelve el tenant de cada petición

`apps/web` es **un solo despliegue** que sirve a todos los clientes — el
subdominio con el que el navegador ve el widget/panel (ej.
`acr.app.tu-dominio.com`) es lo que distingue a un tenant de otro. Como
`apps/web` y `apps/api` viven en dominios *distintos* en producción, la
API no puede usar su propio `Host` para saber de qué tenant se trata (ese
Host es siempre el suyo propio, ej. `api.tu-dominio.com`).

En su lugar:

1. `apps/web/src/lib/tenant-header.ts` manda `X-Tenant-Host:
   window.location.hostname` en cada llamada a la API — el hostname con
   el que el navegador está viendo la página, sea el widget embebido, la
   página completa del chat, o el panel admin.
2. `apps/api/src/tenant/tenant.middleware.ts` (registrado globalmente en
   `AppModule`) resuelve ese header contra `tenants.host` y adjunta el
   tenant resuelto a `request.tenant`.
3. Los controllers lo leen con el decorator `@CurrentTenant()`
   (`apps/api/src/tenant/current-tenant.decorator.ts`).

**Desarrollo local**: sin subdominios reales, una petición a
`http://localhost:3000` no tiene forma de indicar un tenant por URL. Para
eso existe `DEFAULT_TENANT_SLUG` en `.env` — si no está fijada y solo
existe un tenant en la base, se usa ese automáticamente (para no romper
el flujo de desarrollo que ya existía).

## Seguridad entre tenants

- **Catálogo y conocimiento**: cada query de búsqueda filtra por
  `tenant_id` explícitamente (nunca solo por un JOIN implícito) — desde
  `product-search.repository.ts` hasta `knowledge.repository.ts`.
  Verificado en vivo creando un segundo tenant con un producto ficticio:
  buscar ese producto en el tenant real (Prefiero ACR+) da cero
  resultados, y buscar el catálogo real de Prefiero ACR+ desde el tenant
  ficticio también da cero — ningún catálogo se filtra al otro.
- **Login admin/soporte**: `findAdminUserByUsername` ahora exige
  `tenant_id` — el mismo username podría existir en dos tenants distintos
  sin chocar.
- **JWT del panel**: el token de sesión (`AdminTokenPayload`) lleva el
  `tenantId` con el que se inició sesión. `AdminAuthGuard` compara ese
  `tenantId` contra el tenant que `TenantMiddleware` resolvió para la
  petición actual — una sesión iniciada en el subdominio del cliente A es
  rechazada (401) si se reusa contra el subdominio del cliente B.
  Verificado en vivo: login como owner en un tenant, luego la misma
  cookie contra otro tenant → `401 Sesion invalida para este cliente`.
- **Chat público (sin autenticación)**: `conversationId` es un UUID que
  el comprador anónimo controla. `ChatController` verifica con
  `getConversationTenantId()` que esa conversación pertenezca al tenant
  resuelto antes de leer/escribir nada — sin esto, adivinar/reusar un
  UUID ajeno podría filtrar el chat de otro cliente.
- **CORS**: `apps/api/src/main.ts` valida el header `Origin` contra la
  lista dinámica de `https://`/`http://<tenant.host>` + los
  `extra_cors_origins` de cada tenant (el sitio real del cliente donde se
  embebe el widget) — recalculada desde la base con cache de 60s. En
  desarrollo (`NODE_ENV != production`) se acepta cualquier origen, igual
  que antes de este cambio.

## Operación

```bash
# Alta de un cliente nuevo
pnpm run create-tenant -- --slug=acr --name="Prefiero ACR+" \
  --host=acr.app.tu-dominio.com --crawler-base-url=https://prefieroacr.com

# Poblar SU catálogo/conocimiento (cada comando toma --tenant=<slug>;
# si solo hay un tenant, o esta fijado DEFAULT_TENANT_SLUG, se puede omitir)
pnpm run harvest -- --tenant=acr
pnpm run backfill-installments -- --tenant=acr
pnpm --filter @prefiero-ia/worker run backfill-product-embeddings -- --tenant=acr
pnpm run ingest-knowledge -- --tenant=acr
```

Ver `docs/DEPLOYMENT.md` para cómo se traduce esto a subdominios reales
con DNS/TLS en producción.

## Limitaciones conocidas, no resueltas en esta ronda

- **Fuentes de la base de conocimiento** (`apps/worker/src/knowledge/sources.ts`)
  siguen siendo una lista estática de URLs de `prefieroacr.com` — para un
  segundo cliente real, hay que editar ese archivo (o convertirlo en
  configuración por tenant) antes de correr `ingest-knowledge` para él.
- El **owner no tiene una UI para crear tenants** todavía — `create-tenant`
  es un comando de CLI, no un botón en `/admin`. Suficiente para el
  volumen actual (Qubit da de alta cada cliente a mano), pero valdría la
  pena una pantalla si el número de clientes crece.
