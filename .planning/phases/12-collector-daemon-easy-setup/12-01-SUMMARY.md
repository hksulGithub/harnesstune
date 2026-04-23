---
phase: 12
plan: 12-01
status: complete
---

# Summary: Plan 12-01

## What was built

Created the `packages/harnesstune-collector` package — a new standalone monorepo package that implements the collector daemon for multi-platform agent fleet management (Phase 12, D-01 through D-05).

The package implements:
- **Package scaffold**: `package.json` (bin: `harnesstune-collector`, workspace dep on `@harnesstune/shared`), `tsconfig.json` (project reference to `../shared`, composite build), `src/index.ts`, `src/cli.ts` (subcommand dispatcher: setup/start/stop/status/install, --dry-run flag)
- **Config module** (`src/config.ts`): global `~/.harnesstune/` directory, `collector.json` (chmod 600), PID file, status snapshot file, queue directory, `resolveToken()` with `HARNESSTUNE_TOKEN` env var override (D-05)
- **Plugin interface** (`src/plugins/interface.ts`): `PlatformPlugin` interface with `detect()`, `setup()`, `discover()`, `collectRuns(since)` methods as specified in D-03
- **Plugin stubs** — all 4 platforms: `paperclip.ts`, `claude-desktop.ts`, `claude-code.ts`, `openclaw.ts` — `detect()` checks platform-specific file/binary markers; `discover()` and `collectRuns()` return `[]` (stubs per D-03 scope note)
- **Static plugin loader** (`src/plugins/loader.ts`): `getAllPlugins()`, `getPlugin(id)`, `getEnabledPlugins(ids)` — no dynamic require
- **Retry queue** (`src/queue.ts`): 48-entry cap, FIFO eviction, 5s rate-limited replay, adapted from agent CLI pattern
- **HTTP client** (`src/client.ts`): `createClient()` with `X-Collector-Version` header, same interface as agent CLI client
- **Daemon components**: `daemon/heartbeat.ts` (machine-level heartbeat with plugin status map), `daemon/scheduler.ts` (`PluginScheduler` with per-plugin `since` cursor, discover + collectRuns on each cycle)
- **Commands**: `setup.ts` (guided onboarding: relay URL → channel registration → platform detect → per-platform config → write collector.json), `start.ts` (foreground daemon loop: PID dedup, heartbeat timer, poll loop with backoff, status file updates, graceful shutdown), `stop.ts` (PID-based SIGTERM), `status.ts` (PID check + status file display), `install.ts` (launchd plist generator with token injection into EnvironmentVariables)
- **Local type** (`src/types.ts`): collector-local `AgentIdentity` declaration (avoids importing extension-side code)

TypeScript build passes clean (`tsc --build`, no errors).

## Key files created

- `/packages/harnesstune-collector/package.json`
- `/packages/harnesstune-collector/tsconfig.json`
- `/packages/harnesstune-collector/src/index.ts`
- `/packages/harnesstune-collector/src/cli.ts`
- `/packages/harnesstune-collector/src/config.ts`
- `/packages/harnesstune-collector/src/types.ts`
- `/packages/harnesstune-collector/src/client.ts`
- `/packages/harnesstune-collector/src/queue.ts`
- `/packages/harnesstune-collector/src/plugins/interface.ts`
- `/packages/harnesstune-collector/src/plugins/loader.ts`
- `/packages/harnesstune-collector/src/plugins/stubs/paperclip.ts`
- `/packages/harnesstune-collector/src/plugins/stubs/claude-desktop.ts`
- `/packages/harnesstune-collector/src/plugins/stubs/claude-code.ts`
- `/packages/harnesstune-collector/src/plugins/stubs/openclaw.ts`
- `/packages/harnesstune-collector/src/daemon/heartbeat.ts`
- `/packages/harnesstune-collector/src/daemon/scheduler.ts`
- `/packages/harnesstune-collector/src/commands/setup.ts`
- `/packages/harnesstune-collector/src/commands/start.ts`
- `/packages/harnesstune-collector/src/commands/stop.ts`
- `/packages/harnesstune-collector/src/commands/status.ts`
- `/packages/harnesstune-collector/src/commands/install.ts`

## Deviations

- **12-01-PLAN.md not found**: The plan file did not exist in the repository at the start of execution. The implementation was derived directly from `12-CONTEXT.md` (decisions D-01 through D-05) and the canonical refs listed there. All structure and behavior matches the CONTEXT.md spec exactly.
- **`src/types.ts` added**: A local `AgentIdentity` type was added to avoid importing extension-side code (`src/types/workspace.ts`) from the collector package. This is a clean architectural boundary consistent with D-01's rationale (avoiding premature abstraction).
- **`PluginScheduler.uploadRuns()` uses `run_batch` report type**: The relay currently accepts generic report envelopes. Phase 13+ will use the proper `RunReport[]` relay endpoints (`POST /channels/:id/runs`) once the relay endpoints are targeted from the collector. The scheduler is structured to make this a localized change.

## Self-Check

PASSED

- All 5 subcommands implemented: `setup`, `start`, `stop`, `status`, `install`
- Plugin interface matches D-03 spec: `detect()`, `setup()`, `discover()`, `collectRuns(since)`
- All 4 platform stubs created and statically linked in loader
- Config at `~/.harnesstune/` (global, not per-project) per D-04
- `chmod 600` applied to `collector.json` per D-04
- `HARNESSTUNE_TOKEN` env var override in `resolveToken()` per D-05
- Launchd plist injects token into `EnvironmentVariables` per D-05
- Foreground process, launchd handles backgrounding per D-02
- TypeScript build: clean (0 errors, 0 warnings)
- All files committed atomically across 6 commits
