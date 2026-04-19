# HarnessTune v2.0 — Domain Pitfalls

**Domain:** Remote relay communication + CLI daemons + async messaging added to existing local-first VSCode extension
**Researched:** 2026-04-19
**Milestone:** v2.0 Remote Agent Management (subsequent milestone)
**Confidence:** HIGH for Vercel/Turso constraints (official docs), MEDIUM for CLI daemon patterns (community sources), HIGH for TypeScript/adapter patterns (direct codebase inspection)

---

## Summary

v2.0 adds three new components (harnesstune-relay, harnesstune-agent, RemoteAdapter) and converts the existing single-package repo into a multi-package monorepo. The existing codebase is clean — the `AgentBackendAdapter` interface is narrow, `WorkspaceRecord` has a hardcoded `BackendType` union, and the webview message contracts are unversioned. These are the primary integration surfaces where changes will cause silent breakage.

The most dangerous pitfalls are:
1. The existing `BackendType = 'claude-code' | 'openclaw'` union type is in two files (`types/workspace.ts` and `adapters/AdapterFactory.ts`) and will need coordinated updates when `'remote'` is added.
2. Vercel Hobby plan caps function invocations at 100K/month — with aggressive polling from multiple agents this is reachable in days.
3. The Vercel 4.5MB response payload limit will be hit by any agent that accumulates a large report history in a single fetch.
4. The harnesstune-agent daemon has no natural death on macOS — orphaned processes accumulate silently.
5. The relay API token comparison must use `crypto.timingSafeEqual` from day one; string equality leaks timing information.

---

## Critical Pitfalls

Must address. Skipping any of these causes rewrites or security incidents.

---

### Pitfall 1: BackendType Union Duplication Breaks Adapter Discovery

**What goes wrong:** `BackendType` is defined twice — in `src/types/workspace.ts` (`'claude-code' | 'openclaw'`) and again in `src/adapters/AdapterFactory.ts` (same union). Adding `'remote'` to one file without the other compiles fine but causes `AdapterRegistry.create()` to throw "No adapter factory registered for backendType: remote" at runtime. TypeScript cannot catch this because both types are structurally compatible.

**Why it happens:** The two type definitions are not linked by reference. They are independent literal unions that happen to be identical. This was acceptable with two values but becomes a maintenance trap with three.

**Consequences:** Remote workspaces silently fail to connect. The error message gives no indication that the type definition is the cause. Debugging requires tracing the registry lookup chain.

**Prevention:**
- Before writing any v2.0 code, consolidate `BackendType` into a single canonical location in `src/types/workspace.ts` and re-export it from `src/adapters/AdapterFactory.ts`.
- Add `'remote'` to the canonical definition and update the `WorkspaceRecord` type in the same commit.
- Add a compile-time exhaustiveness check in `AdapterRegistry.create()` using a `never` assertion to catch missing registrations at build time.

**Detection:** TypeScript errors if you consolidate first. Runtime `Error: No adapter factory registered` if you don't.

**Phase:** Address in Phase 1 of v2.0 (pre-work / monorepo setup) before writing RemoteAdapter.

---

### Pitfall 2: Webview Message Contracts Have No Version Field

**What goes wrong:** The existing `HostToWebviewMessage` and `WebviewToHostMessage` union types in `src/types/messages.ts` have no version discriminator. v2.0 adds new message types for remote workspaces (`workspace:addRemote`, `remote:reportFetched`, `remote:messageSent`, etc.). If the webview bundle is cached from v1.0 (VSCode caches webview content aggressively) and the extension host sends a v2.0 message, the webview silently ignores it — no error, just missing UI updates.

**Why it happens:** VSCode's webview `getState/setState` and `WebviewPanelSerializer` can restore a stale webview bundle from a previous session. The mismatch is invisible because unknown message types fall through switch statements without throwing.

