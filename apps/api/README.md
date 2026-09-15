# @prefiero-ia/api

API REST + streaming (NestJS) — donde vive el chat, el panel de
administración y el diagnóstico del sistema. No contiene lógica de
negocio propia más allá de orquestar los paquetes (`@prefiero-ia/agent-core`,
`@prefiero-ia/catalog`, `@prefiero-ia/database`, `@prefiero-ia/llm`,
`@prefiero-ia/rag`) detrás de endpoints HTTP.

## Módulos

- **`chat/`** — el chat de cara al comprador.
  - `POST /chat/session` — crea/recupera una sesión anónima (sin login).
  - `POST /chat/conversations/new` — reinicia la conversación.
  - `POST /chat/message` — un turno completo, respuesta de una vez.
  - `POST /chat/stream` — igual, pero por Server-Sent Events (streaming
    real: el primer token llega apenas el modelo empieza a generar, no al
    terminar toda la respuesta).
  - `GET /chat/status` — estado de la conversación (para que el widget
    detecte cuando un agente humano tomó el caso).
  - `POST /chat/rating` — calificación de 1 a 5 al terminar.
  - `prompt.ts` — el system prompt del agente y las instrucciones contra
    prompt injection sobre el contenido de `@prefiero-ia/rag`.
- **`admin/`** — panel de administración, protegido por `AdminAuthGuard`
  (cookie de sesión + JWT). Tres roles (`owner` fijo por variables de
  entorno y global entre todos los tenants; `admin`/`soporte` son filas
  tenant-scoped en `admin_users`, ver `AdminUsersController`). El JWT
  lleva el `tenantId` con el que se inició sesión — `AdminAuthGuard`
  rechaza el token si no coincide con el tenant resuelto para la request
  actual (evita reusar una sesión de un cliente contra el subdominio de
  otro):
  - `admin/auth/*` — login/logout/sesión.
  - `admin/stats/*` — analítica en vivo (overview, top productos, demanda
    no atendida, desglose de intenciones, métricas de soporte).
  - `admin/support/*` — bandeja de soporte humano (listar, responder,
    resolver/cerrar/cancelar conversaciones).
  - `admin/users` — crear/borrar cuentas `admin`/`soporte`, resetear su
    contraseña (ellas mismas no pueden — solo el `owner`).
  - `admin/owner/*` — exclusivo del owner: reporte de impacto y
    diagnóstico de salud del sistema (`GET /admin/owner/health`).
- **`knowledge/`** — `GET /knowledge/search?q=...`, expone
  `@prefiero-ia/rag` directamente para pruebas/diagnóstico.
- **`llm/`** — `GET /llm/health` (estado de cada proveedor configurado),
  `POST /llm/chat` (llamada directa al gateway, sin pasar por el agente —
  para pruebas).
- **`tenant/`** — resuelve QUÉ cliente está detrás de cada request. Un
  solo despliegue de esta API atiende a todos los tenants; ver
  [`docs/MULTI-TENANCY.md`](../../docs/MULTI-TENANCY.md) para el diseño
  completo.
  - `tenant.middleware.ts` (`TenantMiddleware`, registrado global en
    `AppModule`) — lee el header `X-Tenant-Host` (mandado por
    `apps/web` en cada fetch, ver su propio README) y lo resuelve contra
    `tenants.host`. En desarrollo, si no hay header o el host es
    `localhost`/`127.0.0.1`, cae a `DEFAULT_TENANT_SLUG` o al único tenant
    existente — para no romper el flujo local de siempre. Adjunta el
    resultado a `request.tenant`.
  - `current-tenant.decorator.ts` (`@CurrentTenant()`) — cómo los
    controllers leen ese tenant ya resuelto.
- **`main.ts`** — bootstrap: helmet, cookie-parser, `ValidationPipe`
  global, y CORS dinámico por tenant: la lista de orígenes permitidos se
  recalcula desde `tenants.host` + `tenants.extra_cors_origins` de cada
  cliente (con cache de 60s), más `CORS_ORIGINS` en `.env` como lista
  extra global. En desarrollo (`NODE_ENV != production`) se sigue
  aceptando cualquier origen, igual que antes de multi-tenant.

## Desarrollo

```bash
pnpm run predev:api   # compila los packages de los que depende (build:core)
pnpm dev:api          # nest start --watch
```

En Windows: si editas un `package` del que `api` depende (no un archivo
de `apps/api` en sí), reconstruye ese package a mano
(`pnpm --filter @prefiero-ia/<paquete> build`) y reinicia `dev:api` — el
watcher de Nest no detecta cambios en el `dist/` de una dependencia.

## Producción

Ver [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) — imagen Docker ya
construida y probada en `Dockerfile`.
