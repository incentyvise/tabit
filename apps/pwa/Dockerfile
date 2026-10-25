# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN npm install -g pnpm@10.32.1 turbo@2.8.13 && npm cache clean --force
WORKDIR /app

# Stage 1: Prune monorepo for pwa only
FROM base AS prepare
COPY . .
RUN turbo prune pwa --docker

# Stage 2: Install dependencies + build (Vite bakes VITE_* / NEXT_PUBLIC_* at build time)
FROM base AS builder
RUN apk add --no-cache --virtual .doppler-deps curl gnupg \
    && curl -sLf --retry 3 https://cli.doppler.com/install.sh | sh \
    && apk del .doppler-deps

COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY --from=prepare /app/out/full/ .

# Prefer Doppler (DOPPLER_TOKEN_PWA → DOPPLER_TOKEN). Fallback build args for local builds without Doppler.
# Build ARGs are exported to RUN as env vars (so Vite sees them) without being persisted in an image.
ARG DOPPLER_TOKEN=
ARG NEXT_PUBLIC_PWA_URL=
ARG VITE_API_URL=
ARG VITE_REALTIME_URL=
ARG NEXT_PUBLIC_DONATE_URL=
ARG VITE_VAPID_PUBLIC_KEY=
ARG OTEL_EXPORTER_OTLP_ENDPOINT=
ARG OTEL_EXPORTER_OTLP_HEADERS=
ARG OTEL_SERVICE_NAME=
ARG TURBO_TEAM
ARG TURBO_TOKEN

RUN if [ -n "$DOPPLER_TOKEN" ]; then \
      doppler run -- pnpm exec turbo build --filter=pwa...; \
    else \
      pnpm exec turbo build --filter=pwa...; \
    fi

# Stage 3: Production (static — no Doppler at runtime)
FROM nginxinc/nginx-unprivileged:1.27-alpine AS prod

COPY apps/pwa/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/pwa/dist /usr/share/nginx/html

# Archive of previous builds' hashed assets (mount a volume here to keep them
# across deploys). Owned by the unprivileged nginx user so the entrypoint
# script can write it.
USER root
RUN mkdir -p /var/cache/tab-assets/assets && chown -R 101:101 /var/cache/tab-assets
COPY --chmod=755 apps/pwa/docker/retain-assets.sh /docker-entrypoint.d/40-retain-assets.sh
USER 101

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3003/healthz || exit 1