**Consequences:** Users upgrade to v2.0, open existing panels, and see remote workspaces appear in the sidebar but not in the dashboard — because the dashboard webview is running v1.0 bundle code that doesn't handle the new message types.

**Prevention:**
- Add a `version` field to all messages: `{ type: 'workspaces:update'; version: 2; workspaces: WorkspaceRecord[] }`.
- In each webview's message handler, check the version field. If it mismatches, post a `{ type: 'ready' }` message back to the host to trigger a full state refresh, which forces the host to resend with the current version.
- On any new `type` addition, add it to the union type and update the webview switch exhaustively.

**Detection:** Missing UI updates for remote workspaces after upgrade, with no error in the console.

**Phase:** Address at the start of RemoteAdapter implementation (Phase 3 of v2.0).

---

### Pitfall 3: Vercel Hobby Plan Invocation Exhaustion from Agent Polling

**What goes wrong:** Vercel Hobby plan allows 100K function invocations per month. Each agent poll cycle is one invocation (GET /messages). At a 5-minute polling interval with 3 agents: 3 agents × 288 polls/day × 30 days = 25,920 invocations/month. Safe. At 1-minute intervals with 10 agents: 10 × 1440 × 30 = 432,000/month. This exceeds the limit within the first week and takes the relay offline for the rest of the month.

**Why it happens:** Polling intervals feel small individually. The multiplication effect across multiple agents across a month is not intuitive. Vercel does not throttle — it stops serving traffic when the cap is hit, which means both agents and the extension lose relay access silently.

**Consequences:** The relay goes offline. Agents queue reports locally (if local queue is implemented) or drop them (if not). The extension shows all remote workspaces as unreachable. No error message explains why.

**Prevention:**
- Set a minimum polling interval of 5 minutes in the harnesstune-agent default config. Never allow < 2 minutes.
- Add a per-month invocation counter to the relay dashboard so users can see consumption before hitting the cap.
- Implement conditional GET: relay returns `304 Not Modified` when no new messages exist. This makes each poll a single lightweight HTTP round trip without executing significant function logic, and Vercel still counts it as an invocation — so the prevention is interval discipline, not response optimization.
- Document the invocation math in the agent setup guide with a table: N agents × interval → monthly invocations.

**Detection:** All remote workspaces show as offline. Vercel dashboard shows invocation count near or at 100K. No other warning.

**Phase:** Address in Phase 1 of v2.0 (relay design). Document limits before agent CLI is published.

---

### Pitfall 4: Report Payload Exceeds Vercel 4.5MB Limit

**What goes wrong:** Vercel serverless functions have a hard 4.5MB limit on both request and response bodies. A daily briefing report with embedded tool call details, large context summaries, or accumulated history can easily exceed this. A ralph loop report with 50+ iterations including per-iteration diffs will exceed it. The relay returns a `413 FUNCTION_PAYLOAD_TOO_LARGE` or `500 FUNCTION RESPONSE PAYLOAD TOO LARGE`. The extension receives an error response and has no report to display.

**Why it happens:** Report schemas designed without size constraints grow naturally over time. Agents include more detail. Ralph loops run longer. Nobody notices until the first large report fails.

**Consequences:** Reports silently fail to upload (agent side) or fail to fetch (extension side). The relay API returns an HTTP error code but the error is easy to swallow in a polling loop. The user sees stale data in the extension UI.

**Prevention:**
- Enforce a maximum report size of 2MB at the agent before upload: measure serialized JSON size and truncate or paginate.
- Design the relay API to return paginated report lists, not the full report body in a single response. `GET /reports?limit=10&cursor=...` returns metadata only; `GET /reports/:id` returns the full body for one report.
- For ralph loop reports, store only the delta and cumulative summary in the relay; large raw diffs stay on the remote machine and are only fetched on demand.
- Add an explicit size check in the relay upload handler and return a `413` with a descriptive message body pointing to the pagination API.

**Detection:** HTTP 413 or 500 from relay during report upload or fetch. Extension shows "failed to fetch reports" without detail.

