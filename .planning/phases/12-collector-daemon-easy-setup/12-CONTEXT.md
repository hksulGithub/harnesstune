# Phase 12 Context: Collector Daemon + Easy Setup

**Created:** 2026-04-23
**Phase:** 12 — Collector Daemon + Easy Setup
**Status:** Decisions locked

## Prior Decisions (from earlier phases)

- **Phase 06**: pnpm monorepo with `packages/shared` for cross-package types, `assertNeverBackendType()` pattern
- **Phase 07**: Relay API on Vercel + Turso, Bearer token auth (SHA-256 hash + timingSafeEqual), rate limiting (60 req/min per token), Drizzle ORM schema
- **Phase 08**: Agent CLI (`packages/harnesstune-agent`) with `register`, `start`, `stop`, `report` subcommands; per-project `.harnesstune/config.json`; 5-min heartbeat interval; `RetryQueue` with 48-entry cap; foreground process with PID file; `ReportEnvelope` + `HeartbeatReportBody` in `@harnesstune/shared`
- **Phase 09**: `RemoteAdapter` polls on 30s interval; `RelayClient` wraps relay HTTP; per-workspace token in SecretStore; sentinel rootPath `remote://{channelId}`
- **Phase 11**: Multi-agent model — `agents` table with `(channelId, agentId)` unique constraint, `agent_runs` table, `RunReport` shared type, `AgentIdentity` type on `WorkspaceRecord`, relay endpoints for agents/runs/summary, registry v2→v3 migration

## Decisions

### D-01: New standalone package — `packages/harnesstune-collector`

Collector is a new package in the monorepo, not an extension of `harnesstune-agent`. The agent CLI stays unchanged for single-agent use cases.

**Structure:**
```
packages/harnesstune-collector/
  src/
    cli.ts             # entry point
    commands/
      setup.ts         # guided onboarding
      start.ts         # foreground daemon loop
      stop.ts          # SIGTERM via PID file
      status.ts        # PID + status file check
      install.ts       # launchd plist generator
    plugins/
      interface.ts     # PlatformPlugin interface
      loader.ts        # static plugin registry
      stubs/
        paperclip.ts
        claude-desktop.ts
        claude-code.ts
        openclaw.ts
    daemon/
      heartbeat.ts     # machine-level heartbeat
      scheduler.ts     # plugin poll loop
    config.ts          # config read/write
    queue.ts           # retry queue (adapted from agent)
```

**Rationale:** Collector and agent CLI serve different purposes (machine-level fleet management vs single-agent sidecar). Shared logic (heartbeat pattern, queue pattern) is copied and adapted rather than extracted into a shared lib — avoids premature abstraction and migration risk on the stable agent CLI.

### D-02: Foreground process — launchd handles backgrounding

Daemon runs in foreground (stdout logging). User manages backgrounding via:
- Terminal (tmux/screen) for manual runs
- `harnesstune-collector install` generates a macOS launchd plist for auto-start on login

**Subcommands:**
- `setup` — guided config (relay URL, token, platform detection). Config only, no service installation.
- `start` — foreground daemon loop. Writes PID to `~/.harnesstune/collector.pid`.
- `stop` — reads PID file, sends SIGTERM. Daemon catches signal, sends final "disconnected" heartbeat, cleans up.
- `status` — checks PID file (kill(pid, 0)), reads `~/.harnesstune/collector-status.json` written by daemon every heartbeat cycle. Shows: running state, uptime, relay URL, enabled plugins with agent counts, last heartbeat/poll timestamps.
- `install` — generates `~/Library/LaunchAgents/com.harnesstune.collector.plist`, loads via `launchctl load`. Injects token into plist EnvironmentVariables.

**Status file** (`~/.harnesstune/collector-status.json`):
```json
{
  "pid": 12345,
  "startedAt": "2026-04-23T10:00:00Z",
  "lastHeartbeat": "2026-04-23T12:30:00Z",
  "lastPoll": "2026-04-23T12:30:45Z",
  "plugins": {
    "paperclip": { "enabled": true, "agentCount": 3 },
    "claude-desktop": { "enabled": true, "agentCount": 2 }
  }
}
```

### D-03: Plugin interface — daemon-polled, statically linked

**Plugin interface:**
```typescript
interface PlatformPlugin {
  readonly id: string;           // 'paperclip', 'claude-desktop', 'claude-code', 'openclaw'
  readonly displayName: string;  // 'Paperclip', 'Claude Desktop', 'Claude Code', 'OpenClaw'

  // Detect if platform is installed on this machine
  detect(): Promise<boolean>;

  // Interactive first-time config (readline prompts)
  setup(): Promise<PlatformConfig>;

  // Find all agents on this platform
  discover(): Promise<AgentIdentity[]>;

  // Collect completed runs since timestamp
  collectRuns(since: Date): Promise<RunReport[]>;
}

// Per-platform config stored in collector.json platforms[].config
type PlatformConfig = Record<string, unknown>;
```

