# Stack Research: v2.0 Remote Agent Management

**Project:** HarnessTune
**Milestone:** v2.0 — Relay API, Agent CLI, RemoteAdapter
**Researched:** 2026-04-19
**Scope:** NEW dependencies only. Existing v1.0 stack (TypeScript, React, esbuild, sql.js, chokidar, D3, VSCode API) is validated and not re-examined here.

---

## Summary

v2.0 adds three new packages to the HarnessTune monorepo: the relay API server, the agent CLI, and a RemoteAdapter inside the existing extension. Each has a narrow, well-understood dependency surface. The critical choices are:

- **Hono** (not Express) for the relay — serverless-native, runs on Vercel Node.js runtime with minimal config, built-in bearer auth middleware
- **@libsql/client** (not @tursodatabase/serverless) for the DB client — required when using Drizzle ORM, which provides schema migrations critical for a multi-machine deployment
- **Simple opaque API keys** (not JWT) for authentication — relay is a mailbox, not an identity provider; JWT overhead is not justified
- **Node.js built-in crypto** for token generation — no external dependency needed
- **node-cron** for the CLI daemon scheduler — lightweight, zero-dependency cron for polling and report upload intervals
- **Commander** for the CLI entry point — the standard for npx-runnable CLI tools

All versions verified against npm registry on 2026-04-19.

---

## Stack Additions

### harnesstune-relay (new Vercel serverless package)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `hono` | `^4.12.14` | HTTP framework for relay API routes | Serverless-native (Web Standards API), zero-config Vercel deployment via default export, built-in bearer auth middleware, smaller bundle than Express. Turso docs have explicit Hono integration guide. |
| `@hono/node-server` | `^1.19.14` | Local dev server adapter | Required to run Hono on Node.js runtime locally (`vercel dev`). Hono runs natively on edge runtimes; Node.js adapter bridges for local development and Vercel's Node.js serverless functions. |
| `@libsql/client` | `^0.17.2` | Turso (libSQL/SQLite) database client | Required by Drizzle ORM's Turso integration. Supports `./http` subpath which uses `fetch()` — safe for Vercel's Node.js serverless runtime. Alternative `@tursodatabase/serverless` lacks Drizzle ORM support. |
| `drizzle-orm` | `^0.45.2` | SQL query builder + ORM | Type-safe schema definitions, migrations via drizzle-kit, Turso/libSQL first-class support. Critical for managing relay DB schema across deployments without manual SQL. Simpler than Prisma for SQLite edge use case. |
| `drizzle-kit` | `^0.31.10` | Migration CLI tool | `drizzle-kit push` for dev, `drizzle-kit generate` + `drizzle-kit migrate` for production deployments. Dev dependency only. |
| `zod` | `^4.3.6` | Request body validation | Validate incoming payloads from agents (reports, messages) at the relay boundary. Hono has native Zod integration via `@hono/zod-validator`. Already a natural fit; no learning curve given TypeScript-first team. |
| `dotenv` | `^17.4.2` | Env var loading for local dev | Load `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` locally. Vercel injects these in production. Dev dependency. |

**Confidence:** HIGH — Hono, Drizzle, libSQL, and Zod all verified against official docs and npm. Turso explicitly documents the Hono + libSQL combination.

**Relay auth approach:** Use Hono's built-in `bearerAuth` middleware with the `verifyToken` callback. The callback queries the `tokens` table in Turso to check if the presented token exists and is active. No external auth library needed — token generation uses Node.js `crypto.randomBytes(32).toString('hex')`. This is an opaque API key pattern, not JWT. JWT would require signing, expiry logic, and refresh flows that add complexity without benefit here (the relay never needs to introspect token claims — it just checks existence).

**Vercel deployment:** Hono apps export a default handler and deploy with zero configuration. `vercel.json` is not required for basic serverless function routing. The `@hono/node-server` adapter is used only for `vercel dev` local testing.

---

### harnesstune-agent (new npm CLI package)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `commander` | `^14.0.3` | CLI argument parsing and command structure | Industry standard for Node.js CLI tools. Handles `npx harnesstune-agent start --relay-url ... --token ...` invocation pattern cleanly. Zero runtime deps of its own. |
| `node-cron` | `^4.2.1` | Scheduled polling and report upload intervals | Lightweight cron scheduler for Node.js. Runs the poll loop (e.g., every 5 minutes) and report upload (e.g., every 6 hours) as named scheduled tasks within the daemon process. No external process spawning. |
| `chokidar` | existing | File watching on remote machine | Already a v1.0 dependency in the extension. The agent CLI watches the same log/state files as the local OpenClaw adapter. Reuse the same version to keep the ecosystem consistent. Agent CLI can import it directly since it's a Node.js process, not a VSCode extension context. |

**No additional daemon management library** (no PM2, no forever): The agent CLI is itself the daemon. It starts with `npx harnesstune-agent start`, runs a `node-cron` loop, and stays in the foreground. Users who want it as a system service use their OS-native tools (`launchd` on macOS, `systemd` on Linux). Bundling PM2 as a dependency creates unnecessary weight for a single-purpose sidecar.

