---
phase: 04-chat-interface-terminal
plan: 01
subsystem: terminal
tags: [pseudoterminal, stream-json, parser, formatter, child-process]
dependency_graph:
  requires: [agent-types]
  provides: [ClaudeCodeTerminal, StreamJsonParser, OutputFormatter, StreamJsonEvent-types]
  affects: [extension-wiring, agent-event-pipeline]
tech_stack:
  added: []
  patterns: [discriminated-union, newline-delimited-json, ansi-formatting, pseudoterminal]
key_files:
  created:
    - src/terminal/types.ts
    - src/terminal/StreamJsonParser.ts
    - src/terminal/OutputFormatter.ts
    - src/terminal/ClaudeCodeTerminal.ts
    - src/terminal/index.ts
  modified: []
decisions:
  - "OutputFormatter is a static class (no state needed) for pure formatting functions"
  - "normalizeStreamEvent maps system events to SessionStart, tool_use to PreToolUse, result to SessionEnd"
  - "Non-error tool_result events are suppressed in terminal output (too verbose, next assistant message references them)"
  - "Session restart on process exit: state transitions to 'ended', shows restart prompt, Enter key starts fresh session"
metrics:
  duration: "2 min"
  completed: "2026-04-18"
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 0
---

# Phase 04 Plan 01: Pseudoterminal + Stream-JSON Parser + Output Formatter Summary

Self-contained terminal module: StreamJsonParser buffers partial stdout lines and emits parsed events, OutputFormatter renders ANSI-colored text, ClaudeCodeTerminal implements vscode.Pseudoterminal spawning `claude --output-format stream-json` with full lifecycle management.

## What Was Built

### Task 1: Stream-JSON types, parser, and output formatter (17f4efe)

- **types.ts**: Discriminated union `StreamJsonEvent` covering assistant, tool_use, tool_result, result (usage), system, and error event types. `ContentBlock` union for text and tool_use content blocks. `TerminalSessionState` for lifecycle tracking.
- **StreamJsonParser**: Buffers partial lines from stdout chunks, splits on newline, JSON.parse each complete line. Non-JSON lines silently skipped (Claude startup text). Returns array of parsed events per feed() call.
- **OutputFormatter**: Static class with ANSI formatting. Assistant text gets bold headings, tool_use shows cyan `[ToolName] path/command`, errors in bold red, usage as dim summary line, system messages in dim italic. Provides formatPrompt, formatInputPrefix, formatSessionEnd helpers.
- **index.ts**: Barrel exports for all types and classes.

### Task 2: ClaudeCodeTerminal pseudoterminal (fcc637b)

- **ClaudeCodeTerminal**: Full vscode.Pseudoterminal implementation. Constructor takes workspaceId, workspaceName, workspaceRootPath, optional dangerouslySkipPermissions flag and onEvent callback.
- **open()**: Writes welcome banner with workspace name and "Press Enter to start" prompt.
- **handleInput()**: Line-buffered input with character echo, backspace support (`\x1b[D \x1b[D`), Ctrl+C sends SIGINT. Enter in idle state starts session; Enter in active state writes line to child stdin.
- **startSession()**: Spawns `claude --output-format stream-json` in workspace root. Wires stdout through parser/formatter pipeline. stderr rendered in red. Process exit/error triggers session-end message and restart prompt.
- **normalizeStreamEvent()**: Maps stream-JSON events to AgentEvent types following ClaudeCodeHookAdapter.normalizeEvent() pattern. Captures session_id from system/result events.
- **close()**: SIGTERM with 3-second SIGKILL fallback. Fires onDidClose.
- **dispose()**: Calls close(), disposes EventEmitters.

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 17f4efe | feat(chat): add stream-JSON types, parser, and output formatter |
| 2 | fcc637b | feat(chat): implement ClaudeCodeTerminal pseudoterminal |

## Self-Check: PASSED

All 5 files found. Both commits verified.
