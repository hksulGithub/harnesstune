#!/usr/bin/env bash
# Deploy the latest harnesstune-agent tarball to Mac C over SSH.
#
# Usage:
#   ./scripts/deploy-macc.sh            # build + scp + install (no restart)
#   ./scripts/deploy-macc.sh --restart  # also kill old attach and relaunch detached
#
# Assumes:
#   - Mac C reachable at $MACC_HOST (override env var; default 10.243.61.134)
#   - Public-key auth set up (no password prompts)
#   - User on Mac C is hongkeesul
#   - harnesstune-agent already installed globally on Mac C (initial install
#     was manual via npm install -g)

set -euo pipefail

MACC_HOST="${MACC_HOST:-10.243.61.134}"
MACC_USER="${MACC_USER:-hongkeesul}"
SSH="ssh -o ConnectTimeout=10 ${MACC_USER}@${MACC_HOST}"
# Non-interactive ssh doesn't load .zshrc, so brew/npm aren't on PATH.
# Prepend the paths Mac C uses for global npm packages and homebrew node.
REMOTE_PATH='export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/opt/node@20/bin:/usr/local/Cellar/node@20/20.20.2/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"; export NODE_EXTRA_CA_CERTS="$HOME/system-roots.pem";'
SCP="scp -o ConnectTimeout=10"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="${REPO_ROOT}/packages/harnesstune-agent"
TGZ="${AGENT_DIR}/harnesstune-agent-0.0.1.tgz"

RESTART=0
if [[ "${1:-}" == "--restart" ]]; then
  RESTART=1
fi

echo "▶ Building agent + repacking tarball..."
( cd "${REPO_ROOT}" && pnpm run build > /dev/null )
( cd "${AGENT_DIR}" && rm -f harnesstune-agent-*.tgz && pnpm pack > /dev/null )
[[ -f "${TGZ}" ]] || { echo "✘ Tarball not found at ${TGZ}"; exit 1; }
echo "  Built: $(ls -lh "${TGZ}" | awk '{print $5}')"

echo "▶ Copying tarball to Mac C..."
${SCP} "${TGZ}" "${MACC_USER}@${MACC_HOST}:~/Downloads/" > /dev/null
echo "  Copied to ~/Downloads/$(basename "${TGZ}")"

echo "▶ Installing on Mac C..."
${SSH} "${REMOTE_PATH} npm install -g ~/Downloads/$(basename "${TGZ}") --force 2>&1 | tail -3"

if [[ "${RESTART}" -eq 1 ]]; then
  echo "▶ Killing existing attach + agy processes on Mac C..."
  ${SSH} 'pkill -f "harnesstune-agent attach" 2>/dev/null; pkill -f "/agy --dangerously" 2>/dev/null; sleep 1; echo done'
  echo "▶ Relaunching attach in background on Mac C..."
  # nohup + setsid so it survives ssh disconnect; output goes to attach.log
  ${SSH} "cd ~/.harnesstune-agent && ${REMOTE_PATH} nohup harnesstune-agent attach -- agy > attach-bg.log 2>&1 &"
  sleep 2
  ${SSH} 'ps -ef | grep -E "harnesstune-agent attach|/agy" | grep -v grep' || true
else
  echo ""
  echo "✔ Install complete. To pick up the new code, on Mac C:"
  echo "    1. In your attach terminal: Ctrl-] to detach"
  echo "    2. Ctrl-C inside agy to kill it"
  echo "    3. harnesstune-agent attach -- agy"
  echo ""
  echo "  Or re-run this script with --restart to do it automatically (loses live TUI)."
fi
