#!/usr/bin/env bash
# Deploy the latest harnesstune-agent build to Mac B (Hongui-MacBookAir).
#
# Mac B is different from Mac C:
#   - Mac C: npm-installed tarball at ~/.npm-global/lib/node_modules/@harnesstune/agent
#   - Mac B: runs directly from the Dropbox-synced dist via ~/.harnesstune/bin/* wrapper
#
# So for Mac B, "deploy" means: build on Mac A, wait for Dropbox to sync the
# dist files to Mac B, verify, then optionally restart the live attach process.
#
# Usage:
#   ./scripts/deploy-macb.sh            # build + wait-for-sync + verify
#   ./scripts/deploy-macb.sh --restart  # also kill+relaunch attach (loses live TUI)

set -euo pipefail

MACB_HOST="${MACB_HOST:-10.243.69.40}"
MACB_USER="${MACB_USER:-hongkeesul}"
SSH="ssh -o ConnectTimeout=10 ${MACB_USER}@${MACB_HOST}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIST="${REPO_ROOT}/packages/harnesstune-agent/dist/cli.js"

# Path on Mac B (same as Mac A — both Dropbox-mounted at the same place)
REMOTE_AGENT_DIST='/Users/hongkeesul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune/packages/harnesstune-agent/dist/cli.js'

RESTART=0
if [[ "${1:-}" == "--restart" ]]; then
  RESTART=1
fi

echo "▶ Building on Mac A..."
( cd "${REPO_ROOT}" && pnpm run build > /dev/null )
# Use the NEWEST mtime across all dist files, not just cli.js — strategies/
# files often change without touching cli.js (incremental tsc).
LOCAL_MTIME="$(find "${REPO_ROOT}/packages/harnesstune-agent/dist" -type f -name '*.js' -exec stat -f '%m' {} \; | sort -nr | head -1)"
echo "  Local dist newest mtime: ${LOCAL_MTIME} ($(date -r "${LOCAL_MTIME}" '+%H:%M:%S'))"

echo "▶ Waiting for Dropbox to sync dist to Mac B (timeout 180s)..."
deadline=$(( $(date +%s) + 180 ))
while true; do
  REMOTE_MTIME="$(${SSH} "find '$(dirname "${REMOTE_AGENT_DIST}")' -type f -name '*.js' -exec stat -f '%m' {} \\; 2>/dev/null | sort -nr | head -1 || echo 0")"
  REMOTE_MTIME="${REMOTE_MTIME:-0}"
  if [[ "${REMOTE_MTIME}" -ge "${LOCAL_MTIME}" ]]; then
    echo "  Mac B dist synced: ${REMOTE_MTIME} ($(date -r "${REMOTE_MTIME}" '+%H:%M:%S'))"
    break
  fi
  if [[ $(date +%s) -gt ${deadline} ]]; then
    echo "  ✘ Dropbox sync timeout. Mac B mtime ${REMOTE_MTIME} < local ${LOCAL_MTIME}."
    echo "    Check that Dropbox is running on Mac B and not paused."
    exit 1
  fi
  sleep 3
done

if [[ "${RESTART}" -eq 1 ]]; then
  echo "▶ Killing existing attach + claude processes on Mac B..."
  # The wrapper script execs `node .../cli.js attach`, so the visible process
  # name is `node` not `harnesstune-agent`. Match against the cli.js path.
  ${SSH} 'pkill -f "harnesstune-agent/dist/cli.js attach" 2>/dev/null; sleep 1; pkill -f "claude.*--permission-mode.*bypassPermissions" 2>/dev/null; sleep 1; echo done'
  echo "▶ Relaunching attach in background on Mac B..."
  # Non-interactive ssh has a bare PATH; need nvm + brew dirs so `claude` resolves.
  ${SSH} 'cd ~/.harnesstune-agent && export PATH="$HOME/.nvm/versions/node/v20.20.1/bin:/opt/homebrew/bin:$PATH" && nohup ~/.harnesstune/bin/harnesstune-agent attach -- claude > attach-bg.log 2>&1 &'
  sleep 3
  echo "▶ Verifying new attach process..."
  ${SSH} 'ps -eo pid,lstart,command | grep -E "cli.js attach" | grep -v grep | head -2; echo "--- attach-bg.log ---"; tail -10 ~/.harnesstune-agent/attach-bg.log' || true
else
  echo ""
  echo "✔ Build synced. To pick up the new code, on Mac B:"
  echo "    1. In your attach terminal: Ctrl-] to detach"
  echo "    2. Ctrl-C inside claude to kill it"
  echo "    3. ~/.harnesstune/bin/harnesstune-agent attach -- claude"
  echo ""
  echo "  Or re-run this script with --restart to do it automatically (loses live TUI)."
fi
