# Stage 1: Prepare - prune monorepo for api only
FROM node:26-alpine AS prepare
RUN npm install -g pnpm@10.32.1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN pnpm add -g turbo@^2

COPY . .
RUN turbo prune api --docker

# Stage 2: Install dependencies
FROM node:26-alpine AS builder
RUN npm install -g pnpm@10.32.1
WORKDIR /app

COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=prepare /app/out/full/ .

ARG TURBO_TEAM
ARG TURBO_TOKEN
ENV TURBO_TEAM=$TURBO_TEAM
ENV TURBO_TOKEN=$TURBO_TOKEN

RUN pnpm exec turbo build --filter=api...

# Stage 3: Production
FROM node:26-alpine AS prod
RUN apk add --no-cache curl gnupg \
    && curl -sLf --retry 3 https://cli.doppler.com/install.sh | sh
RUN npm install -g pnpm@10.32.1
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/turbo.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages

COPY --from=builder /app/apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
