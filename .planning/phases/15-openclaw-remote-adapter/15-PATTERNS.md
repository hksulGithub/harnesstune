# Phase 15 Pattern Map: OpenClaw Remote Adapter

## Files to Create/Modify

---

### packages/harnesstune-collector/src/plugins/openclaw/types.ts
- **Role:** Raw TypeScript interfaces describing the shape of OpenClaw JSONL event records and the derived in-memory `OpenClawAgent` structure used by mappers.
- **Closest Analog:** `packages/harnesstune-collector/src/plugins/claude-code/types.ts`
- **Key Patterns to Follow:**
  - One interface per raw data shape; one interface per derived/intermediate shape.
  - Keep types narrow and explicit — no `any`, no index signatures unless the upstream format truly requires them.
  - ISO 8601 strings for timestamps in raw records; epoch `number` is acceptable if that is what OpenClaw writes, but the mapper converts to ISO.
  - Example structure from the analog:
    ```ts
    /** Raw event record from a single line of an OpenClaw JSONL log */
    export interface OpenClawEvent {
      ts: string;          // ISO 8601 or epoch — whatever OpenClaw writes
      agentId: string;     // subdirectory name under ~/.openclaw/agents/
      type: string;        // event kind e.g. 'start' | 'finish' | 'error'
      exitCode?: number;
      logLine?: string;
    }

    /** One contiguous session segmented from the event stream */
    export interface OpenClawSession {
      agentId: string;
      startedAt: string;   // ISO 8601
      finishedAt: string;  // ISO 8601
      events: OpenClawEvent[];
    }
    ```

---

### packages/harnesstune-collector/src/plugins/openclaw/reader.ts
- **Role:** Pure file-I/O layer. Reads the `~/.openclaw/agents/` directory tree, enumerates JSONL files per agent subdirectory, parses each line, and returns raw `OpenClawEvent[]`. Does not map or segment — that is the mapper's job.
- **Closest Analog:** `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts`
- **Key Patterns to Follow:**
  - All functions are plain synchronous exports (no class). Async is allowed only where I/O forces it.
  - Guard every `readdirSync` / `readFileSync` in try/catch and return `[]` / `null` on error — never throw from a reader.
  - Filter by mtime against the `since` date before parsing file contents (cheap stat before expensive read):
    ```ts
    const mtime = statSync(filePath).mtime.getTime();
    if (mtime < sinceMs) continue;
    ```
  - JSONL parsing: read the file as a UTF-8 string, split on `\n`, skip blank lines, parse each line with `JSON.parse` inside its own try/catch, and discard malformed lines with a `console.warn`.
  - Staleness guard (borrowed from `claude-desktop/reader.ts`): skip files whose most recent event timestamp is within 30 seconds of `Date.now()` to avoid processing a still-running session.
  - Agent subdirectory enumeration pattern (mirrors `discoverSessionPaths` in the stub):
    ```ts
    const agentDirs = readdirSync(agentsRoot);
    for (const dir of agentDirs) {
      const agentPath = join(agentsRoot, dir);
      if (!statSync(agentPath).isDirectory()) continue;
      // collect JSONL files inside agentPath
    }
    ```
  - Historical backfill window: 7 days. Use `since` param passed in from the daemon; the plugin does not hardcode the window — the caller (daemon cursor) controls it.

---

### packages/harnesstune-collector/src/plugins/openclaw/segmenter.ts
- **Role:** Pure function that takes a flat `OpenClawEvent[]` (already sorted by timestamp) and segments it into `OpenClawSession[]` by applying the gap heuristic: a new session begins when consecutive events are separated by more than `GAP_THRESHOLD_MS` (default 5 minutes, exported constant so it is configurable by the caller).
- **Closest Analog:** No direct analog exists. The closest structural reference is `scanSessions` in `packages/harnesstune-collector/src/plugins/claude-desktop/reader.ts`, which filters session files by time; here the segmentation is event-level rather than file-level.
- **Key Patterns to Follow:**
  - Export a named constant for the threshold:
    ```ts
    export const DEFAULT_SESSION_GAP_MS = 5 * 60 * 1000; // 5 minutes
    ```
  - Function signature keeps threshold optional with a default:
    ```ts
    export function segmentEvents(
      events: OpenClawEvent[],
      gapMs: number = DEFAULT_SESSION_GAP_MS,
    ): OpenClawSession[]
    ```
  - Sort events by `ts` before segmenting — do not assume the caller provides sorted input.
  - Build sessions by iterating events and flushing the current session buffer when `currentTs - prevTs > gapMs`.
  - `startedAt` = first event timestamp in session, `finishedAt` = last event timestamp.
  - Return `[]` for empty input without throwing.

