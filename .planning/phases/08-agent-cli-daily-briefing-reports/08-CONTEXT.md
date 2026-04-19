# Phase 08 Context: Agent CLI + Daily Briefing Reports

**Created:** 2026-04-19
**Phase:** 08 — Agent CLI + Daily Briefing Reports
**Status:** Decisions locked

## Prior Decisions (from earlier phases)

- **Phase 06**: pnpm workspaces, `packages/shared` for cross-package types, `assertNeverBackendType` pattern
- **Phase 07**: Single Hono catch-all app, module-scope Turso client + Drizzle, Turso-backed rate limiting (60 req/min per token), relay endpoints live at `POST /channels`, `POST /reports`, `GET /reports`, `POST /messages`, `GET /messages`, `DELETE /messages/:id`, `GET /health`

## Decisions

### D-01: Subcommand CLI structure

CLI uses subcommands, not flags-as-modes. Zero-dependency argv parsing (no commander.js).

```
harnesstune-agent register   # Interactive first-time setup
harnesstune-agent start      # Run sidecar (foreground)
harnesstune-agent stop       # Send SIGTERM to running sidecar
harnesstune-agent report <file>  # One-shot report upload
```

Entry point: `packages/harnesstune-agent/dist/cli.js` (already configured in package.json bin field).

### D-02: Interactive registration with readline

`register` subcommand uses Node.js `readline/promises` for interactive prompts. No external dependency. Prompts for relay URL and optional agent name. Calls `POST /api/channels` to register, stores result in `.harnesstune/config.json`.

Flags (`--relay-url`, `--name`) accepted for scriptable/CI usage, skipping prompts when provided.

### D-03: Foreground process with PID file

`start` runs in foreground (user manages with tmux/screen/systemd). Writes PID to `.harnesstune/agent.pid`. `stop` reads PID file and sends SIGTERM. Running process catches SIGTERM/SIGINT/SIGHUP, uploads "disconnected" heartbeat, removes PID file, exits.

No background daemon mode — avoids detach/log-rotation complexity.

### D-04: Per-project config directory

Config lives in `.harnesstune/` relative to CWD (per-project, not global). Structure:

```
.harnesstune/
  config.json    # relay URL, channelId, token, pollInterval
  agent.pid      # PID of running sidecar
  queue/         # disk-persisted retry queue (Phase 8 scope: ACLI-11)
```

Multiple agents per machine supported by running from different project directories.

### D-05: Heartbeat as report type

Heartbeat uses the same `POST /api/channels/:id/reports` endpoint with `type: "heartbeat"`. Periodic heartbeats (every 5 minutes, ACLI-06) always send `status: "connected"` with `uptimeSeconds`. On SIGTERM/SIGINT/SIGHUP, a final heartbeat with `status: "disconnected"` is uploaded before exit — this is not periodic, it's a one-shot shutdown signal. Extension marks workspace stale after 15 minutes without any heartbeat.

### D-06: Briefing report schema (flat fields)

```typescript
interface BriefingReportBody {
  goals: string[];
  progress: string;                   // singular narrative summary, not a list
  blockers: string[];
  nextSteps: string[];
  metrics: Record<string, number>;  // tokensUsed, tasksCompleted, errorsEncountered
}
```

Uploaded with `type: "briefing"` to relay.

### D-07: Ralph loop report schema (flat with named metrics)

```typescript
interface RalphReportBody {
  loopId: string;                     // UUID tying all iterations of one loop
  iteration: number;
  metrics: Record<string, number>;    // e.g. accuracy, latency_ms, cost_usd
  baselineMetrics: Record<string, number>;  // from iteration 0
  whatChanged: string;
  cumulativeProgress: string;         // RLPH-01: narrative of cumulative improvement across iterations
}
```

Uploaded with `type: "ralph"` to relay. Delta computed extension-side (RLPH-04).

### D-08: Report upload from stdin or file path (ACLI-03)

`report` subcommand accepts a file path argument (`harnesstune-agent report briefing.json`) or reads from stdin when no argument is given (`echo '{}' | harnesstune-agent report`). Implementation detail — no user decision needed beyond the subcommand structure in D-01.

### D-09: Message polling and instruction routing (ACLI-04, ACLI-05)

`start` loop polls `GET /api/channels/:id/messages?since=<cursor>` on a configurable interval (default 60s, ACLI-04). On error, applies exponential backoff (1s → 2s → 4s → ... → 5min cap). Received messages with `direction: "to_agent"` are routed to the local agent system — for Claude Code, this means invoking `claude -p "<message>"` as a subprocess (ACLI-05). Other backends use a stub that logs the message. After processing, agent DELETEs the message from relay.

### D-10: Configurable report schedule (BRFG-02)

Report schedule configured in `.harnesstune/config.json` as a simple interval (e.g., `"reportInterval": "24h"`), not cron. The `start` loop checks elapsed time since last briefing upload and triggers a report generation callback when the interval expires. Cron expressions deferred — simple interval covers daily/hourly use cases without a cron parser dependency.

### D-11: Shared type interfaces in @harnesstune/shared

`BriefingReportBody`, `RalphReportBody`, `HeartbeatReportBody`, and `ReportType` defined in `packages/shared/src/reports.ts`. Both CLI and extension import from `@harnesstune/shared`. Single source of truth prevents schema drift.

### D-12: Standalone CLI only (MCP deferred)

Agent sidecar is a standalone CLI process, not an MCP server. MCP's request-response lifecycle doesn't fit a persistent daemon that heartbeats independently of the agent framework. MCP-as-delegate mode (where Claude Code calls the running sidecar via MCP tools) is deferred to backlog.

## Deferred Ideas

- **MCP delegate mode**: MCP server that delegates to running sidecar for report submission and message checking. Adds zero-install UX for Claude Code users while keeping the sidecar as the persistent process. Backlogged for v2.1.
- **Retry queue specifics** (ACLI-11): Disk-persisted queue format, cap behavior, backoff strategy. Not discussed — defaults acceptable for Phase 8 planning.

## Requirements Coverage

| Decision | Requirements |
|----------|-------------|
| D-01 | ACLI-01, ACLI-08, ACLI-10 |
| D-02 | ACLI-02 |
| D-03 | ACLI-07, ACLI-08 |
| D-04 | ACLI-09 |
| D-05 | ACLI-06 |
| D-06 | BRFG-01, BRFG-03, BRFG-04 |
| D-07 | RLPH-01, RLPH-02, RLPH-03 |
| D-08 | ACLI-03 |
| D-09 | ACLI-04, ACLI-05 |
| D-10 | BRFG-02 |
| D-11 | (shared types support all report reqs) |
| D-12 | ACLI-01 |
