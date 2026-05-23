#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELAY_DIR="$ROOT_DIR/packages/harnesstune-relay"
DATA_DIR="$ROOT_DIR/.uat-tmp"
DB_PATH="$DATA_DIR/uat-relay.db"
PID_FILE="$DATA_DIR/relay.pid"
LOG_FILE="$DATA_DIR/relay.log"
HOST="${HARNESSTUNE_UAT_HOST:-127.0.0.1}"
PORT="${HARNESSTUNE_UAT_PORT:-8787}"
RELAY_URL="http://$HOST:$PORT/api"
POPULATED_TOKEN="uat-token-ws-populated"
EMPTY_TOKEN="uat-token-ws-empty"

mkdir -p "$DATA_DIR"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid"
    for _ in $(seq 1 30); do
      if ! kill -0 "$old_pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
  fi
  rm -f "$PID_FILE"
fi

if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use by a process not started by this script." >&2
  echo "Set HARNESSTUNE_UAT_PORT to another port and re-run." >&2
  exit 1
fi

pnpm --dir "$RELAY_DIR" run build >/dev/null

(
  cd "$RELAY_DIR"
  UAT_DB_PATH="$DB_PATH" \
  UAT_POPULATED_TOKEN="$POPULATED_TOKEN" \
  UAT_EMPTY_TOKEN="$EMPTY_TOKEN" \
  node ./seed-payload.mjs
)

(
  cd "$RELAY_DIR"
  TURSO_DATABASE_URL="file:$DB_PATH" \
  TURSO_AUTH_TOKEN="" \
  HOST="$HOST" \
  PORT="$PORT" \
  node local-server.mjs >"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
)

for _ in $(seq 1 50); do
  if curl -fsS "http://$HOST:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if ! curl -fsS "http://$HOST:$PORT/api/health" >/dev/null 2>&1; then
  echo "Relay failed to start. See $LOG_FILE" >&2
  exit 1
fi

cat <<EOF
HarnessTune local UAT relay is running.

Relay URL: $RELAY_URL

Add these remote workspaces from VS Code:
- ws-populated token: $POPULATED_TOKEN
- ws-empty token: $EMPTY_TOKEN

Re-run this script to reset the same fixture data.
Relay log: $LOG_FILE
PID file: $PID_FILE
EOF
