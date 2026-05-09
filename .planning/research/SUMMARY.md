# Research Summary: HarnessTune v2.0 — Remote Agent Management

**Project:** HarnessTune v2.0 — Remote Agent Management
**Domain:** Remote relay communication + async agent reporting + CLI sidecar daemon added to a v1.0 local-first VSCode extension
**Researched:** 2026-04-19
**Confidence:** HIGH

---

## Executive Summary

HarnessTune v2.0 extends the existing local agent dashboard into a remote command center using a relay/mailbox pattern — a well-established async messaging architecture used by Azure, AWS, and purpose-built agent management tools like AgentMail. The pattern requires three new deployable units: a stateless relay API (Vercel serverless + Turso SQLite), an agent CLI sidecar that runs on each remote machine alongside the AI agent, and a RemoteAdapter inside the existing extension. The extension's v1.0 adapter interface, workspace registry, sidebar, and SecretStore are all designed in a way that makes remote integration additive — no rewrites required, only targeted extensions.

The recommended build order is strictly determined by dependencies: relay API first (everything else depends on it), then agent CLI (enables report upload and message polling), then extension type changes and RemoteAdapter, then the sidebar add-remote flow, then the ReportPanel UI. The relay must be designed right on the first pass — its API contract (pagination, `X-Agent-Version` header, paginated endpoints) is hard to retrofit without breaking deployed agents. The agent CLI and relay together form the "spine" of v2.0; the extension UI is the "face." Build the spine before the face.

The dominant risks are operational and security, not architectural. Vercel Hobby plan's 100K monthly invocation cap is reachable in days with aggressive polling intervals. Token comparison must use `crypto.timingSafeEqual` from day one. Two existing TypeScript types — `BackendType` (defined in two files) and `WorkspaceRecord` (no local/remote discriminant) — must be consolidated before any feature work begins. These are pre-work items, not phase items. Missing them causes silent runtime failures and TypeScript blind spots that compound across all subsequent phases.

---

## Key Findings

### Stack Additions

v2.0 adds a narrow, well-chosen dependency surface. No new libraries are needed in the extension — RemoteAdapter uses Node.js built-in `fetch` and the existing SecretStore. All new packages live in the two new monorepo packages.

**Core technologies:**
- **Hono `^4.12.14`** — HTTP framework for the relay; serverless-native, zero-config Vercel deployment, built-in bearer auth middleware, smaller bundle than Express.
- **@libsql/client `^0.17.2`** — Turso database client required by Drizzle ORM; use `./http` subpath for Vercel Node.js runtime compatibility.
- **drizzle-orm `^0.45.2` + drizzle-kit `^0.31.10`** — type-safe schema and migrations; critical for managing relay DB schema across multi-machine deployments without manual SQL.
- **zod `^4.3.6`** — request body validation at the relay boundary; native Hono integration.
- **commander `^14.0.3`** — CLI entry point for `npx harnesstune-agent`; industry standard, zero runtime deps.
- **node-cron `^4.2.1`** — scheduling report uploads and message polling cycles within the CLI daemon.
- **chokidar** (existing v1.0 dep) — file watching on remote machines; reused in agent CLI without adding a new dep.
- **Node.js built-in crypto** — token generation (`randomBytes`) and constant-time comparison (`timingSafeEqual`); no external auth library.

**Explicitly rejected:** Express, JWT/jsonwebtoken, PM2/forever, axios/got, Prisma, socket.io/ws. All rejections have clear rationale in STACK.md.

Full source: `.planning/research/STACK.md`

---

### Feature Landscape

The relay/mailbox is the dependency anchor — without it, nothing else in v2.0 is buildable. The MVP is a complete end-to-end loop: agent registers → uploads briefing → extension reads it → engineer can reply. Ralph loop reports and full async chat are v2.0-completeable but can trail the MVP.

**Must have (table stakes — cannot ship without):**
- Relay API: document store (channels + messages + reports), token-based auth with `?since=` cursor pagination, health check endpoint, one-command Vercel deploy
- Agent CLI: `npx` zero-install entry, registration, briefing report upload, message polling with exponential backoff, heartbeat, `--dry-run` flag, config file management
- Daily briefing report: goals / progress / blockers / next steps / metrics snapshot — universally applicable regardless of AI agent framework
- Remote workspace management: "Add Remote Workspace" command, sidebar integration alongside local workspaces, connection error states (network vs 401 vs stale)
- Report Timeline UI: chronological feed, briefing cards with blocker call-out, message composer, type filtering

