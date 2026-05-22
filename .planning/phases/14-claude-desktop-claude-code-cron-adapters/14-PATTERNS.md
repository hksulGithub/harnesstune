# Phase 14: Pattern Map

## Files to Create/Modify

---

### `packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts`
- **Role:** Plugin (upgrade stub to full implementation)
- **Analog:** `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts`
- **Data flow:** `scheduled-tasks.json` mtime check → parse file → diff state → return `AgentIdentity[]`; session `.json` files glob → filter by `scheduledTaskId` + `since` → staleness guard → map to `RunReport[]`
- **Key excerpt:**
```typescript
// paperclip.ts lines 28–36: constructor pattern — cast PlatformConfig to typed fields
constructor(private readonly platformConfig?: PlatformConfig) {
  if (platformConfig?.['serverUrl'] && platformConfig?.['apiKey']) {
    this.client = new PaperclipClient(
      platformConfig['serverUrl'] as string,
      platformConfig['apiKey'] as string,
    );
    this.companyId = (platformConfig['companyId'] as string) || undefined;
  }
}

// paperclip.ts lines 48–93: setup() readline pattern with finally block
async setup(existing?: PlatformConfig): Promise<PlatformConfig> {
  const rl = createInterface({ input, output });
  try {
    const defaultUrl = (existing?.['serverUrl'] as string | undefined) ?? '';
    const serverUrl = (
      await rl.question(`Paperclip server URL${defaultUrl ? ` [${defaultUrl}]` : ''}: `)
    ).trim() || defaultUrl;
    // ... prompts and validation
    return { serverUrl, apiKey, companyId };
  } finally {
    rl.close();
  }
}

// paperclip.ts lines 95–101: discover() — map platform data to AgentIdentity[]
async discover(): Promise<AgentIdentity[]> {
  if (!this.client || !this.companyId) {
    return [];
  }
  const agents = await this.client.getAgents(this.companyId);
  return agents.map(mapAgent);
}

// paperclip.ts lines 103–147: collectRuns() — best-effort with per-step try/catch
async collectRuns(since: Date): Promise<RunReport[]> {
  if (!this.client || !this.companyId) {
    return [];
  }
  // ...
}

// claude-desktop.ts lines 29–36: detect() — already complete, keep as-is
async detect(): Promise<boolean> {
  const markers = [
    '/Applications/Claude.app',
    join(homedir(), 'Applications', 'Claude.app'),
    join(homedir(), 'Library', 'Application Support', 'Claude'),
  ];
  return markers.some(p => existsSync(p));
}
```
- **Deviations from analog:**
  - Constructor stores `sessionsDir: string` (not a client object). Guard becomes `if (!this.sessionsDir) return []`.
  - `setup()` globs `<DEFAULT_SESSIONS_DIR>/*/*/scheduled-tasks.json` to discover `orgId/userId` pairs; presents numbered list if multiple; stores the full resolved path as `sessionsDir`. Existing stub prompt (line 42) is replaced by this auto-discovery flow.
  - `discover()` calls `readScheduledTasks(sessionsDir)` (from `claude-desktop/reader.ts`) instead of a network client; applies mtime guard with in-memory `lastKnownMtime` + `cachedAgents` fields.
  - `collectRuns(since)` scans session `.json` files, filters by `scheduledTaskId` presence + `> since` + staleness guard (`lastActivityAt < now - 30_000`), wraps parse in try/catch for race condition (5.1), calls `mapSessionToRunReport` from `claude-desktop/mappers.ts`.
  - No `PaperclipClient` import — no HTTP calls. File I/O only.
  - `tokenUsage` and `costCents` are always `undefined` (Claude Desktop does not expose these).

---

