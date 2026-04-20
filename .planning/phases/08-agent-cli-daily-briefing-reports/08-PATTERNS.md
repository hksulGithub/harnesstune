# Phase 08 — Patterns

**Generated:** 2026-04-19
**Phase:** 08 — Agent CLI + Daily Briefing Reports

---

## Files to Create / Modify

| File | Action | Role |
|------|--------|------|
| `packages/shared/src/reports.ts` | Create | Shared type definitions (single source of truth) |
| `packages/shared/src/index.ts` | Modify | Re-export from reports.ts |
| `packages/harnesstune-agent/src/cli.ts` | Create | CLI entry point (argv dispatch) |
| `packages/harnesstune-agent/src/commands/register.ts` | Create | `register` subcommand — readline prompts + POST /api/channels |
| `packages/harnesstune-agent/src/commands/start.ts` | Create | `start` subcommand — foreground sidecar loop |
| `packages/harnesstune-agent/src/commands/stop.ts` | Create | `stop` subcommand — reads PID file, sends SIGTERM |
| `packages/harnesstune-agent/src/commands/report.ts` | Create | `report` subcommand — one-shot upload from file or stdin |
| `packages/harnesstune-agent/src/config.ts` | Create | Read/write `.harnesstune/config.json` |
| `packages/harnesstune-agent/src/client.ts` | Create | HTTP client wrapper (fetch + auth headers) |
| `packages/harnesstune-agent/src/index.ts` | Modify | Replace stub with real exports |
| `packages/harnesstune-agent/package.json` | Modify | Add `dev` and `typecheck` scripts |

---

## 1. Shared Types: `packages/shared/src/reports.ts`

### Role
Single source of truth for all report body schemas. Imported by both `@harnesstune/agent` (CLI sends) and the extension (UI renders). Prevents schema drift.

### Analog
`src/types/agent.ts` — plain TypeScript interface file, no runtime dependencies, export pattern matches `src/types/index.ts` barrel.

### Existing pattern from `src/types/agent.ts`
```typescript
// src/types/agent.ts — interface-only file, no imports
export type AgentEventType = 'SessionStart' | 'SessionEnd' | ...;

export interface AgentTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

export interface AgentEvent {
  id: string;
  // ... flat fields only
}
```

### Pattern to replicate in `packages/shared/src/reports.ts`
```typescript
/**
 * @harnesstune/shared — Report body schemas
 * Single source of truth. Imported by @harnesstune/agent and the extension.
 */

export type ReportType = 'briefing' | 'ralph' | 'heartbeat';

export interface BriefingReportBody {
  goals: string[];
  progress: string;                        // singular narrative summary
  blockers: string[];
  nextSteps: string[];
  metrics: Record<string, number>;         // tokensUsed, tasksCompleted, errorsEncountered
}

export interface RalphReportBody {
  loopId: string;                          // UUID tying all iterations
  iteration: number;
  metrics: Record<string, number>;         // accuracy, latency_ms, cost_usd
  baselineMetrics: Record<string, number>; // from iteration 0
  whatChanged: string;
  cumulativeProgress: string;              // narrative of cumulative improvement
}

export interface HeartbeatReportBody {
  status: 'connected' | 'disconnected';
  uptimeSeconds: number;
}
```

### Update `packages/shared/src/index.ts`
```typescript
export const SHARED_VERSION = '0.0.1';
export * from './reports.js';
```

Note the `.js` extension — required for ESM in this project (all packages use `"type": "module"` and `"moduleResolution": "bundler"`).

---

## 2. CLI Entry Point: `packages/harnesstune-agent/src/cli.ts`

### Role
Dispatches argv to subcommand handlers. No external deps — zero-dependency argv parsing per D-01. Must be the file compiled to `dist/cli.js` (the `bin` target in `package.json`).

### Shebang requirement
`dist/cli.js` must begin with `#!/usr/bin/env node`. Since TypeScript strips shebangs, add it via tsconfig `noEmitHelpers` or use a postbuild script. Simplest: add `#!/usr/bin/env node` as first line of `src/cli.ts` — tsc passes it through.

