# Manual de despliegue a producción

Guía operativa para que Qubit despliegue Prefi en un servidor real y le
entregue a un cliente (primer caso: Prefiero ACR+) el enlace que activa el
chat en su sitio. Arquitectura según `docs/PRODUCT.md` (sección 62-65): un
solo VPS con Docker Compose — sin Kubernetes, sin múltiples servidores.

Todos los archivos que este manual referencia ya existen en el repo:
`apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/worker/Dockerfile`,
`docker-compose.prod.yml`, `infrastructure/nginx/conf.d/*.example`. Las
tres imágenes se construyeron y probaron en local antes de escribir este
documento (API respondiendo en `/llm/health`, web sirviendo `/`, `/widget`
y `/embed.js` con 200).

## 0. Arquitectura

**Multi-tenant** (ver `docs/MULTI-TENANCY.md` para el detalle completo):
un solo despliegue de `api`/`web` atiende a TODOS los clientes — cada uno
distinguido por su propio subdominio de `app`. No hay que repetir este
manual completo por cada cliente nuevo, solo la sección 7b.

```
                         ┌───────────────────────────────────────────┐
                         │   VPS (Docker Compose)                     │
  Internet ──HTTPS───▶   │                                            │
                         │  nginx (80/443, TLS)                       │
                         │   ├─ acr.app.tu-dominio.com  ──▶ web (3000) │  ← tenant "acr"
                         │   ├─ clienteb.app.tu-dominio.com ──▶ web    │  ← tenant "clienteb"
                         │   └─ api.tu-dominio.com      ──▶ api (3001) │  ← UNA sola API para todos
                         │                                            │
                         │  api ──▶ postgres (pgvector, tenant_id en  │
                         │           cada tabla)                      │
                         │  api ──▶ redis                             │
                         │  worker (bajo demanda, --tenant=<slug>)    │
                         └───────────────────────────────────────────┘
```

- **`<tenant>.app.tu-dominio.com`** — un subdominio por cliente, sirviendo
  la MISMA imagen de `web` (panel `/admin`, `/widget`, `/embed.js`). El
  subdominio con el que el navegador ve la página es lo único que
  distingue a un cliente de otro — `apps/web` manda ese hostname en el
  header `X-Tenant-Host` en cada llamada a la API.
- **`api.tu-dominio.com`** — una sola API para todos los tenants
  (`/chat/*`, `/admin/*`, `/llm/*`). Resuelve a qué tenant pertenece cada
  petición por el header de arriba, nunca por su propio dominio.
- **`worker` no es un servicio permanente todavía** (`apps/worker/src/index.ts`
  sigue siendo un placeholder): se invoca puntualmente, por tenant
  (`--tenant=<slug>`), para poblar el catálogo y la base de conocimiento
  de ESE cliente (sección 7b), nunca con `restart: unless-stopped`.

Reemplaza `tu-dominio.com` por el dominio real de Qubit (ej.
`qubit.com.co`, con `app.` y `api.` como raíces de subdominio) en todos
los pasos de abajo. El primer cliente de este manual usa el slug `acr`
(Prefiero ACR+) — un cliente nuevo repite solo la sección 7b con su
propio slug.

## 1. Requisitos previos

- Un VPS Ubuntu 22.04+ — con el volumen de Plan Base (hasta 1.500
  conversaciones/mes, catálogo de 5.000 productos) **2 vCPU / 4 GB RAM /
  40 GB disco** sobra con margen; es el mismo servidor que ya se cotizó en
  la propuesta comercial (línea "Servidor dedicado", $280.000/mes).
- Un dominio propio de Qubit con acceso a su panel de DNS (no del
  cliente — el cliente solo recibe un `<script>` que apunta a un dominio
  de Qubit).
- Acceso SSH root/sudo al VPS.
- Las API keys reales de producción: `QWEN_API_KEY` (y opcionalmente
  `QWEN_EMBEDDING_API_KEY` con una key de workspace pay-as-you-go válida —
  ver limitación conocida en el `README.md` principal) y `DEEPSEEK_API_KEY`
  como respaldo.

