# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN npm install -g pnpm@10.32.1 turbo@2.8.13 && npm cache clean --force
WORKDIR /app

# Stage 1: Prune monorepo for admin only
FROM base AS prepare
COPY . .
RUN turbo prune admin --docker

# Stage 2: Install dependencies + build (Vite bakes VITE_* / NEXT_PUBLIC_* at build time)
FROM base AS builder
RUN apk add --no-cache --virtual .doppler-deps curl gnupg \
    && curl -sLf --retry 3 https://cli.doppler.com/install.sh | sh \
    && apk del .doppler-deps

COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY --from=prepare /app/out/full/ .

# Prefer Doppler (DOPPLER_TOKEN_ADMIN → DOPPLER_TOKEN). Fallback build args for local builds without Doppler.
# Build ARGs are exported to RUN as env vars (so Vite sees them) without being persisted in an image.
ARG DOPPLER_TOKEN=
ARG VITE_API_URL=
ARG NEXT_PUBLIC_PWA_URL=
ARG NEXT_PUBLIC_ADMIN_URL=
ARG TURBO_TEAM
ARG TURBO_TOKEN

RUN if [ -n "$DOPPLER_TOKEN" ]; then \
      doppler run -- pnpm exec turbo build --filter=admin...; \
    else \
      pnpm exec turbo build --filter=admin...; \
    fi

# Stage 3: Production (static)
FROM nginxinc/nginx-unprivileged:1.27-alpine AS prod

COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3004/healthz || exit 1
