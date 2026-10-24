#!/bin/sh
set -e

# Run through Doppler only when a service token is provided; otherwise use the
# plain container env (compose passes DATABASE_URL etc. directly).
with_env() {
  if [ -n "$DOPPLER_TOKEN" ]; then
    doppler run -- "$@"
  else
    "$@"
  fi
}

(cd /app/packages/db && with_env ./node_modules/.bin/drizzle-kit migrate)

cd /app/apps/api
if [ -n "$DOPPLER_TOKEN" ]; then
  exec doppler run -- node dist/index.js
fi
exec node dist/index.js