---

### packages/harnesstune-collector/src/plugins/openclaw/mappers.ts
- **Role:** Maps `OpenClawSession` → `RunReport` and OpenClaw agent directory names → `AgentIdentity`. No I/O; pure data transformation.
- **Closest Analog:** `packages/harnesstune-collector/src/plugins/claude-desktop/mappers.ts`
- **Key Patterns to Follow:**
  - Two named exports: one for identity mapping, one for run report mapping.
  - `AgentIdentity` mapper — use directory name as both `agentId` and `name`; set `platform: 'openclaw'`; `schedule: null`; `lastRunAt: null` (collector does not know schedule from JSONL alone); `status: 'active'`:
    ```ts
    export function mapAgentDir(dirName: string): AgentIdentity {
      return {
        agentId: dirName,
        name: dirName,
        platform: 'openclaw',
        schedule: null,
        lastRunAt: null,
        status: 'active',
      };
    }
    ```
  - `RunReport` mapper — infer `status` from presence of an error-type event or non-zero exit code in the session, mirroring the `claude-desktop` pattern (`session.error ? 'failure' : 'success'`):
    ```ts
    export function mapSessionToRunReport(session: OpenClawSession): RunReport {
      const failed = session.events.some(e => e.type === 'error' || (e.exitCode != null && e.exitCode !== 0));
      return {
        agentId: session.agentId,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        status: failed ? 'failure' : 'success',
        durationMs: new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime(),
        logExcerpt: session.events.map(e => e.logLine).filter(Boolean).slice(-50).join('\n') || undefined,
        errorSummary: failed
          ? session.events.find(e => e.type === 'error')?.logLine
          : undefined,
      };
    }
    ```
  - Import `RunReport` from `@harnesstune/shared` and `AgentIdentity` from `../../types.js` — exact same import paths as every other mapper.

---

### packages/harnesstune-collector/src/plugins/openclaw/index.ts (main plugin class)
- **Role:** The `OpenClawPlugin` class that implements `PlatformPlugin`. Replaces the stub at `src/plugins/stubs/openclaw.ts`. Orchestrates `reader`, `segmenter`, and `mappers` — owns no I/O logic itself.
- **Closest Analog:** `packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts` (full implementation)
- **Key Patterns to Follow:**
  - Class structure: `readonly id = 'openclaw'`, `readonly displayName = 'OpenClaw'`, private `agentsDir?: string`, private `cachedAgents: AgentIdentity[] = []`, constructor accepts `PlatformConfig`:
    ```ts
    constructor(private readonly platformConfig?: PlatformConfig) {
      if (platformConfig?.['agentsDir']) {
        this.agentsDir = platformConfig['agentsDir'] as string;
      }
    }
    ```
  - `detect()`: check existence of markers using `existsSync` exactly as the stub already does — reuse the stub's marker list (`~/.openclaw`, `/usr/local/bin/openclaw`, `/opt/homebrew/bin/openclaw`).
  - `setup()`: use `createInterface` from `node:readline/promises` with `stdin`/`stdout`, identical to the Paperclip and Claude Desktop pattern. Auto-detect `~/.openclaw/agents/`; if it exists, confirm and return it; if not found, prompt user. Validate the chosen directory exists before returning:
    ```ts
    const rl = createInterface({ input, output });
    try {
      const defaultDir = join(homedir(), '.openclaw', 'agents');
      const detected = existsSync(defaultDir);
      if (detected) {
        console.log(`Found OpenClaw agents at: ${defaultDir}`);
        return { agentsDir: defaultDir };
      }
      const answer = (await rl.question(`OpenClaw agents directory [${defaultDir}]: `)).trim();
      const agentsDir = answer || defaultDir;
      if (!existsSync(agentsDir)) {
        console.warn(`Warning: directory not found: ${agentsDir}`);
      }
      return { agentsDir };
    } finally {
      rl.close();
    }
    ```
  - `discover()`: enumerate subdirectories of `agentsDir` with `readdirSync`; filter to directories only; map each name via `mapAgentDir`. Cache result in `this.cachedAgents` (no mtime-based invalidation needed for directories; just re-read on each poll cycle since it is cheap):
    ```ts
    async discover(): Promise<AgentIdentity[]> {
      if (!this.agentsDir) return [];
      // readdirSync + statSync isDirectory filter + mapAgentDir
    }
    ```
  - `collectRuns(since)`: call `scanJsonlFiles(this.agentsDir, since)` from reader to get raw events per agent, call `segmentEvents` per agent's events, call `mapSessionToRunReport` on each session, flatten, return. Wrap in try/catch per agent and log errors without propagating — identical to the per-session error handling in `claude-desktop`:
    ```ts
    try {
      runs.push(mapSessionToRunReport(session));
    } catch (err) {
      console.error(`Failed to map session for ${agentId}:`, (err as Error).message);
    }
    ```
  - Early return guard `if (!this.agentsDir) return []` at the top of both `discover()` and `collectRuns()`.

