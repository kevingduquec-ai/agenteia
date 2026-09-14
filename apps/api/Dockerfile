# Imagen de producción de la API (NestJS). Se construye desde la RAIZ del
# monorepo (ver docs/DEPLOYMENT.md): `docker build -f apps/api/Dockerfile .`
# No usamos multi-stage con COPY --from entre etapas para simplificar el
# manejo de los workspaces de pnpm (varios `packages/*` con `workspace:*`)
# — el costo es una imagen mas pesada, aceptable para el volumen de este
# despliegue (un solo VPS, un solo cliente).
FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /repo

# Copiamos primero solo los manifiestos para que Docker cachee `pnpm install`
# mientras no cambien las dependencias, aunque cambie el código fuente.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/agent-core/package.json packages/agent-core/package.json
COPY packages/catalog/package.json packages/catalog/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/rag/package.json packages/rag/package.json
COPY packages/recommendation/package.json packages/recommendation/package.json
COPY packages/security/package.json packages/security/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build:core && pnpm --filter @prefiero-ia/api build

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
