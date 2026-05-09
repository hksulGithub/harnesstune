# Summary: Plan 15-02 — OpenClaw Mappers, Plugin Class, and Loader Wiring

## Status: COMPLETE

## Tasks Executed

### T1: OpenClaw mappers
- Created `packages/harnesstune-collector/src/plugins/openclaw/mappers.ts`
- `mapAgentDir(dirName)`: returns AgentIdentity with platform='openclaw', schedule=null, lastRunAt=null, status='active'
- `mapSessionToRunReport(session)`: infers status from error events / non-zero exitCode, truncates logExcerpt to last 50 lines via `.slice(-50)`
- Imports: RunReport from @harnesstune/shared, AgentIdentity from ../../types.js, OpenClawSession from ./types.js
- Commit: `f999258`

### T2: OpenClawPlugin class implementing PlatformPlugin
- Created `packages/harnesstune-collector/src/plugins/openclaw/index.ts`
- `readonly id = 'openclaw'`, `readonly displayName = 'OpenClaw'`
- Constructor: accepts optional PlatformConfig, reads `platformConfig?.['agentsDir']` into private field
- `detect()`: checks three markers — `~/.openclaw`, `/usr/local/bin/openclaw`, `/opt/homebrew/bin/openclaw`
- `setup()`: auto-detects DEFAULT_AGENTS_DIR; if found, returns it; if not, prompts via readline; validates existence; rl.close() in finally
- `discover()`: early return [] if !agentsDir; calls listAgentDirs + mapAgentDir
- `collectRuns(since)`: early return [] if !agentsDir; calls scanJsonlFiles + segmentEvents + mapSessionToRunReport; per-session try/catch
- Zero third-party dependencies — node:fs, node:path, node:os, node:readline/promises only
- Commit: `812e10e`

### T3: Replace stub with re-export and update loader wiring
- `packages/harnesstune-collector/src/plugins/stubs/openclaw.ts`: replaced 43-line stub class with single re-export line `export { OpenClawPlugin } from '../openclaw/index.js';`
- `packages/harnesstune-collector/src/plugins/loader.ts`: `new OpenClawPlugin()` → `new OpenClawPlugin(platformConfigs['openclaw'])` — matches pattern of all other plugins
- Commit: `1dc3d0a`

## Verification

- `npx tsc --noEmit -p packages/harnesstune-collector/tsconfig.json` — clean (no errors) after each task
- All 5 openclaw source files present: types.ts, reader.ts, segmenter.ts, mappers.ts, index.ts
- Stub is now a single re-export line (no class definition)
- Loader passes config to all 4 plugins uniformly

## Files Created

- `packages/harnesstune-collector/src/plugins/openclaw/mappers.ts` (NEW)
- `packages/harnesstune-collector/src/plugins/openclaw/index.ts` (NEW)

## Files Modified

- `packages/harnesstune-collector/src/plugins/stubs/openclaw.ts` (stub → re-export)
- `packages/harnesstune-collector/src/plugins/loader.ts` (pass platformConfigs['openclaw'])

## Key Decisions

- Stub preserved as a re-export rather than deleting it — avoids any import-path changes in loader.ts and any other file that may reference the stub path
- No agent caching in discover() — listAgentDirs is synchronous and fast; caching deferred as noted in the plan
- collectRuns() iterates the Map returned by scanJsonlFiles (keyed by agentId), segments per-agent events, maps each session individually with per-session error isolation
