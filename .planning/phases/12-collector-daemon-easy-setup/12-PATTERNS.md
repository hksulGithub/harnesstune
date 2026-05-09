# Phase 12 Pattern Map

## File: `packages/harnesstune-collector/src/cli.ts`
**Role:** Entry point — parses `process.argv`, dispatches to subcommand handlers: `setup`, `start`, `stop`, `status`, `install`
**Analog:** `packages/harnesstune-agent/src/cli.ts`
**Key patterns to replicate:**
- Shebang `#!/usr/bin/env node` on line 1
- No external argv parsing library — manual `process.argv.slice(2)` + switch
- Named flag stripped before subcommand dispatch (e.g. `--dry-run`)
- Each subcommand is a separately imported async function
- `default:` branch prints usage and `process.exit(1)`

### Code Excerpt
```typescript
#!/usr/bin/env node

import { setup }   from './commands/setup.js';
import { start }   from './commands/start.js';
import { stop }    from './commands/stop.js';
import { status }  from './commands/status.js';
import { install } from './commands/install.js';

const rawArgs = process.argv.slice(2);
const args = rawArgs.filter(a => a !== '--dry-run');
const dryRun = rawArgs.includes('--dry-run');
const [subcommand, ...rest] = args;

switch (subcommand) {
  case 'setup':   await setup(rest);           break;
  case 'start':   await start(rest, { dryRun }); break;
  case 'stop':    await stop(rest);            break;
  case 'status':  await status(rest);          break;
  case 'install': await install(rest);         break;
  default:
    console.error(`Unknown subcommand: ${subcommand ?? '(none)'}`);
    console.error('Usage: harnesstune-collector <setup|start|stop|status|install> [options]');
    process.exit(1);
}
```

---

## File: `packages/harnesstune-collector/src/commands/setup.ts`
**Role:** Guided onboarding — prompts for relay URL, calls `POST /api/channels` to register a channel, writes `~/.harnesstune/collector.json` with `chmod 600`, prompts for platform detection and config
**Analog:** `packages/harnesstune-agent/src/commands/register.ts`
**Key patterns to replicate:**
- `createInterface` from `node:readline/promises` for interactive prompts
- `parseFlags` helper for `--flag value` pairs, pre-filling answers from flags to allow non-interactive use
- `fetch(relayUrl + '/api/channels', { method: 'POST', ... })` to register channel
- `writeConfig()` after successful registration
- `rl.close()` in a `finally` block

### Code Excerpt
```typescript
// From register.ts — readline + flag pre-fill pattern
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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
    const err = await res.json().catch(() => ({})) as { error?: string };
    console.error('Registration failed:', err.error ?? res.statusText);
    process.exit(1);
  }

  const data = await res.json() as { channelId: string; token: string; message: string };
  writeConfig({ relayUrl, channelId: data.channelId, token: data.token, agentName });
  console.log(`Registered as channel ${data.channelId}`);
}
```

**Delta for `setup.ts`:** After registration, also call `fs.chmodSync(CONFIG_FILE, 0o600)`. Then iterate detected plugins via `plugin.detect()` and prompt user to enable each one.

---

## File: `packages/harnesstune-collector/src/commands/start.ts`
**Role:** Foreground daemon — writes PID file, sends initial `connected` heartbeat, runs plugin poll loop every 60s (configurable), writes `collector-status.json` after each cycle, handles `SIGTERM`/`SIGINT` for graceful shutdown
**Analog:** `packages/harnesstune-agent/src/commands/start.ts`
**Key patterns to replicate:**
- PID duplicate detection with `process.kill(pid, 0)` and stale-PID cleanup
- `writePid(process.pid)` immediately after the duplicate check
- Signal handlers (`SIGTERM`, `SIGINT`, `SIGHUP`) that call a shared `shutdown()` function
- `shutdown()` guard (`if (shuttingDown) return`) to prevent double-execution
- `sendHeartbeat('disconnected')` + `removePid()` inside `shutdown()`
- Heartbeat on fixed interval via `setInterval(...).unref()`
- Poll loop as recursive `async function pollLoop()` scheduled with `setTimeout(() => { void pollLoop(); }, delay)`
- Exponential backoff: `currentBackoff = Math.min(currentBackoff * 2, BACKOFF_MAX)`; reset to `BACKOFF_INITIAL` on success
- Jitter: `Math.floor(Math.random() * JITTER_MAX_MS)` added to delay
- Keep-alive pattern: `await new Promise<void>((resolve) => { ... })` with a `setInterval(...).unref()` that resolves when `shuttingDown` is true