**Phase:** Address in Phase 1 of v2.0 (relay API design). Pagination must be in the API contract from the start — retrofitting it breaks all existing harnesstune-agent clients.

---

### Pitfall 5: Token Comparison Using String Equality (Timing Attack)

**What goes wrong:** The relay API receives `Authorization: Bearer <token>` on every request. If the relay compares the token with `=== ` or `!==`, the comparison short-circuits on the first mismatched byte. A remote attacker making thousands of requests can measure response time to enumerate valid token prefixes byte-by-byte, gradually reconstructing a valid token.

**Why it happens:** String equality is the natural first implementation. The vulnerability is non-obvious and has no functional test failure — it works correctly for valid/invalid tokens but leaks timing information.

**Consequences:** API tokens can be extracted by a patient attacker using timing measurements. In the relay model where a single token grants full access to an agent's workspace data, this is a critical breach.

**Prevention:**
- Use `crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(storedToken))` for all token comparison in the relay. This is built into Node.js `crypto` module — no external dependency required.
- Ensure both buffers are the same length before comparing (length difference leaks information too). If lengths differ, compare against a dummy buffer of the correct length and always return false.
- Add a test that verifies `timingSafeEqual` is used in the auth middleware, not string equality.

**Detection:** No functional test will catch this. Code review only. Add a lint rule or grep check for `=== token` patterns in the relay auth path.

**Phase:** Address in Phase 1 of v2.0 (relay auth design). Non-negotiable before public deployment.

---

### Pitfall 6: API Token Leakage in Logs

**What goes wrong:** The harnesstune-agent CLI is a Node.js process that logs HTTP requests for debugging. If the agent or relay logs the full `Authorization` header, the token appears in plaintext in log files on both the remote machine and the Vercel function logs. Vercel logs are retained and accessible to anyone with Vercel account access. Agent machine logs may be tailed or shipped to a log aggregator.

**Why it happens:** Debug logging libraries (axios interceptors, `fetch` wrappers, `morgan`, `hono` logger) log headers by default. Developers add debug logging during development and forget to strip token headers.

**Consequences:** Tokens in Vercel logs are visible to anyone with Vercel project access. Tokens in agent machine logs may be shipped to Datadog/Loki/etc. and visible to multiple parties. Leaked tokens grant full relay access for that agent's workspace.

**Prevention:**
- Add a `sanitizeHeaders` step to all HTTP logger middleware in both relay and agent: redact `Authorization` to `Bearer [REDACTED]` before logging.
- In the agent CLI, never log the full URL if the token is passed as a query parameter (design: always use `Authorization` header, never query params).
- At relay startup, log token hashes (SHA-256 first 8 chars) not the raw token, so logs are useful for debugging without exposing the value.
- Add a pre-commit hook or CI lint step that greps for `token` + `console.log` or `logger.info` in the same context.

**Detection:** Grep Vercel function logs for `Authorization: Bearer` patterns after first deployment. If found, rotate all tokens immediately.

**Phase:** Address in Phase 1 of v2.0 (relay design) and Phase 2 (agent CLI design).

---

## Moderate Pitfalls

Should address. Skipping causes operational problems or user confusion.

---

### Pitfall 7: Orphaned harnesstune-agent Processes on macOS

**What goes wrong:** The harnesstune-agent CLI is run as a background process via `npx harnesstune-agent start`. When the user's shell session ends, when the machine sleeps, or when the agent is "stopped" via the extension UI, the process may not terminate cleanly. On macOS, orphaned Node.js processes accumulate, consume CPU at idle, and spin fans. Restarting the agent creates a second instance polling the same workspace — causing duplicate report uploads.

**Why it happens:** Node.js processes survive shell exit by default. Without explicit SIGTERM/SIGINT handling and a PID file, there is no reliable way to detect or kill a previous instance. `npx` does not manage process lifecycle.

