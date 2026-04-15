# UX Research: Agent Management Interface Patterns

**Project:** HarnessTune (VSCode Extension)
**Focus:** UX & Features — Agent monitoring, visualization, and control
**Researched:** 2026-04-16
**Overall Confidence:** HIGH (VSCode API official docs + multiple verified secondary sources)

---

## 1. VSCode Extension UX Fundamentals

### Container Architecture

VSCode's UI divides into containers and items. Extensions contribute to predefined zones — never invent new chrome.

| Container | Best Use for HarnessTune |
|-----------|--------------------------|
| Activity Bar | Icon entry point to the HarnessTune view container |
| Primary Sidebar | Agent list tree view (main navigation) |
| Secondary Sidebar | Agent detail / config inspector panel |
| Panel (bottom) | Log stream, event trace, or terminal-style output |
| Editor Area | Webview for the agent graph diagram |
| Status Bar | Live agent health summary (running count, error badge) |

### Core UX Rules (Official VSCode Docs)

**Webviews — use sparingly.** The official guideline is: "Only use webviews when absolutely necessary." They are the right choice for the agent graph diagram and dashboard, but NOT for settings or simple lists.

Webview dos:
- Use VSCode CSS variables for all colors so the panel respects light/dark/high-contrast themes
- Follow WCAG color contrast and add ARIA labels
- Make all toolbar actions available via the Command Palette too

Webview don'ts:
- Do not open webviews automatically on extension install or every window open
- Do not replicate VSCode's native Settings UI inside a webview
- Do not use wizard flows inside webviews

**Tree Views (sidebar agent list):**
- Use descriptive labels and product icons to distinguish agent states
- Do not use tree items as buttons to fire commands — use the item's inline action buttons instead
- Limit inline actions to 3 per item maximum
- Avoid nesting deeper than 2-3 levels

**Status Bar:**
- Keep text short; prefer icons
- Do not add custom colors except for error (red) or warning (yellow) states — these are reserved for urgent/blocking issues
- For background progress, use a spinning icon in the status bar; only escalate to a notification toast if user attention is required