### Code Excerpt
```typescript
// PID duplicate detection
const existingPid = readPid();
if (existingPid !== null) {
  try {
    process.kill(existingPid, 0); // signal 0 = existence check, throws if not found
    console.error(`Error: collector already running (PID ${existingPid}). Use 'harnesstune-collector stop' first.`);
    process.exit(1);
  } catch {
    console.warn(`Warning: stale PID file found for PID ${existingPid}, ignoring`);
    removePid();
  }
}
writePid(process.pid);

// Signal handlers + graceful shutdown
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down — sending disconnected heartbeat...');
  await sendHeartbeat('disconnected');
  removePid();
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT',  () => { void shutdown(); });
process.on('SIGHUP',  () => { void shutdown(); });

// Heartbeat timer (every 5 min, unref'd so it doesn't prevent exit)
const heartbeatTimer = setInterval(() => {
  if (!shuttingDown) void sendHeartbeat('connected');
}, HEARTBEAT_MS);
heartbeatTimer.unref();

// Poll loop with exponential backoff + jitter
async function pollLoop(): Promise<void> {
  if (shuttingDown) return;
  try {
    // ... call scheduler, write status file ...
    currentBackoff = BACKOFF_INITIAL; // reset on success
  } catch (err) {
    console.error('Poll error:', err);
    currentBackoff = Math.min(currentBackoff * 2, BACKOFF_MAX);
  }
  if (!shuttingDown) {
    const baseDelay = currentBackoff === BACKOFF_INITIAL ? pollInterval : currentBackoff;
    const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
    setTimeout(() => { void pollLoop(); }, baseDelay + jitter);
  }
}

// Keep process alive
await new Promise<void>((resolve) => {
  const keepAlive = setInterval(() => {
    if (shuttingDown) { clearInterval(keepAlive); resolve(); }
  }, 1000);
  keepAlive.unref();
});
```

**Delta from agent `start.ts`:** Instead of a message-poll loop, the collector poll loop calls `scheduler.runCycle(plugins, config)` and writes `collector-status.json` after each cycle. Heartbeat body includes `plugins` map with per-plugin `agentCount`.

---

## File: `packages/harnesstune-collector/src/commands/stop.ts`
**Role:** Reads `~/.harnesstune/collector.pid`, sends `SIGTERM`, cleans up stale PID file if process not found
**Analog:** `packages/harnesstune-agent/src/commands/stop.ts`
**Key patterns to replicate:**
- `readPid()` — return early with error if null
- `process.kill(pid, 'SIGTERM')`
- Catch `ESRCH` (process not found) separately from other errors — remove stale PID file on `ESRCH`, rethrow otherwise

### Code Excerpt
```typescript
import { readPid, removePid } from '../config.js';

export async function stop(_args: string[]): Promise<void> {
  const pid = readPid();
  if (!pid) {
    console.error('No running collector found (~/.harnesstune/collector.pid not present)');
    process.exit(1);
  }
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to collector (PID ${pid})`);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ESRCH') {
      console.error(`Process ${pid} not found -- removing stale PID file`);
      removePid();
    } else {
      throw err;
    }
  }
}
```

---

## File: `packages/harnesstune-collector/src/commands/status.ts`
**Role:** Checks PID liveness via `kill(pid, 0)`, reads `~/.harnesstune/collector-status.json`, prints formatted status including uptime, plugins, and last heartbeat/poll timestamps
**Analog:** `packages/harnesstune-agent/src/commands/stop.ts` (PID read pattern) + `packages/harnesstune-agent/src/config.ts` (file read pattern)
**Key patterns to replicate:**
- `readPid()` + `process.kill(pid, 0)` for liveness check
- Catch ESRCH to distinguish "not running" from "running but PID file missing"
- `JSON.parse(readFileSync(...))` for status file
- Handle missing status file gracefully (daemon may have never completed a cycle)

### Code Excerpt
```typescript
// PID liveness check (from stop.ts pattern)
const pid = readPid();
let running = false;
if (pid !== null) {
  try {
    process.kill(pid, 0);
    running = true;
  } catch {
    // ESRCH — process not found
  }
}

