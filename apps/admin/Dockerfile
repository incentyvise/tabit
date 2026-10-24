# Stage 1: Prepare - prune monorepo for admin only
FROM node:26-alpine AS prepare
RUN npm install -g pnpm@10.32.1
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

RUN pnpm add -g turbo@^2

COPY . .
RUN turbo prune admin --docker

# Stage 2: Install dependencies + build (Vite bakes VITE_* / NEXT_PUBLIC_* at build time)
FROM node:26-alpine AS builder
RUN apk add --no-cache curl gnupg \
    && curl -sLf --retry 3 https://cli.doppler.com/install.sh | sh
RUN npm install -g pnpm@10.32.1
WORKDIR /app

COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=prepare /app/out/full/ .

# Prefer Doppler (DOPPLER_TOKEN_ADMIN → DOPPLER_TOKEN). Fallback build args for local builds without Doppler.
ARG DOPPLER_TOKEN=
ARG VITE_API_URL=
ARG NEXT_PUBLIC_PWA_URL=
ARG NEXT_PUBLIC_ADMIN_URL=
ARG TURBO_TEAM
ARG TURBO_TOKEN

ENV VITE_API_URL=$VITE_API_URL
ENV NEXT_PUBLIC_PWA_URL=$NEXT_PUBLIC_PWA_URL
ENV NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
ENV TURBO_TEAM=$TURBO_TEAM
ENV TURBO_TOKEN=$TURBO_TOKEN
ENV DOPPLER_TOKEN=$DOPPLER_TOKEN

RUN if [ -n "$DOPPLER_TOKEN" ]; then \
      doppler run -- pnpm exec turbo build --filter=admin...; \
    else \
      pnpm exec turbo build --filter=admin...; \
    fi

# Stage 3: Production (static)
FROM nginx:1.27-alpine AS prod
WORKDIR /usr/share/nginx/html

COPY --from=builder /app/apps/admin/dist .
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3004

CMD ["nginx", "-g", "daemon off;"]