### `packages/harnesstune-collector/src/plugins/claude-desktop/types.ts`
- **Role:** Types (platform-specific raw interfaces)
- **Analog:** `packages/harnesstune-collector/src/plugins/paperclip/types.ts`
- **Data flow:** Raw JSON shapes read from disk → typed interfaces consumed by `reader.ts` and `mappers.ts`
- **Key excerpt:**
```typescript
// paperclip/types.ts lines 1–43: one interface per raw data shape, typed fields, optional where nullable
export interface PaperclipAgent {
  id: string;
  name: string;
  schedule?: string;       // cron expression or null
  lastRunAt?: string;      // ISO 8601
  status?: string;         // 'active' | 'paused' | 'disabled' etc.
}

export interface PaperclipTaskSession {
  id: string;
  agentId: string;
  startedAt: string;       // ISO 8601
  finishedAt: string;      // ISO 8601
  status: 'success' | 'failure' | 'timeout' | 'running';
  durationMs?: number;
  logExcerpt?: string;
  errorSummary?: string;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
}
```
- **Deviations from analog:**
  - Two interfaces only: `ScheduledTask` (from `scheduled-tasks.json`) and `SessionFile` (from `local_<uuid>.json`).
  - `ScheduledTask` fields: `id: string`, `cronExpression: string`, `enabled: boolean`, `lastRunAt?: string`, `lastScheduledFor?: string`, `createdAt: number` (epoch ms), `filePath: string`, `model: string`, `approvedPermissions: Array<{ toolName: string }>`, `disableJitter: boolean`.
  - `SessionFile` fields: `sessionId: string`, `scheduledTaskId?: string`, `sessionType?: string`, `createdAt: number` (epoch ms), `lastActivityAt: number` (epoch ms), `error?: string`, `isArchived: boolean`, `title: string`, `model: string`. All other fields typed `[key: string]: unknown` or simply omitted as optional.
  - No paginated response wrapper (no API pagination).

---

### `packages/harnesstune-collector/src/plugins/claude-desktop/mappers.ts`
- **Role:** Mappers (pure transform functions)
- **Analog:** `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts`
- **Data flow:** `ScheduledTask` → `AgentIdentity`; `SessionFile` → `RunReport`
- **Key excerpt:**
```typescript
// paperclip/mappers.ts lines 6–15: mapAgent — sets all 6 AgentIdentity fields, platform hardcoded
export function mapAgent(agent: PaperclipAgent): AgentIdentity {
  return {
    agentId: agent.id,
    name: agent.name,
    platform: 'paperclip',
    schedule: agent.schedule ?? null,
    lastRunAt: agent.lastRunAt ?? null,
    status: agent.status ?? 'unknown',
  };
}

// paperclip/mappers.ts lines 18–39: mapTaskSession — durationMs computation from timestamps
export function mapTaskSession(session: PaperclipTaskSession): RunReport {
  const durationMs =
    session.durationMs ??
    (new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime());
  return {
    agentId: session.agentId,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    status: session.status,
    durationMs,
    logExcerpt: session.logExcerpt,
    errorSummary: session.errorSummary,
    tokenUsage,
    costCents: session.costCents,
  };
}
```
- **Deviations from analog:**
  - `mapScheduledTask(task: ScheduledTask): AgentIdentity` — `platform: 'claude-desktop'`; `status: task.enabled ? 'active' : 'paused'`; `lastRunAt: task.lastRunAt ?? null` (already ISO string); `schedule: task.cronExpression`.
  - `mapSessionToRunReport(session: SessionFile, taskId: string): RunReport` — `agentId: taskId`; `startedAt: new Date(session.createdAt).toISOString()`; `finishedAt: new Date(session.lastActivityAt).toISOString()`; `durationMs: session.lastActivityAt - session.createdAt`; `status: session.error ? 'failure' : 'success'`; `errorSummary: session.error` (if present); no `tokenUsage`, no `costCents`.
  - No `enrichWithCosts` or `mapActivitiesToEvents` — those are Paperclip-specific.

---

