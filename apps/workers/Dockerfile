# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI=true
RUN npm install -g pnpm@10.32.1 turbo@2.8.13 && npm cache clean --force
WORKDIR /app

# Doppler CLI only (curl/gnupg are dropped after install)
FROM base AS doppler
RUN apk add --no-cache --virtual .doppler-deps curl gnupg \
    && curl -sLf --retry 3 https://cli.doppler.com/install.sh | sh \
    && apk del .doppler-deps

# Stage 1: Prune monorepo for workers only
FROM base AS prepare
COPY . .
RUN turbo prune workers --docker

# Stage 2: Install + build, then drop devDependencies
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY --from=prepare /app/out/full/ .

# ARGs are visible to RUN as env vars without being persisted into the image config
ARG TURBO_TEAM
ARG TURBO_TOKEN
RUN pnpm exec turbo build --filter=workers...

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --offline --store-dir /pnpm/store \
      --config.confirmModulesPurge=false

# Stage 3: Production
FROM node:26-alpine AS prod
RUN apk add --no-cache tini
COPY --from=doppler /usr/local/bin/doppler /usr/local/bin/doppler
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages

USER node
WORKDIR /app/apps/workers
EXPOSE 3002

# Doppler only when a service token is provided; otherwise plain container env.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "if [ -n \"$DOPPLER_TOKEN\" ]; then exec doppler run -- node dist/index.js; else exec node dist/index.js; fi"]
