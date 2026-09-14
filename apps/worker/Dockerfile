# Imagen del worker (crawler / ingesta de conocimiento / embeddings).
# `apps/worker/src/index.ts` es hoy un placeholder (no hay un consumidor
# BullMQ corriendo 24/7 todavia) — esta imagen sirve para correr los
# comandos puntuales bajo demanda (ver docs/DEPLOYMENT.md):
#
#   docker compose run --rm worker pnpm run harvest
#   docker compose run --rm worker pnpm run ingest-knowledge
#   docker compose run --rm worker pnpm run backfill-product-embeddings
#
# Cuando exista un consumidor BullMQ real de larga duracion, cambiar el
# CMD de abajo a `node apps/worker/dist/index.js` y correrlo como servicio
# normal en el compose en vez de con `run --rm`.
FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /repo

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

RUN pnpm run build:database && pnpm run build:llm

ENV NODE_ENV=production
CMD ["node", "-e", "console.log('Usa: docker compose run --rm worker pnpm run <harvest|ingest-knowledge|backfill-product-embeddings>')"]