### `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts`
- **Role:** I/O utilities (file system reads, filtering)
- **Analog:** `packages/harnesstune-collector/src/plugins/paperclip/client.ts` (closest structural analog for the "data access layer" role; file I/O instead of HTTP)
- **Data flow:** `sessionsDir` path → `fs.readFileSync` / `fs.readdirSync` → typed objects; filter sessions by `scheduledTaskId` and `since`
- **Key excerpt:**
```typescript
// paperclip/client.ts lines 1–8: imports — node:fs equivalents replace fetch
import type {
  PaperclipCompany,
  PaperclipAgent,
  // ...
} from './types.js';

// paperclip/client.ts lines 73–96: getAll() — pagination loop
// Analog: reader.ts has no pagination but same try/catch + parse pattern
private async getAll<T>(path: string, params?: Record<string, string>): Promise<T[]> {
  const results: T[] = [];
  // ... fetch loop with JSON parse
  return results;
}

// config.ts lines 1–2, 47–52: readFileSync pattern for JSON config files
import { readFileSync, existsSync } from 'node:fs';
// ...
return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as CollectorConfig;
```
- **Deviations from analog:**
  - Uses `node:fs` (`readFileSync`, `readdirSync`, `statSync`) not `fetch`. No class — exported standalone async functions.
  - `readScheduledTasks(sessionsDir: string): ScheduledTask[]` — wraps `JSON.parse(readFileSync(...))` in try/catch; returns `[]` on parse error (guards race condition 5.1).
  - `readSessionFile(filePath: string): SessionFile | null` — individual session file parse, returns `null` on error.
  - `scanSessions(sessionsDir: string, since: Date): SessionFile[]` — `readdirSync` for `local_*.json` files; filters by `mtime > since`; calls `readSessionFile` per file; filters to only those with `scheduledTaskId` set.
  - `getScheduledTasksMtime(sessionsDir: string): Date` — `statSync(path).mtime` for mtime guard.

---

### `packages/harnesstune-collector/src/plugins/stubs/claude-code.ts`
- **Role:** Plugin (upgrade stub to full implementation)
- **Analog:** `packages/harnesstune-collector/src/plugins/stubs/paperclip.ts`
- **Data flow:** `crontab -l` → parse → `AgentIdentity[]`; `~/.harnesstune/cron-runs/*.json` scan → parse → delete → `RunReport[]`
- **Key excerpt:**
```typescript
// paperclip.ts lines 28–36: constructor with config guard
constructor(private readonly platformConfig?: PlatformConfig) {
  if (platformConfig?.['serverUrl'] && platformConfig?.['apiKey']) {
    // ... initialize client
  }
}

// paperclip.ts lines 48–93: setup() with readline and finally block
async setup(existing?: PlatformConfig): Promise<PlatformConfig> {
  const rl = createInterface({ input, output });
  try {
    // ... prompts
    return { ... };
  } finally {
    rl.close();
  }
}

// install.ts lines 4–8: execFileAsync pattern for child_process
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
// ...
await execFileAsync('launchctl', ['unload', PLIST_PATH]);

// install.ts lines 1–2, 39–41: mkdirSync + writeFileSync + chmodSync pattern
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
writeFileSync(PLIST_PATH, plistContent, 'utf-8');
chmodSync(PLIST_PATH, 0o600);
```
- **Deviations from analog:**
  - Constructor stores `wrapperPath` and `cronRunsDir` from config (no client object).
  - `setup()` does NOT use `readline` for user input — it is non-interactive: writes the wrapper script, sets `chmod 755`, creates `~/.harnesstune/bin/` and `~/.harnesstune/cron-runs/` dirs, prints PATH and crontab instructions, returns `{ wrapperPath, cronRunsDir }`. Existing stub's `return {}` (line 34) is replaced entirely.
  - `discover()` calls `execFileAsync('crontab', ['-l'])`, handles exit code 1 as empty crontab (not an error), calls `parseCrontab()` from `claude-code/crontab.ts`, maps each `CrontabEntry` to `AgentIdentity`.
  - `collectRuns(since)` uses `readdirSync` on `cronRunsDir`, reads each `.json` file (ignores `.json.tmp`), calls `mapCronRunFile()`, deletes file after successful map, applies 7-day cleanup for stale files. No try/catch per-file abort — partial failure returns successfully-mapped runs.
  - No network calls anywhere in the plugin.