**Consequences:** Duplicate reports in the relay (two agents uploading for the same workspace). CPU/fan spin on the remote machine. "Agent is already running" confusion for users.

**Prevention:**
- Write a PID file to a well-known location (`~/.harnesstune/agent-<workspaceId>.pid`) on startup.
- On startup, check if the PID file exists and if the process is alive (`process.kill(pid, 0)` — throws if dead). If alive, exit with "agent already running for this workspace". If dead, overwrite the stale PID file.
- Register `SIGTERM`, `SIGINT`, and `SIGHUP` handlers that: flush any pending reports, delete the PID file, and `process.exit(0)`.
- Provide a `npx harnesstune-agent stop --workspace <id>` subcommand that reads the PID file and sends SIGTERM.
- On macOS, document the `launchd` plist approach for running as a true background service with automatic restart.

**Detection:** Multiple entries in relay for the same agent ID. Remote machine shows multiple `node` processes with `harnesstune-agent` in the command.

**Phase:** Address in Phase 2 of v2.0 (agent CLI design).

---

### Pitfall 8: Cold Start Latency Degrades First-Poll UX

**What goes wrong:** Vercel serverless functions cold-start when they haven't been invoked recently. Cold start for a Node.js function with a Turso HTTP connection takes 300-800ms. The harnesstune-agent's first poll after a period of inactivity hits this cold start, which can push total round-trip time to 1-2 seconds. On Hobby plan, archived functions (invoked < once per 7 days) add at least 1 additional second to the cold start. The extension's RemoteAdapter shows a workspace as "connecting" for several seconds on first load.

**Why it happens:** Serverless functions are stateless and scale to zero between invocations. This is a fundamental tradeoff of the serverless model.

**Consequences:** Sluggish first-load experience. Users click on a remote workspace and wait 2-3 seconds for the first data — compared to instant local workspace loading in v1.0.

**Prevention:**
- Set a generous connection timeout in the RemoteAdapter (8 seconds for first poll, 5 seconds thereafter).
- Show a "connecting to relay" loading state in the workspace sidebar rather than showing the workspace as "error" during the cold-start window.
- Keep the relay function bundle small: avoid large dependencies that increase cold-start time. Hono is the right choice over Express for this reason (smaller bundle).
- Consider a lightweight `/ping` endpoint in the relay that the extension pings on startup to warm the function before the first real poll.

**Detection:** Consistent 1-3 second delays on first remote workspace load, followed by normal response times.

**Phase:** Address in Phase 1 of v2.0 (relay design) and Phase 3 (RemoteAdapter implementation).

---

### Pitfall 9: Local Queue Grows Without Bound When Relay Is Down

**What goes wrong:** When the relay is unreachable, the harnesstune-agent queues reports locally for retry. If the relay is down for hours or days (Vercel outage, network partition, Hobby plan cap exhaustion), the queue grows until it fills the agent machine's disk or memory. A 6-hour reporting interval with rich reports could queue 20-50 reports over a multi-day outage.

**Why it happens:** Retry queues without eviction policies grow indefinitely. The agent has no way to know when the relay will return, so it keeps queuing.

**Consequences:** Disk pressure on the remote machine. Memory pressure if the queue is in-memory. When the relay returns, the agent sends a burst of queued reports simultaneously — which may itself hit Vercel's payload or rate limits.

**Prevention:**
- Implement a bounded queue: maximum 48 reports (48 hours at 1-hour interval). When full, drop the oldest report and log a warning.
- Store the queue on disk (JSON file or SQLite), not in memory — agent restarts should not lose the queue.
- On relay recovery, replay queued reports with a minimum 5-second delay between uploads to avoid a burst that hits Vercel limits.
- Add a queue depth metric to the agent status that the extension can display: "12 reports queued, relay unreachable".

**Detection:** harnesstune-agent log shows repeated "relay unreachable, queuing report" entries. Queue file grows in `~/.harnesstune/queue/`.

**Phase:** Address in Phase 2 of v2.0 (agent CLI design).

