---
phase: 02
slug: claude-code-adapter-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x (ts-jest) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx jest --testPathPattern=src --passWithNoTests` |
| **Full suite command** | `npx jest --passWithNoTests` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --passWithNoTests`
- **After every plan wave:** Run `npx jest --passWithNoTests --coverage`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | CCAD-01 | — | Server binds 127.0.0.1 only | unit | `npx jest tests/server/HookServer.test.ts -t "listens on dynamic port"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | CCAD-02 | — | Idempotent settings.json merge | unit | `npx jest tests/adapters/ClaudeCodeHookAdapter.test.ts -t "idempotent inject"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | CCAD-03 | — | Disconnect removes only _harnesstune entries | unit | `npx jest tests/adapters/ClaudeCodeHookAdapter.test.ts -t "clean disconnect"` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 0 | CCAD-04 | — | AgentEvent normalized from raw payload | unit | `npx jest tests/adapters/ClaudeCodeHookAdapter.test.ts -t "normalize event"` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 0 | CCAD-05 | — | Token usage extracted and stored | unit | `npx jest tests/database/AgentEventStore.test.ts -t "token usage"` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 0 | CCAD-06 | — | sql.js init and round-trip | unit | `npx jest tests/database/AgentEventStore.test.ts -t "init and flush"` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | CTRL-01 | — | PreToolUse gate blocks when paused | unit | `npx jest tests/controls/AgentControlManager.test.ts -t "pause"` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | CTRL-02 | — | PreToolUse gate allows when running | unit | `npx jest tests/controls/AgentControlManager.test.ts -t "resume"` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | CTRL-03 | — | Stop sends SIGTERM to PID | unit | `npx jest tests/controls/AgentControlManager.test.ts -t "stop"` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | DASH-04 | — | Panel serializer state round-trip | manual | Extension Development Host | N/A | ⬜ pending |
| 02-03-02 | 03 | 2 | NOTF-01 | — | Error event routes to showErrorMessage | unit | `npx jest tests/notifications/NotificationService.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `jest.config.js` — framework config (ts-jest)
- [ ] `package.json` devDependencies: `jest`, `ts-jest`, `@types/jest`
- [ ] `tests/server/HookServer.test.ts` — covers CCAD-01
- [ ] `tests/adapters/ClaudeCodeHookAdapter.test.ts` — covers CCAD-02, CCAD-03, CCAD-04
- [ ] `tests/database/AgentEventStore.test.ts` — covers CCAD-05, CCAD-06
- [ ] `tests/controls/AgentControlManager.test.ts` — covers CTRL-01, CTRL-02, CTRL-03
- [ ] `tests/notifications/NotificationService.test.ts` — covers NOTF-01

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Panel serializer state round-trip | DASH-04 | Requires Extension Development Host lifecycle | 1. Open dashboard 2. Select agent + workspace tab 3. Close/reopen VSCode 4. Verify state restored |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
