FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

FROM base AS build-deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --filter @vibe-idx/web... --frozen-lockfile

COPY apps/web apps/web

RUN pnpm --filter @vibe-idx/web build

FROM base AS prod-deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --filter @vibe-idx/web... --prod --frozen-lockfile \
  && rm -rf /pnpm/store

FROM node:24-bookworm-slim AS app

ENV NODE_ENV=production

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/web/package.json apps/web/package.json
COPY --from=prod-deps /app/apps/web/node_modules apps/web/node_modules
COPY --from=build-deps /app/apps/web/build apps/web/build
COPY --from=build-deps /app/apps/web/dist apps/web/dist

EXPOSE 8080

CMD ["node", "apps/web/build/server/http.js"]
