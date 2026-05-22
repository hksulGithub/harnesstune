#!/usr/bin/env bash
#
# install-collector.sh — one-shot HarnessTune collector installer for a Mac.
#
# What it does:
#   1. Verify Node 20+ and pnpm are available (installs pnpm via corepack).
#   2. pnpm install + build the collector package (idempotent).
#   3. Register a channel with the relay (POST /api/channels) — gets channelId+token.
#   4. Write ~/.harnesstune/collector.json with paperclip enabled (if flags supplied).
#   5. Symlink a `harnesstune-collector` shim into ~/.harnesstune/bin/.
#   6. Install + load the launchd plist (auto-start on login).
#
# Usage:
#   bash install-collector.sh \
#     [--relay-url <url>] \
#     [--name <machine-name>] \
#     [--paperclip-server-url <url>] \
#     [--paperclip-api-key <key>] \
#     [--paperclip-company-id <cid>] \
#     [--skip-launchd] \
#     [--skip-paperclip]
#
# Flags can also come from env vars: HARNESSTUNE_RELAY_URL, HARNESSTUNE_MACHINE_NAME,
# HARNESSTUNE_PAPERCLIP_SERVER_URL, HARNESSTUNE_PAPERCLIP_API_KEY,
# HARNESSTUNE_PAPERCLIP_COMPANY_ID.
#
# If a paperclip value is missing and stdin is a TTY, you'll be prompted once.
# If stdin is not a TTY (CI, ssh -T) and a required value is missing, the script
# exits 2 with the missing flag name.

set -euo pipefail

# --- locate repo root (script is in repo/scripts/) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- defaults ---
RELAY_URL="${HARNESSTUNE_RELAY_URL:-http://192.168.0.111:8787}"
MACHINE_NAME="${HARNESSTUNE_MACHINE_NAME:-$(hostname -s)}"
PAPERCLIP_SERVER_URL="${HARNESSTUNE_PAPERCLIP_SERVER_URL:-http://localhost:3100}"
PAPERCLIP_API_KEY="${HARNESSTUNE_PAPERCLIP_API_KEY:-}"
PAPERCLIP_COMPANY_ID="${HARNESSTUNE_PAPERCLIP_COMPANY_ID:-}"
SKIP_LAUNCHD=0
SKIP_PAPERCLIP=0

# --- arg parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --relay-url) RELAY_URL="$2"; shift 2 ;;
    --name) MACHINE_NAME="$2"; shift 2 ;;
    --paperclip-server-url) PAPERCLIP_SERVER_URL="$2"; shift 2 ;;
    --paperclip-api-key) PAPERCLIP_API_KEY="$2"; shift 2 ;;
    --paperclip-company-id) PAPERCLIP_COMPANY_ID="$2"; shift 2 ;;
    --skip-launchd) SKIP_LAUNCHD=1; shift ;;
    --skip-paperclip) SKIP_PAPERCLIP=1; shift ;;
    -h|--help)
      sed -n '1,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

# --- 1. Node check ---
step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found on PATH."
  echo "  Install with: brew install node   (or download from https://nodejs.org)" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  err "Node $(node -v) found; HarnessTune requires Node 20+."
  exit 1
fi
echo "Node $(node -v) OK"

# --- 2. pnpm check (corepack) ---
step "Checking pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found; enabling via corepack..."
  if ! corepack enable 2>/dev/null; then
    err "corepack enable failed. Install pnpm manually: npm i -g pnpm"
    exit 1
  fi
  corepack prepare pnpm@latest --activate 2>/dev/null || true
fi
echo "pnpm $(pnpm -v) OK"

# --- 3. paperclip credentials (interactive fallback) ---
prompt_if_tty() {
  local var_name="$1" prompt_text="$2" silent="${3:-0}"
  local current_val="${!var_name}"
  if [[ -n "$current_val" ]]; then return 0; fi
  if [[ ! -t 0 ]]; then
    err "$var_name is required (no TTY for prompt). Pass it as a flag or env var."
    exit 2
  fi
  if [[ "$silent" == "1" ]]; then
    read -r -s -p "$prompt_text" val; echo
  else
    read -r -p "$prompt_text" val
  fi
  printf -v "$var_name" '%s' "$val"
}

if [[ "$SKIP_PAPERCLIP" == "0" ]]; then
  step "Paperclip credentials"
  prompt_if_tty PAPERCLIP_API_KEY "Paperclip Board API Key (blank to skip): " 1
  if [[ -z "$PAPERCLIP_API_KEY" ]]; then
    echo "No API key supplied — skipping Paperclip setup."
    SKIP_PAPERCLIP=1
  else
    prompt_if_tty PAPERCLIP_COMPANY_ID "Paperclip companyId (blank to auto-pick if only one): "
  fi
fi

# --- 4. install + build ---
step "Installing dependencies (pnpm install)"
cd "$REPO_ROOT"
pnpm install --silent

step "Building @harnesstune/shared and @harnesstune/collector"
pnpm --filter @harnesstune/shared build
pnpm --filter @harnesstune/collector build

COLLECTOR_CLI="$REPO_ROOT/packages/harnesstune-collector/dist/cli.js"
if [[ ! -f "$COLLECTOR_CLI" ]]; then
  err "Build did not produce $COLLECTOR_CLI"
  exit 1
fi

# --- 5. shim into ~/.harnesstune/bin/harnesstune-collector ---
BIN_DIR="$HOME/.harnesstune/bin"
mkdir -p "$BIN_DIR"
SHIM="$BIN_DIR/harnesstune-collector"
cat > "$SHIM" <<EOF
#!/usr/bin/env bash
exec "$(command -v node)" "$COLLECTOR_CLI" "\$@"
EOF
chmod +x "$SHIM"
echo "Shim installed: $SHIM"