Sources: [VSCode UX Guidelines Overview](https://code.visualstudio.com/api/ux-guidelines/overview) | [Webviews Guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews) | [Status Bar Guidelines](https://code.visualstudio.com/api/ux-guidelines/status-bar) | [Views Guidelines](https://code.visualstudio.com/api/ux-guidelines/views)

---

## 2. Status Indicator Conventions

### Traffic Light System

The traffic light metaphor is the established UX convention for operational status. Use it consistently and always pair color with a secondary signal (icon or label) — never rely on color alone (colorblindness).

| State | Color | Icon | Label | When to Use |
|-------|-------|------|-------|-------------|
| Running / Healthy | Green (#3DD68C or VSCode `testing.iconPassed`) | ● filled circle | "Running" | Agent active, no anomalies |
| Idle / Standby | Blue-gray | ○ hollow circle | "Idle" | Agent initialized but not executing |
| Warning | Amber/Yellow | ▲ triangle | "Warning" | Non-blocking issue, attention needed |
| Error | Red | ✕ or ⬡ hexagon | "Error" | Blocking failure, requires action |
| Unknown / Disconnected | Gray | ? | "Unknown" | Cannot reach agent, no heartbeat |
| In Progress | Blue + spinner | ↻ spinner | "Running…" | Active task in progress |

**Recommendation:** Follow the IBM Carbon Design System status indicator pattern — it uses distinct shapes per severity (circle, diamond, triangle, square) so shape alone conveys meaning, not just color. This satisfies accessibility requirements without extra effort.

### Badge Patterns

Use count badges on the Activity Bar icon to surface unacknowledged errors or alerts. Rules:
- Show badge only for actionable states (errors, warnings requiring review)
- Cap displayed number at 99+ to avoid overflow
- Clear the badge when the user opens the panel and acknowledges the state

### Progress Indicators

- **Determinate bar**: Use when task duration is predictable (e.g., "Processing 3 of 7 files")
- **Indeterminate spinner**: Use for open-ended async operations (e.g., "Waiting for agent response")
- **Sparkline**: Use in the agent list row to show recent activity trend — a 20-30px mini line chart of the last N actions or response times. Pair with a numeric value.

Sources: [Carbon Design System — Status Indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/) | [Traffic Lights of UX — Usability Geek](https://usabilitygeek.com/traffic-lights-ux-smart-color/)

---

## 3. Agent Info Panel Design

### What Users Need to See

Based on agentic UX research, an agent detail panel should answer five questions at a glance:
1. What is this agent's role?
2. What is it doing right now?
3. What did it recently do?
4. What can I change?
5. Is anything wrong?

### Recommended Panel Layout

```
┌─────────────────────────────────────────┐
│  [Icon] Agent Name            [● Running]│
│  Role: [role label]                      │
│  Model: claude-sonnet-4-6               │
├─────────────────────────────────────────┤
│  CURRENT TASK                            │
│  [Task description]          [Pause][✕] │
│  Step 3 of 7  ████████░░░░  00:42 elapsed│
├─────────────────────────────────────────┤
│  RECENT ACTIONS     [correlation ID]     │
│  ✓ Read file: PROJECT.md        12s ago  │
│  ✓ Called tool: search          18s ago  │
│  ✗ Error: rate_limit_exceeded   25s ago  │
│  [Show full log →]                       │
├─────────────────────────────────────────┤
│  CONFIGURATION                [Edit]     │
│  Instructions: [excerpt…]               │
│  Autonomy level: ●●●○○ Medium           │
│  Budget cap: $0.25 / session            │
└─────────────────────────────────────────┘
```

### Key Design Decisions

**Role display:** Show a concise role label (not the full system prompt). Clicking "Instructions" should expand to a scrollable code-style block or open the source `.md` file in the editor.

**Status badge:** Place it inline with the agent name in the header — not buried in a footer. Use the traffic light convention from Section 2.

**Recent actions:** Show a fixed-height scrollable list (last 5–10 actions). Each entry: icon (success/error/pending), action type, description truncated to 60 chars, relative timestamp. Link to the full log in the Panel.

**Configuration section:** Show key fields inline (model, autonomy level, budget). "Edit" opens the source config file in the editor — do not recreate the config editor in the panel.

**Confidence / cost display:** For agents that report cost or confidence scores, show these inline: a small wallet icon + dollar amount, a signal-bar icon for confidence.

Sources: [Agentic UX — Oversight, Confidence, Control (Logiciel)](https://logiciel.io/blog/agentic-ux-oversight-confidence-control) | [UI Design for AI Agents (FuseLab)](https://fuselabcreative.com/ui-design-for-ai-agents/) | [Designing AI Agent Experiences (UX Design Institute)](https://www.uxdesigninstitute.com/blog/design-experiences-for-ai-agents/)

---

## 4. Dashboard UX for Monitoring Systems

### Information Hierarchy

Follow the F/Z eye-tracking pattern: most critical information goes top-left.

Recommended zone layout for HarnessTune's dashboard view:

```
TOP ROW (global state at a glance)
  [Total Agents: 6]  [Running: 3]  [Errors: 1]  [Cost today: $0.41]

MAIN AREA (agent grid/list)
  Each agent card: name, role, status badge, sparkline, last action

SIDE/DETAIL PANEL (selected agent)
  Full agent detail panel (see Section 3)

BOTTOM (event stream)
  Real-time log of cross-agent events
```

### Status Cards (Top Row)

Each summary card should show:
- Large bold metric value (draws attention)
- Short label below (e.g., "Errors")
- Delta indicator: icon + color + percentage vs previous period (e.g., ▲ +2 since last hour)
- Clicking any card filters the main list to matching agents

### Sparklines

Use sparklines inside agent list rows to show trend-over-time in thumbnail form. Implementation rules:
- Width: 60–80px, height: 20–24px
- Accent-color the latest data point (dot or endpoint)
- Do not add axis labels — the sparkline shows trend shape only; pair with the numeric value in adjacent text
- Metric to track: task completions per minute, or response latency rolling average

### Real-Time Updates

For live data:
- **Do not full-page refresh.** Patch individual components (status badge, sparkline, recent action entry) as events arrive via WebSocket or VSCode extension message passing.
- Show a subtle timestamp ("Updated 2s ago") rather than a pulsing animation — pulsing draws constant attention and creates fatigue.
- On stale data (no update for >30s), visually dim the affected component and show "No recent data."

Sources: [Smashing Magazine — UX Strategies for Real-Time Dashboards](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/) | [Pencil & Paper — Dashboard UX Patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards)

---

## 5. Agent Communication Flow Visualization (Graph Diagram)

### Library Recommendation

**Use React Flow** (or Svelte Flow if the webview uses Svelte). These are purpose-built for interactive node-edge diagrams with VSCode-embeddable webviews.

React Flow provides out of the box: drag nodes, zoom/pan, multi-select, custom node components, minimap, and edge routing. It is the de facto standard for agent pipeline visualization in 2025.

Alternative for pure graph/network topology (not workflow): **Cytoscape.js** (more flexible layout algorithms, good for complex topologies).

### Node Types for Agent Graph

| Node Type | Visual Treatment | Contents |
|-----------|-----------------|----------|
| Agent node | Rounded rect, colored border by status | Icon, name, status badge |
| Orchestrator/root | Slightly larger, elevated shadow | Label: "Orchestrator" |
| Tool call | Small rect, tool icon | Tool name, call count |
| Data source | Cylinder shape | File/DB name |
| Human checkpoint | Diamond | "Approval required" |

### Interaction Patterns

**Click to inspect:** Single-click on an agent node opens the agent detail panel (Section 3) in the sidebar. Do not open a modal — use the side panel so the diagram stays visible.

**Hover tooltip:** On hover, show a small tooltip card with: agent name, current status, last action, and response time. Auto-dismiss on mouse leave. Keep tooltip width under 220px to avoid obscuring adjacent nodes.

**Zoom/pan:** Follow web conventions — scroll wheel to zoom, click-drag to pan. Provide a "Fit to view" button (keyboard shortcut: `Ctrl/Cmd + Shift + F`) that resets zoom to show all nodes. Show a minimap in the corner for large graphs.

**Edge labels:** Show message type or tool call name on edges. On hover over an edge, show full message payload in a tooltip (truncated to 200 chars with "show more" link).

**Live animation:** Animate active message passing: highlight the edge in motion with a traveling dot when a message is in flight. Stop animation when idle. This is the primary way to show "liveness" in the diagram.

**Selection:** Multi-select nodes with Shift+click or drag-select. Selected nodes show a highlight ring. Bulk actions (pause selected, view logs for selected) appear in a floating context toolbar above the selection.

### Layout

Use a **dagre** or **ELK** hierarchical layout as default. This renders orchestrator → workers in clear top-down flow. Allow users to switch to force-directed layout for topology exploration.

Sources: [React Flow — Interactive Node-Based UIs](https://codingcops.com/react-flow/) | [Svelte Flow](https://svelteflow.dev) | [Graph Visualization UX — Cambridge Intelligence](https://cambridge-intelligence.com/graph-visualization-ux-how-to-avoid-wrecking-your-graph-visualization/)

---

## 6. Chat Interface Patterns in IDEs

### What Works (Evidence from Copilot/Cursor/Continue)

| Pattern | Source | Verdict |
|---------|--------|---------|
| Persistent sidebar chat panel | GitHub Copilot, Cursor | Use — users expect a docked panel, not a floating modal |
| Codebase context awareness | Cursor | High value — agents should be able to reference files |
| Streaming token output | All three | Required — users abandon interfaces that show nothing until completion |
| Multi-model selector | Copilot (GPT-4o, Claude, Gemini) | Use if HarnessTune supports multiple models |
| Chat history / session memory | Cursor | Use — shows recent questions/actions per agent |
| Slash commands | Continue, Copilot | Use for quick actions: `/pause`, `/log`, `/config` |
| Inline diff preview | Cursor Composer | Use if agents can edit files — show diff before applying |

### UX Differentiation

Cursor's model: full AI-driven IDE, deep integration, indexed codebase. GitHub Copilot's model: lightweight sidebar chat, stays out of the way. Continue.dev: maximum control, local models, privacy.

**HarnessTune's positioning:** The chat panel is not a coding assistant — it is an agent command & control surface. Design it differently:
- Input field should feel like a command console, not a chat message box
- Output should render structured data (JSON, tables, log entries) not just markdown prose
- Persistent session context per agent, not global chat history

Sources: [Cursor vs GitHub Copilot vs Continue — DEV Community](https://dev.to/synsun/cursor-vs-github-copilot-vs-continue-ai-code-editor-showdown-2026-2h89) | [GitHub Copilot Chat — GitHub Docs](https://docs.github.com/en/copilot/responsible-use/chat-in-your-ide)

---

## 7. Multi-Agent Communication Flow Visualization

### Architectural Patterns Reflected in UI

Three agent communication patterns each require different visual treatments:

**Supervisor-Worker (hierarchical):**
- Show as top-down DAG in the graph view
- Supervisor node at top, workers branching below
- Animate message passing as edges light up sequentially

**Blackboard (shared state):**
- Show a central "Blackboard" node that all agents read/write
- Use dashed edges for reads, solid edges for writes
- Show a small write-count badge on the blackboard node

**Sequential pipeline:**
- Show as a linear left-to-right flow
- Active step highlighted, completed steps muted

### Event Stream Panel

Place in the bottom Panel area (tabbed with terminal). Show a live event stream:

```
[12:03:41] [Supervisor → Worker-1] task_assigned: "Scrape YouTube data"
[12:03:42] [Worker-1] tool_call: search("harnesstune site:github.com")
[12:03:44] [Worker-1 → Supervisor] result: 14 items found
[12:03:44] [Supervisor] decision: route to Worker-2 for analysis
```

Each line: timestamp, source agent, event type, payload excerpt. Color-code by event type (green for success, yellow for decision points, red for errors). Support filtering by agent name or event type.

Sources: [Secrets of Agentic UX — UX Magazine](https://uxmag.com/articles/secrets-of-agentic-ux-emerging-design-patterns-for-human-interaction-with-ai-agents) | [Multi-Agent Workflow Design — Medium/Kanerika](https://medium.com/@kanerika/multi-agent-workflows-a-practical-guide-to-design-tools-and-deployment-3b0a2c46e389) | [4 UX Principles for Multi-Agent AI — Victor Dibia](https://newsletter.victordibia.com/p/4-ux-design-principles-for-multi)

---

## 8. Notification and Alert Patterns

### VSCode Notification Hierarchy

VSCode has three escalation levels. Map HarnessTune alerts to these levels:

| Alert Severity | VSCode Mechanism | HarnessTune Use Case |
|---------------|-----------------|---------------------|
| Informational | Status bar update | Agent started/stopped, task completed |
| Warning | Toast notification (bottom right) | Retry attempt, rate limit approaching, unexpected output |
| Error | Toast notification + status bar error color | Agent crashed, config invalid, tool call failed fatally |
| Critical / Blocking | Modal dialog | Irreversible action pending (e.g., agent about to delete files) |

Toast notifications auto-dismiss unless they contain actions. Maximum 3 toasts visible simultaneously; older ones hide automatically.

### Notification Content Rules

Each notification should answer: what happened, which agent, and what the user should do (if anything).

Good: `"Worker-1 failed: rate_limit_exceeded. Retrying in 30s. [View Log] [Dismiss]"`
Bad: `"Error occurred"`

For errors, follow the agentic UX framing principle: specify what failed, which fallback applied, and what happens next. Frame failures as recoverable processes.

### Anomaly Detection Alerts

For pattern-based anomalies (agent running too long, unusual cost spike, unexpected silence):
- Do not fire toasts for every anomaly — use status bar badge increment instead
- Collect anomalies into a dedicated "Alerts" view (tree view or webview table)
- Allow users to configure per-agent thresholds in settings
- Provide one-click "acknowledge" and "investigate" actions per alert

Sources: [VSCode Notifications Guidelines](https://code.visualstudio.com/api/ux-guidelines/notifications) | [Agentic UX: Oversight, Confidence, Control (Logiciel)](https://logiciel.io/blog/agentic-ux-oversight-confidence-control)

---

## 9. Control & Oversight UX

### The Four Core Controls

Every agent (and the orchestrator) must expose these four controls, always visible when the agent is active:

1. **Pause** — suspend execution, retain state, allow resume
2. **Resume** — continue from paused state
3. **Cancel / Stop** — terminate execution cleanly
4. **Approve / Deny** — for agents awaiting human confirmation on a decision

These map to the "start, stop, pause buttons are a good starting point" principle from agentic UX research. Without these, users have no recourse when agents behave unexpectedly ("Sorcerer's Apprentice" risk).

### Risk / Autonomy Level Display

Show per-agent autonomy level using a 5-step visual scale (e.g., ●●●○○ = Medium). Three bands with automatic behavior:
- **High confidence (4–5):** Agent acts automatically
- **Medium confidence (2–3):** Agent asks before proceeding
- **Low confidence (1):** Agent stops and requires explicit approval

This matches the "confidence gating" pattern: act / ask / stop thresholds.

### Decision Ledger

Provide a searchable log per agent answering four questions per entry: what was done, why it was allowed, what it cost, and what it produced. This is the audit trail for trust-building and debugging.

### Budget Display

If agents incur API costs, show a budget meter inline with the agent — not just in a separate settings page. A small wallet icon + running total + cap (e.g., `💰 $0.12 / $0.25`) placed in the agent header achieves this without disrupting the layout.

Sources: [4 UX Design Principles for Multi-Agent AI — Victor Dibia Newsletter](https://newsletter.victordibia.com/p/4-ux-design-principles-for-multi) | [Agentic UX: Oversight, Confidence, Control (Logiciel)](https://logiciel.io/blog/agentic-ux-oversight-confidence-control)

---

## 10. Keyboard, Command Palette, and Accessibility

### Command Palette Integration

Every major action in HarnessTune should be invocable from the Command Palette (`Ctrl/Cmd + Shift + P`). Prefix all commands with `HarnessTune:` for discoverability.

Recommended commands:
```
HarnessTune: Open Dashboard
HarnessTune: Show Agent Graph
HarnessTune: Pause All Agents
HarnessTune: Resume All Agents
HarnessTune: Open Agent Inspector (agent name)
HarnessTune: View Logs
HarnessTune: Clear Alerts
```

### Keybinding Recommendations

| Action | Suggested Keybinding | Rationale |
|--------|---------------------|-----------|
| Open HarnessTune sidebar | `Ctrl/Cmd + Shift + H` | Mnemonic: H for Harness |
| Fit graph to view | `Ctrl/Cmd + Shift + F` | Standard fit-view convention |
| Pause selected agent | `Ctrl/Cmd + .` | Period = "stop" (period/full stop) |
| Open agent log | `Ctrl/Cmd + L` in agent context | L for Log |

All keybindings must be configurable and must not override default VSCode keybindings.

### Accessibility

- All status indicators must have text labels or ARIA roles — never color alone
- Keyboard navigation through agent list (arrow keys), focus rings on interactive items
- Graph diagram: support Tab navigation through nodes, Enter to inspect, Escape to deselect
- Respect VSCode's high-contrast theme via CSS variable tokens

Sources: [VSCode Command Palette Guidelines](https://code.visualstudio.com/api/ux-guidelines/command-palette) | [VSCode Panel Guidelines](https://code.visualstudio.com/api/ux-guidelines/panel) | [Graph Visualization Accessibility — Cambridge Intelligence](https://cambridge-intelligence.com/graph-visualization-ux-how-to-avoid-wrecking-your-graph-visualization/)

---

## 11. Feature Prioritization for MVP

### Must-Have (Table Stakes)

| Feature | Rationale |
|---------|-----------|
| Agent list tree view (sidebar) | Primary navigation — without this, there is no extension |
| Status badges (traffic light) per agent | Core monitoring value proposition |
| Agent detail panel (role, status, recent actions) | Users need to inspect any agent on demand |
| Pause/Resume/Stop controls per agent | Safety requirement — must prevent runaway agents |
| Status bar summary (running/error count) | Ambient awareness without opening the panel |
| Notifications for errors (toast + badge) | Users must be alerted to failures |
| Command Palette integration | VSCode UX requirement; power user must-have |

### High Value (Phase 2)

| Feature | Rationale |
|---------|-----------|
| Interactive agent graph (webview) | Visual differentiator; complex but high payoff |
| Live event stream panel | Deep debugging and transparency |
| Sparklines in agent list rows | Glanceable trend information |
| Budget display per agent | Cost awareness; important for API-heavy workloads |
| Decision ledger / audit log | Trust-building and debugging for multi-agent setups |

### Defer (Later Phases)

| Feature | Why Defer |
|---------|-----------|
| Policy Studio / guardrail editor | High complexity; can use config files initially |
| Diff preview before agent file edits | Requires deep workspace integration |
| Anomaly detection with thresholds | Needs baseline data before meaningful anomaly detection |
| Multi-model selector in chat | Not needed until model-switching is a user need |

---

## 12. Anti-Patterns to Avoid

| Anti-Pattern | Why It Fails | Better Approach |
|-------------|--------------|-----------------|
| Opening a webview on every extension activate | Violates VSCode UX guidelines; feels spammy | Open only when user explicitly navigates to it |
| Recreating VSCode Settings UI in a webview | Redundant; users already know VSCode settings | Link to native `settings.json` or `contributes.configuration` |
| Color-only status indicators | Fails accessibility for colorblind users | Always pair color with icon and/or label |
| Full-page refresh for live data updates | Creates jarring UX flicker; loses scroll position | Patch individual components via message passing |
| Modal dialogs for every agent action | Interrupts flow; creates alert fatigue | Use inline controls; reserve modals for truly irreversible actions |
| Nesting agent tree deeper than 3 levels | Becomes unnavigable; users get lost | Flatten hierarchy; use filtering instead of nesting |
| Toast for every informational event | Alert fatigue; users start ignoring all notifications | Reserve toasts for warnings/errors; use status bar for info |
| Wizard flows inside webview | Violates VSCode guidelines explicitly | Use multi-step Quick Pick or side-by-side panel layout |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| VSCode extension UX rules | HIGH | Official VSCode API docs (code.visualstudio.com) |
| Status indicator conventions | HIGH | IBM Carbon Design System + multiple design sources |
| Agent info panel layout | MEDIUM | Synthesized from agentic UX research; no direct VSCode extension precedent for agent management specifically |
| Dashboard layout patterns | HIGH | Multiple verified design sources, Smashing Magazine |
| Graph diagram interaction | HIGH | React Flow official docs + Cambridge Intelligence research |
| Chat interface patterns | HIGH | Direct product comparison (Copilot, Cursor, Continue) |
| Multi-agent flow visualization | MEDIUM | Emerging pattern area; research is current (2025) but implementations are still maturing |
| Notification hierarchy | HIGH | Official VSCode docs confirmed by community discussion |
| Keyboard/accessibility | HIGH | Official VSCode guidelines |

---

## Open Questions / Gaps

1. **VSCode Webview UI Toolkit deprecated (Jan 2025)** — The official component library was deprecated. The recommended replacement is VSCode Elements (community-maintained). This should be verified before building webview components. Official docs still reference the old toolkit.

2. **React Flow licensing** — React Flow is MIT licensed for open source but requires a pro license for commercial use of some premium features. Confirm licensing requirements for HarnessTune's distribution model.

3. **AG-UI protocol** — Microsoft and Google are developing agent-to-UI communication protocols (AG-UI, A2UI) that may standardize how agent state is surfaced in UIs. Worth monitoring; may affect architecture of the event stream.

4. **Performance ceiling for graph rendering** — React Flow handles up to ~500 nodes comfortably. If HarnessTune targets large multi-agent systems (50+ agents), test rendering performance and consider virtualization or clustering early.

5. **Agent identity vs. instance** — The UX assumes each "agent" is a distinct named entity. If HarnessTune must handle multiple instances of the same agent type running in parallel, the tree view and graph require a naming/grouping convention that is not yet defined.