// Status file read (from config.ts readConfig pattern)
let statusData: CollectorStatus | null = null;
if (existsSync(STATUS_FILE)) {
  statusData = JSON.parse(readFileSync(STATUS_FILE, 'utf-8')) as CollectorStatus;
}
```

---

## File: `packages/harnesstune-collector/src/config.ts`
**Role:** Global config at `~/.harnesstune/` — read/write `collector.json`, read/write/remove `collector.pid`, write `collector-status.json`, expose queue directory path
**Analog:** `packages/harnesstune-agent/src/config.ts`
**Key patterns to replicate:**
- `CONFIG_DIR` computed from `os.homedir()` (not `process.cwd()` — global, not per-project)
- `readConfig()` throws with actionable message if file missing
- `writeConfig()` calls `mkdirSync(CONFIG_DIR, { recursive: true })` before write
- `writePid()` / `readPid()` / `removePid()` trio with the same `existsSync` guards
- `getQueueDir()` creates and returns the queue directory path

### Code Excerpt
```typescript
// Agent analog — note CONFIG_DIR uses process.cwd() (per-project)
// Collector MUST change this to os.homedir() (global):
import { homedir } from 'node:os';

export const CONFIG_DIR = join(homedir(), '.harnesstune');
const CONFIG_FILE    = join(CONFIG_DIR, 'collector.json');
export const PID_FILE    = join(CONFIG_DIR, 'collector.pid');
const STATUS_FILE    = join(CONFIG_DIR, 'collector-status.json');
const QUEUE_DIR      = join(CONFIG_DIR, 'queue');

// readConfig / writeConfig pattern (identical structure)
export function readConfig(): CollectorConfig {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error('No config found. Run: harnesstune-collector setup');
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as CollectorConfig;
}

export function writeConfig(config: CollectorConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  // Additional step vs agent: chmod 600
  chmodSync(CONFIG_FILE, 0o600);
}

// PID helpers — identical pattern, different filename
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
  if (existsSync(PID_FILE)) rmSync(PID_FILE);
}

// Status file write (new in collector — no agent analog)
export function writeStatus(status: CollectorStatus): void {
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
}

export function getQueueDir(): string {
  mkdirSync(QUEUE_DIR, { recursive: true });
  return QUEUE_DIR;
}
```

**Key delta from agent `config.ts`:** `CONFIG_DIR` uses `os.homedir()` instead of `process.cwd()`. Add `chmodSync(CONFIG_FILE, 0o600)` in `writeConfig`. Add `writeStatus()` / `readStatus()` for `collector-status.json`. Token read must check `HARNESSTUNE_TOKEN` env var first (D-05 token precedence).

---

## File: `packages/harnesstune-collector/src/queue.ts`
**Role:** Retry queue for failed relay uploads — file-based persistence in `~/.harnesstune/queue/`, 48-entry FIFO cap, replay on successful poll cycle
**Analog:** `packages/harnesstune-agent/src/queue.ts`
**Key patterns to replicate:**
- File-based queue: one `.json` file per entry in the queue directory
- Filename format: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
- `list()` returns entries sorted oldest-first (lexicographic sort on timestamp-prefixed filenames)
- FIFO eviction: `rmSync(oldest.path)` when `entries.length >= MAX_QUEUE_SIZE` before enqueuing
- `replay()` stops on first failure (relay still unreachable), rate-limits successful uploads with 5s sleep
- `MAX_QUEUE_SIZE = 48` — keep identical to agent

### Code Excerpt
```typescript
const MAX_QUEUE_SIZE = 48;
const REPLAY_MIN_INTERVAL_MS = 5000;

export class RetryQueue {
  private readonly dir: string;

  constructor() {
    this.dir = getQueueDir();
  }

  enqueue(channelId: string, body: unknown): void {
    mkdirSync(this.dir, { recursive: true });
    const entries = this.list();

    // FIFO eviction if at cap
    if (entries.length >= MAX_QUEUE_SIZE) {
      const oldest = entries[0];
      if (oldest) rmSync(oldest.path);
    }

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const filepath = join(this.dir, filename);
    writeFileSync(filepath, JSON.stringify({ channelId, body, timestamp: Date.now() }), 'utf-8');
  }

