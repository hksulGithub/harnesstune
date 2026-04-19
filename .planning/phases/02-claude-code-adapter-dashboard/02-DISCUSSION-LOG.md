# Phase 2: Claude Code Adapter + Dashboard — Discussion Log

**Date:** 2026-04-16
**Areas discussed:** 3 of 3 selected

---

## Area 1: Hook Server Design

**Gray area:** How the embedded HTTP server receives Claude Code hook events — port allocation, config injection, security, event schema, resilience.

**Decisions captured:**
1. Port selection: Dynamic port via `server.listen(0)`, written to `globalStorageUri/hook-server.port`
2. Config merge: Deep merge into `~/.claude/settings.json` with `_harnesstune: true` tag. Atomic writes (temp + rename). Backup before first write.
3. Security: Localhost `127.0.0.1` + random session token in URL query param
4. Architecture: Node built-in `http` module, no Express
5. Hook type: Direct HTTP hooks (`type: http`) — no shell wrappers
6. Events: 9 lifecycle events (SessionStart, SessionEnd, SubagentStart, SubagentStop, PreToolUse, PostToolUse, PostToolUseFailure, Stop, StopFailure)
7. AgentEvent schema: OTel-aligned with id, workspaceId, sessionId, agentId, eventType, timestamp, toolName?, toolInput?, model?, tokenUsage?, error?, raw
8. Resilience: Return 200 fast, queue in memory, async SQLite flush

**User approach:** Provided comprehensive pre-thought design covering all sub-questions in a single message.

---

## Area 2: Dashboard Layout & Navigation

**Gray area:** How the dashboard WebviewPanel is structured — panel type, layout hierarchy, agent detail display, persistence, message contracts, styling.

**Decisions captured:**
1. Panel architecture: Single WebviewPanel, sidebar stays as Phase 1 workspace list
2. Layout: Two-level hierarchy — workspace tabs → summary bar → master-detail split
3. Agent detail: Master-detail pattern, compact agent cards left, detail panel right
4. Persistence: WebviewPanelSerializer with getState/setState, stores active tab + selected agent
5. Message contracts: Extended HostToWebview (dashboard:agentEvents/agentUpdate/summary) and WebviewToHost (agent:pause/resume/stop, dashboard:requestState)
6. Styling: VSCode CSS variables, plain CSS, no UI toolkit

**User approach:** Provided detailed design with ASCII mockup of layout hierarchy.

---

## Area 3: Agent Controls (Pause/Resume/Stop)

**Gray area:** How pause, resume, and stop actually reach Claude Code — no documented external control API exists.

**Decisions captured:**
1. Stop: SIGTERM to Claude Code PID (tracked via child_process.spawn or ps scan)
2. Pause/Resume: PreToolUse gate — hook returns `{continue: false, decision: "block"}` when paused. No SIGTSTP to avoid process corruption and broken connections.
3. State model: `AgentControlState = 'running' | 'paused' | 'stopping' | 'stopped'` with `AgentSession` tracking sessionId, workspaceId, pid, controlState, pausedAt
4. Command Palette: Three commands (pauseAgent, resumeAgent, stopAgent) with QuickPick agent selector

**User approach:** Provided analysis table of mechanism confidence levels and recommended Option B (PreToolUse gate) over Option A (SIGTSTP) with clear rationale.

---

## Areas Not Selected

- **Notification Strategy** — skipped by user (not selected from gray area list). Left to Claude's discretion during planning.

---

*Discussion completed: 2026-04-16*
*Output: 02-CONTEXT.md with 19 decisions across 3 areas*