### Pattern
```typescript
#!/usr/bin/env node
/**
 * harnesstune-agent CLI — subcommand dispatcher
 * No external argv parsing dependencies (D-01).
 */

import { register } from './commands/register.js';
import { start } from './commands/start.js';
import { stop } from './commands/stop.js';
import { report } from './commands/report.js';

const [, , subcommand, ...args] = process.argv;

switch (subcommand) {
  case 'register':
    await register(args);
    break;
  case 'start':
    await start(args);
    break;
  case 'stop':
    await stop(args);
    break;
  case 'report':
    await report(args);
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand ?? '(none)'}`);
    console.error('Usage: harnesstune-agent <register|start|stop|report> [options]');
    process.exit(1);
}
```

### Import style note
All intra-package imports use `.js` extensions even though source files are `.ts`. This is the existing pattern throughout `packages/harnesstune-relay/src/` — e.g., `import { getDb } from '../db/client.js'`.

---

## 3. Config Module: `packages/harnesstune-agent/src/config.ts`

### Role
Reads and writes `.harnesstune/config.json` relative to `process.cwd()`. Owns the config directory structure from D-04.

### Analog
`packages/harnesstune-relay/src/db/client.ts` — module-scope singleton, lazy init pattern.

### Config shape
```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentConfig {
  relayUrl: string;         // e.g. https://relay.example.com
  channelId: string;
  token: string;            // raw Bearer token — stored locally only
  agentName?: string;
  pollInterval?: number;    // ms, default 60000
  reportInterval?: string;  // e.g. "24h", default "24h"
}

const CONFIG_DIR = join(process.cwd(), '.harnesstune');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PID_FILE = join(CONFIG_DIR, 'agent.pid');

export function readConfig(): AgentConfig {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error('No config found. Run: harnesstune-agent register');
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as AgentConfig;
}

export function writeConfig(config: AgentConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function writePid(pid: number): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, 'utf-8').trim();
  return raw ? parseInt(raw, 10) : null;
}

export function removePid(): void {
  if (existsSync(PID_FILE)) {
    import('node:fs').then(fs => fs.rmSync(PID_FILE));
  }
}

export { CONFIG_DIR, PID_FILE };
```

---

## 4. HTTP Client: `packages/harnesstune-agent/src/client.ts`

### Role
Thin fetch wrapper that attaches `Authorization: Bearer <token>` and `X-Agent-Version` headers to every request. All relay calls go through this.

### Analog
No existing HTTP client in the codebase. The relay uses `@libsql/client` directly. The pattern to follow is Node's built-in `fetch` (available Node 18+, project targets ES2022).

### Version header
The relay's `versionMiddleware` (`packages/harnesstune-relay/src/middleware/version.ts`) checks `X-Agent-Version` header. Agent must send this on every request.

### Pattern
```typescript
import { AGENT_VERSION } from './index.js';

export interface RelayClient {
  post(path: string, body: unknown): Promise<Response>;
  get(path: string, params?: Record<string, string>): Promise<Response>;
  delete(path: string): Promise<Response>;
}

export function createClient(relayUrl: string, token: string): RelayClient {
  const base = relayUrl.replace(/\/$/, '');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Agent-Version': AGENT_VERSION,
  };

  return {
    async post(path, body) {
      return fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    },
    async get(path, params) {
      const url = new URL(`${base}${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      }
      return fetch(url.toString(), { method: 'GET', headers });
    },
    async delete(path) {
      return fetch(`${base}${path}`, { method: 'DELETE', headers });
    },
  };
}
```

---

## 5. `register` Command: `packages/harnesstune-agent/src/commands/register.ts`

### Role
Interactive first-time setup. Prompts for relay URL and agent name via `readline/promises`, calls `POST /api/channels`, stores response in `.harnesstune/config.json`.

### Analog
`packages/harnesstune-relay/src/routes/channels.ts` — `POST /channels` handler is what this calls. Expects `{ name: string }`, returns `{ channelId, token, message }`.

### Flag parsing pattern
No external deps. Parse `--relay-url` and `--name` from args array manually:

```typescript
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeConfig } from '../config.js';

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1]) {
      flags[args[i].slice(2)] = args[++i];
    }
  }
  return flags;
}

export async function register(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  let relayUrl = flags['relay-url'];
  let agentName = flags['name'];

  if (!relayUrl || !agentName) {
    const rl = createInterface({ input, output });
    try {
      relayUrl ??= await rl.question('Relay URL: ');
      agentName ??= await rl.question('Agent name: ');
    } finally {
      rl.close();
    }
  }

  const res = await fetch(`${relayUrl.replace(/\/$/, '')}/api/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: agentName }),
  });

  if (!res.ok) {
    const err = await res.json() as { error?: string };
    console.error('Registration failed:', err.error ?? res.statusText);
    process.exit(1);
  }

  const data = await res.json() as { channelId: string; token: string; message: string };
  writeConfig({ relayUrl, channelId: data.channelId, token: data.token, agentName });

  console.log(`Registered as channel ${data.channelId}`);
  console.log(data.message); // "Save this token. It will not be shown again."
}
```

Note: registration uses plain `fetch` without the `RelayClient` wrapper — no token exists yet at registration time.

---

## 6. `start` Command: `packages/harnesstune-agent/src/commands/start.ts`

### Role
Foreground sidecar loop per D-03. Writes PID file, runs heartbeat timer (every 5 min, D-05), runs message poll loop (default 60s, D-09), runs report schedule check (D-10). Handles SIGTERM/SIGINT/SIGHUP with graceful shutdown (disconnected heartbeat + PID cleanup).

### Signal handling pattern
```typescript
import { readConfig, writePid, removePid } from '../config.js';
import { createClient } from '../client.js';
import type { HeartbeatReportBody } from '@harnesstune/shared';

