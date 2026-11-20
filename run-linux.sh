#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine and the Docker Compose plugin, then rerun this script." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Install the Docker Compose plugin." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.browser.example .env
  echo "Created .env with HTTP_PORT=3080."
fi

mkdir -p data/librechat data/mongodb uploads logs
chmod 700 data data/librechat data/mongodb
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"

echo "Building and starting LibreChat with the shared browser..."
docker compose --env-file .env -f docker-compose.browser.yml up -d --build

HTTP_PORT_VALUE="$(awk -F= '$1 == "HTTP_PORT" {gsub(/[ '\''\"]/, "", $2); print $2; exit}' .env)"
HTTP_PORT_VALUE="${HTTP_PORT_VALUE:-3080}"
echo "LibreChat: http://localhost:${HTTP_PORT_VALUE}"
echo "First user registration creates the admin account. Browser profile and uploaded files are stored under ./data and ./uploads."
echo "For remote access, use a VPN or HTTPS reverse proxy manager; don't expose the HTTP port directly to the public internet."
