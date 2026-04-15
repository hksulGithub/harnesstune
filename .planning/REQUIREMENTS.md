# Requirements: HarnessTune

**Defined:** 2026-04-16
**Core Value:** Engineers running multiple agent systems can see and control all their agents from one place inside VSCode.

## v1 Requirements

### Extension Foundation (FOUN)

- [ ] **FOUN-01**: Extension activates in VSCode and registers commands with `HarnessTune:` prefix
- [ ] **FOUN-02**: Extension uses esbuild dual-target build (CJS extension host + ESM webview bundles)
- [ ] **FOUN-03**: Extension stores workspace registry as JSON at `globalStorageUri`
- [ ] **FOUN-04**: Extension stores API keys via `context.secrets`, never in globalState

### Workspace Management (WKSP)

- [ ] **WKSP-01**: User can create a new workspace by connecting to an existing agent directory
- [ ] **WKSP-02**: User can create a new workspace from a scaffold template
- [ ] **WKSP-03**: User can remove a workspace from the registry
- [ ] **WKSP-04**: Workspace registry persists absolute paths and survives VSCode restarts
- [ ] **WKSP-05**: File watcher pipeline monitors agent directories using RelativePattern with absolute base paths

### Sidebar (SIDE)

- [ ] **SIDE-01**: Sidebar shows workspace list with status indicators (running/idle/warning/error)
- [ ] **SIDE-02**: Status indicators use color + shape (never color alone) for accessibility
- [ ] **SIDE-03**: Clicking a workspace opens its workspace view in the editor area
- [ ] **SIDE-04**: Sidebar is a WebviewView with React, registered via `registerWebviewViewProvider`
- [ ] **SIDE-05**: Status bar item shows running agent count + error badge

### Dashboard (DASH)

- [ ] **DASH-01**: Main dashboard WebviewPanel shows aggregate health across all workspaces
- [ ] **DASH-02**: Per-workspace mini dashboard shows summary cards (total agents, running, errors, cost)
- [ ] **DASH-03**: Agent detail panel shows: role, model, status, current task, recent actions, config excerpt
- [ ] **DASH-04**: Dashboard panels persist across VSCode restarts via WebviewPanelSerializer
- [ ] **DASH-05**: Dashboard uses typed postMessage contracts (HostToWebviewMessage / WebviewToHostMessage)

### Agent Controls (CTRL)

- [ ] **CTRL-01**: User can pause a running agent from the dashboard
- [ ] **CTRL-02**: User can resume a paused agent
- [ ] **CTRL-03**: User can stop/cancel a running agent
- [ ] **CTRL-04**: Controls are accessible via both UI buttons and Command Palette

### Agent Schematic (SCHM)

- [ ] **SCHM-01**: Interactive topology graph renders in a WebviewPanel using D3.js or React Flow
- [ ] **SCHM-02**: Graph reconstructs agent hierarchy from SubagentStart/SubagentStop events
- [ ] **SCHM-03**: Clicking a node shows agent info (role, status, config, instructions, recent actions)
- [ ] **SCHM-04**: Graph supports zoom, pan, and "fit to view"
- [ ] **SCHM-05**: Edges animate to show message-in-flight between agents
- [ ] **SCHM-06**: Graph uses hierarchical layout (dagre/d3-dag) by default

### Chat Interface (CHAT)

- [ ] **CHAT-01**: Embedded terminal per workspace using VSCode native Pseudoterminal API
- [ ] **CHAT-02**: Terminal routes to the workspace's configured LLM backend (Claude Code first)
- [ ] **CHAT-03**: Terminal panel retains context when hidden (retainContextWhenHidden: true)
- [ ] **CHAT-04**: User can send instructions and receive responses in the terminal

### Claude Code Adapter (CCAD)

- [ ] **CCAD-01**: Local HTTP server in extension host receives Claude Code hook POSTs
- [ ] **CCAD-02**: Adapter auto-injects hook config into `~/.claude/settings.json` on connect
- [ ] **CCAD-03**: Adapter auto-removes hook config on disconnect
- [ ] **CCAD-04**: Adapter normalizes Claude Code events to shared AgentEvent schema (OTel-aligned)
- [ ] **CCAD-05**: Token usage, cost, and timing data are captured per agent session
- [ ] **CCAD-06**: Agent events stored in sql.js SQLite database at globalStorageUri