**Should have (differentiators):**
- Ralph loop progress reports with convergence chart (D3 line chart, iteration × metric) — no prior art in agent management IDEs
- Blocker highlighting badge in sidebar (non-null `blockers` triggers red indicator)
- Stale report indicator (workspace dims if last briefing >48h old)
- Slash command routing (`/pause`, `/resume`, `/stop`) from async chat to local agent session
- `npx harnesstune-agent report` for on-demand report uploads
- Message TTL / auto-expiry to prevent unbounded Turso growth

**Defer to v2.1 without blocking v2.0:**
- Auto-synthesize briefing from log files (agent CLI parsing transcripts without AI cooperation)
- Multi-workspace morning summary rollup
- Loop comparison (A vs B)
- Inline report commenting with `in_reply_to_report_id` routing
- Framework auto-detection (Claude Code vs OpenClaw vs generic)
- Self-host LAN relay script

**Hard anti-features to enforce:** WebSocket/SSE on relay (Vercel cannot hold persistent connections), relay-side message schema validation (keep relay dumb), inbound HTTP server on agent machine (breaks outbound-only networking), token in settings.json (use SecretStore or local 0600 file).

Full source: `.planning/research/FEATURES.md`

---

### Architecture

The integration is fully additive. v1.0 local workspace behavior is entirely unchanged. `AgentBackendAdapter` interface: no modification. `AdapterRegistry`, `handleEvent()`, `SecretStore`, `HookServer`, `SchematicPanel`: zero changes. All modified components accept additive field additions only.

**Major components and responsibilities:**

1. **harnesstune-relay** — stateless Vercel serverless REST API; dumb document store only. Endpoints: channels (registration), reports (upload/list/fetch), messages (post/poll/ack). Turso schema: 4 tables (channels, tokens, reports, messages). Token stored as SHA-256 hash only; raw token shown once at registration.

2. **harnesstune-agent** — Node.js CLI daemon on remote machine. Internal modules: RegistrationClient, LocalAdapterDelegate, ReportScheduler, MessagePoller, InstructionRouter (stub acceptable for v2.0). Config in `~/.harnesstune-agent/<channel-id>.json`. PID file required for orphan detection.

3. **RemoteAdapter** — new implementation of `AgentBackendAdapter`; polling loop with `setInterval`; emits synthetic `AgentEvent` objects derived from report data into the existing `handleEvent()` pipeline. Uses `RelayClient` (thin fetch wrapper). No new npm deps in the extension.

4. **ReportPanel** — new `WebviewPanel` (separate from DashboardPanel); chronological report timeline, convergence chart (D3), MessageComposer. Opened via `harnesstune.showReports` command.

**Key patterns:**
- Two separate databases: extension's local sql.js (unchanged) and Turso (remote reports/messages). No schema coupling.
- Remote report data fetched on demand and cached in-memory in RemoteAdapter — not locally persisted in v2.0.
- `authToken` never in workspaces.json — SecretStore keyed by `workspaceId`.
- Report JSON payload typed by `report_type` field; relay stores opaque blob; clients own validation.

**Build order (dependency-driven):**
1. Relay API → 2. Agent CLI → 3. Extension type changes → 4. RemoteAdapter → 5. Sidebar add-remote flow → 6. ReportPanel UI → 7. End-to-end test

Full source: `.planning/research/ARCHITECTURE.md`

---

### Critical Pitfalls

Six pitfalls rise to "must address" severity (causes rewrite or security incident):

1. **BackendType defined in two files** — adding `'remote'` to one without the other compiles but silently fails at runtime. Fix: consolidate to single canonical source before any v2.0 code.

2. **WorkspaceRecord has no local/remote discriminant** — optional field proliferation without `mode: 'local' | 'remote'` breaks TypeScript narrowing throughout. Fix: add discriminant, migrate registry JSON to version 2. Pre-work, not a phase item.

3. **Vercel Hobby 100K invocation cap** — 10 agents × 1-min interval × 30 days = 432,000 invocations (4.3x cap). Fix: enforce minimum 5-min interval in CLI defaults; jitter every poll cycle by `+Math.random() * 60s`; document the math in setup guide.