---

### Pitfall 10: Thundering Herd on Simultaneous Agent Polls

**What goes wrong:** If multiple agents are configured with the same polling interval (e.g., every 5 minutes) and start at the same time, they all poll the relay at exactly T+0:00, T+5:00, T+10:00, etc. Each poll is one Vercel invocation. With 10 agents at 5-minute intervals, this is 10 simultaneous cold-starts every 5 minutes — Vercel spins up 10 function instances simultaneously. On Hobby plan this accelerates invocation consumption and may trigger rate limiting.

**Why it happens:** Deterministic start times create synchronized polling. The default interval is the same for all agents out of the box.

**Consequences:** Invocation spikes every N minutes rather than smooth distribution. Higher cold-start probability per poll. Faster consumption of the 100K/month Hobby limit.

**Prevention:**
- Add jitter to the polling interval: `actualInterval = configuredInterval + Math.random() * 60_000` (up to 60 seconds of random offset per cycle).
- Initialize the first poll with a random delay: `firstPollDelay = Math.random() * configuredInterval` so agents that start simultaneously don't all fire at T+0.
- The relay should be stateless enough that concurrent polls are not a problem — but jitter prevents the unnecessary invocation spike.

**Detection:** Vercel invocation graph shows regular spikes at fixed intervals. Each spike height equals the number of active agents.

**Phase:** Address in Phase 2 of v2.0 (agent CLI design). One-line fix, high leverage.

---

### Pitfall 11: Turso Connection State Across Cold Starts

**What goes wrong:** The Turso `@libsql/client` (or `@tursodatabase/serverless`) client is initialized once per Vercel function instance. In theory, serverless functions are stateless. In practice, Vercel re-uses warm function instances within the same invocation window. The Turso HTTP client uses WebSocket for performance when available. If the WebSocket connection is held open across invocations and the Turso server closes it (server-side idle timeout), the next invocation gets a broken connection that appears alive until the first query fails.

**Why it happens:** Vercel's function reuse ("warm starts") creates a pseudo-persistent state that serverless code doesn't expect to manage.

**Consequences:** First query after a warm start with a stale connection throws a connection error. The relay returns a 500 to the agent. The agent retries on next poll. Under heavy load, many warm instances can have stale connections simultaneously, causing a burst of 500 errors.

**Prevention:**
- Use Turso's `@tursodatabase/serverless` package which is designed for serverless contexts and does not use persistent WebSocket connections.
- Initialize the client inside the request handler function, not at module scope — this ensures a fresh connection per invocation.
- Wrap all Turso queries in a try/catch that reconnects on connection error rather than letting the 500 propagate to the caller.

**Detection:** Sporadic 500 errors from relay that resolve on retry. No pattern by agent or request type — any endpoint can fail.

**Phase:** Address in Phase 1 of v2.0 (relay design). Architecture decision, not a fix to retrofit.

---

### Pitfall 12: Mixing Local and Remote Workspace State in the Extension

**What goes wrong:** The existing `WorkspaceRegistry` stores all workspaces in a single JSON file with a flat list. v1.0 workspaces are local (identified by `rootPath`). v2.0 remote workspaces need `relayUrl` + `agentToken` instead of `rootPath`. If both are stored in the same `WorkspaceRecord` struct, optional fields proliferate: `rootPath` is undefined for remote, `relayUrl` is undefined for local. The registry has no way to enforce which fields are required for which type.

**Why it happens:** The `WorkspaceRecord` type was designed for local workspaces only. Adding optional fields is the path of least resistance but creates a discriminated union without the discriminant.

**Consequences:** The adapter layer receives a `WorkspaceConnectionConfig` with undefined fields. `AdapterRegistry.create()` creates an adapter for the wrong type. Downstream components have to defensively check for undefined everywhere.

