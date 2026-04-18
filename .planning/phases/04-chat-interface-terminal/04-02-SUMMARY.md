---
phase: 04-chat-interface-terminal
plan: 02
subsystem: terminal
tags: [terminal-manager, extension-wiring, command-palette, event-pipeline, configuration]
dependency_graph:
  requires: [ClaudeCodeTerminal, agent-types, workspace-registry]
  provides: [TerminalManager, harnesstune.openTerminal, dangerouslySkipPermissions-config]
  affects: [dashboard-events, schematic-topology, agent-controls]
tech_stack:
  added: []
  patterns: [workspace-terminal-mapping, pseudoterminal-lifecycle, event-pipeline-reuse]
key_files:
  created:
    - src/terminal/TerminalManager.ts
  modified:
    - src/terminal/index.ts
    - src/extension.ts
    - package.json
decisions:
  - "TerminalManager listens to onDidCloseTerminal globally and matches by terminal reference to clean up map entries"
  - "Single workspace produces auto-selection (no QuickPick) for frictionless UX"
  - "Terminal event pipeline reuses exact same pattern as hook adapter pipeline (persist, session lifecycle, notifications, dashboard push, schematic topology rebuild)"
metrics:
  duration: "1 min"
  completed: "2026-04-18"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 3
  status: "awaiting-human-verification"
---

# Phase 04 Plan 02: Terminal Manager + Extension Wiring Summary

TerminalManager maps workspaceId to native VSCode terminals backed by ClaudeCodeTerminal pseudoterminals, with openTerminal command palette integration, workspace QuickPick selection, event pipeline wiring into dashboard/schematic/controls, and dangerouslySkipPermissions workspace configuration.

## What Was Built

### Task 1: TerminalManager class and extension wiring (4bdadff)

- **TerminalManager.ts**: Maps workspaceId to `{ terminal, pty }` entries. `openTerminal()` checks for existing terminal (show if alive, clean up if closed, create if new). Listens to `onDidCloseTerminal` for automatic cleanup. `disposeAll()` kills all child processes and disposes terminals. Implements `vscode.Disposable`.
- **index.ts**: Added `TerminalManager` and `TerminalManagerOpenOptions` exports.
- **package.json**: Added `harnesstune.openTerminal` command. Added `configuration` section with `harnesstune.dangerouslySkipPermissions` boolean setting (default false, resource scope).
- **extension.ts**: Phase 4 section after agent control commands. TerminalManager instantiated with onEvent callback that feeds terminal stream-JSON events into the same pipeline as hook events (persist to eventStore, session lifecycle via controlManager, notifications, dashboard push, schematic topology rebuild). `harnesstune.openTerminal` command registered with workspace QuickPick (auto-selects if only one workspace). Reads `dangerouslySkipPermissions` from workspace configuration.

## Human Verification Checkpoint (Task 2) -- AWAITING

Task 2 is a `checkpoint:human-verify`. The following verification steps must be performed manually:

1. **Open the extension** in VS Code (F5 or Run Extension Development Host).
2. **Connect a workspace** if none exist (HarnessTune: Connect Workspace).
3. **Open a terminal**: Run "HarnessTune: Open Terminal" from the Command Palette.
   - Expected: A new terminal tab appears in the terminal area named "HarnessTune: {workspace-name}".
   - Expected: Terminal shows a welcome message and "Press Enter to start a Claude Code session..." prompt.
4. **Start a session**: Press Enter.
   - Expected: Terminal shows "Starting Claude Code session..." and then the Claude Code session starts.
   - If `claude` CLI is not installed, expect an error message in red.
5. **Send a message**: Type "Say hello in exactly 3 words" and press Enter.
   - Expected: The message is sent, a "thinking..." indicator appears, and Claude's response streams back with formatted text.
6. **Verify tool use formatting**: Type "Create a file called /tmp/harnesstune-test.txt with the text 'hello'" and press Enter.
   - Expected: Tool use lines appear as compact summaries like `[Write] /tmp/harnesstune-test.txt`.
7. **Hide and re-show terminal**: Click a different terminal tab or hide the terminal panel, then re-show it.
   - Expected: Terminal content is preserved, session is still active.
8. **Open second workspace terminal**: Connect a second workspace, then open a terminal for it.
   - Expected: A second terminal tab appears with a different name. The first terminal is unaffected.
9. **Verify event pipeline**: Open the Dashboard (HarnessTune: Show Dashboard) while a terminal session is active.
   - Expected: Events from the terminal session appear in the dashboard.

**Resume signal:** Type "approved" or describe issues found.

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 4bdadff | feat(chat): add TerminalManager and wire openTerminal command |
| 2 | -- | checkpoint:human-verify (awaiting) |

## Self-Check: PASSED

All files found. Commit 4bdadff verified. Build passes with no errors.
