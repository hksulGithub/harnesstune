---
phase: 12
plan: 12-02
status: complete
---

# Summary: Plan 12-02

## What was built

CLI entry point, daemon modules, and all 5 subcommands for `harnesstune-collector`.

**Task 12-02-T1** — CLI entry point + heartbeat + scheduler:
- `cli.ts`: shebang, `--dry-run` flag stripping, switch on 5 subcommands, `process.exit(1)` default
- `daemon/heartbeat.ts`: `sendHeartbeat(config, queue, status, plugins)` using `resolveToken(config)` and direct `fetch`, enqueues on failure
- `daemon/scheduler.ts`: `runCycle(plugins, config, queue, cursors)` function iterating enabled plugins, calling `discover()` + `collectRuns(since)`, uploading runs, advancing cursors, calling `queue.replay()`

**Task 12-02-T2** — All 5 subcommand files:
- `commands/setup.ts`: readline prompts for relay URL + machine name, `POST /api/channels`, platform detect loop, `writeConfig` with chmod 600
- `commands/start.ts`: PID duplicate detection, `writePid`, connected heartbeat, `setInterval` heartbeat timer (unref'd), `runCycle` poll loop with exponential backoff + jitter, `writeStatus` after each cycle, graceful `SIGTERM`/`SIGINT`/`SIGHUP` shutdown sending disconnected heartbeat
- `commands/stop.ts`: reads PID file, sends `SIGTERM`, cleans stale PID on `ESRCH`
- `commands/status.ts`: `kill(pid, 0)` liveness check, prints "Collector is RUNNING" / "Collector is NOT RUNNING", reads status file with uptime and per-plugin info
- `commands/install.ts`: generates launchd plist with `RunAtLoad`, `KeepAlive`, `HARNESSTUNE_TOKEN` env injection, `chmodSync(PLIST_PATH, 0o600)`, `launchctl load`
- `plugins/loader.ts`: added `export` to `ALL_PLUGINS` constant

## Key files created/modified

- `packages/harnesstune-collector/src/cli.ts` — verified already correct, no change needed
- `packages/harnesstune-collector/src/daemon/heartbeat.ts` — rewritten to use `CollectorConfig` + `resolveToken` pattern (was using `CollectorRelayClient`)
- `packages/harnesstune-collector/src/daemon/scheduler.ts` — rewritten as `runCycle()` function (was a `PluginScheduler` class with `poll()` method)
- `packages/harnesstune-collector/src/commands/start.ts` — rewritten to use `runCycle()` and direct `sendHeartbeat(config, ...)` signatures
- `packages/harnesstune-collector/src/commands/setup.ts` — verified correct, no change needed
- `packages/harnesstune-collector/src/commands/stop.ts` — verified correct, no change needed
- `packages/harnesstune-collector/src/commands/status.ts` — added "Collector is RUNNING" / "Collector is NOT RUNNING" output lines
- `packages/harnesstune-collector/src/commands/install.ts` — added `chmodSync(PLIST_PATH, 0o600)` after plist write
- `packages/harnesstune-collector/src/plugins/loader.ts` — exported `ALL_PLUGINS` constant

## Deviations

**Design deviation corrected:** Plan 12-01 had implemented `heartbeat.ts` using a `CollectorRelayClient` abstraction and `scheduler.ts` as a `PluginScheduler` class, which diverged from the plan 12-02 spec. These were rewritten to match the plan's function-based API (`sendHeartbeat(config, queue, ...)` and `runCycle(plugins, config, queue, cursors)`). The `CollectorRelayClient` (`client.ts`) and `createClient()` remain in the package but are no longer used by the daemon path.

**`queue.replay()` signature:** The existing `RetryQueue.replay(client, channelId)` takes a `RelayClient` object and `channelId`. The new `scheduler.ts` constructs an inline relay client object to pass to `queue.replay()`, matching the existing queue interface without changing it.

## Self-Check

PASSED

- All T1 acceptance criteria verified: `sendHeartbeat` with `resolveToken(config)`, `randomUUID`, `queue.enqueue`, `plugins` in body; `runCycle` with `plugin.discover()`, `plugin.collectRuns(since)`, `queue.replay()`
- All T2 acceptance criteria verified: shebang, 5 case branches, `writePid`, `sendHeartbeat`, `runCycle`, `writeStatus`, `SIGTERM`/`SIGINT`/`SIGHUP`, `shuttingDown` guard, `process.kill(existingPid, 0)`, backoff formula, `ESRCH`, `readStatus()`, "Collector is RUNNING"/"NOT RUNNING", `com.harnesstune.collector`, `LaunchAgents`, `RunAtLoad`, `KeepAlive`, `HARNESSTUNE_TOKEN`, `chmodSync(PLIST_PATH, 0o600)`, `launchctl load`
- `tsc --build packages/harnesstune-collector` exits 0 with no type errors
- `STATE.md` and `ROADMAP.md` not modified