# --- 6. register channel with relay ---
step "Registering machine with relay at $RELAY_URL"
REGISTER_PAYLOAD=$(node -e 'process.stdout.write(JSON.stringify({name: process.argv[1]}))' "$MACHINE_NAME")
REGISTER_RESPONSE=$(curl -sS -X POST "$RELAY_URL/api/channels" \
  -H 'Content-Type: application/json' \
  -d "$REGISTER_PAYLOAD") || {
    err "Channel registration request failed. Is the relay reachable at $RELAY_URL?"
    exit 1
  }

# Parse channelId + token from response (no jq dependency)
CHANNEL_ID=$(node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const j=JSON.parse(s); if(!j.channelId) throw new Error("no channelId");
      process.stdout.write(j.channelId);
    } catch(e){ process.stderr.write("parse error: "+e.message+"\nresponse: "+s); process.exit(1); }
  });' <<< "$REGISTER_RESPONSE")
TOKEN=$(node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const j=JSON.parse(s); process.stdout.write(j.token); }
    catch(e){ process.exit(1); }
  });' <<< "$REGISTER_RESPONSE")

if [[ -z "$CHANNEL_ID" || -z "$TOKEN" ]]; then
  err "Could not parse channelId/token from relay response:"
  echo "$REGISTER_RESPONSE" >&2
  exit 1
fi
echo "Registered channel: $CHANNEL_ID"

# --- 7. compose collector.json ---
step "Writing ~/.harnesstune/collector.json"
CONFIG_FILE="$HOME/.harnesstune/collector.json"
mkdir -p "$HOME/.harnesstune"

# If paperclip-company-id missing, try auto-pick by hitting the paperclip API.
if [[ "$SKIP_PAPERCLIP" == "0" && -z "$PAPERCLIP_COMPANY_ID" ]]; then
  echo "Looking up companies on $PAPERCLIP_SERVER_URL ..."
  COMPANIES_RAW=$(curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_SERVER_URL/api/companies" || true)
  PAPERCLIP_COMPANY_ID=$(node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const j=JSON.parse(s);
        const arr = Array.isArray(j) ? j : (j.companies ?? j.data ?? []);
        if (arr.length === 1) { process.stdout.write(arr[0].id); return; }
        process.stderr.write("found "+arr.length+" companies; specify --paperclip-company-id\n");
        for (const c of arr) process.stderr.write("  "+c.id+"  "+(c.name||"")+"\n");
      } catch(e){ process.stderr.write("could not parse /api/companies response\n"); }
    });' <<< "$COMPANIES_RAW" || true)
  if [[ -z "$PAPERCLIP_COMPANY_ID" ]]; then
    err "Could not auto-pick companyId. Re-run with --paperclip-company-id <cid>."
    exit 1
  fi
  echo "Auto-picked companyId: $PAPERCLIP_COMPANY_ID"
fi

# Build platforms array via node so JSON is well-formed.
PLATFORMS_JSON=$(node -e '
  const enabled = process.argv[1] === "1";
  const platforms = [
    { id: "paperclip", enabled,
      config: enabled ? {
        serverUrl: process.argv[2],
        apiKey: process.argv[3],
        companyId: process.argv[4],
      } : {} },
    { id: "claude-desktop", enabled: false, config: {} },
    { id: "claude-code", enabled: false, config: {} },
    { id: "openclaw", enabled: false, config: {} },
  ];
  process.stdout.write(JSON.stringify(platforms));
' "$([[ "$SKIP_PAPERCLIP" == "0" ]] && echo 1 || echo 0)" \
  "$PAPERCLIP_SERVER_URL" "$PAPERCLIP_API_KEY" "$PAPERCLIP_COMPANY_ID")

node -e '
  const fs = require("node:fs");
  const cfg = {
    relayUrl: process.argv[1],
    channelId: process.argv[2],
    token: process.argv[3],
    pollInterval: 60000,
    heartbeatInterval: 300000,
    platforms: JSON.parse(process.argv[4]),
  };
  fs.writeFileSync(process.argv[5], JSON.stringify(cfg, null, 2));
  fs.chmodSync(process.argv[5], 0o600);
' "$RELAY_URL" "$CHANNEL_ID" "$TOKEN" "$PLATFORMS_JSON" "$CONFIG_FILE"
echo "Config written: $CONFIG_FILE (chmod 600)"

# --- 8. launchd install ---
if [[ "$SKIP_LAUNCHD" == "1" ]]; then
  step "Skipping launchd (per --skip-launchd)"
  echo "Start manually: $SHIM start"
else
  step "Installing launchd plist (auto-start on login)"
  "$SHIM" install
  # `install` registers + starts on next login. Kick it off now too.
  if command -v launchctl >/dev/null 2>&1; then
    launchctl start com.harnesstune.collector 2>/dev/null || true
  fi
fi

# --- summary ---
cat <<EOF

================================================================
  HarnessTune collector installed.
  Channel ID:  $CHANNEL_ID
  Token:       (saved to $CONFIG_FILE — chmod 600)
  Relay:       $RELAY_URL
  Machine:     $MACHINE_NAME
================================================================

Next: in VSCode on your client Mac, "HarnessTune: Add Remote Workspace"
  Relay URL:  $RELAY_URL
  Channel ID: $CHANNEL_ID
  Token:      (read it from $CONFIG_FILE on this machine)

Inspect:
  cat $CONFIG_FILE
  $SHIM status
  tail -f ~/.harnesstune/collector.log
EOF