  list(): QueueEntry[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => {
        const filepath = join(this.dir, f);
        const data = JSON.parse(readFileSync(filepath, 'utf-8')) as { channelId: string; body: unknown; timestamp: number };
        return { path: filepath, ...data } as QueueEntry;
      });
  }

  async replay(client: RelayClient): Promise<number> {
    const entries = this.list();
    if (entries.length === 0) return 0;
    let replayed = 0;
    for (const entry of entries) {
      try {
        const res = await client.post(`/api/channels/${entry.channelId}/reports`, entry.body);
        if (res.ok) {
          rmSync(entry.path);
          replayed++;
          if (replayed < entries.length) {
            await new Promise(resolve => setTimeout(resolve, REPLAY_MIN_INTERVAL_MS));
          }
        } else {
          break;
        }
      } catch {
        break;
      }
    }
    return replayed;
  }
}
```

**Delta from agent `queue.ts`:** Nearly identical. Only difference: `getQueueDir()` will come from the collector's `config.ts` (pointing to `~/.harnesstune/queue/` instead of `.harnesstune/queue/`).

---

## File: `packages/harnesstune-collector/src/plugins/interface.ts`
**Role:** `PlatformPlugin` interface definition — the contract all plugin stubs implement
**Analog:** `packages/shared/src/reports.ts` (TypeScript interface/type definition pattern)
**Key patterns to replicate:**
- Pure TypeScript `interface` — no runtime code
- `readonly` on identity fields (`id`, `displayName`)
- All methods return `Promise<T>` (async-compatible for I/O in real implementations)
- Export `AgentIdentity` from `@harnesstune/shared` (re-use, don't redefine)

### Code Excerpt
```typescript
// From shared/src/reports.ts — interface definition pattern
export interface RunReport {
  agentId: string;
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'failure' | 'timeout' | 'running';
  durationMs: number;
  logExcerpt?: string;
  errorSummary?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  costCents?: number;
}

// Collector interface.ts will follow this pattern:
import type { AgentIdentity } from '@harnesstune/shared';
import type { RunReport } from '@harnesstune/shared';

export type PlatformConfig = Record<string, unknown>;

export interface PlatformPlugin {
  readonly id: string;
  readonly displayName: string;
  detect(): Promise<boolean>;
  setup(): Promise<PlatformConfig>;
  discover(): Promise<AgentIdentity[]>;
  collectRuns(since: Date): Promise<RunReport[]>;
}
```

---

## File: `packages/harnesstune-collector/src/plugins/loader.ts`
**Role:** Static plugin registry — imports all 4 plugin stubs, exports typed array; config `platforms[]` enables/disables at runtime
**Analog:** `packages/harnesstune-agent/src/cli.ts` (static import pattern — all subcommands imported at top, no dynamic require)
**Key patterns to replicate:**
- All plugins statically imported at module level (no dynamic `require()`)
- Exported as a typed array `const ALL_PLUGINS: PlatformPlugin[]`
- Caller filters by `config.platforms` to get enabled plugins

### Code Excerpt
```typescript
// Static import pattern from cli.ts:
import { register } from './commands/register.js';
import { start }    from './commands/start.js';
import { stop }     from './commands/stop.js';
import { report }   from './commands/report.js';

// loader.ts applies same pattern to plugins:
import { PaperclipPlugin }      from './stubs/paperclip.js';
import { ClaudeDesktopPlugin }  from './stubs/claude-desktop.js';
import { ClaudeCodePlugin }     from './stubs/claude-code.js';
import { OpenClawPlugin }       from './stubs/openclaw.js';
import type { PlatformPlugin }  from './interface.js';

export const ALL_PLUGINS: PlatformPlugin[] = [
  new PaperclipPlugin(),
  new ClaudeDesktopPlugin(),
  new ClaudeCodePlugin(),
  new OpenClawPlugin(),
];
```

---

## File: `packages/harnesstune-collector/src/daemon/heartbeat.ts`
**Role:** Machine-level heartbeat sender — posts to `/api/channels/:id/reports` with `type: 'heartbeat'`, enqueues to `RetryQueue` on failure
**Analog:** `sendHeartbeat()` function inside `packages/harnesstune-agent/src/commands/start.ts`
**Key patterns to replicate:**
- `reportId: randomUUID()` on every heartbeat
- `generatedAt: new Date().toISOString()`
- `queue.enqueue(channelId, envelope)` on non-ok response or network error
- Envelope shape: `{ type: 'heartbeat', body: { status, uptimeSeconds }, generatedAt, reportId }`

### Code Excerpt
```typescript
// From start.ts — sendHeartbeat inline function
import { randomUUID } from 'node:crypto';

