# Ecosystem Research: HarnessTune — Agent Monitoring VSCode Extension

**Researched:** 2026-04-16
**Overall confidence:** MEDIUM-HIGH (core Claude SDK: HIGH; competitor internals: MEDIUM; OpenClaw/Paperclip internals: MEDIUM; visualization trade-offs: HIGH)

---

## 1. Existing Agent Monitoring & Management Tools

### 1.1 Platform Landscape (2026)

The observability market has split into two distinct camps: **LLM-centric observability** (Helicone, Braintrust, Phoenix) and **multi-agent orchestration monitoring** (AgentOps, LangSmith, Langfuse). HarnessTune occupies a third space neither camp serves: **IDE-embedded, topology-first, session-aware monitoring without requiring cloud infrastructure**.

| Tool | Primary Focus | Multi-Agent Topology? | IDE Integration | Open Source |
|------|--------------|----------------------|-----------------|-------------|
| LangSmith | LangGraph trace trees | Yes (trace graph view, beta 2025) | No | Partial |
| AgentOps | Session waterfall replay | Waterfall (not graph) | No | Yes (SDK) |
| Helicone | Proxy-based cost/token monitoring | No | No (acquired by Mintlify, maintenance mode) | Yes |
| Langfuse | LLM tracing + eval | Beta graph view (Feb 2025) | No | Yes |
| Braintrust | Evaluation + datasets | No | No | Partial |
| Phoenix (Arize) | Trace + eval (LLM-agnostic) | Limited | No | Yes |
| Paperclip | Org-chart multi-agent OS | Org-chart only | No | Yes |

**Key gap:** No tool in this landscape provides real-time agent topology visualization embedded in the IDE where agents are actually being invoked. LangSmith's graph view is browser-based, LangChain-coupled, and requires a cloud account. AgentOps is timeline-based, not topology-based.

### 1.2 LangSmith Detail

- Deep LangGraph integration; built by LangChain team
- Trace view shows full execution tree: inputs, outputs, latency, token count, errors per node
- Graph view (beta Feb 2025 via Langfuse's implementation): overlays agent graph with trace spans — first step toward generalized agent graph view, not yet production-grade
- Virtually zero performance overhead (confirmed benchmarks)
- **Limitation:** Tightly coupled to LangChain/LangGraph stack; no Claude Code / SDK support

### 1.3 AgentOps Detail

- SDK-level hooks for 400+ LLMs and all major frameworks (CrewAI, AutoGen, AG2, Agno, OpenAI Agents)
- Session Waterfall: time-axis view with LLM calls, tool calls, errors — most useful feature
- "Point in time" session replay (rewind/replay capability)
- Tracks SubagentStart/SubagentStop with agent IDs for multi-agent correlation
- **Limitation:** No graph topology; no Claude Code hooks integration documented

### 1.4 Helicone

- Proxy-based (zero code change: reroute API calls through Helicone endpoint)
- Flat $25/month pricing; built-in caching
- **Status: Acquired by Mintlify in 2025; in maintenance mode** (MEDIUM confidence — single acquisition report)
- Not designed for multi-agent orchestration monitoring

### 1.5 Paperclip (New, March 2026)

- Node.js 20+ server + React UI; embedded PostgreSQL; TypeScript monorepo (pnpm)
- API server on `http://localhost:3100`
- Architecture: heartbeat-based agent activation (scheduled polling, not event-driven spawning)
- Supports heterogeneous agent backends: OpenClaw, Claude Code, Codex, Cursor, Bash scripts, HTTP endpoints
- Org-chart visualization of agent hierarchy; task/goal management dashboard
- Full tool-call tracing with immutable audit log; budget enforcement per agent
- **Integration surface for HarnessTune:** Paperclip's local API server (`localhost:3100`) could serve as a data source. Session logs are stored in the database; no official external monitoring API documented
- 30,000+ GitHub stars within 3 weeks of launch

---

## 2. Claude Code CLI & Agent SDK

### 2.1 Architecture: How Claude Code Runs

The Claude Agent SDK (formerly "Claude Code SDK") spawns the Claude Code CLI as a subprocess. Communication is via **stdin/stdout using newline-delimited JSON (nd-JSON)**. Two interaction modes:

- **`query()` function** — one-shot: spawns CLI, streams responses, terminates. Overhead per query.
- **`ClaudeSDKClient` class** — session mode: `connect()` spawns CLI once; multiple queries over same process; state persisted across queries.

Custom spawn function supported for VM/container/remote environments via `spawn_claude_code_process` option.

SDK MCP servers avoid subprocess spawning entirely — when the CLI needs SDK-registered tools, it uses the control protocol to invoke Python/TS functions directly.

### 2.2 Hooks System (PRIMARY INTEGRATION SURFACE FOR HARNESSTUNE)

Hooks are user-defined handlers that execute at specific lifecycle points. This is the cleanest integration mechanism for HarnessTune. **Configuration lives in `~/.claude/settings.json` (user-wide) or `.claude/settings.json` (project-specific).**

**All hook events (24 total):**

| Cadence | Events |
|---------|--------|
| Per session | `SessionStart`, `SessionEnd` |
| Per turn | `UserPromptSubmit`, `Stop`, `StopFailure` |
| Per tool call | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted` |
| Async | `WorktreeCreate`, `WorktreeRemove`, `Notification`, `ConfigChange`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`, `PreCompact`, `PostCompact`, `Elicitation`, `ElicitationResult` |

**Common JSON fields on all events (critical for topology tracking):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default|acceptEdits|bypassPermissions|...",
  "hook_event_name": "EventName",
  "agent_id": "agent-abc123",     // Only in subagents
  "agent_type": "Explore|custom"  // Only with --agent or in subagents
}
```

**Hook handler types:**

1. **`command`** — shell script that reads JSON from stdin, writes JSON to stdout
2. **`http`** — POST to a URL; HarnessTune's local server is the target
3. **`prompt`** — single-turn LLM evaluation
4. **`agent`** — spawns subagent with tools for deep verification

**HTTP hook configuration (HarnessTune's intake mechanism):**
```json
{
  "type": "http",
  "url": "http://localhost:PORT/hooks/EVENTTYPE",
  "timeout": 30,
  "headers": { "Authorization": "Bearer $TOKEN" },
  "allowedEnvVars": ["TOKEN"]
}
```

**SubagentStart/SubagentStop** — these two events are the backbone of multi-agent topology reconstruction. Each carries `agent_id` and `agent_type`. Cross-referencing these with `session_id` reconstructs the parent-child agent graph at runtime.

**Known issue:** A bug (`#573` in `claude-agent-sdk-python`) where subprocess inherits `CLAUDECODE=1` env var, preventing SDK usage from inside hooks. Mitigation: use HTTP hooks rather than command hooks for HarnessTune integration to avoid the subprocess inheritance issue.