**Prevention:**
- Add a `mode: 'local' | 'remote'` discriminant to `WorkspaceRecord` before writing any RemoteAdapter code.
- Use TypeScript discriminated union narrowing: `if (workspace.mode === 'remote')` branches are type-safe.
- Migrate the existing registry file: add `version: 2` and `mode: 'local'` to all existing records. The registry `load()` already handles `version` mismatches — extend the migration logic.
- Store `authToken` for remote workspaces in `SecretStore` (already done for local `apiKey`) — never in the registry JSON file.

**Detection:** TypeScript errors if you add the discriminant and type-narrow correctly. Runtime `undefined` errors if you don't.

**Phase:** Address in pre-work / monorepo setup before any v2.0 feature work.

---

### Pitfall 13: npx Package Version Drift Between Agent and Relay

**What goes wrong:** `npx harnesstune-agent` downloads the latest published version of the package. If the relay API changes its request/response shape between harnesstune-agent v1.x and v2.x, an agent running a cached or outdated npx version will fail with unclear HTTP errors. Conversely, if the relay is updated before agents are updated, agents sending the old report format get 400 errors with no guidance on what changed.

**Why it happens:** `npx` caches the last-downloaded version in npm's cache directory. Users may not re-run `npx harnesstune-agent` for weeks. The relay is updated independently on every Vercel deploy.

**Consequences:** Agents silently fail to upload reports. The extension shows the remote workspace as stale. Users have no indication that their agent CLI is out of date.

**Prevention:**
- Version the relay API with a mandatory `X-Agent-Version` request header. The relay rejects requests from incompatible versions with a `426 Upgrade Required` response and a human-readable message: "harnesstune-agent 1.x is not compatible with this relay. Run: npx harnesstune-agent@2 start".
- Design the report schema with a `schemaVersion` field so the relay can handle multiple versions simultaneously during transition periods.
- Publish a `harnesstune-agent@latest` tag and document that users should use `npx harnesstune-agent@latest` (not a pinned version) unless they need stability.

**Detection:** 400 or 426 errors from relay in agent logs. Report upload failures with no other explanation.

**Phase:** Address in Phase 1 of v2.0 (relay API design). The `X-Agent-Version` header must be in the API from the first release.

---

## Low-Risk Pitfalls

Nice to handle. Minor friction if skipped.

---

### Pitfall 14: Vercel Hobby Plan 10-Second Timeout on Report Writes

**What goes wrong:** Vercel Hobby plan limits function execution to 10 seconds. A report upload that hits a cold-start Turso connection and writes a large JSON blob could exceed this. On Pro plan the limit is 60 seconds, which is effectively never a problem for simple mailbox operations.

**Prevention:** Keep relay functions simple — single-query read or write operations. No processing, no transformation, no aggregation in the relay. The relay is a dumb mailbox; all logic is in the agent and extension. This is the existing architectural intent and naturally avoids the timeout.

**Phase:** By design in Phase 1 of v2.0. No special work needed if relay stays dumb.

---

### Pitfall 15: Monorepo Build Order — Types Package Must Build First

**What goes wrong:** When extracting shared types into a `packages/harnesstune-types` package (to share between relay, agent, and extension), TypeScript project references require the types package to be built before any consumer. If the root build script runs `tsc --build` across all packages without respecting references, consumers may compile against stale `.d.ts` files.

**Prevention:**
- Use TypeScript project references (`tsconfig.json` with `"references": [{ "path": "./packages/harnesstune-types" }]`) in all consumer packages.
- In the root `package.json`, build with `tsc --build` at root level — TypeScript resolves build order from the reference graph automatically.
- Add a `postinstall` script or CI step that validates all package builds succeed before running tests.

**Phase:** Address in monorepo setup phase. Standard TypeScript pattern.

---

### Pitfall 16: Agent Cannot Force Report Generation

**What goes wrong:** The harnesstune-agent CLI cannot directly cause an AI agent (Claude Code, OpenClaw) to generate a structured daily briefing report. The agent CLI can only read what the AI agent produces. If the AI agent doesn't write a report file or produce structured output, the harnesstune-agent has nothing to upload.

