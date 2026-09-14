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

Dos dominios públicos, un solo servidor:

```
                         ┌─────────────────────────────┐
                         │   VPS (Docker Compose)       │
  Internet ──HTTPS───▶   │                              │
                         │  nginx (80/443, TLS)          │
                         │   ├─ app.tu-dominio.com ──▶ web  (Next.js, 3000)
                         │   └─ api.tu-dominio.com ──▶ api  (NestJS, 3001)
                         │                              │
                         │  api ──▶ postgres (pgvector)  │
                         │  api ──▶ redis                │
                         │  worker (bajo demanda, no 24/7)│
                         └─────────────────────────────┘
```

- **`app.tu-dominio.com`** sirve el panel `/admin`, la página del chat
  `/widget` y el script estático `/embed.js` — es el dominio que va DENTRO
  del `<script src="...">` que se pega en el sitio del cliente.
- **`api.tu-dominio.com`** es la API REST/streaming (`/chat/*`,
  `/admin/*`, `/llm/*`). El frontend le habla vía CORS con
  `credentials: true` (cookie de sesión del panel) — por eso son dos
  dominios separados y no rutas bajo el mismo host.
- **`worker` no es un servicio permanente todavía** (`apps/worker/src/index.ts`
  sigue siendo un placeholder): se invoca puntualmente para poblar el
  catálogo y la base de conocimiento (sección 8), nunca con `restart:
  unless-stopped`.

Reemplaza `tu-dominio.com` por el dominio real elegido para este cliente
(ej. `prefi-acr.qubit.com.co` como raíz, con `app.` y `api.` como
subdominios) en todos los pasos de abajo.

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

Crea dos registros `A` apuntando a la IP del VPS:

```
app.tu-dominio.com   A   <IP-del-VPS>
api.tu-dominio.com   A   <IP-del-VPS>
```

Espera a que propaguen (`dig app.tu-dominio.com` debe devolver la IP)
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
| `POSTGRES_PASSWORD` | contraseña generada, no "prefiero" |
| `JWT_SECRET` | ver comando abajo |
| `OWNER_USERNAME` / `OWNER_PASSWORD_HASH` | ver comando abajo |
| `NEXT_PUBLIC_API_URL` | `https://api.tu-dominio.com` |
| `CORS_ORIGINS` | `https://app.tu-dominio.com,https://prefieroacr.com` |
| `QWEN_API_KEY`, `DEEPSEEK_API_KEY` | keys reales |
| `CRAWLER_BASE_URL` | `https://prefieroacr.com` (ya viene así) |
| `MAX_ADMIN_SEATS` / `MAX_SUPPORT_SEATS` | según el plan contratado (Base: 1/1, Crecimiento: 2/3) |

`CORS_ORIGINS` lleva **ambos** dominios que van a llamar a la API: el
propio panel/widget (`app.tu-dominio.com`) y cualquier sitio donde se
vaya a embeber el widget (`prefieroacr.com`) — sin el segundo, el chat
insertado en el sitio del cliente no podría hablarle a la API desde el
navegador del comprador (CORS lo bloquea).

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
migraciones de esquema en `database/migrations/` (9 al día de hoy) se
aplican a mano, en orden, una sola vez:

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
sed -i "s/APP_DOMAIN/app.tu-dominio.com/g; s/API_DOMAIN/api.tu-dominio.com/g" prefi.conf
cd ../../..

docker compose -f docker-compose.prod.yml --env-file .env up -d nginx
```

**Fase 2 — pedir los certificados y activar HTTPS de verdad:**

```bash
sudo certbot certonly --webroot \
  -w infrastructure/nginx/webroot \
  -d app.tu-dominio.com -d api.tu-dominio.com \
  --email tu-correo@qubit.com.co --agree-tos --no-eff-email

cd infrastructure/nginx/conf.d
cp prefi.conf.example prefi.conf
sed -i "s/APP_DOMAIN/app.tu-dominio.com/g; s/API_DOMAIN/api.tu-dominio.com/g" prefi.conf
cd ../../..

