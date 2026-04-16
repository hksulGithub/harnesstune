---
phase: 02-claude-code-adapter-dashboard
plan: "01"
subsystem: claude-code-adapter
tags: [types, http-server, adapter, settings-injection, event-normalization, jest, sql.js]
dependency_graph:
  requires: [01-03]
  provides: [AgentEvent, AgentSession, HookServer, ClaudeCodeHookAdapter, AgentBackendAdapter]
  affects: [02-02, 02-03, 02-04]
tech_stack:
  added: [sql.js, jest, ts-jest, @types/jest, @types/sql.js]
  patterns: [EventEmitter, token-auth, atomic-write, tag-based-cleanup, OTel-aligned-schema]
key_files:
  created:
    - src/types/agent.ts
    - src/adapters/AgentBackendAdapter.ts
    - src/adapters/ClaudeCodeHookAdapter.ts
    - src/server/HookServer.ts
    - src/server/index.ts
    - jest.config.js
    - tests/__mocks__/vscode.ts
    - tests/server/HookServer.test.ts
    - tests/adapters/ClaudeCodeHookAdapter.test.ts
  modified:
    - src/types/messages.ts
    - src/types/index.ts
    - src/adapters/index.ts
    - esbuild.mjs
    - package.json
    - tsconfig.json
decisions:
  - "HookServer buffers full body before responding (body <10KB, sub-ms) so PreToolUse pause gate can inspect event type before replying"
  - "PreToolUse deny response uses hookSpecificOutput.permissionDecision: deny format per Claude Code docs, not deprecated {continue: false} format"
  - "ClaudeCodeHookAdapter.injectHooks filters existing _harnesstune entries before inserting, making connect idempotent"
  - "Atomic settings.json write via write-to-tmp + renameSync prevents partial-write corruption"
  - "sql.js marked external in esbuild and sql-wasm.wasm copied to dist/ so WASM loads at runtime"
metrics:
  duration: "~10 min"
  completed: "2026-04-16T09:55:40Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 9
  files_modified: 6
  tests_added: 10
  tests_passing: 10
---

# Phase 02 Plan 01: Claude Code Adapter + Data Pipeline Summary

**One-liner:** OTel-aligned AgentEvent type contracts, token-authenticated HTTP hook server with PreToolUse pause gate, and idempotent settings.json injection adapter using _harnesstune tag-based atomic writes.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Type contracts, AgentBackendAdapter, extended message types | 760db32 | src/types/agent.ts, src/types/messages.ts, src/adapters/AgentBackendAdapter.ts |
| 2 | HookServer, ClaudeCodeHookAdapter, test infrastructure | 738d51f | src/server/HookServer.ts, src/adapters/ClaudeCodeHookAdapter.ts, tests/ |

## What Was Built

### Task 1: Type Contracts

- **`src/types/agent.ts`** — `AgentEventType` union (9 events), `AgentEvent` interface (OTel GenAI-aligned), `AgentTokenUsage`, `AgentControlState`, `AgentSession`
- **`src/types/messages.ts`** — Extended with 3 host→webview types (`dashboard:agentEvents`, `dashboard:agentUpdate`, `dashboard:summary`) and 4 webview→host types (`agent:pause`, `agent:resume`, `agent:stop`, `dashboard:requestState`). All Phase 1 members preserved.
- **`src/adapters/AgentBackendAdapter.ts`** — Interface contract: `connect`, `disconnect`, `onDidReceiveEvent: Event<AgentEvent>`, `Disposable`

### Task 2: HookServer + ClaudeCodeHookAdapter

- **`src/server/HookServer.ts`** — Node.js `http.Server` extending `EventEmitter`. Binds to `127.0.0.1:0` (OS-assigned dynamic port). Token auth via `crypto.randomBytes(16)` — rejects requests without valid `?token=` with 401. Buffers full body before responding to enable PreToolUse gate inspection. Deny path returns canonical `hookSpecificOutput.permissionDecision: 'deny'` format. Emits `hookEvent` for downstream processing.
- **`src/adapters/ClaudeCodeHookAdapter.ts`** — Implements `AgentBackendAdapter`. `injectHooks` deep-merges 9 hook entries tagged `_harnesstune: true` into `~/.claude/settings.json` with atomic write + backup. Idempotent: filters existing `_harnesstune` entries before inserting. `removeHooks` filters only tagged entries, preserves user hooks. `normalizeEvent` maps raw Claude Code payloads to `AgentEvent` using `crypto.randomUUID()` for IDs.
- **`jest.config.js`** — ts-jest preset, node environment, vscode mock mapper
- **`tests/__mocks__/vscode.ts`** — Minimal VSCode API mock for jest
- **10 tests passing** — server auth, dynamic port, pause gate, event emission, idempotency, user hook preservation, normalization, backup creation

## Decisions Made

1. **Body buffering before response for PreToolUse gate** — The plan noted a tension between fast response (D-06) and gate inspection. Body is <10KB and buffering is sub-millisecond, so buffer-then-respond is used. This ensures the pause gate can inspect `payload.event` without a separate code path. Fast response is still achieved in practice.

2. **hookSpecificOutput deny format** — Used the canonical Claude Code docs format (`hookSpecificOutput.permissionDecision: 'deny'`), not the deprecated `{ continue: false, decision: 'block' }` format. This is enforced by the acceptance criteria negative check.

3. **Idempotent inject via filter-then-append** — Before injecting, all existing `_harnesstune` entries are filtered from each event's array. This handles extension restart without clean disconnect.

4. **sql.js as external in esbuild** — Prevents esbuild from trying to bundle the WASM loader. WASM binary copied to `dist/sql-wasm.wasm` separately. This matches the RESEARCH.md recommendation for correct runtime WASM resolution.

## Deviations from Plan

None — plan executed exactly as written. The one design consideration (body buffering vs fast response) was addressed as specified in the plan's threat model and action comments.

## Self-Check: PASSED

Files verified:
- src/types/agent.ts — FOUND
- src/types/messages.ts — FOUND (contains dashboard:agentEvents, workspaces:update preserved)
- src/adapters/AgentBackendAdapter.ts — FOUND
- src/adapters/ClaudeCodeHookAdapter.ts — FOUND
- src/server/HookServer.ts — FOUND
- jest.config.js — FOUND
- tests/server/HookServer.test.ts — FOUND
- tests/adapters/ClaudeCodeHookAdapter.test.ts — FOUND

Commits verified:
- 760db32 — FOUND (feat(02-01): type contracts...)
- 738d51f — FOUND (feat(02-01): HookServer...)

Test results: 10/10 passing
Build: node esbuild.mjs exits 0, sql-wasm.wasm copied
TypeScript: npx tsc --project tsconfig.extension.json --noEmit exits 0
