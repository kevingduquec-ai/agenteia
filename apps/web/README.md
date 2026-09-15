# @prefiero-ia/web

Frontend (Next.js App Router) — sirve tres cosas distintas desde una sola
app: la experiencia de chat, el panel de administración, y el script
estático que activa el widget en el sitio del cliente.

## Rutas

- **`/`** y **`/widget`** — la misma UI de chat (`ChatPanel`); `/widget`
  es la que carga dentro del `<iframe>` que crea `embed.js` (sin el
  padding de página completa). Sesión anónima guardada en
  `localStorage` (`lib/session.ts`) — nunca requiere login del comprador.
- **`/admin`**, **`/admin/login`**, **`/admin/support`**, **`/admin/users`**,
  **`/admin/impact`** — panel de administración. `admin/layout.tsx`
  protege todo bajo `/admin` con `checkAdminSession()`
  (`lib/admin-api.ts`); `/admin/impact` es exclusivo del rol `owner`.
- **`public/embed.js`** — el script de una sola línea que el cliente pega
  en su sitio (`<script src=".../embed.js" defer></script>`). Sin
  dependencias (no requiere React ni nada del sitio anfitrión): crea la
  burbuja flotante y, al hacer clic, monta un `<iframe>` apuntando a
  `/widget`. `public/test-embed.html` simula un sitio externo con el
  widget instalado, para probar sin tocar el sitio real.

## Componentes clave (`src/components/`)

- **`ChatPanel.tsx`** — el orquestador: sesión, envío de mensajes
  (streaming), reinicio de conversación, polling de estado mientras
  espera soporte humano, disparo del `RatingPrompt` al reiniciar.
- **`ChatOrb.tsx`** — el orbe 3D (react-three-fiber, sin SSR) que sirve de
  "rostro" del asistente — gira despacio en reposo, se acelera pensando/
  respondiendo.
- **`MessageBubble.tsx`** — burbujas de chat + `ProductCardRow` (las
  tarjetas de producto con foto/precio que arma `AgentEngine`).
- **`QuickActions.tsx`** — los accesos rápidos del estado vacío (buscar,
  cuota, presupuesto, regalo, duda, "Problemas con tu compra o tu
  pedido" — esta última manda `forceHumanSupport: true`, saltando el
  clasificador de intención).
- **`RatingPrompt.tsx`** — calificación de 1 a 5 al terminar el chat.

## `src/lib/`

- **`api.ts`** — cliente del chat (`/chat/*`).
- **`admin-api.ts`** — cliente del panel admin (`/admin/*`); también
  arma el snippet de `embed.js` que se muestra en `/admin` usando
  `window.location.origin` (el dominio de **esta** app — nunca el de la
  API, que es un dominio distinto en producción, ver
  `docs/FIXES-2026-09-14.md` para el bug real que esto corrigió).
- **`tenant-header.ts`** — `tenantHeaders()`, manda
  `X-Tenant-Host: window.location.hostname` en cada llamada de `api.ts`/
  `admin-api.ts`. Es así como la API (en su propio dominio, distinto al
  de esta app en producción) sabe a qué tenant pertenece la request —
  ver [`docs/MULTI-TENANCY.md`](../../docs/MULTI-TENANCY.md). SSR-safe
  (no falla si `window` no existe).
- **`session.ts`** — id de sesión anónimo en `localStorage`.

## Desarrollo

```bash
pnpm dev:web   # next dev, http://localhost:3000
```

`NEXT_PUBLIC_API_URL` (en `apps/web/.env.local` para desarrollo, o como
build-arg del `Dockerfile` en producción) apunta al dominio de
`@prefiero-ia/api` — se hornea en el bundle en build time, cambiarlo
requiere reconstruir, no solo reiniciar.

## Producción

Ver [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) — imagen Docker ya
construida y probada en `Dockerfile`.