---

### `packages/harnesstune-collector/src/plugins/claude-code/types.ts`
- **Role:** Types (platform-specific raw interfaces)
- **Analog:** `packages/harnesstune-collector/src/plugins/paperclip/types.ts`
- **Data flow:** Raw JSON shapes written by `harnesstune-wrap` → typed interfaces consumed by `mappers.ts` and `crontab.ts`
- **Key excerpt:**
```typescript
// paperclip/types.ts lines 8–14: one interface per data shape, typed optional fields
export interface PaperclipAgent {
  id: string;
  name: string;
  schedule?: string;
  lastRunAt?: string;
  status?: string;
}
```
- **Deviations from analog:**
  - Two interfaces: `CronRunFile` (written by `harnesstune-wrap`) and `CrontabEntry` (parsed from `crontab -l` output).
  - `CronRunFile` fields (D-07): `agentName: string`, `command: string`, `exitCode: number`, `startedAt: string` (ISO), `finishedAt: string` (ISO), `durationMs: number`, `outputTail: string`.
  - `CrontabEntry` fields: `schedule: string` (cron expression `'0 9 * * *'` or `'@reboot'`), `agentName: string`, `rawLine: string`.
  - No paginated response wrapper.

---

### `packages/harnesstune-collector/src/plugins/claude-code/mappers.ts`
- **Role:** Mappers (pure transform functions)
- **Analog:** `packages/harnesstune-collector/src/plugins/paperclip/mappers.ts`
- **Data flow:** `CronRunFile` → `RunReport`; `CrontabEntry` → `AgentIdentity`
- **Key excerpt:**
```typescript
// paperclip/mappers.ts lines 6–15: mapAgent — AgentIdentity with platform hardcoded
export function mapAgent(agent: PaperclipAgent): AgentIdentity {
  return {
    agentId: agent.id,
    name: agent.name,
    platform: 'paperclip',
    schedule: agent.schedule ?? null,
    lastRunAt: agent.lastRunAt ?? null,
    status: agent.status ?? 'unknown',
  };
}

// paperclip/mappers.ts lines 18–39: mapTaskSession — durationMs, status, errorSummary
export function mapTaskSession(session: PaperclipTaskSession): RunReport {
  const durationMs =
    session.durationMs ??
    (new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime());
  return {
    agentId: session.agentId,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    status: session.status,
    durationMs,
    // ...
  };
}
```
- **Deviations from analog:**
  - `mapCrontabEntry(entry: CrontabEntry): AgentIdentity` — `agentId: entry.agentName`; `name: entry.agentName`; `platform: 'claude-code'`; `schedule: entry.schedule`; `lastRunAt: null`; `status: 'active'`.
  - `mapCronRunFile(file: CronRunFile): RunReport` — `agentId: file.agentName`; `status: file.exitCode === 0 ? 'success' : 'failure'`; `errorSummary`: set only when `exitCode !== 0`, value is `outputTail` tail or a generic message; `logExcerpt: file.outputTail`; `durationMs: file.durationMs`; `startedAt/finishedAt` from `file.startedAt/finishedAt`; no `tokenUsage`, no `costCents`.

---