**Why it happens:** The AI agent (Claude Code) operates autonomously. The harnesstune-agent is a sidecar, not a controller. It observes but cannot compel.

**Consequences:** Reports depend entirely on the AI agent's output discipline. An AI agent that doesn't self-report produces no data for the relay.

**Prevention:**
- Design the daily briefing report as an opt-in feature: harnesstune-agent watches a well-known directory (`~/.harnesstune/reports/`) for new files. The AI agent's CLAUDE.md instructs it to write structured reports there.
- Provide a report template that CLAUDE.md instructions reference. The AI agent fills the template; the harnesstune-agent detects and uploads the file.
- Alternatively, harnesstune-agent can construct a minimal "heartbeat" report from observable signals (process alive, last file modification time, log tail) without AI agent cooperation. This is always available even if the AI agent doesn't self-report.
- Do not promise "the agent will always produce reports" — document that report quality depends on the AI agent's configuration.

**Phase:** Address in Phase 2 of v2.0 (agent CLI design). The convention for report file location and format must be agreed between the agent CLI and the AI agent's CLAUDE.md instructions.

---

### Pitfall 17: Token Rotation Without Downtime

**What goes wrong:** If a token is compromised, the user needs to rotate it. Token rotation requires: generate a new token on the relay, copy it to the extension (SecretStore), copy it to the remote machine and restart harnesstune-agent. During this window, the old token still works (the relay doesn't immediately revoke it) or doesn't work (the relay revokes it before the agent restarts). Either way, there's a potential gap.

**Prevention:**
- Relay should support a brief grace period: when a new token is generated for a workspace, the old token remains valid for one additional poll cycle (5-15 minutes) before being revoked.
- The extension's "Configure Remote Workspace" dialog should provide a guided token rotation flow with explicit steps.

**Phase:** Address in Phase 1 of v2.0 (relay auth design). Design the rotation endpoint from the start.

---

### Pitfall 18: Large Report Summaries in Memory on Extension Side

**What goes wrong:** The RemoteAdapter fetches reports from the relay and holds them in memory in the extension host. If reports are fetched eagerly for all remote workspaces on extension startup, and each report is 500KB, 10 remote workspaces = 5MB in extension host memory at startup. Combined with existing WebviewPanel memory usage (80-150MB each), this contributes to memory pressure.

**Prevention:**
- Fetch report metadata (ID, timestamp, title, size) eagerly. Fetch full report body lazily, only when the user opens the report view for a specific workspace.
- Cache the last-fetched report per workspace; don't re-fetch if the timestamp hasn't changed.

**Phase:** Address in Phase 3 of v2.0 (RemoteAdapter + extension integration).

---

## Prevention Matrix

| Pitfall | Severity | Phase to Address | Strategy |
|---------|----------|-----------------|----------|
| BackendType union duplication | Critical | Pre-work / monorepo setup | Consolidate to single definition, add `'remote'`, exhaustiveness check |
| Webview message contract unversioned | Critical | Phase 3 v2.0 (RemoteAdapter) | Add `version` field to all message types, version-mismatch refresh trigger |
| Vercel Hobby invocation exhaustion | Critical | Phase 1 v2.0 (relay design) | Min 5-min poll interval, invocation counter, interval documentation |
| Vercel 4.5MB payload limit | Critical | Phase 1 v2.0 (relay design) | Paginated report API, 2MB agent-side enforcement, metadata-only list endpoint |
| Timing attack on token comparison | Critical | Phase 1 v2.0 (relay auth) | `crypto.timingSafeEqual` everywhere, length-normalize before compare |
| Token leakage in logs | Critical | Phase 1-2 v2.0 | Sanitize `Authorization` header in all loggers, never log raw token |
| Orphaned agent process on macOS | Moderate | Phase 2 v2.0 (agent CLI) | PID file, SIGTERM/SIGINT handlers, `stop` subcommand |
| Cold start latency | Moderate | Phase 1 + 3 v2.0 | 8-second connection timeout, "connecting" loading state, small relay bundle, `/ping` warm-up |
| Local queue grows unbounded | Moderate | Phase 2 v2.0 (agent CLI) | 48-report bounded queue, disk persistence, rate-limited replay |
| Thundering herd on polls | Moderate | Phase 2 v2.0 (agent CLI) | Jitter on interval (`+Math.random() * 60s`), random first-poll delay |
| Turso stale connection on warm start | Moderate | Phase 1 v2.0 (relay design) | `@tursodatabase/serverless` package, client initialized per-request not module-scope |
| Local/remote state mixing in registry | Moderate | Pre-work / monorepo setup | `mode: 'local' | 'remote'` discriminant, registry migration to version 2 |
| npx version drift vs relay API | Moderate | Phase 1 v2.0 (relay design) | `X-Agent-Version` header, 426 rejection with upgrade message, `schemaVersion` in reports |
| Vercel 10-second timeout | Low | Phase 1 v2.0 (by design) | Keep relay as dumb mailbox, no processing logic in functions |
| Monorepo build order | Low | Monorepo setup | TypeScript project references, `tsc --build` at root |
| Agent cannot force report generation | Low | Phase 2 v2.0 (agent CLI) | Watch well-known directory, heartbeat report as fallback, CLAUDE.md instructs report writing |
| Token rotation downtime | Low | Phase 1 v2.0 (relay auth) | Grace period for old token, guided rotation flow in extension |
| Report memory pressure in extension | Low | Phase 3 v2.0 (RemoteAdapter) | Lazy fetch full body, cache last-fetched, metadata-only on startup |

---

## Sources

### HIGH Confidence (Official Documentation)
- [Vercel Functions Limitations](https://vercel.com/docs/functions/limitations) — 4.5MB payload, function size limits
- [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby) — 100K invocation limit (monthly)
- [FUNCTION_PAYLOAD_TOO_LARGE — Vercel Docs](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE) — 413 error behavior
- [What can I do about Vercel Functions timing out?](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out) — Hobby 10s, Pro 60s confirmed
- [Turso Serverless JavaScript Driver](https://turso.tech/blog/introducing-turso-serverless-javascript-driver) — `@tursodatabase/serverless` recommended for serverless contexts
- [Node.js crypto.timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequalbuf1-buf2) — built-in constant-time comparison
- [Timing Attacks in Node.js](https://dev.to/silentwatcher_95/timing-attacks-in-nodejs-4pmb) — timing attack mechanics

### MEDIUM Confidence (Verified Against Multiple Sources)
- [How to bypass Vercel body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions) — 4.5MB request body confirmed
- [Vercel Hobby invocation limit discrepancy thread](https://community.vercel.com/t/vercel-hobby-plan-function-invocation-limit-discrepancy-1-million-vs-100k-notification/32767) — confirms 100K/month enforcement
- [Turso libSQL Edge Database](https://docs.turso.tech/libsql) — connection model documentation
- [Thundering herd mitigation patterns](https://medium.com/@venkteshsubramaniam/the-thundering-herd-distributed-systems-rate-limiting-9128d20e1f00) — jitter strategy confirmed
- [npm Token Leak via Snyk](https://security.snyk.io/vuln/SNYK-DOTNET-NPM-60200) — token leakage patterns
- Direct codebase inspection: `src/types/workspace.ts`, `src/types/messages.ts`, `src/adapters/AdapterFactory.ts`, `src/adapters/AgentBackendAdapter.ts`, `src/adapters/AdapterRegistry.ts`, `src/registry/WorkspaceRegistry.ts`, `src/secrets/SecretStore.ts`, `package.json`

---

*Researched: 2026-04-19*
*Milestone: v2.0 Remote Agent Management*
*Feeds: Roadmap phase design for all v2.0 phases*
