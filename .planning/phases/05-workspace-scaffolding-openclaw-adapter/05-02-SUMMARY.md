---
phase: 05-workspace-scaffolding-openclaw-adapter
plan: 02
subsystem: scaffold, ui
tags: [vscode-commands, template-engine, workspace-management, backend-switching]

# Dependency graph
requires:
  - phase: 05-01
    provides: "AdapterRegistry, BackendType, WorkspaceConnectionConfig, connectWorkspace, activeAdapters map"
provides:
  - "ScaffoldService class with listTemplates, substitute, scaffold methods"
  - "3 bundled workspace templates (claude-code-basic, openclaw-basic, multi-agent)"
  - "harnesstune.createWorkspace command — full template-based workspace creation"
  - "harnesstune.configureWorkspace command — backend type switching"
  - "WorkspaceRegistry.update() accepts backendType changes"
affects: [05-03-openclaw-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns: [template-variable-substitution, multi-step-quickpick-wizard, adapter-hot-swap]

key-files:
  created:
    - src/scaffold/ScaffoldService.ts
    - src/scaffold/index.ts
    - resources/templates/claude-code-basic/template.json
    - resources/templates/claude-code-basic/CLAUDE.md
    - resources/templates/claude-code-basic/harnesstune.json
    - resources/templates/openclaw-basic/template.json
    - resources/templates/openclaw-basic/CLAUDE.md
    - resources/templates/multi-agent/template.json
    - resources/templates/multi-agent/CLAUDE.md
    - resources/templates/multi-agent/roles/README.md
    - tests/scaffold/ScaffoldService.test.ts
  modified:
    - src/extension.ts
    - src/registry/WorkspaceRegistry.ts
    - src/types/workspace.ts

key-decisions:
  - "Unit tests focus on substitute() pure function; listTemplates/scaffold require vscode.workspace.fs mocking deferred to integration"
  - "configureWorkspace disconnects old adapter before registry update to prevent stale connections"

patterns-established:
  - "Template variable substitution via {{VAR}} regex with unknown-token preservation"
  - "Multi-step command wizard: QuickPick -> InputBox loop -> OpenDialog -> scaffold -> register -> connect"
  - "Backend hot-swap: disconnect old adapter, update registry, reconnect via connectWorkspace"

requirements-completed: [WKSP-02]

# Metrics
duration: 4min
completed: 2026-04-19
---

# Phase 05 Plan 02: Workspace Scaffolding + Configure Command Summary

**ScaffoldService with 3 bundled templates, createWorkspace wizard command, and configureWorkspace backend-switching command**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-19T03:36:13Z
- **Completed:** 2026-04-19T03:39:45Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments
- ScaffoldService class with template discovery, {{VAR}} substitution, and file scaffolding
- 3 bundled templates: claude-code-basic (2 files), openclaw-basic (1 file), multi-agent (2 files + roles dir)
- createWorkspace command: template picker, variable input, folder selection, conflict check, scaffold, register, connect, dashboard open
- configureWorkspace command: workspace picker, backend type picker, old adapter disconnect/dispose, registry update, reconnect

## Task Commits

Each task was committed atomically:

1. **Task 1: ScaffoldService class + template files + unit tests** - `ae66c3a` (feat, TDD)
2. **Task 2: Wire createWorkspace command into extension.ts** - `c20c997` (feat)
3. **Task 3: Implement configureWorkspace command — backend type switching** - `48efa03` (feat)

## Files Created/Modified
- `src/scaffold/ScaffoldService.ts` - Template listing, variable substitution, file scaffolding
- `src/scaffold/index.ts` - Barrel re-export
- `resources/templates/claude-code-basic/template.json` - Claude Code starter manifest
- `resources/templates/claude-code-basic/CLAUDE.md` - Template with {{VAR}} tokens
- `resources/templates/claude-code-basic/harnesstune.json` - Agent config template
- `resources/templates/openclaw-basic/template.json` - OpenClaw starter manifest
- `resources/templates/openclaw-basic/CLAUDE.md` - Template with {{VAR}} tokens
- `resources/templates/multi-agent/template.json` - Multi-agent manifest
- `resources/templates/multi-agent/CLAUDE.md` - Orchestrator template
- `resources/templates/multi-agent/roles/README.md` - Roles directory placeholder
- `tests/scaffold/ScaffoldService.test.ts` - 4 unit tests for substitute()
- `src/extension.ts` - createWorkspace + configureWorkspace commands, ScaffoldService/path imports
- `src/registry/WorkspaceRegistry.ts` - update() accepts backendType
- `src/types/workspace.ts` - IWorkspaceRegistry.update() signature extended

## Decisions Made
- Unit tests focus on substitute() pure function; listTemplates/scaffold require vscode.workspace.fs which is tested via build + manual
- configureWorkspace disconnects old adapter (disconnect + dispose + activeAdapters.delete) before updating registry to prevent stale connections

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ScaffoldService and commands ready for use
- OpenClaw adapter factory registration placeholder still commented out in extension.ts (Plan 03 responsibility)
- Plan 03 will implement OpenClawAdapter, OpenClawLogSession, and wire the openclaw factory

---
*Phase: 05-workspace-scaffolding-openclaw-adapter*
*Completed: 2026-04-19*

## Self-Check: PASSED

All 7 key files verified present. All 3 task commits verified (ae66c3a, c20c997, 48efa03).
