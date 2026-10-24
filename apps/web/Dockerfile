# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.32.1 turbo@2.8.13 && npm cache clean --force
WORKDIR /app

# Stage 1: Prune monorepo for web only
FROM base AS prepare
COPY . .
RUN turbo prune web --docker

# Stage 2: Install + build, then drop devDependencies
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY --from=prepare /app/out/full/ .

# Build ARGs are exported to RUN as env vars (so Next sees them) without being persisted in an image.
ARG VITE_BACKEND_URL=
ARG NEXT_PUBLIC_WEB_URL=
ARG NEXT_PUBLIC_PWA_URL=
ARG NEXT_PUBLIC_DONATE_URL=
ARG NEXT_PUBLIC_RYBBIT_SCRIPT_URL=
ARG NEXT_PUBLIC_WEB_RYBBIT_SITE_ID=
ARG OTEL_EXPORTER_OTLP_ENDPOINT=
ARG OTEL_EXPORTER_OTLP_HEADERS=
ARG OTEL_SERVICE_NAME=
ARG TURBO_TEAM
ARG TURBO_TOKEN

# The root `build` script excludes web (`--filter=!web`), so build it explicitly.
RUN pnpm exec turbo build --filter=web...

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --offline --store-dir /pnpm/store \
      --config.confirmModulesPurge=false

# Stage 3: Production
FROM node:26-alpine AS prod
RUN apk add --no-cache tini
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages

USER node
WORKDIR /app/apps/web
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node_modules/.bin/next", "start"]
