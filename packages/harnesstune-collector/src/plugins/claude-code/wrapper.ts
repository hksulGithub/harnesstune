/**
 * Generate the harnesstune-wrap bash script.
 * Pure function — returns the script as a string.
 */
export function generateWrapperScript(): string {
  return `#!/usr/bin/env bash
# harnesstune-wrap — capture exit code, duration, output tail for Claude Code cron jobs
# Usage: harnesstune-wrap --name <agent-name> <command> [args...]
# Written by harnesstune-collector setup. Do not edit manually.

set -uo pipefail

RUNS_DIR="\$HOME/.harnesstune/cron-runs"
OUTPUT_TAIL_LINES=50
TRANSCRIPT_FILE=""

# --- Parse --name flag ---
if [ "\$#" -lt 3 ] || [ "\$1" != "--name" ]; then
  echo "Usage: harnesstune-wrap --name <agent-name> <command> [args...]" >&2
  exit 2
fi

AGENT_NAME="\$2"
shift 2

# --- Ensure runs directory exists ---
mkdir -p "\$RUNS_DIR"

# --- Record start time ---
STARTED_AT=\$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
START_EPOCH=\$(date +%s)

# --- Run the wrapped command, capture output ---
TMPOUT=\$(mktemp)
"\$@" > "\$TMPOUT" 2>&1
EXIT_CODE=\$?

# --- Record end time ---
FINISHED_AT=\$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
END_EPOCH=\$(date +%s)
DURATION_MS=$(( (END_EPOCH - START_EPOCH) * 1000 ))

# --- Capture last N lines of output ---
OUTPUT_TAIL=\$(tail -n "\$OUTPUT_TAIL_LINES" "\$TMPOUT" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g; s/\\t/\\\\t/g')
TRANSCRIPT_FILE="\$TMPOUT"
TRANSCRIPT_FILE_ESCAPED=\$(printf '%s' "\$TRANSCRIPT_FILE" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')

# --- Build JSON (no jq dependency — use printf) ---
TIMESTAMP=\$(date +%s%N | cut -c1-13)
RUN_FILE="\$RUNS_DIR/\${TIMESTAMP}-\${AGENT_NAME}.json"
TMP_FILE="\${RUN_FILE}.tmp"

printf '{
  "agentName": "%s",
  "command": "%s",
  "exitCode": %d,
  "startedAt": "%s",
  "finishedAt": "%s",
  "durationMs": %d,
  "outputTail": "%s",
  "transcriptPath": "%s"
}\\n' "\$AGENT_NAME" "\$(echo "\$*" | sed 's/"/\\\\"/g')" "\$EXIT_CODE" "\$STARTED_AT" "\$FINISHED_AT" "\$DURATION_MS" "\$OUTPUT_TAIL" "\$TRANSCRIPT_FILE_ESCAPED" > "\$TMP_FILE"

# --- Atomic rename (risk 5.7 mitigation) ---
mv "\$TMP_FILE" "\$RUN_FILE"

# --- Exit with the wrapped command's exit code ---
exit \$EXIT_CODE
`;
}