**Interaction model:** Daemon owns the schedule. Every 60 seconds (configurable), daemon calls `plugin.collectRuns(since)` for each enabled plugin. Plugins are pure data sources — no internal event loops, no watchers, no state. Daemon tracks the `since` cursor per-plugin.

**Loading:** All 4 plugins are statically imported and compiled into the binary. `collector.json` `platforms[]` array toggles which are enabled. No dynamic `require()`, no plugin discovery at runtime.

**Phase 12 scope:** All 4 plugins are stubs — `detect()` checks for platform-specific markers (file paths, installed binaries), `discover()` returns `[]`, `collectRuns()` returns `[]`. Real implementations come in Phase 13-15.

**Default poll interval:** 60 seconds, configurable per-plugin via `collector.json`.

### D-04: Global config at `~/.harnesstune/`

Collector config is machine-level, distinct from agent CLI's per-project `.harnesstune/` pattern.

**Directory structure:**
```
~/.harnesstune/
  collector.json         # daemon config (created by setup)
  collector.pid          # PID file (created by start)
  collector-status.json  # status snapshot (written by daemon)
  queue/                 # retry queue directory
```

**Config shape:**
```json
{
  "relayUrl": "https://harnesstune-relay.vercel.app",
  "channelId": "ch-abc123",
  "token": "ht_tok_abc123def456",
  "pollInterval": 60000,
  "heartbeatInterval": 300000,
  "platforms": [
    {
      "id": "paperclip",
      "enabled": true,
      "config": {
        "serverUrl": "https://paperclip.example.com",
        "apiKey": "pk-..."
      }
    },
    {
      "id": "claude-desktop",
      "enabled": true,
      "config": {
        "sessionsDir": "~/Library/Application Support/Claude/local-agent-mode-sessions"
      }
    },
    {
      "id": "claude-code",
      "enabled": false,
      "config": {}
    },
    {
      "id": "openclaw",
      "enabled": false,
      "config": {}
    }
  ]
}
```

**File permissions:** `chmod 600 ~/.harnesstune/collector.json` set during `setup`.

### D-05: One channel per collector/machine — env var token override

**Channel model:** Each collector instance registers ONE channel representing the machine. All agents across all platforms share that channel. Extension creates one remote workspace per collector (one workspace = one machine's fleet).

**Token precedence:**
1. `HARNESSTUNE_TOKEN` environment variable (highest priority)
2. `token` field in `collector.json` (fallback)

**Setup flow:**
1. User provides relay URL
2. `setup` calls `POST /api/channels` to register a new channel
3. Token is written to `collector.json`
4. When `install` generates launchd plist, it injects the token into plist `EnvironmentVariables`

**Extension-side mapping:**
- User runs "Add Remote Workspace" in VSCode
- Enters relay URL + the collector's token
- Extension creates one workspace showing all agents from that machine
- `RemoteAdapter` polls `GET /channels/:id/agents` to populate the agent list

## Canonical Refs

| What | Where |
|------|-------|
| Agent CLI (existing sidecar) | `packages/harnesstune-agent/src/` |
| Heartbeat pattern | `packages/harnesstune-agent/src/commands/start.ts` |
| RetryQueue pattern | `packages/harnesstune-agent/src/queue.ts` |
| AgentConfig pattern | `packages/harnesstune-agent/src/config.ts` |
| RunReport shared type | `packages/shared/src/reports.ts` |
| AgentIdentity type | `src/types/workspace.ts` |
| Relay agents route | `packages/harnesstune-relay/src/routes/agents.ts` |
| Relay runs route | `packages/harnesstune-relay/src/routes/runs.ts` |
| Relay channel registration | `packages/harnesstune-relay/src/routes/channels.ts` |

## Deferred Ideas

- **Shared core library** (`harnesstune-core`): Extract heartbeat, queue, relay client into shared package used by both agent CLI and collector. Deferred to avoid migration risk on stable agent CLI.
- **Dynamic plugin loading**: Third-party plugins loaded from a directory at runtime. Not needed for the 4 known platforms.
- **Background daemon mode**: Built-in fork/detach with log rotation. Launchd/systemd handle this better.
- **macOS Keychain integration**: Store token in Keychain via `security` CLI. More secure but platform-specific and may prompt for access.
- **Per-platform channels**: Separate channel per platform for granular access control. Adds setup overhead without clear user benefit.
- **WebSocket/SSE push from relay**: Eliminates polling. Out of scope per PROJECT.md.
- **Plugin hot-reload**: Reload plugins without restarting daemon. Unnecessary complexity for 4 static plugins.

## Requirements Coverage

| Decision | Requirements |
|----------|-------------|
| D-01 | COLL-01 (single process per machine) |
| D-02 | COLL-04 (persistent daemon with heartbeat) |
| D-03 | COLL-03 (platform plugin architecture), MAWM-05 (agent discovery) |
| D-04 | COLL-02 (guided onboarding config) |
| D-05 | COLL-02 (relay registration during setup) |

**Note:** COLL-05 (per-agent run reporting) and COLL-06 (historical batch sync) are covered by the plugin interface contract (D-03: `collectRuns(since)`) but real implementations are in Phases 13-15. Phase 12 delivers stub plugins only.
