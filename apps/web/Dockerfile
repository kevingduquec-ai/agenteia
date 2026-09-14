# Imagen de producción del frontend (Next.js). Se construye desde la RAIZ
# del monorepo (ver docs/DEPLOYMENT.md): `docker build -f apps/web/Dockerfile .`
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

# NEXT_PUBLIC_* se hornea en el bundle en build time — hay que pasarlo como
# build-arg (ver docker-compose.prod.yml), no solo como variable de entorno
# en tiempo de ejecucion, o el frontend seguira apuntando a localhost.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter @prefiero-ia/web build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "@prefiero-ia/web", "start"]