### `packages/harnesstune-collector/src/plugins/claude-code/crontab.ts`
- **Role:** Utility (crontab parsing)
- **Analog:** `packages/harnesstune-collector/src/plugins/paperclip/client.ts` (closest analog as the "data access" layer, though file-based here)
- **Data flow:** raw `crontab -l` stdout string → line-by-line parse → `CrontabEntry[]`
- **Key excerpt:**
```typescript
// install.ts lines 4–8: execFileAsync pattern — exact pattern to replicate for crontab -l
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
// ...
await execFileAsync('launchctl', ['unload', PLIST_PATH]);

// install.ts lines 44–49: treat non-zero exit as expected case (not hard error)
try {
  await execFileAsync('launchctl', ['unload', PLIST_PATH]);
} catch {
  // Not previously loaded — expected on first install
}
```
- **Deviations from analog:**
  - Exported function `parseCrontab(output: string): CrontabEntry[]` — not a class. Pure function, no I/O.
  - Exported function `readCrontab(): Promise<CrontabEntry[]>` — calls `execFileAsync('crontab', ['-l'])`, treats exit code 1 as "no crontab" (returns `[]`), calls `parseCrontab(stdout)`.
  - Parse algorithm (per research section 3.3): skip blank lines, `#` comments, `/^\s*\w+=/` env vars. For remaining lines, check if command portion contains `harnesstune-wrap`. Extract `--name` value with regex `/--name\s+['"]?([^'"]+?)['"]?(?:\s|$)/`. Extract schedule: if line starts with `@`, use the `@keyword` as schedule; otherwise split on whitespace and take `fields.slice(0, 5).join(' ')`. Skip lines missing `--name` with `console.warn`. Return `CrontabEntry[]`.
  - `execFileAsync` decodes stdout as `utf-8` (default Node behavior).

---

### `packages/harnesstune-collector/src/plugins/claude-code/wrapper.ts`
- **Role:** Script generator (pure function producing bash script string)
- **Analog:** `packages/harnesstune-collector/src/commands/install.ts` — `generatePlist()` function (lines 81–119)
- **Data flow:** no inputs → bash script string (written to disk by `setup()`)
- **Key excerpt:**
```typescript
// install.ts lines 81–119: generatePlist() — pure function returns multiline string
function generatePlist(opts: PlistOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC ...>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${opts.label}</string>
  ...
</dict>
</plist>
`;
}

// install.ts lines 39–41: mkdirSync + writeFileSync + chmodSync (called by setup(), not wrapper.ts itself)
mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
writeFileSync(PLIST_PATH, plistContent, 'utf-8');
chmodSync(PLIST_PATH, 0o600);
```
- **Deviations from analog:**
  - `generateWrapperScript(): string` — returns bash (not XML). No parameters needed; all paths are runtime-resolved inside the script using `$HOME`.
  - Script structure (per research section 6.4): `#!/usr/bin/env bash`, `set -euo pipefail`, parse `--name` from `"$@"` (exit with usage error if missing per D-09), record `startedAt`, run wrapped command capturing stdout+stderr to temp file via `script` or process substitution, capture `exitCode`, record `finishedAt`, compute `durationMs`, extract last 50 lines as `outputTail`, write JSON to `$HOME/.harnesstune/cron-runs/<timestamp>-<name>.json.tmp`, atomic rename to `.json`, exit with wrapped command's exit code.
  - Wrapper uses temp-file-then-rename pattern for atomicity (risk 5.7).
  - The calling `setup()` in `claude-code.ts` handles `mkdirSync` + `writeFileSync` + `chmodSync 0o755` (not 0o600 — it must be executable).

---

### `packages/harnesstune-collector/src/plugins/loader.ts`
- **Role:** Config (plugin registry, 2-line change)
- **Analog:** Self — current `loader.ts` lines 29–32
- **Data flow:** `readConfig()` → `platformConfigs` map → injected into plugin constructors
- **Key excerpt:**
```typescript
// loader.ts lines 28–33: current stub calls (lines 30–31 are the change targets)
return [
  new PaperclipPlugin(platformConfigs['paperclip']),
  new ClaudeDesktopPlugin(),       // line 30: change to pass config
  new ClaudeCodePlugin(),           // line 31: change to pass config
  new OpenClawPlugin(),
];
```
- **Deviations from analog:**
  - Lines 30–31 change to `new ClaudeDesktopPlugin(platformConfigs['claude-desktop'])` and `new ClaudeCodePlugin(platformConfigs['claude-code'])`. No other changes to this file.

---

## PATTERN MAPPING COMPLETE