export async function start(_args: string[]): Promise<void> {
  const config = readConfig();
  const client = createClient(config.relayUrl, config.token);

  writePid(process.pid);
  let shuttingDown = false;

  async function sendHeartbeat(status: 'connected' | 'disconnected') {
    const body: HeartbeatReportBody = {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
    };
    await client.post(`/api/channels/${config.channelId}/reports`, {
      type: 'heartbeat',
      body,
    }).catch(err => console.error('Heartbeat failed:', err));
  }

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await sendHeartbeat('disconnected');
    removePid();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGHUP', shutdown);

  // Initial connected heartbeat
  await sendHeartbeat('connected');

  // Heartbeat timer — every 5 minutes
  const HEARTBEAT_MS = 5 * 60 * 1000;
  const heartbeatTimer = setInterval(() => {
    if (!shuttingDown) sendHeartbeat('connected');
  }, HEARTBEAT_MS);
  heartbeatTimer.unref(); // don't block process exit

  // Message poll + report schedule loops follow ...
}
```

### Exponential backoff pattern (for message poll errors, D-09)
```typescript
const BACKOFF_INITIAL = 1000;
const BACKOFF_MAX = 5 * 60 * 1000;

function nextBackoff(current: number): number {
  return Math.min(current * 2, BACKOFF_MAX);
}
```

### Message routing pattern (D-09)
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function routeMessage(body: Record<string, unknown>): Promise<void> {
  const text = typeof body['text'] === 'string' ? body['text'] : JSON.stringify(body);
  try {
    // For Claude Code backend — invoke claude CLI as subprocess
    await execFileAsync('claude', ['-p', text]);
  } catch (err) {
    console.error('Message routing failed:', err);
  }
}
```

### Report interval parsing (D-10)
```typescript
function parseInterval(interval: string): number {
  // Simple: "24h" -> ms, "60m" -> ms, "30s" -> ms
  const match = interval.match(/^(\d+)(h|m|s)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h
  const n = parseInt(match[1], 10);
  if (match[2] === 'h') return n * 60 * 60 * 1000;
  if (match[2] === 'm') return n * 60 * 1000;
  return n * 1000;
}
```

---

## 7. `stop` Command: `packages/harnesstune-agent/src/commands/stop.ts`

### Role
Reads `.harnesstune/agent.pid`, sends SIGTERM to that process. Simple, per D-03.

```typescript
import { readPid } from '../config.js';

export async function stop(_args: string[]): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.error('No running agent found (.harnesstune/agent.pid not present)');
    process.exit(1);
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to agent (PID ${pid})`);
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      console.error(`Process ${pid} not found — removing stale PID file`);
      import('../config.js').then(m => m.removePid());
    } else {
      throw err;
    }
  }
}
```

---

## 8. `report` Command: `packages/harnesstune-agent/src/commands/report.ts`

### Role
One-shot report upload from file path argument or stdin (D-08). Validates JSON, determines type from content, uploads to relay.

```typescript
import { readFileSync } from 'node:fs';
import { readConfig } from '../config.js';
import { createClient } from '../client.js';

