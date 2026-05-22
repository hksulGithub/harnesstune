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
  node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';

const dbPath = process.env.UAT_DB_PATH;
if (!dbPath) throw new Error('UAT_DB_PATH is required');

const client = createClient({ url: `file:${dbPath}` });
const now = Date.now();
const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
// Drizzle's `mode: 'timestamp'` columns store Unix seconds, so seed inserts must use seconds.
const ms = (offsetMs) => Math.floor((now + offsetMs) / 1000);
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function exec(sql, args = []) {
  await client.execute({ sql, args });
}

await exec(`CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
await exec(`CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  token_hash TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL
)`);
await exec(`CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  agent_id TEXT,
  created_at INTEGER NOT NULL
)`);
await exec(`CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  direction TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
await exec(`CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  agent_id TEXT NOT NULL,
  name TEXT,
  platform TEXT NOT NULL,
  schedule TEXT,
  last_run_at INTEGER,
  status TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL
)`);
await exec(`CREATE UNIQUE INDEX IF NOT EXISTS agents_channel_agent_uniq ON agents(channel_id, agent_id)`);
await exec(`CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  agent_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  log_excerpt TEXT,
  error_summary TEXT,
  token_usage TEXT,
  cost_cents INTEGER
)`);
await exec(`CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_channel_agent_started_uniq ON agent_runs(channel_id, agent_id, started_at)`);
await exec(`CREATE TABLE IF NOT EXISTS rate_limits (
  token_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (token_id, window_start)
)`);

const channels = ['ws-populated', 'ws-empty'];
const tokenIds = ['token-ws-populated', 'token-ws-empty'];
for (const tokenId of tokenIds) await exec('DELETE FROM rate_limits WHERE token_id = ?', [tokenId]);
for (const channelId of channels) {
  await exec('DELETE FROM agent_runs WHERE channel_id = ?', [channelId]);
  await exec('DELETE FROM reports WHERE channel_id = ?', [channelId]);
  await exec('DELETE FROM messages WHERE channel_id = ?', [channelId]);
  await exec('DELETE FROM agents WHERE channel_id = ?', [channelId]);
  await exec('DELETE FROM tokens WHERE channel_id = ?', [channelId]);
  await exec('DELETE FROM channels WHERE id = ?', [channelId]);
}

await exec('INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?)', ['ws-populated', 'ws-populated', ms(-7 * 86400000)]);
await exec('INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?)', ['ws-empty', 'ws-empty', ms(-7 * 86400000)]);
await exec('INSERT INTO tokens (id, channel_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)', [
  'token-ws-populated', 'ws-populated', hash(process.env.UAT_POPULATED_TOKEN), 'ws-populated UAT token', ms(-7 * 86400000),
]);
await exec('INSERT INTO tokens (id, channel_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)', [
  'token-ws-empty', 'ws-empty', hash(process.env.UAT_EMPTY_TOKEN), 'ws-empty UAT token', ms(-7 * 86400000),
]);

const agents = [
  ['agent-row-fresh', 'agent-fresh', 'Fresh agent', 'running', '*/5 * * * *', ms(-45_000)],
  ['agent-row-stale', 'agent-stale', 'Stale agent', 'idle', '*/15 * * * *', ms(-30 * 3600000)],
  ['agent-row-failing', 'agent-failing', 'Failing agent', 'error', '*/10 * * * *', ms(-20 * 60000)],
];
for (const agent of agents) {
  await exec(`INSERT INTO agents
    (id, channel_id, agent_id, name, platform, schedule, last_run_at, status, created_at)
    VALUES (?, 'ws-populated', ?, ?, 'claude-code', ?, ?, ?, ?)`, [
      agent[0], agent[1], agent[2], agent[4], agent[5], agent[3], ms(-7 * 86400000),
    ]);
}

const runRows = [
  ['run-fresh-1', 'agent-fresh', -45 * 60_000, -44 * 60_000, 'success', 60_000, 'Fresh run completed normally.', null, { inputTokens: 1800, outputTokens: 600 }, 11],
  ['run-fresh-2', 'agent-fresh', -26 * 3600_000, -26 * 3600_000 + 90_000, 'success', 90_000, 'Daily maintenance run completed.', null, { inputTokens: 2200, outputTokens: 800 }, 14],
  ['run-fresh-3', 'agent-fresh', -5 * 86400_000, -5 * 86400_000 + 75_000, 'success', 75_000, 'Weekly reconciliation completed.', null, { inputTokens: 2500, outputTokens: 900 }, 16],
  ['run-stale-1', 'agent-stale', -30 * 3600_000, -30 * 3600_000 + 120_000, 'success', 120_000, 'Last stale-agent run completed before missing schedule.', null, { inputTokens: 1200, outputTokens: 400 }, 9],
  ['run-stale-2', 'agent-stale', -3 * 86400_000, -3 * 86400_000 + 110_000, 'success', 110_000, 'Historical stale-agent run completed.', null, { inputTokens: 1300, outputTokens: 450 }, 10],
  ['run-stale-3', 'agent-stale', -6 * 86400_000, -6 * 86400_000 + 100_000, 'success', 100_000, 'Older stale-agent run completed.', null, { inputTokens: 1100, outputTokens: 350 }, 8],
  ['run-failing-1', 'agent-failing', -20 * 60_000, -19 * 60_000, 'failure', 60_000, 'Command exited with code 1.', 'Recent failing run 1 of 3.', { inputTokens: 320000, outputTokens: 85000 }, 240],
  ['run-failing-2', 'agent-failing', -2 * 3600_000, -2 * 3600_000 + 70_000, 'failure', 70_000, 'Command exited with code 1.', 'Recent failing run 2 of 3.', { inputTokens: 280000, outputTokens: 70000 }, 210],
  ['run-failing-3', 'agent-failing', -5 * 3600_000, -5 * 3600_000 + 80_000, 'failure', 80_000, 'Command exited with code 1.', 'Recent failing run 3 of 3.', { inputTokens: 260000, outputTokens: 65000 }, 190],
];
for (const row of runRows) {
  await exec(`INSERT INTO agent_runs
    (id, channel_id, agent_id, started_at, finished_at, status, duration_ms, log_excerpt, error_summary, token_usage, cost_cents)
    VALUES (?, 'ws-populated', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      row[0], row[1], ms(row[2]), ms(row[3]), row[4], row[5], row[6], row[7], JSON.stringify(row[8]), row[9],
    ]);
}

const reports = [
  ['report-token-usage', 'alert', 'agent-failing', {
    kind: 'token-usage',
    agentId: 'agent-failing',
    message: 'Token usage exceeded UAT threshold.',
    inputTokens: 320000,
    outputTokens: 85000,
  }],
  ['report-stale-agent', 'alert', 'agent-stale', {
    kind: 'stale-agent',
    agentId: 'agent-stale',
    message: 'No heartbeat or run within the stale-agent threshold.',
    lastRunAt: iso(-30 * 3600_000),
  }],
  ['report-heartbeat', 'heartbeat', 'agent-fresh', {
    status: 'connected',
    generatedAt: iso(-45_000),
  }],
];
for (const report of reports) {
  await exec('INSERT INTO reports (id, channel_id, type, body, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    report[0], 'ws-populated', report[1], JSON.stringify(report[3]), report[2], ms(-60_000),
  ]);
}

await client.close();
NODE
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