### Notifications (NOTF)

- [ ] **NOTF-01**: Agent errors trigger VSCode toast notifications
- [ ] **NOTF-02**: Informational events update status bar only (no toasts)
- [ ] **NOTF-03**: Status bar error badge increments on new errors

## v2 Requirements

### Additional Adapters

- **ADPT-01**: OpenClaw adapter via JSONL file tailing
- **ADPT-02**: Paperclip adapter via localhost API polling
- **ADPT-03**: OpenCode adapter via ACP protocol
- **ADPT-04**: Generic/custom adapter with configurable event format

### Advanced Monitoring

- **ADVM-01**: Sparklines in sidebar agent rows showing health trends
- **ADVM-02**: Live event stream panel with cross-agent timeline
- **ADVM-03**: Decision ledger / audit log per agent (searchable)
- **ADVM-04**: Anomaly detection with configurable thresholds
- **ADVM-05**: Budget meter with caps and alerts per agent

### Advanced Chat

- **ACHAT-01**: Embedded xterm.js terminal in webview (node-pty)
- **ACHAT-02**: Slash commands in chat (/pause, /log, /config)
- **ACHAT-03**: Multi-model selector for chat backend
- **ACHAT-04**: Structured output rendering (JSON/tables) in chat

### Workspace Management (Advanced)

- **AWKSP-01**: Workspace tags and archive functionality
- **AWKSP-02**: Workspace export/import
- **AWKSP-03**: Agent identity convention for parallel instances

## Out of Scope

| Feature | Reason |
|---------|--------|
| Standalone desktop app | VSCode extension for v1; standalone possible v2+ |
| Cloud/SaaS component | Local-first; no accounts, no infrastructure |
| Building agent frameworks | Integrates with existing ones only |
| Full IDE replacement | Leverages VSCode as host |
| Real-time collaborative editing | Single-user for v1 |
| VS Code for Web (vscode.dev) | Requires native Node.js (child_process, PTY) |
| Mermaid.js for live topology | Cannot dynamically update without full re-render |
| Policy studio / guardrail editor | Use config files initially |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUN-01 | Phase 1 | Pending |
| FOUN-02 | Phase 1 | Pending |
| FOUN-03 | Phase 1 | Pending |
| FOUN-04 | Phase 1 | Pending |
| WKSP-01 | Phase 1 | Pending |
| WKSP-02 | Phase 5 | Pending |
| WKSP-03 | Phase 1 | Pending |
| WKSP-04 | Phase 1 | Pending |
| WKSP-05 | Phase 1 | Pending |
| SIDE-01 | Phase 1 | Pending |
| SIDE-02 | Phase 1 | Pending |
| SIDE-03 | Phase 1 | Pending |
| SIDE-04 | Phase 1 | Pending |
| SIDE-05 | Phase 1 | Pending |
| DASH-01 | Phase 2 | Pending |
| DASH-02 | Phase 2 | Pending |
| DASH-03 | Phase 2 | Pending |
| DASH-04 | Phase 2 | Pending |
| DASH-05 | Phase 2 | Pending |
| CTRL-01 | Phase 2 | Pending |
| CTRL-02 | Phase 2 | Pending |
| CTRL-03 | Phase 2 | Pending |
| CTRL-04 | Phase 2 | Pending |
| CCAD-01 | Phase 2 | Pending |
| CCAD-02 | Phase 2 | Pending |
| CCAD-03 | Phase 2 | Pending |
| CCAD-04 | Phase 2 | Pending |
| CCAD-05 | Phase 2 | Pending |
| CCAD-06 | Phase 2 | Pending |
| NOTF-01 | Phase 2 | Pending |
| NOTF-02 | Phase 2 | Pending |
| NOTF-03 | Phase 2 | Pending |
| SCHM-01 | Phase 3 | Pending |
| SCHM-02 | Phase 3 | Pending |
| SCHM-03 | Phase 3 | Pending |
| SCHM-04 | Phase 3 | Pending |
| SCHM-05 | Phase 3 | Pending |
| SCHM-06 | Phase 3 | Pending |
| CHAT-01 | Phase 4 | Pending |
| CHAT-02 | Phase 4 | Pending |
| CHAT-03 | Phase 4 | Pending |
| CHAT-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0

---
*Requirements defined: 2026-04-16*
*Last updated: 2026-04-16 after initial definition*