4. **Vercel 4.5MB payload limit** — large briefings or long Ralph loops will exceed it. Fix: paginated report list API (metadata-only on list, full body on `/reports/:id`) must be in v2.0.0 contract — retrofitting breaks deployed agents.

5. **Token comparison using string equality** — short-circuits and leaks timing information. Fix: `crypto.timingSafeEqual` everywhere in relay auth; length-normalize buffers. Non-negotiable before public deployment.

6. **Token leakage in logs** — Hono logger and agent fetch wrapper log `Authorization` header. Fix: `sanitizeHeaders` middleware on relay; `Bearer [REDACTED]` in agent CLI logs; never use token as query parameter.

Additional moderate pitfalls: orphaned agent processes (PID file + signal handlers), cold start latency (8s timeout + "connecting" state), unbounded local retry queue (cap at 48 reports, disk-persist), Turso stale connection on warm starts (initialize client per-request), npx version drift vs relay API (`X-Agent-Version` header from day one), webview message contract versioning (add `version` field to all message types).

Full source: `.planning/research/PITFALLS.md`

---

## Implications for Roadmap

### Pre-Work: Monorepo + Type Consolidation

**Rationale:** Two TypeScript issues cause silent failures in every subsequent phase if not resolved first. Monorepo structure must also precede cross-package imports.
**Delivers:** `BackendType` consolidated to single definition with `'remote'` added; `mode: 'local' | 'remote'` discriminant on `WorkspaceRecord`; registry migrated to version 2; monorepo structure (`packages/harnesstune-relay`, `packages/harnesstune-agent`, root extension); TypeScript project references.
**Avoids:** Pitfalls 1 and 2 (BackendType duplication, local/remote state mixing), Pitfall 15 (monorepo build order).
**Research flag:** SKIP — standard TypeScript patterns.

---

### Phase 1: Relay API

**Rationale:** Every v2.0 feature depends on a callable relay. The relay's API contract (pagination shape, `X-Agent-Version` header, auth pattern) is taken as a dependency by all downstream packages — changing it after the fact breaks deployed agents. Design it right once.
**Delivers:** Live Vercel deployment; Turso schema (channels, tokens, reports, messages); full REST endpoint set; SHA-256 token hash auth with `crypto.timingSafeEqual`; paginated report list; `GET /health`; `X-Agent-Version` rejection; header sanitization in logger.
**Uses:** Hono, @libsql/client (./http), drizzle-orm + drizzle-kit, zod, @hono/node-server (dev only).
**Avoids:** Pitfalls 3 (invocation cap), 4 (payload limit — pagination in contract from day one), 5 (timing attack), 6 (token log leakage), 11 (Turso stale connection), 13 (version drift), 14 (10s timeout — dumb mailbox pattern).
**Research flag:** SKIP — Turso + Vercel + Hono officially documented with integration guides.

---

### Phase 2: Agent CLI (harnesstune-agent)

**Rationale:** The CLI is the agent's voice. Build against the live staging relay from Phase 1 for real integration testing.
**Delivers:** `npx harnesstune-agent` entry point; registration flow; daily briefing report upload; message polling (60s default + jitter); heartbeat; PID file + SIGTERM/SIGINT/SIGHUP handlers; `stop` subcommand; bounded local retry queue (48-report cap, disk-persisted); `--dry-run` flag.
**Uses:** commander, node-cron, chokidar (existing); Node.js built-in fetch + crypto.
**Implements:** RegistrationClient, LocalAdapterDelegate, ReportScheduler, MessagePoller (InstructionRouter stub acceptable for v2.0).
**Avoids:** Pitfalls 6 (token log leakage in agent), 7 (orphaned processes), 9 (unbounded queue), 10 (thundering herd), 16 (agent cannot force reports — watch well-known dir + heartbeat fallback).
**Research flag:** SKIP — sidecar daemon pattern is established; Commander and node-cron are standard.

---

### Phase 3: Extension Types + RemoteAdapter