### Instalar Docker en el VPS

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
sudo apt-get install -y certbot
docker --version && docker compose version
```

### DNS

Crea un registro `A` para la API y uno por cada tenant que vayas a
desplegar ahora (el primero, `acr`):

```
api.tu-dominio.com       A   <IP-del-VPS>
acr.app.tu-dominio.com   A   <IP-del-VPS>
```

Un cliente nuevo más adelante solo necesita su propio registro
`<slug>.app.tu-dominio.com` — no hace falta wildcard mientras sean pocos
clientes (agregar uno de más no rehace nada de lo ya desplegado, ver
sección 7b).

Espera a que propaguen (`dig acr.app.tu-dominio.com` debe devolver la IP)
antes de pedir los certificados en el paso 6.

## 2. Clonar el proyecto y configurar `.env`

```bash
git clone <url-del-repo> prefiero-ia
cd prefiero-ia
cp .env.example .env
```

Edita `.env` y fija **todo lo siguiente** con valores reales de
producción (nunca dejar los de `.env.example`):

| Variable | Valor en producción |
|---|---|
| `NODE_ENV` | `production` (activa la validación estricta de CORS por tenant, ver `docs/MULTI-TENANCY.md`) |
| `POSTGRES_PASSWORD` | contraseña generada, no "prefiero" |
| `JWT_SECRET` | ver comando abajo |
| `OWNER_USERNAME` / `OWNER_PASSWORD_HASH` | ver comando abajo |
| `NEXT_PUBLIC_API_URL` | `https://api.tu-dominio.com` |
| `QWEN_API_KEY`, `DEEPSEEK_API_KEY` | keys reales |

Ya **no existen** `CRAWLER_BASE_URL`/`MAX_ADMIN_SEATS`/`MAX_SUPPORT_SEATS`
ni un `CORS_ORIGINS` obligatorio: eso ahora vive por cliente en la tabla
`tenants` (`crawler_base_url`, cupos, `extra_cors_origins` — el sitio del
cliente donde se embebe el widget) y se crea con `create-tenant` en la
sección 7b. `CORS_ORIGINS` en `.env` sigue existiendo solo como una lista
extra de orígenes que no pertenecen a ningún tenant (ej. herramientas
internas) — normalmente se deja vacío.

```bash
# JWT_SECRET — cualquier cadena aleatoria larga sirve:
openssl rand -hex 32

# OWNER_PASSWORD_HASH — hash bcrypt de la contraseña real que va a usar
# Qubit para entrar como owner (nunca en texto plano en .env):
docker run --rm node:22-bookworm-slim node -e \
  "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" \
  'TU_PASSWORD_REAL_AQUI'
```

## 3. Base de datos: extensiones y migraciones

