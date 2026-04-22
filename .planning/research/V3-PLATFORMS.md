# v3.0 Platform Research — Multi-Platform Agent Fleet Management

## Paperclip Integration

**What it is:** Open-source Node.js/React platform for orchestrating AI agent teams. Server/dashboard that manages scheduling, budgeting, governance, and audit logging for pluggable agent runtimes.

**API Surface (REST, Bearer token auth via Board API Keys):**
- `GET /companies/:companyId/agents` — list all agents
- `GET /agents/:id/runtime-state` — current execution state
- `GET /agents/:id/task-sessions` — active task sessions
- `GET /companies/:companyId/issues` — list/filter issues (tasks)
- `GET /issues/:id/runs` — runs for an issue
- `GET /companies/:companyId/costs/by-agent?from=&to=` — per-agent cost breakdowns
- `GET /companies/:companyId/activity?agentId=&limit=` — audit trail
- `GET /instance/scheduler-heartbeats` — all agent heartbeat statuses

**Key DB tables:** `agents`, `heartbeat_runs` (execution records with timing, exit codes, errors, token usage), `issues` (tasks), `cost_events` (per-run token counts and costs), `activity_log`

**Auth:** Board API Keys (SHA-256 hashed, Bearer token). Grants full read access to agents, runs, costs, activity.

**Integration approach:** REST API polling with Board API Key. No plugin needed — the API is rich enough. Query `costs/by-agent` and `heartbeat_runs` for historical reporting.

---

## Claude Desktop Scheduled Tasks

**Storage (all plain JSON on macOS):**
- **Task registry:** `~/Library/Application Support/Claude/local-agent-mode-sessions/<orgId>/<userId>/scheduled-tasks.json`
  - Fields: `id`, `cronExpression`, `enabled`, `filePath`, `model`, `lastRunAt`, `lastScheduledFor`, `disableJitter`
- **Task prompts:** `~/Documents/Claude/Scheduled/<task-name>/SKILL.md` (Markdown + YAML frontmatter)
- **Session history:** `~/Library/Application Support/Claude/local-agent-mode-sessions/<orgId>/<userId>/local_<sessionId>.json`
  - Full conversation logs with `sessionId`, `createdAt`, `lastActivityAt`, `model`, `title`, `initialMessage`

**No API.** All data is in JSON files. Read directly from filesystem on the remote Mac.

**Correlation challenge:** Session files may lack explicit `scheduledTaskId`. Correlate by matching `initialMessage` content against `SKILL.md` prompt text, plus timestamp proximity to `lastScheduledFor`.

**Execution model:** Desktop checks schedule every minute while app is open. Missed tasks run when app reopens. Deterministic jitter up to 10 minutes.

**Integration approach:** Sidecar on remote Mac reads `scheduled-tasks.json` + parses session files → builds run history → reports via relay.

---

## Claude Code Cron Jobs

**Existing v2.0 pattern:** Agent CLI sidecar (`harnesstune-agent start`) with heartbeat, report upload, message polling via relay.

**For cron jobs:** Each cron job invocation wraps a `claude` CLI call. The sidecar reports after each run completes.

**Integration approach:** Enhanced sidecar that auto-discovers cron entries (parse `crontab -l`) or accepts manual agent registration. Each cron job = one agent identity.

---

## OpenClaw

**Existing v1.0 pattern:** JSONL file tailing via chokidar at `~/.openclaw/agents/<agentId>/sessions/*.jsonl`.

**For remote:** Same sidecar + relay pattern as Claude Code. Parse JSONL locally, build reports, upload via relay.

---

## Architecture Decision: Collector Model

All three platforms on a remote Mac share one collector process:

```
Remote Mac
├── harnesstune-collector (single process)
│   ├── Paperclip collector  → REST API polling
│   ├── Claude Desktop collector → JSON file watching
│   ├── Claude Code collector → cron job wrapping / post-run reporting
│   └── OpenClaw collector → JSONL file tailing
└── Reports via relay → HarnessTune extension
```

The collector replaces the current single-purpose `harnesstune-agent` sidecar with a multi-platform daemon that discovers and reports on all agents across all platforms on a machine.