**Rationale:** Lock TypeScript message contracts before building UI components — type churn after UI is written is expensive. RemoteAdapter enables sidebar and ReportPanel to be integration-tested against real relay data.
**Delivers:** New `HostToWebviewMessage` and `WebviewToHostMessage` variants (with `version` field); `ReportDocument`, `DailyBriefingReport`, `RalphLoopReport` types; `RemoteAdapter` with polling loop + synthetic `AgentEvent` emission; `RelayClient` fetch wrapper; `'remote'` registered in `AdapterRegistry`; lazy report body fetching (metadata on poll, full body on demand).
**Avoids:** Pitfall 2 (webview message versioning), 8 (cold start — 8s timeout + "connecting" state), 18 (report memory pressure — lazy fetch).
**Research flag:** SKIP — adapter interface pattern established in v1.0 codebase.

---

### Phase 4: Remote Workspace Management (Sidebar)

**Rationale:** Once RemoteAdapter can fetch data, expose the user-facing flow to add and manage remote workspaces. Makes remote workspaces first-class citizens in the sidebar alongside local ones.
**Delivers:** `harnesstune.addRemoteWorkspace` command (relay URL + token QuickInput, channel verification, SecretStore storage, registry.add); `WorkspaceRegistry.add()` extended for remote fields; `SidebarViewProvider` handler for `workspace:addRemote`; sidebar "Add Remote Workspace" UI path; status indicators (running/idle/error/stale); last-seen timestamp in sidebar row; relay URL grouping.
**Avoids:** Pitfall 17 (token rotation — design rotation endpoint alongside add-workspace flow).
**Research flag:** SKIP — workspace registry extension is a standard additive change; sidebar patterns established in v1.0.

---

### Phase 5: Report Timeline UI + Async Chat

**Rationale:** Build the UI last — it depends on stable types (Phase 3) and a working data source (RemoteAdapter). Report Timeline and Async Chat share the same WebviewPanel and timeline feed, so they are more efficient built together than separately.
**Delivers:** `ReportPanel` WebviewPanel with serializer; `ReportTimeline` React component (chronological feed, type filtering); `BriefingReportCard` with blocker call-out box; `RalphLoopReportCard` with +/- delta rendering; `RalphLoopChart` (D3 line chart, iteration × metric); `MessageComposer`; interleaved chat + reports in one timeline; inline reply on report cards; `harnesstune.showReports` command; paginated load (last 20, "Load more").
**Research flag:** MEDIUM confidence — convergence chart in a VSCode webview has no confirmed prior art. D3 in a sandboxed webview context may require specific CSP configuration. Prototype the chart component before committing full Phase 5 scope.

---

### Phase 6: Polish + Operational Hardening

**Rationale:** Close operational gaps before v2.0 ships. Plant seeds for v2.1 (framework auto-detection stub, report synthesis from logs).
**Delivers:** Message TTL / auto-expiry per channel type; invocation math documented in setup guide; multi-workspace morning digest command; blocker badge in sidebar; stale workspace dimming (>48h); `version` field audit across all webview message types; end-to-end integration test pass (remote machine → relay → extension round trip).
**Research flag:** SKIP — all operational patterns have clear prior art.

---

### Phase Ordering Rationale

- **Relay before everything:** The relay API contract is the only cross-package contract. Define it precisely, deploy it, and treat changes as breaking. Every other component takes it as a dependency.
- **Agent CLI before extension UI:** The extension UI can only be meaningfully tested with real data arriving from a real agent. Build the data producer before the data consumer.
- **Types before UI:** WebviewPanel message contracts are the inner contract within the extension. Changing them after components are built causes ripple rewrites.
- **Sidebar before ReportPanel:** Users reach ReportPanel by clicking a workspace in the sidebar. The entry point must exist before the destination.
- **Ralph loop reports trail briefings within phases:** Daily briefing reports are universally applicable. Ralph loop reports require agents running improvement loops. Build briefings first; add ralph loop support in Phase 5 alongside the convergence chart.

---

### Research Flags

Phases needing deeper research during planning:
- **Phase 5 (ReportPanel — convergence chart):** D3 in a sandboxed VSCode webview for iterative line charts has no confirmed prior art. Prototype before committing scope. CSP configuration for D3 in this context may require adjustment.

Phases with standard patterns (skip research-phase):
- Pre-Work, Phase 1, Phase 2, Phase 3, Phase 4, Phase 6 — all patterns are well-documented, officially sourced, or established in v1.0 codebase.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified against npm 2026-04-19; official Turso + Hono + Vercel + Drizzle integration guides exist |
| Features | HIGH | Relay/mailbox is well-established; Ralph loop has active open-source ecosystem; async chat is standard request-reply |
| Architecture | HIGH | Based on direct v1.0 codebase inspection; all integration points identified; additive changes confirmed |
| Pitfalls | HIGH (Vercel/security) / MEDIUM (CLI daemon) | Vercel limits and timing attacks confirmed from official docs; orphaned process patterns from community sources |

