#!/usr/bin/env sh
set -eu

cd /app

# Keep dependencies in the named Docker volume. Install only on first startup,
# or after that volume is deliberately removed.
if [ ! -x node_modules/.bin/nodemon ] || [ ! -x node_modules/.bin/vite ]; then
  npm ci --no-audit
fi

# Build workspace packages once at startup. The app and client then reload from
# the mounted source tree without rebuilding the Docker image.
npm run build:packages

npm run backend:dev &
backend_pid=$!
cd /app/client
npm run dev -- --host 0.0.0.0 --port 3090 &
frontend_pid=$!

cleanup() {
  kill "$frontend_pid" 2>/dev/null || true
  kill "$backend_pid" 2>/dev/null || true
  wait "$frontend_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$frontend_pid"