---

### packages/harnesstune-collector/src/plugins/stubs/openclaw.ts (modify — replace stub)
- **Role:** Either deleted in favor of the new `openclaw/index.ts`, or converted into a thin re-export. The loader currently imports from `./stubs/openclaw.js`.
- **Closest Analog:** The existing stub file itself; see also how `claude-desktop` and `claude-code` stubs were promoted to full implementations.
- **Key Patterns to Follow:**
  - The loader at `src/plugins/loader.ts` imports `OpenClawPlugin` from `'./stubs/openclaw.js'`. The simplest migration is to replace the stub file body with a re-export from the real implementation:
    ```ts
    export { OpenClawPlugin } from '../openclaw/index.js';
    ```
  - Alternatively, update `loader.ts` to import directly from `'../openclaw/index.js'` — the same pattern used for `claude-desktop` and `claude-code` which have their own subdirectories.
  - Do not change the `loader.ts` `buildPlugins()` call signature: `new OpenClawPlugin()` must continue to work (constructor accepts optional config, same as the stub).

---

### packages/harnesstune-collector/src/plugins/loader.ts (modify — import path only if stub is deleted)
- **Role:** Plugin registry. No logic changes needed; only the import path for `OpenClawPlugin` changes if the stub is deleted rather than converted to a re-export.
- **Closest Analog:** The file itself — see lines 5 and 32 which import and instantiate `OpenClawPlugin`.
- **Key Patterns to Follow:**
  - Current import: `import { OpenClawPlugin } from './stubs/openclaw.js';`
  - If stub becomes a re-export, loader requires no change.
  - If stub is deleted, update to: `import { OpenClawPlugin } from './openclaw/index.js';`
  - The `buildPlugins()` function passes `platformConfigs['openclaw']` to the constructor — the full implementation must accept this config object or ignore it gracefully when undefined, exactly as the stub's no-arg constructor does today.

---

## Cross-Cutting Patterns (apply to all new files)

### Import paths
All collector-internal imports use `.js` extension even for `.ts` source files (ESM with `"moduleResolution": "bundler"` or `"node16"`):
```ts
import type { AgentIdentity } from '../../types.js';
import type { RunReport } from '@harnesstune/shared';
import type { PlatformPlugin, PlatformConfig } from '../interface.js';
```

### Error handling
Never throw from `discover()` or `collectRuns()` — return `[]` and log with `console.error`. This is consistent across all existing plugins.

### No chokidar / no file watchers
The `PlatformPlugin` interface doc is explicit: *"Plugins are pure data sources: no internal event loops, no file watchers, no persistent state."* The phase description's mention of "chokidar" refers to reading files that chokidar-style watchers *might* tail externally, but the plugin itself must poll via `readdirSync` + `readFileSync` on each daemon poll cycle — exactly how `claude-desktop/reader.ts` works.

### `node:fs` only, no third-party I/O libs
All existing plugins use only `node:fs`, `node:path`, `node:os`, `node:readline/promises`, `node:child_process`. The collector `package.json` has no runtime dependencies beyond `@harnesstune/shared`. OpenClaw plugin must follow the same constraint.

---

## PATTERN MAPPING COMPLETE
