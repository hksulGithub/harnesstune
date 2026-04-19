# Phase 4: Chat Interface + Terminal - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Embedded terminal per workspace routing user input to the workspace's configured LLM backend (Claude Code for v1) and streaming output back. Covers requirements CHAT-01, CHAT-02, CHAT-03, CHAT-04.

</domain>

<decisions>
## Implementation Decisions

### Terminal Invocation Model
- **D-01:** Spawn `claude --output-format stream-json` as child process via `child_process.spawn()`. Pseudoterminal wraps the process — `handleInput` writes to stdin, stdout JSON lines are parsed and rendered as formatted text via `onDidWrite`.
- **D-02:** Stream-JSON gives structured events (assistant text, tool_use, tool_result, usage) in one channel. Reuse `ClaudeCodeHookAdapter.normalizeEvent()` pattern for parsing — same schema fields (`session_id`, `agent_id`, `tool_name`, `tool_input`, `usage`).
- **D-03:** NOT full interactive CLI mode (Option A) — ANSI-escaped output requires fragile parsing. NOT `-p` print mode (Option B) — batch-only, loses conversation context between messages.
- **D-04:** Support `--dangerously-skip-permissions` flag. User can opt into this per workspace or globally. The terminal spawn command should allow this flag to be passed through.

### Terminal Session Lifecycle
- **D-05:** Explicit start, NOT auto-spawn. Opening a workspace terminal shows a "Start Session" prompt. Rationale: Claude Code sessions consume API tokens immediately — auto-spawning burns credits for monitor-only workspaces.
- **D-06:** Survive panel hide (`retainContextWhenHidden: true` — locked constraint CHAT-03). Child process stays alive when user switches tabs. Conversation intact on return.
- **D-07:** One active session per workspace for v1. `AgentControlManager` maps sessionId → AgentSession. Multi-session terminals deferred to v2 (ACHAT-01: xterm.js + node-pty).
- **D-08:** On panel dispose (not hide — actual close): SIGTERM the child process, emit SessionEnd, clean up. On re-open via serializer, show "Start Session" prompt — don't auto-reconnect to a dead process.

### Terminal Panel Location
- **D-09:** Native VSCode terminal area via `window.createTerminal({ pty })`. NOT a WebviewPanel in the editor area.
- **D-10:** Rationale: native terminal UX for free — keyboard shortcuts, split terminals, terminal tabs, resize, drag. No webview overhead or React rendering for text output. Pseudoterminal implements `onDidWrite` (output) and `handleInput` (input) — simplest possible implementation.
- **D-11:** Each workspace gets its own named terminal (e.g., "HarnessTune: workspace-name"). Switching workspaces shows the corresponding terminal.
- **D-12:** v2 path (ACHAT-01) moves to webview-based xterm.js for richer formatting, slash commands (ACHAT-02), and structured output rendering (ACHAT-04).

### Input/Output Formatting
- **D-13:** Processed output, NOT raw passthrough. Stream-JSON is JSON lines, not human-readable — parsing is required, not optional.
- **D-14:** Assistant text: write directly with basic ANSI formatting (bold for headers, etc.).
- **D-15:** Tool use: compact summary line like `[Edit] src/foo.ts:42` rather than full tool input JSON. Full tool details available in Dashboard/Schematic AgentDetailPanel.
- **D-16:** Token usage: optionally append a subtle cost line at end of each response (from stream-JSON `usage` field).
- **D-17:** Errors: write in red (ANSI `\x1b[31m`).

### Claude's Discretion
- Exact stream-JSON line parser implementation (newline-delimited JSON handling, partial line buffering)
- "Start Session" prompt design (inline text vs button-like prompt in terminal)
- ANSI color palette for different message types (assistant, tool, error, system)
- Terminal title format and naming convention
- How `--dangerously-skip-permissions` is configured (workspace setting, command flag, or both)
- Whether to show a session summary (tokens, cost, duration) on session end
- Pseudoterminal class structure and event wiring

</decisions>

<specifics>
## Specific Ideas

- The Pseudoterminal class should own the `child_process.ChildProcess` reference and handle lifecycle (spawn, stdin write, stdout parse, SIGTERM on dispose). Keep it self-contained — the extension.ts wiring should be minimal.
- JSON line parser: buffer partial lines (stdout chunks may split mid-JSON), split on `\n`, `JSON.parse()` each complete line. Emit parsed events for both terminal rendering AND the existing hook event pipeline (so dashboard/schematic stay in sync).
- Terminal name format: `HarnessTune: {workspaceName}` — matches VSCode convention of `{extension}: {context}`.
- The "Start Session" prompt can be a simple terminal write: `"Press Enter to start a Claude Code session..."` — no React, no webview, just text in the native terminal.
- Consider dual-channel event flow: hook server captures lifecycle events (PreToolUse, PostToolUse, etc.) while stream-JSON provides content/text. Both feed into the same AgentEvent pipeline. Don't duplicate — use hooks for lifecycle, stream-JSON for content.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §Phase 4 — Phase goal, key deliverables, success criteria, research flags
- `.planning/REQUIREMENTS.md` — Requirements CHAT-01, CHAT-02, CHAT-03, CHAT-04

### Locked architectural constraints
- `.planning/ROADMAP.md` §Key Architectural Constraints — Pseudoterminal API (not node-pty), retainContextWhenHidden on terminal panel only

### Phase 2 integration points (built infrastructure this phase depends on)
- `src/adapters/AgentBackendAdapter.ts` — `AgentBackendAdapter` interface (connect/disconnect/onDidReceiveEvent)
- `src/adapters/ClaudeCodeHookAdapter.ts` — `normalizeEvent()` method, hook injection pattern, stream-JSON field names match hook payload schema
- `src/controls/AgentControlManager.ts` — Session lifecycle tracking (start, pause, resume, stop), maps sessionId → AgentSession
- `src/server/HookServer.ts` — HTTP hook server for lifecycle events (complement to stream-JSON content events)
- `src/types/agent.ts` — `AgentEvent`, `AgentSession`, `AgentControlState` types
- `src/extension.ts` — Event routing, command registration, workspace registry wiring

### Prior phase context
- `.planning/phases/02-claude-code-adapter-dashboard/02-CONTEXT.md` — Hook server, adapter, dashboard, controls decisions
- `.planning/phases/03-agent-schematic-live-topology/03-CONTEXT.md` — Topology, layout, panel integration decisions

</canonical_refs>

<deferred>
## Deferred Ideas

- **xterm.js embedded terminal in webview** — v2 requirement ACHAT-01. Enables richer formatting, inline images, structured output rendering. Requires node-pty.
- **Slash commands in terminal** — v2 requirement ACHAT-02. `/pause`, `/log`, `/config` commands parsed client-side before sending to Claude.
- **Multi-model selector** — v2 requirement ACHAT-03. Let user pick which model/backend the terminal routes to.
- **Structured output rendering** — v2 requirement ACHAT-04. JSON tables, code blocks with syntax highlighting in webview terminal.
- **Multi-session tabs per workspace** — Multiple concurrent Claude sessions within one workspace. Deferred to v2 with xterm.js.

</deferred>

---

*Phase: 04-chat-interface-terminal*
*Context gathered: 2026-04-18*