### 2.3 Session & Subagent Tracking

- `session_id` — unique per Claude Code session, propagated to all events
- `parent_tool_use_id` — on messages from within a subagent context, identifies which subagent execution generated the message; this is the edge data for topology graph construction
- `agent_id` — unique per subagent invocation
- `transcript_path` — JSONL file on disk containing full conversation history; readable in real-time as subagents run

**Multi-agent graph reconstruction algorithm:**
1. `SessionStart` creates root node
2. `SubagentStart` creates child node (edge: parent session → child agent)
3. `PreToolUse`/`PostToolUse` attach to current active agent node
4. `SubagentStop` closes child node
5. `parent_tool_use_id` on streamed messages provides precise edge data

### 2.4 Message Stream Types

The `query()` function yields these message types:
- `SystemMessage` (subtype: `init`) — contains `session_id`
- `AssistantMessage` — Claude's responses
- `ToolUseMessage` — tool invocations
- `ToolResultMessage` — tool results
- `ResultMessage` — final result with `result` field

---

## 3. OpenCode Framework

### 3.1 Architecture

OpenCode (created by SST team, released late 2025) is a terminal-based AI coding agent with a **client/server separation architecture**:

- Core engine runs as a server (remote connection supported)
- CLI, desktop app, or IDE extension as clients
- Connects to 20+ model providers via Vercel AI SDK

**Agent model (two-tier):**
- **Primary agents:** Build (full tool access), Plan (analysis only, file edits require confirmation)
- **Subagents:** General, Explore (read-only), plus hidden system agents (Compaction, Title, Summary)
- Custom agents via JSON config (`opencode.json`) or Markdown files in `~/.config/opencode/agents/` or `.opencode/agents/`

**Protocol:** ACP (Agent Client Protocol) via stdin/stdout using **nd-JSON**. Agents can be invoked as subagents by other systems via `@mention` syntax.

**Integration surface for HarnessTune:**
- ACP server exposes a local endpoint (ACP starts on demand)
- `opencode.json` configurable per project
- No native hooks system comparable to Claude Code's; monitoring requires polling or ACP server subscription