**Token storage on the agent side:** Stored in a local config file (e.g., `~/.harnesstune-agent/config.json`) created on `npx harnesstune-agent register`. No keychain dependency — the token is an API key, not a user credential.

**Confidence:** HIGH for Commander and node-cron — both verified on npm, widely used. MEDIUM for the "no daemon manager" pattern — this is an architectural choice based on the simplicity principle documented in V2_VISION.md, not a library comparison.

---

### harnesstune extension — RemoteAdapter additions

The existing extension gains a `RemoteAdapter` class. It uses only the VSCode API and Node.js built-in `https`/`fetch`. No new npm dependencies are needed in the extension package for the adapter itself.

| Capability | How | New dep? |
|------------|-----|----------|
| HTTP polling to relay | Node.js `fetch` (built-in, Node 18+, available in VSCode's Node.js runtime) | No |
| Token storage | VSCode `SecretStore` (already used in v1.0) | No |
| Remote workspace config | Existing workspace registry + JSON config files | No |
| Report rendering | React webviews (existing), new report view components | No |

**Confidence:** HIGH — VSCode's Node.js runtime has included `fetch` since Node 18. The v1.0 extension already uses `SecretStore`. No new npm packages are required for the extension's RemoteAdapter.

---

## Integration Points with v1.0

| v2.0 Component | Integration Point | Notes |
|----------------|-------------------|-------|
| RemoteAdapter | Implements the existing `IWorkspaceAdapter` interface | Same interface as `ClaudeCodeAdapter` and `OpenClawAdapter`. Sidebar, dashboard, and schematic panels work unchanged. |
| RemoteAdapter | Uses `SecretStore` from v1.0 `SecretsService` | API tokens stored under key `harnesstune.token.{workspaceId}` pattern. |
| harnesstune-agent | Uses same report schema as relay API | Report shape defined once in a shared `@harnesstune/types` package (or inline — decide at implementation). |
| Relay API | Turso schema mirrors local sql.js schema for event types | Relay stores `reports` and `messages` tables, not the full event log. Different from the local sql.js event storage. |
| Agent CLI | Reads same JSONL log format as OpenClawAdapter | Agent daemon tails the same files. Can share the tail/parse logic as a utility or just re-implement the 20-line pattern. |

---

## What NOT to Add

| Rejected Dependency | Category | Why Not |
|--------------------|----------|---------|
| `express` | Relay framework | Hono has identical DX, smaller bundle, native serverless support. Express requires wrapping for Vercel. No upside. |
| `jsonwebtoken` / `jose` | Auth library | JWT is over-engineered for API key auth. The relay doesn't issue or verify identity tokens — it checks opaque keys against a database. Built-in `crypto` handles generation. |
| `pm2` / `forever` | Daemon manager | The agent CLI is a single-purpose foreground process. Daemon management is the user's responsibility (OS-level). Adding PM2 as a package dependency is heavyweight and unnecessary. |
| `axios` / `got` | HTTP client | Node.js 18+ `fetch` is available in the VSCode runtime and in Node.js on remote machines. Zero-dep fetch is sufficient for the polling interval pattern (no streaming, no retries needed beyond simple exponential backoff). |
| `prisma` | ORM | Over-engineered for a SQLite relay with 2-3 tables. Binary Prisma engine has known edge/serverless compatibility issues. Drizzle is the correct choice for Turso. |
| `socket.io` / `ws` | WebSocket | v2.0 is explicitly async/polling. Real-time is out of scope until v3. No persistent connections needed. |
| `@supabase/supabase-js` | Alternative DB client | Turso is the chosen DB. Supabase is a different product. |
| `passport` | Auth middleware | Hono's built-in `bearerAuth` middleware handles token validation with a `verifyToken` callback. No passport needed. |
| `ncc` / `pkg` | CLI bundler | The agent CLI is a TypeScript package published to npm and run via `npx`. Standard `tsc` compilation with a `bin` field is sufficient. No need to bundle into a standalone binary. |

---

## Installation

### harnesstune-relay

```bash
# Runtime
npm install hono @hono/node-server @libsql/client drizzle-orm zod

# Dev
npm install -D drizzle-kit dotenv typescript @types/node
```

### harnesstune-agent

```bash
# Runtime
npm install commander node-cron chokidar

# Dev
npm install -D typescript @types/node
```

### harnesstune (extension) — no new deps

The existing `package.json` requires no additions for the RemoteAdapter.

---

## Sources

- Hono official docs: https://hono.dev/docs/getting-started/vercel (Vercel deployment)
- Hono bearer auth middleware: https://hono.dev/docs/middleware/builtin/bearer-auth
- Turso + Drizzle guide: https://docs.turso.tech/sdk/ts/orm/drizzle
- Turso + Hono guide: https://docs.turso.tech/sdk/ts/guides/hono
- @libsql/client exports verified: `./http` subpath uses `fetch()`, safe for Vercel Node.js runtime
- npm versions verified 2026-04-19: hono@4.12.14, @libsql/client@0.17.2, drizzle-orm@0.45.2, drizzle-kit@0.31.10, zod@4.3.6, commander@14.0.3, node-cron@4.2.1, @hono/node-server@1.19.14