async function sendHeartbeat(status: 'connected' | 'disconnected'): Promise<void> {
  const envelope = {
    type: 'heartbeat' as const,
    body: {
      status,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    generatedAt: new Date().toISOString(),
    reportId: randomUUID(),
  };
  try {
    const res = await client.post(`/api/channels/${config.channelId}/reports`, envelope);
    if (!res.ok) {
      console.error(`Heartbeat upload failed: ${res.status}`);
      queue.enqueue(config.channelId, envelope);
    }
  } catch (err) {
    console.error('Heartbeat error:', err);
    queue.enqueue(config.channelId, envelope);
  }
}
```

**Delta:** Extract into standalone `heartbeat.ts` module. Accept `client`, `config`, `queue` as arguments. Add `plugins` summary to heartbeat body (D-02 status file shape).

---

## File: `packages/harnesstune-collector/src/daemon/scheduler.ts`
**Role:** Plugin poll loop body — for each enabled plugin, calls `plugin.collectRuns(since)`, uploads runs to relay, advances the `since` cursor per-plugin
**Analog:** The `pollLoop()` function in `packages/harnesstune-agent/src/commands/start.ts`
**Key patterns to replicate:**
- Single async function `runCycle()` called by the outer timer loop in `start.ts`
- Try/catch per plugin so one failing plugin doesn't abort others
- Relay upload follows same pattern as heartbeat: enqueue to RetryQueue on failure
- Returns data to write into `collector-status.json` (last poll time, per-plugin agent counts)

### Code Excerpt
```typescript
// From start.ts — poll loop pattern to adapt:
async function pollLoop(): Promise<void> {
  if (shuttingDown) return;
  try {
    const res = await client.get(`/api/channels/${config.channelId}/messages`, params);
    if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
    // ... process results ...

    // Attempt queue replay on successful poll (relay is reachable)
    const replayed = await queue.replay(client);
    if (replayed > 0) console.log(`Replayed ${replayed} queued report(s)`);

    currentBackoff = BACKOFF_INITIAL; // reset on success
  } catch (err) {
    console.error('Poll error:', err);
    currentBackoff = Math.min(currentBackoff * 2, BACKOFF_MAX);
  }

  if (!shuttingDown) {
    const baseDelay = currentBackoff === BACKOFF_INITIAL ? pollInterval : currentBackoff;
    const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
    setTimeout(() => { void pollLoop(); }, baseDelay + jitter);
  }
}
```

---

## File: `packages/harnesstune-collector/package.json`
**Role:** Package manifest — `bin` field for `harnesstune-collector` CLI, workspace dependency on `@harnesstune/shared`, ESM module
**Analog:** `packages/harnesstune-agent/package.json`
**Key patterns to replicate:**
- `"type": "module"` — ESM throughout
- `"bin": { "harnesstune-collector": "./dist/cli.js" }`
- `"scripts": { "build": "tsc --build", "clean": "rm -rf dist", "typecheck": "tsc --noEmit", "dev": "node --watch dist/cli.js" }`
- `"engines": { "node": ">=20" }`
- `"dependencies": { "@harnesstune/shared": "workspace:*" }`
- `"devDependencies": { "typescript": "^5.6.0" }`
- `"files": ["dist"]`

### Code Excerpt
```json
{
  "name": "@harnesstune/collector",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "harnesstune-collector": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit",
    "dev": "node --watch dist/cli.js"
  },
  "engines": {
    "node": ">=20"
  },
  "files": ["dist"],
  "dependencies": {
    "@harnesstune/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

---

## File: `packages/harnesstune-collector/tsconfig.json`
**Role:** TypeScript project config — composite mode, ESM target, project reference to `../shared`
**Analog:** `packages/harnesstune-agent/tsconfig.json`
**Key patterns to replicate:**
- `"composite": true` — enables project references
- `"module": "ES2022"` + `"moduleResolution": "bundler"` — ESM with Node-compatible resolution
- `"references": [{ "path": "../shared" }]` — links to shared package
- `"outDir": "./dist"`, `"rootDir": "./src"`
- `"strict": true`

### Code Excerpt
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" }
  ]
}
```

**Also required:** Add `{ "path": "./packages/harnesstune-collector" }` to the root `tsconfig.json` `references` array (mirrors how `harnesstune-agent` is registered there).

---

## Summary: Key Deltas from Agent Analog

| Concern | Agent pattern | Collector delta |
|---|---|---|
| Config location | `process.cwd()/.harnesstune/` | `os.homedir()/.harnesstune/` |
| Config file | `config.json` | `collector.json` |
| PID file | `agent.pid` | `collector.pid` |
| Additional files | — | `collector-status.json` written each cycle |
| Token read | Config file only | `HARNESSTUNE_TOKEN` env var takes precedence |
| Config permissions | No chmod | `chmod 600` on write |
| Poll loop body | Message fetch + route | `scheduler.runCycle(plugins, ...)` |
| Heartbeat body | `{ status, uptimeSeconds }` | `{ status, uptimeSeconds, plugins: { id: { enabled, agentCount } } }` |
| Setup command | `register` (flags only) | `setup` (interactive readline + platform detection) |
| New commands | — | `status`, `install` |
