#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

for command in Xvfb x11vnc websockify python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing $command. On Debian/Ubuntu run: sudo apt update && sudo apt install -y xvfb x11vnc novnc websockify python3 python3-venv python3-pip chromium chromium-driver" >&2
    exit 1
  fi
done

NOVNC_WEB="${NOVNC_WEB:-/usr/share/novnc}"
if [[ ! -f "$NOVNC_WEB/vnc.html" ]]; then
  echo "Could not find noVNC at $NOVNC_WEB. Set NOVNC_WEB to the directory containing vnc.html." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Fill in your Telegram and AI provider settings, then run this script again." >&2
  exit 1
fi

mkdir -p data
if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

export DISPLAY="${DISPLAY:-:99}"
export BROWSER_USE_CHROMIUM_PATH="${BROWSER_USE_CHROMIUM_PATH:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}"
if [[ -z "$BROWSER_USE_CHROMIUM_PATH" ]]; then
  echo "Install Chromium (for example: sudo apt install chromium) or set BROWSER_USE_CHROMIUM_PATH." >&2
  exit 1
fi

cleanup() {
  for pid in "${BOT_PID:-}" "${NOVNC_PID:-}" "${VNC_PID:-}" "${XVFB_PID:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

Xvfb "$DISPLAY" -screen 0 "${SCREEN_SIZE:-1440x900x24}" -ac +extension RANDR >/tmp/browser-bot-xvfb.log 2>&1 &
XVFB_PID=$!
for _ in {1..40}; do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then echo "Xvfb failed; see /tmp/browser-bot-xvfb.log" >&2; exit 1; fi

# noVNC is intentionally bound to loopback. Reach it through SSH forwarding.
x11vnc -display "$DISPLAY" -localhost -forever -shared -nopw -rfbport 5900 >/tmp/browser-bot-vnc.log 2>&1 &
VNC_PID=$!
websockify --web="$NOVNC_WEB" 127.0.0.1 "${NOVNC_PORT:-6080}" 127.0.0.1:5900 >/tmp/browser-bot-novnc.log 2>&1 &
NOVNC_PID=$!

echo "Virtual desktop ready. On Windows run: ssh -N -L 6080:127.0.0.1:${NOVNC_PORT:-6080} USER@LINUX_HOST"
echo "Then open http://127.0.0.1:6080/vnc.html in Windows. Keep the SSH window open."
echo "Starting Telegram browser bot..."
.venv/bin/python bot.py &
BOT_PID=$!
wait "$BOT_PID"