docker compose -f docker-compose.prod.yml --env-file .env restart nginx
```

Certbot instala su propio cron/systemd timer para renovar automáticamente;
solo falta que nginx recargue los certificados renovados cada tanto (basta
un `docker compose -f docker-compose.prod.yml exec nginx nginx -s reload`
mensual, o agregarlo como línea extra al hook de renovación de certbot en
`/etc/letsencrypt/renewal-hooks/deploy/`).

## 6. Verificación post-despliegue

```bash
curl -s https://api.tu-dominio.com/llm/health          # {"ok":true,...} si las keys estan bien
curl -s -o /dev/null -w "%{http_code}\n" https://app.tu-dominio.com/embed.js   # 200
```

Entra a `https://app.tu-dominio.com/admin/login` con el `OWNER_USERNAME` y
la contraseña real del paso 2, y revisa `Impacto → Diagnóstico del
sistema` (`GET /admin/owner/health`) — confirma en la UI que la base de
datos y el motor inteligente están `ok`.

## 7. Cargar el catálogo y la base de conocimiento

Con `api`/`web` ya arriba, corre el worker puntualmente (perfil `tools`,
no queda corriendo después):

```bash
docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run harvest -- --limit=30        # prueba acotada primero

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run harvest                      # catálogo completo

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run ingest-knowledge             # FAQ, garantía, envíos, etc.

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run backfill-product-embeddings  # busqueda semantica (ver docs/FIXES-2026-09-14.md)

docker compose -f docker-compose.prod.yml --env-file .env run --rm worker \
  pnpm run backfill-installments        # cuota ACR por producto (ver docs/FIXES-2026-09-14.md)
```

Corre `harvest` primero siempre — tanto `backfill-product-embeddings` como
`backfill-installments` completan datos de productos que ya deben existir
en la tabla (el primero por id, el segundo por SKU contra las categorías
ya conocidas). `backfill-installments` es seguro de repetir cuando cambien
precios/cuotas reales del sitio; `backfill-product-embeddings` solo
procesa productos que todavía no tienen embedding (200 por corrida — con
un catálogo de ~1.800 productos hacen falta varias corridas seguidas).

## 8. Generar y entregar el enlace de activación

Esto es lo único que el cliente necesita para "prender" el chat en su
sitio — un `<script>` de una línea, nada de credenciales ni configuración
de su lado.

1. Entra a `https://app.tu-dominio.com/admin` con la cuenta owner.
2. Baja hasta el panel **"Instalar el chat en tu marketplace"** — ya
   genera el snippet correcto solo con el dominio en el que estás parado
   (`app.tu-dominio.com`), por ejemplo:

   ```html
   <script src="https://app.tu-dominio.com/embed.js" defer></script>
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
   del panel: `https://app.tu-dominio.com/admin/login` — este es de uso
   interno del cliente, no se pega en ningún sitio.

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

- [ ] Los 9 archivos de `database/migrations/` aplicados sin error.
- [ ] `CORS_ORIGINS` incluye `https://prefieroacr.com` (o el dominio real
      donde se va a pegar el widget).
- [ ] `https://api.tu-dominio.com/llm/health` responde `ok:true` para
      Qwen (y DeepSeek si se configuró).
- [ ] Login de owner funciona en `https://app.tu-dominio.com/admin/login`.
- [ ] `https://app.tu-dominio.com/embed.js` responde 200 (no 404/CORS).
- [ ] Catálogo cargado (`pnpm run harvest` corrido sin `--limit`).
- [ ] Embeddings de producto generados (`backfill-product-embeddings`
      corrido hasta que reporte `processed: 0`) y cuotas completadas
      (`backfill-installments`).
- [ ] Cuenta `admin` creada para el cliente, con su contraseña entregada
      por un canal seguro (no por el mismo chat que se está activando).
- [ ] El snippet de instalación probado en una página real de prueba
      antes de pedirle al cliente que lo pegue en producción (usar
      `apps/web/public/test-embed.html` como referencia de cómo se ve).