**Overall confidence: HIGH**

### Gaps to Address

- **InstructionRouter design:** Routing received messages to the local agent (Claude Code stdin, SIGCONT, task queue file) is framework-specific. Stub is acceptable for v2.0; validate against Claude Code's actual control interface during Phase 2 before specifying full routing behavior.

- **Convergence chart CSP in VSCode webview:** D3 in a sandboxed webview has no confirmed prior art. May require `<meta http-equiv="Content-Security-Policy">` adjustments. Prototype before Phase 5 scope is committed.

- **Report quality without AI agent cooperation:** If the AI agent on the remote machine doesn't write structured reports to the well-known directory, the CLI can only produce heartbeat reports from observable signals. Report quality depends on CLAUDE.md instructions being followed. This is a documentation/convention gap, not a code gap.

- **Turso free tier query limits:** Vercel invocation count is the more likely bottleneck, but Turso's free tier has query limits too. Validate against current Turso pricing during Phase 1 to confirm 5-minute polling with up to 10 agents stays within the free tier.

---

## Sources

### Primary (HIGH confidence — official documentation)
- [Hono docs — Vercel deployment](https://hono.dev/docs/getting-started/vercel)
- [Hono bearer auth middleware](https://hono.dev/docs/middleware/builtin/bearer-auth)
- [Turso + Drizzle integration guide](https://docs.turso.tech/sdk/ts/orm/drizzle)
- [Turso + Hono integration guide](https://docs.turso.tech/sdk/ts/guides/hono)
- [Vercel Functions Limitations](https://vercel.com/docs/functions/limitations) — 4.5MB payload, 10s Hobby timeout
- [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby) — 100K invocation limit
- [Vercel Fluid Compute — Scale to One](https://vercel.com/blog/scale-to-one-how-fluid-solves-cold-starts)
- [Node.js crypto.timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequalbuf1-buf2)
- npm registry — all package versions verified 2026-04-19
- Direct v1.0 codebase inspection: `src/types/workspace.ts`, `src/types/messages.ts`, `src/adapters/`, `src/registry/WorkspaceRegistry.ts`, `src/secrets/SecretStore.ts`

### Secondary (MEDIUM confidence — community / multiple sources)
- [HTTP Mailbox — Asynchronous RESTful Communication (ODU, 2013)](https://digitalcommons.odu.edu/cgi/viewcontent.cgi?article=1026&context=computerscience_etds)
- [Asynchronous Request-Reply Pattern — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply)
- [Sidecar Pattern — System Design Newsletter](https://newsletter.systemdesign.one/p/sidecar-pattern)
- [Ralph Loop — Alibaba Cloud Community](https://www.alibabacloud.com/blog/from-react-to-ralph-loop-a-continuous-iteration-paradigm-for-ai-agents_602799)
- [ralph — snarktank GitHub](https://github.com/snarktank/ralph)
- [ralph-loop — PageAI-Pro GitHub](https://github.com/PageAI-Pro/ralph-loop)
- [vercel-labs/ralph-loop-agent](https://github.com/vercel-labs/ralph-loop-agent)
- [AgentMail — Email Inbox API for AI Agents](https://www.agentmail.to/)
- [Thundering herd mitigation patterns](https://medium.com/@venkteshsubramaniam/the-thundering-herd-distributed-systems-rate-limiting-9128d20e1f00)
- [Vercel Hobby invocation limit — community thread](https://community.vercel.com/t/vercel-hobby-plan-function-invocation-limit-discrepancy-1-million-vs-100k-notification/32767)
- [Turso Serverless JavaScript Driver](https://turso.tech/blog/introducing-turso-serverless-javascript-driver)
- [Timing Attacks in Node.js](https://dev.to/silentwatcher_95/timing-attacks-in-nodejs-4pmb)
- [AI Agent Authentication Methods — Stytch](https://stytch.com/blog/ai-agent-authentication-methods/)

---

*Research completed: 2026-04-19*
*Milestone: v2.0 Remote Agent Management*
*Ready for roadmap: yes*
