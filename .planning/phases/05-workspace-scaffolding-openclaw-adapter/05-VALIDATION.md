---
phase: 5
slug: workspace-scaffolding-openclaw-adapter
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x |
| **Config file** | jest.config.js |
| **Quick run command** | `npx jest --testPathPattern=src/ --passWithNoTests` |
| **Full suite command** | `npx jest --passWithNoTests` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern=src/ --passWithNoTests`
- **After every plan wave:** Run `npx jest --passWithNoTests`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 05-01-01 | 01 | 1 | WKSP-02 | unit | `npx jest --testPathPattern=AdapterRegistry` | ⬜ pending |
| 05-01-02 | 01 | 1 | WKSP-02 | unit | `npx jest --testPathPattern=WorkspaceRecord` | ⬜ pending |
| 05-02-01 | 02 | 2 | WKSP-02 | unit | `npx jest --testPathPattern=ScaffoldService` | ⬜ pending |
| 05-02-02 | 02 | 2 | WKSP-02 | manual | VSCode scaffold command e2e | ⬜ pending |
| 05-03-01 | 03 | 3 | ADPT-01 | unit | `npx jest --testPathPattern=OpenClawAdapter` | ⬜ pending |
| 05-03-02 | 03 | 3 | ADPT-01 | unit | `npx jest --testPathPattern=OpenClawLogSession` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing test infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scaffold command creates workspace with correct files | WKSP-02 | Requires VSCode extension host | Run "HarnessTune: Create Workspace", verify files created, workspace in sidebar |
| OpenClaw events appear in dashboard | ADPT-01 | Requires chokidar watching live JSONL | Write test events to `~/.harnesstune/openclaw/test/events.jsonl`, verify dashboard display |
| Adapter selector in workspace settings | WKSP-02 | VSCode command interaction | Run "HarnessTune: Configure Workspace", switch backend type |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