export async function report(args: string[]): Promise<void> {
  const config = readConfig();
  const client = createClient(config.relayUrl, config.token);

  let raw: string;
  const filePath = args[0];

  if (filePath && filePath !== '-') {
    raw = readFileSync(filePath, 'utf-8');
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    raw = Buffer.concat(chunks).toString('utf-8');
  }

  let payload: { type: string; body: Record<string, unknown> };
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error('Invalid JSON in report');
    process.exit(1);
  }

  if (!payload.type || !payload.body) {
    console.error('Report must have "type" and "body" fields');
    process.exit(1);
  }

  const res = await client.post(`/api/channels/${config.channelId}/reports`, payload);
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    console.error('Upload failed:', err.error ?? res.statusText);
    process.exit(1);
  }

  const data = await res.json() as { id: string };
  console.log(`Report uploaded: ${data.id}`);
}
```

---

## 9. Relay API — Endpoint Reference

All agent HTTP calls target the relay. Route table from `packages/harnesstune-relay/src/app.ts`:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/channels` | None | Register channel (register cmd) |
| `POST` | `/api/channels/:id/reports` | Bearer | Upload report / heartbeat |
| `GET` | `/api/channels/:id/messages` | Bearer | Poll messages (`?since=<ISO>`) |
| `DELETE` | `/api/channels/:id/messages/:msgId` | Bearer | Acknowledge + delete message |
| `GET` | `/health` | None | Health check |

### Report upload body (from `packages/harnesstune-relay/src/routes/reports.ts`)
```typescript
// POST /api/channels/:channelId/reports
{
  type: "briefing" | "ralph" | "heartbeat",
  body: Record<string, unknown>   // typed by ReportType via @harnesstune/shared
}
// Returns 201: { id, channelId, type, createdAt }
```

### Message poll response (from `packages/harnesstune-relay/src/routes/messages.ts`)
```typescript
// GET /api/channels/:channelId/messages?since=<ISO>&limit=<n>
{ messages: Array<{ id, channelId, direction, body, createdAt }>, count: number }
// Agent filters for direction === "to_agent"
// After processing: DELETE /api/channels/:id/messages/:msgId
```

---

## 10. `packages/harnesstune-agent/package.json` — Modifications

Current stub (`packages/harnesstune-agent/package.json`):
```json
{
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist"
  }
}
```

Add `dev` and `typecheck` scripts to match relay pattern:
```json
{
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit",
    "dev": "node --watch dist/cli.js"
  }
}
```

The `bin` field already points to `./dist/cli.js` — correct, no change needed.

---

## 11. TypeScript Configuration Notes

### Module resolution
All packages use `"moduleResolution": "bundler"` and `"module": "ES2022"`. Internal imports must use `.js` extension even for `.ts` source files. Example from relay:
```typescript
import { getDb } from '../db/client.js';  // .js extension required
```

### Package references
`packages/harnesstune-agent/tsconfig.json` already references `../shared`. No change needed for new files within the agent package.

### `@harnesstune/shared` import in CLI
```typescript
import type { BriefingReportBody, RalphReportBody, HeartbeatReportBody, ReportType } from '@harnesstune/shared';
```
Works because `packages/harnesstune-agent/package.json` already declares `"@harnesstune/shared": "workspace:*"` dependency.

---

## 12. File Layout — Final Structure

```
packages/harnesstune-agent/
├── src/
│   ├── cli.ts                    # Entry point — argv dispatch (shebang)
│   ├── config.ts                 # .harnesstune/config.json + PID file
│   ├── client.ts                 # fetch wrapper with Bearer + X-Agent-Version
│   ├── index.ts                  # AGENT_VERSION export (already exists, update)
│   └── commands/
│       ├── register.ts           # readline prompts + POST /api/channels
│       ├── start.ts              # foreground sidecar loop
│       ├── stop.ts               # SIGTERM via PID file
│       └── report.ts             # one-shot upload from file/stdin
├── dist/
│   └── cli.js                    # compiled output — bin target
├── package.json                  # bin: { harnesstune-agent: ./dist/cli.js }
└── tsconfig.json                 # references ../shared

packages/shared/
├── src/
│   ├── index.ts                  # export SHARED_VERSION + re-export reports.js
│   └── reports.ts                # ReportType, BriefingReportBody, RalphReportBody, HeartbeatReportBody
└── tsconfig.json
```

---

## 13. Key Constraints Summary

| Constraint | Source | Impact |
|------------|--------|--------|
| No external argv deps | D-01 | Manual `process.argv` parsing in cli.ts and commands |
| Foreground only, no daemon | D-03 | `start` uses `setInterval` + signal handlers, never detaches |
| Per-project `.harnesstune/` | D-04 | All config paths relative to `process.cwd()` |
| Heartbeat = report type | D-05 | `POST /reports` with `type: "heartbeat"` — not a separate endpoint |
| Simple interval, not cron | D-10 | `parseInterval("24h")` → ms, no cron parser dep |
| Types in @harnesstune/shared | D-11 | Both CLI and extension import from shared, never duplicate |
| `"type": "module"` in all packages | Phase 06 | `.js` extensions on all imports, top-level `await` in cli.ts |
