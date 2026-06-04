# syntax=docker/dockerfile:1
#
# Single-image Suinami deploy: builds the web SPA, then runs the Hono API which
# ALSO serves that SPA (one URL for judges). The indexer rebuilds the feed from
# chain on boot, so no persistent volume is required.

# ---------- base ----------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ---------- deps (cached on manifests) ----------
FROM base AS deps
# build toolchain for better-sqlite3's native binding
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/web/package.json   apps/web/package.json
COPY apps/api/package.json   apps/api/package.json
COPY packages/shared/package.json    packages/shared/package.json
COPY packages/sui/package.json       packages/sui/package.json
COPY packages/walrus/package.json    packages/walrus/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/ui/package.json        packages/ui/package.json
RUN pnpm install --frozen-lockfile

# ---------- build the web SPA ----------
FROM deps AS build
COPY . .
# Vite bakes VITE_* at build time. The Tatum key is client-exposed by design for
# the demo (a read-scoped gateway key); the production path is an API read-proxy.
ARG VITE_SUI_NETWORK=mainnet
ARG VITE_SUI_RPC_URL
ARG VITE_TATUM_API_KEY
ARG VITE_WALRUS_AGGREGATOR_URL
ARG VITE_SUINAMI_PACKAGE_ID
ARG VITE_SUINAMI_FEED_OBJECT_ID
ARG VITE_API_BASE_URL=
ENV VITE_SUI_NETWORK=$VITE_SUI_NETWORK \
    VITE_SUI_RPC_URL=$VITE_SUI_RPC_URL \
    VITE_TATUM_API_KEY=$VITE_TATUM_API_KEY \
    VITE_WALRUS_AGGREGATOR_URL=$VITE_WALRUS_AGGREGATOR_URL \
    VITE_SUINAMI_PACKAGE_ID=$VITE_SUINAMI_PACKAGE_ID \
    VITE_SUINAMI_FEED_OBJECT_ID=$VITE_SUINAMI_FEED_OBJECT_ID \
    VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @suinami/web build
# Host the built SPA from the API process.
RUN cp -r apps/web/dist apps/api/public

# ---------- runner ----------
FROM base AS runner
ENV NODE_ENV=production
# The whole workspace + node_modules (source-first packages run via tsx at runtime).
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 8080
# `pnpm start` => `tsx src/index.ts`; cwd=/app/apps/api so it finds ./public + the db.
CMD ["pnpm", "start"]