### 3.2 Key CLI Commands

```bash
opencode                    # Launch TUI
opencode --print "prompt"   # Headless mode, stdout only
opencode channels status    # Channel health
opencode doctor --fix       # Diagnostics
```

---

## 4. OpenClaw Framework

### 4.1 Background

OpenClaw (originally "Clawdbot", renamed after Anthropic trademark complaint in January 2026) is an open-source autonomous agent framework by Peter Steinberger (PSPDFKit founder). MIT license. Uses messaging platforms as primary UI (WhatsApp, Telegram, Slack, Discord, and 20+ others).

**Enterprise add-on:** NemoClaw (Nvidia, March 2026) — security layer with OpenShell sandboxing.

### 4.2 Architecture

Three-layer architecture:
1. **Gateway** — WebSocket server connecting messaging platforms to core
2. **Agent Runtime** — AI loop: context assembly → model invocation → tool execution → state persistence
3. **Plugin SDK** — public contract at `src/plugin-sdk/`

**Plugin SDK surface:**
- `src/plugin-sdk/plugin-entry.ts`
- `src/plugin-sdk/core.ts`
- `src/plugin-sdk/provider-entry.ts`
- `src/plugin-sdk/channel-contract.ts`
- `src/plugin-sdk/provider-auth.ts`

**Gateway Protocol:** Typed control-plane communication in `src/gateway/protocol/schema.ts`. Supports additive evolution; breaking changes require explicit versioning. Bridge protocol documented at `docs/gateway/bridge-protocol.md`.

**Integration surface for HarnessTune:**
- HTTP Gateway: `--bind loopback --port PORT`
- Session logs at `~/.openclaw/agents/<agentId>/sessions/*.jsonl`
- Status probe: `openclaw channels status --probe`
- `openclaw doctor --fix` for diagnostics
- No webhook system; monitoring is polling-based via session JSONL files or HTTP gateway

**Manifest-driven plugin discovery:** `openclaw.plugin.json` — HarnessTune could register as a plugin for deep integration.

---

## 5. Multi-Agent Topology Visualization: State of the Art

### 5.1 Current Approaches in Production Tools

| Tool | Visualization Type | Rendering | Interactive? | Real-time? |
|------|--------------------|-----------|-------------|------------|
| LangSmith | Execution tree | Browser (unspecified) | Partial | No (post-run) |
| Langfuse | Trace graph (beta) | Browser (unspecified) | Partial | No (post-run) |
| AgentOps | Session waterfall | Canvas/SVG | Click to expand | Session replay |
| Paperclip | Org chart | React | Yes | Yes (task-level) |
| disler/claude-code-hooks-multi-agent-observability | Event timeline + pulse chart | Vue 3 + Canvas | Filter/query | Yes (WebSocket) |

**Open-source reference implementation worth studying:** `disler/claude-code-hooks-multi-agent-observability` — Bun TypeScript server, SQLite with WAL mode, Vue 3 client. Uses dual-color timeline (left border = app identity, second border = session color). Canvas-based live pulse chart. WebSocket broadcasting for real-time updates. This is the closest existing implementation to what HarnessTune needs, but lives outside the IDE.

### 5.2 OpenTelemetry Semantic Conventions for Agents (Emerging Standard)

The OpenTelemetry GenAI SIG is standardizing agent observability conventions (2025). Key signals:
- Root span per agent run/session
- Child spans per tool call, LLM request
- GenAI semantic conventions: model, latency, tokens, cache
- Frameworks converging: CrewAI, AutoGen, LangGraph, IBM Bee Stack — all targeting the same OTel GenAI semantic conventions

**VSCode + OTel:** Microsoft filed issue #293225 ("Meta: Agent Observability based on OpenTelemetry") for Copilot Chat observability. The hooks-based export pipeline approach proposed there maps directly to what HarnessTune needs: `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd` hooks emitting JSON → transform to OTel spans → local OTLP collector. HarnessTune should align its data model with OTel GenAI semantic conventions now to stay forward-compatible.

---

## 6. Mermaid.js vs D3.js for Agent Schematic Rendering

### 6.1 Mermaid.js

**Strengths:**
- Text-to-diagram: declarative Markdown-like syntax
- Native GitHub/Notion/Confluence rendering
- Existing VSCode extensions (ms-vscode.copilot-mermaid-diagram, vstirbu.vscode-mermaid-preview)
- Internally uses D3 and dagre-d3 for layout