Levanta solo Postgres y Redis primero (todavía no la API/web):

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d postgres redis
docker compose -f docker-compose.prod.yml ps   # ambos "healthy" antes de seguir
```

`infrastructure/postgres/init/001_extensions.sql` crea `vector` y
`pg_trgm` automáticamente la primera vez (monta como
`docker-entrypoint-initdb.d`, solo corre en un volumen nuevo). Las
migraciones de esquema en `database/migrations/` (10 al día de hoy,
incluida `0010_multi_tenant.sql`) se aplican a mano, en orden, una sola
vez:

```bash
for f in database/migrations/*.sql; do
  echo "== $f =="
  docker exec -i prefiero-ia-postgres psql -U prefiero -d prefiero_ia < "$f"
done
```

Si algún día se agrega una migración `0010_...sql` nueva, correr solo esa
línea (no todas de nuevo — no son idempotentes).

## 4. Construir y levantar la API y el frontend

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build api web
docker compose -f docker-compose.prod.yml logs -f api   # Ctrl+C cuando veas "Nest application successfully started"
```

En este punto `api` y `web` ya corren, pero solo son alcanzables dentro
del VPS (`localhost:3001` / `localhost:3000`) — falta nginx con HTTPS
para exponerlos a internet.

## 5. Nginx + HTTPS

Es un proceso de dos fases porque nginx no puede arrancar apuntando a
certificados que todavía no existen.

**Fase 1 — bootstrap HTTP (para que certbot pueda validar el dominio):**

```bash
cd infrastructure/nginx/conf.d
cp prefi.bootstrap.conf.example prefi.conf
sed -i "s/APP_DOMAIN/acr.app.tu-dominio.com/g; s/API_DOMAIN/api.tu-dominio.com/g" prefi.conf
cd ../../..

docker compose -f docker-compose.prod.yml --env-file .env up -d nginx
```

**Fase 2 — pedir los certificados y activar HTTPS de verdad:**

```bash
sudo certbot certonly --webroot \
  -w infrastructure/nginx/webroot \
  -d acr.app.tu-dominio.com -d api.tu-dominio.com \
  --email tu-correo@qubit.com.co --agree-tos --no-eff-email

cd infrastructure/nginx/conf.d
cp prefi.conf.example prefi.conf
sed -i "s/APP_DOMAIN/acr.app.tu-dominio.com/g; s/API_DOMAIN/api.tu-dominio.com/g" prefi.conf
cd ../../..

docker compose -f docker-compose.prod.yml --env-file .env restart nginx
```

> Los archivos `.example` traen un solo bloque `APP_DOMAIN` — con más de
> un tenant, agrega un `server` adicional por cada subdominio nuevo (todos
> apuntando al mismo contenedor `web`) en vez de reemplazar el existente.
> Ver sección 7b para el flujo completo de agregar un cliente.

Certbot instala su propio cron/systemd timer para renovar automáticamente;
solo falta que nginx recargue los certificados renovados cada tanto (basta
un `docker compose -f docker-compose.prod.yml exec nginx nginx -s reload`
mensual, o agregarlo como línea extra al hook de renovación de certbot en
`/etc/letsencrypt/renewal-hooks/deploy/`).

## 6. Verificación post-despliegue

```bash
curl -s https://api.tu-dominio.com/llm/health          # {"ok":true,...} si las keys estan bien
curl -s -o /dev/null -w "%{http_code}\n" https://acr.app.tu-dominio.com/embed.js   # 200
```

Entra a `https://acr.app.tu-dominio.com/admin/login` con el
`OWNER_USERNAME` y la contraseña real del paso 2, y revisa `Impacto →
Diagnóstico del sistema` (`GET /admin/owner/health`) — confirma en la UI
que la base de datos y el motor inteligente están `ok`.

## 7. Crear el tenant y cargar su catálogo

Con `api`/`web` ya arriba, primero se crea la fila del cliente
(`tenants`) y después se puebla SU catálogo/conocimiento — todo por
`docker compose run` puntual (perfil `tools`, no queda corriendo
después):

```bash
docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run create-tenant -- --slug=acr --name="Prefiero ACR+" \
    --host=acr.app.tu-dominio.com --crawler-base-url=https://prefieroacr.com

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run harvest -- --tenant=acr --limit=30      # prueba acotada primero

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run harvest -- --tenant=acr                 # catálogo completo

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run add-knowledge-source -- --tenant=acr \
    --url=https://prefieroacr.com/preguntas-frecuentes   # repetir por cada página de FAQ/garantía/envíos/políticas

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run ingest-knowledge -- --tenant=acr        # FAQ, garantía, envíos, etc.

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm --filter @prefiero-ia/worker run backfill-product-embeddings -- --tenant=acr

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run backfill-installments -- --tenant=acr
```

Corre `harvest` primero siempre — tanto `backfill-product-embeddings` como
`backfill-installments` completan datos de productos que ya deben existir
en la tabla (el primero por id, el segundo por SKU contra las categorías
ya conocidas). `backfill-installments` es seguro de repetir cuando cambien
precios/cuotas reales del sitio; `backfill-product-embeddings` solo
procesa productos que todavía no tienen embedding (200 por corrida — con
un catálogo de ~1.800 productos hacen falta varias corridas seguidas).
Ver `docs/FIXES-2026-09-14.md` para el detalle de ambos.

### 7b. Agregar un cliente nuevo más adelante

Todo lo de arriba, pero sin repetir los pasos 1-6 (el servidor, Docker,
`api`/`web`, y sus certificados/`api.tu-dominio.com` ya existen):

1. DNS: agrega `<slug>.app.tu-dominio.com` apuntando a la misma IP.
2. Nginx: agrega un `server` nuevo en `infrastructure/nginx/conf.d/prefi.conf`
   para ese subdominio (mismo `proxy_pass http://web:3000` que ya usa el
   resto) y pide su certificado con
   `sudo certbot certonly --webroot -w infrastructure/nginx/webroot -d <slug>.app.tu-dominio.com ...`
   — puedes ir agregando `-d` a un mismo certificado o pedir uno nuevo por
   cliente, cualquiera de los dos funciona con nginx.
3. `pnpm run create-tenant -- --slug=<slug> --name="..." --host=<slug>.app.tu-dominio.com --crawler-base-url=https://sitio-del-cliente.com`
4. Los comandos de `harvest`/`add-knowledge-source`/`ingest-knowledge`/
   backfills de arriba, con `--tenant=<slug>` (y una URL por cada página de
   FAQ/garantía/envíos/políticas de ESE cliente en `add-knowledge-source`
   — nunca las de Prefiero ACR+, cada cliente tiene su propio contenido).
5. Sección 8, con el subdominio de ESE cliente.

No hace falta reconstruir ni reiniciar `api`/`web` — ambos ya sirven a
cualquier tenant que exista en la base.

## 8. Generar y entregar el enlace de activación

Esto es lo único que el cliente necesita para "prender" el chat en su
sitio — un `<script>` de una línea, nada de credenciales ni configuración
de su lado.

1. Entra a `https://acr.app.tu-dominio.com/admin` con la cuenta owner
   (el subdominio de ESE cliente — cada tenant se administra entrando por
   su propio subdominio).
2. Baja hasta el panel **"Instalar el chat en tu marketplace"** — ya
   genera el snippet correcto solo con el dominio en el que estás parado
   (`acr.app.tu-dominio.com`), por ejemplo:

   ```html
   <script src="https://acr.app.tu-dominio.com/embed.js" defer></script>
   ```

   > Antes de este despliegue, ese panel armaba el enlace con el dominio
   > de la *API* en vez del de *esta* app — como `embed.js` vive en
   > `apps/web`, no en `apps/api`, el enlace generado quedaba roto en
   > cualquier ambiente con dominios separados (exactamente el de
   > producción). Se corrigió en `apps/web/src/app/admin/page.tsx` para
   > que siempre use el dominio real donde corre el panel — ya no hace
   > falta tocar nada a mano, lo que copias del botón "Copiar" es
   > literalmente lo que hay que pegar.
3. Copia esa línea y pásasela al cliente con una sola instrucción: **pegarla
   justo antes de `</body>`, en cualquier página de su sitio** (o en su
   plantilla global, para que aparezca en todo el sitio).
4. Crea además su cuenta `admin` desde `/admin/users` (o `soporte`, según
   quién la vaya a usar) y entrégale por separado el segundo enlace, el
   del panel: `https://acr.app.tu-dominio.com/admin/login` — este es de
   uso interno del cliente, no se pega en ningún sitio.

Con eso, el cliente recibe exactamente los "dos enlaces" que promete la
propuesta comercial (sección 6, "Cómo se entrega"): uno que activa el chat
en su sitio, y uno para que su equipo entre al panel.

## 9. Mantenimiento y actualizaciones

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build api web
```

`--build` reconstruye solo las imágenes cuyo código cambió (Docker cachea
las capas de `pnpm install` mientras no cambien los `package.json`); `up
-d` reemplaza el contenedor viejo por el nuevo sin tocar Postgres/Redis/
nginx. Si cambia una migración nueva, aplícala a mano (paso 3) ANTES del
`up -d --build`, no después.

## 10. Checklist final antes de avisarle al cliente

- [ ] Los 10 archivos de `database/migrations/` aplicados sin error.
- [ ] `NODE_ENV=production` en `.env` (activa la validación estricta de
      CORS por tenant — sin esto, cualquier origen puede llamar la API).
- [ ] El tenant del cliente creado (`create-tenant`) con su `host` y
      `crawler-base-url` reales.
- [ ] Si el widget se va a embeber en un sitio del cliente distinto de su
      propio subdominio de panel, ese sitio está en `--extra-cors-origins`
      del tenant (o se agregó después con un `UPDATE tenants`).
- [ ] `https://api.tu-dominio.com/llm/health` responde `ok:true` para
      Qwen (y DeepSeek si se configuró).
- [ ] Login de owner funciona en `https://<slug>.app.tu-dominio.com/admin/login`.
- [ ] `https://<slug>.app.tu-dominio.com/embed.js` responde 200 (no 404/CORS).
- [ ] Catálogo cargado (`pnpm run harvest -- --tenant=<slug>` corrido sin `--limit`).
- [ ] Embeddings de producto generados (`backfill-product-embeddings`
      corrido hasta que reporte `processed: 0`) y cuotas completadas
      (`backfill-installments`), ambos con `--tenant=<slug>`.
- [ ] Cuenta `admin` creada para el cliente, con su contraseña entregada
      por un canal seguro (no por el mismo chat que se está activando).
- [ ] El snippet de instalación probado en una página real de prueba
      antes de pedirle al cliente que lo pegue en producción (usar
      `apps/web/public/test-embed.html` como referencia de cómo se ve).