**Limitations (critical for HarnessTune):**
- `securityLevel` must be set permissively to allow click events — introduces security concerns in webview context
- Click events have known bug history (issue #901: click events not firing in certain versions)
- Cannot dynamically add/delete nodes or create links at runtime without full re-render
- "Basic" interactivity rating in feature comparisons — designed for static documentation
- Re-rendering requires clearing the DOM and re-running `mermaid.init()` — causes flicker on fast updates

**Verdict for HarnessTune: Not recommended for live topology.** Acceptable for exporting static diagrams of completed sessions.

### 6.2 D3.js (v7)

**Strengths:**
- Full control over every SVG element
- Data binding architecture natively supports reactive updates when data changes
- `d3-force` module: force-directed graph with node dragging, collision, link strength
- Mouse/click event handlers on individual nodes are first-class
- VSCode webview pattern is well-established: `acquireVsCodeApi()` + `postMessage` bridge; D3 renders in the webview sandbox
- `webview.setState()` / `getState()` persists UI state across close/reopen
- `d3-dynamic-graph` library provides high-level API for dynamically updating force-directed graphs

**Limitations:**
- Steep learning curve; more code than Mermaid
- No built-in layout algorithms for DAGs (need `dagre` or `d3-dag` separately for hierarchical layouts)

**Verdict for HarnessTune: Recommended for live topology view.** Use D3.js v7 with `d3-force` for the main agent graph panel. Use `dagre-d3` or `d3-dag` for hierarchical (parent-child) layout when showing agent spawning trees. Fall back to Mermaid syntax for "export as diagram" feature.

### 6.3 Implementation Pattern for VSCode Webview

```
Extension Host                     Webview Sandbox
─────────────────                  ───────────────────────────────
Hook HTTP server           →       postMessage({type: 'agent_event', data: {...}})
receives events            ←       vscode.postMessage({type: 'node_click', id: ...})
updates state graph
serializes to JSON
```

Key constraints:
- Webview is a sandboxed browser context — no `require()`, no Node.js APIs
- All communication via `postMessage` / `onmessage`
- CSP (Content Security Policy) must explicitly allow D3.js script execution
- Use `webview.asWebviewUri()` for bundled JS assets

---

## 7. Adapter Pattern for Multi-Backend Integration (TypeScript)

### 7.1 Design Rationale

HarnessTune needs to consume events from multiple agent backends:
- Claude Code / Agent SDK (hooks via HTTP)
- OpenCode (ACP server polling or stdout streaming)
- OpenClaw (JSONL session file tailing + HTTP gateway)
- Paperclip (local API at `localhost:3100`)
- Future: LangGraph, CrewAI, custom agents

The Adapter pattern is the correct structural choice. Each backend has incompatible event formats; adapters normalize to a unified internal event schema.

### 7.2 Recommended Interface Structure

```typescript
// Core event schema (OTel GenAI-aligned)
interface AgentEvent {
  id: string;
  timestamp: number;
  sessionId: string;
  agentId?: string;
  agentType?: string;
  parentAgentId?: string;   // maps to parent_tool_use_id
  eventType: AgentEventType;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  error?: string;
  backend: BackendType;
  raw: unknown;             // original event for debugging
}

type AgentEventType =
  | 'session_start' | 'session_end'
  | 'tool_use' | 'tool_result' | 'tool_error'
  | 'subagent_start' | 'subagent_stop'
  | 'permission_request' | 'permission_denied'
  | 'user_prompt' | 'stop';

type BackendType = 'claude-code' | 'opencode' | 'openclaw' | 'paperclip' | 'generic-otel';

// Adapter interface
interface AgentBackendAdapter {
  readonly backend: BackendType;
  connect(options: ConnectionOptions): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): Disposable;
  getActiveSessions(): Promise<SessionSummary[]>;
}

// Concrete adapter example
class ClaudeCodeHookAdapter implements AgentBackendAdapter {
  readonly backend = 'claude-code';
  private httpServer: http.Server;

  connect(options: { port: number }): Promise<void> {
    // Start HTTP server to receive hook POSTs
    // Inject hook config into ~/.claude/settings.json
  }

  onEvent(handler: (event: AgentEvent) => void): Disposable {
    // Normalize Claude Code hook JSON → AgentEvent
    // Map session_id, agent_id, parent_tool_use_id
  }
}
```

### 7.3 Key Implementation Notes

- Use the **Object Adapter** variant (wraps instance) rather than Class Adapter (inheritance) for TypeScript — more flexible for async event streams
- `Disposable` return from `onEvent` follows VSCode's own extension API convention — adopt this for consistency
- Auto-inject hook configuration into `~/.claude/settings.json` on adapter connect; remove on disconnect — no manual user setup
- For OpenClaw: tail `~/.openclaw/agents/<agentId>/sessions/*.jsonl` using `fs.watch` or `chokidar`; parse nd-JSON incrementally
- For Paperclip: poll `localhost:3100` API; no WebSocket/SSE documented yet

### 7.4 Prior Art in TypeScript Ecosystem

The pattern is well-documented at refactoring.guru and in TypeScript design pattern collections. Key sources confirm: adapters should wrap a single external instance, translate parameters in both directions, and expose only the target interface to consumers. The adapter constructor takes the adaptee as a parameter (not hardcoded), enabling testing with mock backends.

---

## 8. Key Recommendations for HarnessTune

### 8.1 Integration Architecture (Ordered by Priority)

1. **Claude Code hooks via HTTP** — deepest integration, most data, hooks support all lifecycle events; start here
2. **OpenClaw JSONL tailing** — low friction, session files already on disk; no API keys needed
3. **Paperclip local API** — polling-based; useful for Paperclip-orchestrated multi-agent workflows
4. **OpenCode ACP server** — requires user to start OpenCode with ACP enabled; lower priority

### 8.2 Visualization Stack

- **Primary graph panel:** D3.js v7 + `d3-force` + `dagre` for layout
- **Static export:** Mermaid.js syntax generation (text output only, no rendering issues)
- **Timeline panel:** Canvas-based (similar to disler's reference implementation) — more performant than SVG for high-frequency events

### 8.3 Data Model Alignment

Align internal event schema with OpenTelemetry GenAI semantic conventions from day one. This:
- Enables export to Langfuse, AgentOps, LangSmith later (adapters out, not just in)
- Follows the direction VSCode itself is heading (issue #293225)
- Makes the data model defensible and interoperable

### 8.4 What Competitors Don't Do (HarnessTune's White Space)

1. No competitor offers **IDE-embedded topology** — all solutions are browser dashboards
2. No competitor provides **zero-infrastructure monitoring** — all require cloud accounts or separate servers
3. No competitor auto-injects hooks configuration — users must manually configure
4. No competitor normalizes across **multiple agent backends** behind a single view
5. No competitor shows **live graph updates** as agents spawn subagents in real time

---

## Sources

- [Claude Agent SDK Overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [OpenCode Agents Documentation](https://opencode.ai/docs/agents/)
- [OpenClaw GitHub Repository](https://github.com/openclaw/openclaw)
- [Paperclip GitHub Repository](https://github.com/paperclipai/paperclip)
- [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [Langfuse Trace Graph View Changelog (Feb 2025)](https://langfuse.com/changelog/2025-02-14-trace-graph-view)
- [AgentOps Dashboard Documentation](https://docs.agentops.ai/v1/usage/dashboard-info)
- [OpenTelemetry AI Agent Observability Blog (2025)](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [VSCode Agent Observability Issue #293225](https://github.com/microsoft/vscode/issues/293225)
- [Mermaid.js Official Site](https://mermaid.js.org/)
- [Mermaid vs D3.js vs Chart.js Comparison 2026](https://www.pkgpulse.com/blog/mermaid-vs-d3-vs-chartjs-diagrams-data-visualization-javascript-2026)
- [D3.js Force-Directed Graph 2025 Guide](https://dev.to/nigelsilonero/how-to-implement-a-d3js-force-directed-graph-in-2025-5cl1)
- [Top 5 AI Agent Observability Platforms 2026](https://o-mega.ai/articles/top-5-ai-agent-observability-platforms-the-ultimate-2026-guide)
- [8 AI Observability Platforms Compared 2025](https://softcery.com/lab/top-8-observability-platforms-for-ai-agents-in-2025)
- [Inside the Claude Agent SDK (AWS Substack)](https://buildwithaws.substack.com/p/inside-the-claude-agent-sdk-from)
- [Adapter Pattern in TypeScript (Refactoring Guru)](https://refactoring.guru/design-patterns/adapter/typescript/example)
- [LangSmith with LangGraph: Trace Multi-Agent Workflows](https://markaicode.com/langsmith-langgraph-tracing-multi-agent-workflows/)
- [Paperclip Review 2026](https://vibecoding.app/blog/paperclip-review)
- [OpenClaw Architecture Explained (ppaolo Substack)](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [Claude Code Hooks Production Patterns (Pixelmojo)](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns)
