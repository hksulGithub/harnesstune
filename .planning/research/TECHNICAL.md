# Technical Architecture Research: HarnessTune VSCode Extension

**Project:** HarnessTune — multi-agent management IDE as a VSCode extension
**Researched:** 2026-04-16
**Overall confidence:** HIGH (official docs + verified community patterns)

---

## 1. VSCode Extension Layout: The Full Picture

VSCode's UI is divided into named regions. Each is a separate API surface with different contribution mechanisms.

```
┌─────────────────────────────────────────────────────────────┐
│  Activity Bar │  Primary Sidebar  │  Editor Area            │
│  (icon tabs)  │  (TreeView /      │  (Editor Groups /       │
│               │   WebviewView)    │   WebviewPanel)         │
├───────────────┴───────────────────┴─────────────────────────┤
│  Panel (Terminal / Output / Problems / WebviewView)         │
└─────────────────────────────────────────────────────────────┘
│  Status Bar                                                  │
└─────────────────────────────────────────────────────────────┘
```

**Contribution regions relevant to HarnessTune:**

| Region | API Surface | Best Use For |
|--------|-------------|-------------|
| Activity Bar | `contributes.viewsContainers` + icon | HarnessTune icon — entry point |
| Primary Sidebar | `WebviewView` via `registerWebviewViewProvider` | Workspace list + status tree |
| Editor Area | `WebviewPanel` via `createWebviewPanel` | Dashboard, schematic, chat panes |
| Secondary Sidebar | Same `WebviewView` mechanism | Optional overflow panels |
| Panel (bottom) | `WebviewView` or terminal | Embedded PTY terminal |
| Status Bar | `StatusBarItem` | Aggregate health indicator |

**Key distinction:** `WebviewPanel` lives in the editor area (openable/closeable like a file tab). `WebviewView` lives in the sidebar or panel region and is always present once contributed.

**Confidence: HIGH** — from official VSCode Extension API docs.

---

## 2. Multi-Pane Layout Architecture for HarnessTune

### Recommended Layout Model

HarnessTune requires a tmux-like experience with a sidebar workspace list and multiple content panes. The correct mapping:

**Primary Sidebar (left):** `WebviewView` with React — workspace list with status indicators. This is always visible. Registered via `registerWebviewViewProvider`.

**Editor Area (center/main):** Multiple `WebviewPanel` instances opened as tabs or split across editor groups. Each workspace opens its own panel set.

**Panel Area (bottom):** Either VSCode's native integrated terminal OR an embedded xterm.js `WebviewView` — see Section 5 for the tradeoff.

### Editor Group Split for Multi-Panel Per Workspace

VSCode supports opening `WebviewPanel` into a specific editor column using `ViewColumn` enum:

```typescript
vscode.window.createWebviewPanel(
  'harnesstune.dashboard',
  'Agent Dashboard',
  vscode.ViewColumn.One,  // or Two, Three, Active, Beside
  options
);
```

`ViewColumn.Beside` opens a panel to the right of the current active editor — useful for opening the schematic next to the dashboard. Users can freely drag/split panel tabs from there.

**Limitation:** Extensions cannot programmatically control split ratios or enforce a specific multi-column layout. The API exposes column placement, but the user controls sizing. You can open panels in specific columns; you cannot lock layout.

**Recommendation for HarnessTune:**
- Open Dashboard in `ViewColumn.One`
- Open Schematic in `ViewColumn.Two` (beside)
- Chat terminal in `ViewColumn.Three` or bottom Panel
- Do not try to enforce layout — provide a "Reset Layout" command instead

### Multiple Panels Per Workspace

The standard pattern is to manage panel instances in a `Map<workspaceId, WebviewPanel>`. Check if a panel exists before creating:

```typescript
const existing = this.panels.get(workspaceId);
if (existing) {
  existing.reveal(vscode.ViewColumn.One);
  return;
}
const panel = vscode.window.createWebviewPanel(...);
this.panels.set(workspaceId, panel);
panel.onDidDispose(() => this.panels.delete(workspaceId));
```

**Confidence: HIGH**

---

## 3. React Inside VSCode Webviews

### Architecture

Each webview is a sandboxed iframe. All code the webview needs must be pre-compiled and served as local files by the extension. No CDN, no external script loading (CSP blocks it).

**Project structure:**

```
harnesstune/
├── src/
│   ├── extension.ts          — Extension host entry point
│   ├── panels/
│   │   ├── DashboardPanel.ts — Manages WebviewPanel lifecycle
│   │   ├── SchematicPanel.ts
│   │   └── ChatPanel.ts
│   ├── views/
│   │   └── WorkspaceView.ts  — Sidebar WebviewView provider
│   └── messaging/
│       └── types.ts          — Shared message types (host ↔ webview)
├── webview-ui/
│   ├── dashboard/
│   │   └── index.tsx         — React app for Dashboard panel
│   ├── schematic/
│   │   └── index.tsx         — React app for Schematic panel
│   ├── chat/
│   │   └── index.tsx         — React app for Chat panel
│   └── sidebar/
│       └── index.tsx         — React app for Sidebar WebviewView
├── dist/                     — esbuild output (extension + all webview bundles)
├── esbuild.js                — Build config (multiple entry points)
└── package.json
```

### Build Configuration (esbuild — recommended over webpack)

Maintain **two separate build targets**: the extension host (Node.js CommonJS) and each webview (browser ESM). These are fundamentally different runtimes.

```javascript
// esbuild.js
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  external: ['vscode'],  // vscode is provided by the runtime
};

const webviewConfigs = [
  { entryPoints: ['webview-ui/dashboard/index.tsx'], outfile: 'dist/webviews/dashboard.js' },
  { entryPoints: ['webview-ui/schematic/index.tsx'], outfile: 'dist/webviews/schematic.js' },
  { entryPoints: ['webview-ui/chat/index.tsx'],      outfile: 'dist/webviews/chat.js' },
  { entryPoints: ['webview-ui/sidebar/index.tsx'],   outfile: 'dist/webviews/sidebar.js' },
].map(config => ({
  ...config,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
}));
```

**Why esbuild over webpack:** A migration from webpack to esbuild reduced build times from 50 seconds to under 1 second — critical for a dev loop where you relaunch the extension debugger constantly.

**Why not Vite for the webview:** Vite is excellent in dev mode (HMR) but produces a more complex build artifact. esbuild is simpler to configure for the sandboxed webview context. Vite is a reasonable alternative if you want HMR in webview during development; configure it only for dev and fall back to esbuild for production.

### Loading the Bundle in a Panel

```typescript
class DashboardPanel {
  private _getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'dashboard.js')
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
      <html>
      <head>
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   img-src ${webview.cspSource} https: data:;
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}';">
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
```

**CSP note:** `unsafe-inline` for styles is acceptable; avoid it for scripts. Use nonces for scripts.

### TypeScript Configuration

The webview React code needs DOM types; the extension code must not include DOM types (it runs in Node). Use separate `tsconfig.json` files:

- `tsconfig.json` — base, references both
- `tsconfig.extension.json` — `"lib": ["ES2022"]`, no DOM
- `tsconfig.webview.json` — `"lib": ["ES2022", "DOM"]`, `"jsx": "react-jsx"`

**Confidence: HIGH**

---

## 4. Messaging: Extension Host ↔ React Webview

### Raw postMessage (avoid for complex use)

The base API is `panel.webview.postMessage(data)` (host→webview) and `vscode.postMessage(data)` from within the webview script (webview→host). This is untyped and becomes unmanageable as messages multiply.

### Recommended Pattern: Typed RPC Layer

The production pattern used by complex extensions (including Cline) is a typed message contract with correlation IDs for request/response pairs.

**Define a shared message type contract** (used by both host and webview):

```typescript
// src/messaging/types.ts
export type HostToWebviewMessage =
  | { type: 'workspace:update'; payload: WorkspaceState }
  | { type: 'agent:statusChange'; payload: AgentStatus }
  | { type: 'schematic:data'; payload: SchematicGraph };

export type WebviewToHostMessage =
  | { type: 'workspace:select'; workspaceId: string }
  | { type: 'agent:inspect'; agentId: string }
  | { type: 'chat:send'; text: string };
```

**In the webview (React):**

```typescript
const vscode = acquireVsCodeApi();  // call ONCE, store in module scope
vscode.postMessage({ type: 'workspace:select', workspaceId: 'ws-1' });

window.addEventListener('message', (event) => {
  const msg = event.data as HostToWebviewMessage;
  if (msg.type === 'workspace:update') { /* update state */ }
});
```

**For async request/response**, use a UUID correlation pattern:

```typescript
function callHost<T>(type: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const handler = (event: MessageEvent) => {
      if (event.data.responseId === id) {
        window.removeEventListener('message', handler);
        resolve(event.data.result);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type, payload, requestId: id });
  });
}
```

**Library option:** `vscode-messenger` by TypeFox implements this as a JSON-RPC protocol with a typed API. Worth adopting for HarnessTune to avoid building this from scratch.

**State management in React:** Use React Context + useReducer for UI state. The extension host is the source of truth; the webview only holds display state. On `retainContextWhenHidden: false` (default), use `vscode.setState()` to snapshot React state so it survives panel hide/show cycles.

**Confidence: HIGH**

---

## 5. Terminal / PTY Integration — Two Approaches

This is the most architecturally significant decision for HarnessTune's chat interface.

### Approach A: VSCode Native Terminal (Recommended for v1)

Use `vscode.window.createTerminal()` with `ExtensionTerminalOptions` and `Pseudoterminal`.

```typescript
const writeEmitter = new vscode.EventEmitter<string>();
const pty: vscode.Pseudoterminal = {
  onDidWrite: writeEmitter.event,
  open: () => writeEmitter.fire('HarnessTune terminal ready\r\n'),
  close: () => { /* cleanup */ },
  handleInput: (data: string) => {
    // pipe data to child process (Claude Code CLI, etc.)
    childProcess.stdin.write(data);
  }
};
const terminal = vscode.window.createTerminal({ name: 'Agent: ws-1', pty });
terminal.show();
```

The extension spawns the actual CLI process (`child_process.spawn`) and bridges its stdio to the `Pseudoterminal` interface. The terminal appears in VSCode's integrated terminal panel — users get native copy/paste, font scaling, and shell integration.

**Shell Integration API (important for HarnessTune):** VSCode 1.80+ exposes `terminal.shellIntegration.executeCommand()` and `onDidEndTerminalShellExecution`. This lets the extension detect command completions and parse exit codes — useful for tracking agent task outcomes. Reliability improved in March 2025 builds.

**Pros:** Zero additional bundle size, native VSCode UX, no xterm.js licensing complexity, accessible.
**Cons:** Terminal lives in VSCode's panel area — cannot be embedded inline within a webview pane without workarounds.

### Approach B: xterm.js Embedded in Webview

Bundle xterm.js into the webview React app. The extension host manages the `node-pty` process and pipes data through postMessage.

```
child_process (agent CLI)
  ↓ stdout/stderr
Extension Host
  ↓ panel.webview.postMessage({ type: 'pty:data', data: chunk })
WebviewPanel (React + xterm.js)
  ↕ renders terminal, captures keystrokes
  ↓ vscode.postMessage({ type: 'pty:input', data: key })
Extension Host
  ↓ stdin write
child_process
```

**`node-pty` dependency:** Requires native Node.js binaries (`.node` files). These must be bundled with the extension and are platform-specific. This significantly complicates extension packaging and CI — separate binaries for win32/darwin/linux, architecture variants (arm64/x64). `node-pty` is the same library VSCode uses internally.

**Pros:** Terminal embedded inside the webview layout — can sit next to the schematic in the same panel without layout constraints.
**Cons:** Complex packaging (native binaries), adds ~500KB+ to extension size, CSP must allow xterm.js resources, accessibility gaps vs. native terminal.

### Recommendation

**Use Approach A for v1.** Open a dedicated named terminal per workspace (`Agent: <workspace-name>`) via Pseudoterminal. The terminal appears in VSCode's integrated terminal panel, which users already know how to split and manage. Wire the chat panel webview to show agent output by reading from a log file or receiving streamed data via postMessage — keep the PTY in the host process.

**Consider Approach B only if** the UX requirement is hard: terminal must be inline with the schematic in the same editor pane. Defer to v2 when the complexity cost is justified.

**Confidence: MEDIUM** — technical feasibility of both approaches is HIGH confidence; the UX judgment is MEDIUM (needs user testing to validate).

---

## 6. Sidebar: TreeView vs. WebviewView

### TreeView API

`registerTreeDataProvider` or `createTreeView` + `TreeDataProvider` implementation. Renders a native VSCode tree with folders, icons, inline action buttons, badges, and decorations. Keyboard navigable, accessible, matches VSCode aesthetic.

```typescript
// package.json contributes
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "harnesstune",
        "title": "HarnessTune",
        "icon": "$(circuit-board)"
      }]
    },
    "views": {
      "harnesstune": [{
        "id": "harnesstune.workspaces",
        "name": "Workspaces"
      }]
    }
  }
}
```

TreeView supports:
- `TreeItem` with `iconPath`, `description`, `tooltip`, `contextValue`
- `createTreeView` gives access to `reveal()`, `onDidChangeSelection`, `onDidExpandElement`
- Inline actions via `view/item/context` menu with `"group": "inline"`
- `TreeItemCheckboxState` for selectable items
- Drag and drop with `TreeDragAndDropController`

**What TreeView cannot do:** Rich custom UI (health bars, sparklines, colored status badges with custom shapes). If the workspace list needs complex visual indicators beyond text + icon, TreeView hits its ceiling.

### WebviewView in Sidebar

`registerWebviewViewProvider` with a `WebviewViewProvider`. Full React app rendered in the sidebar. Visually unlimited.

**Tradeoffs:**

| Concern | TreeView | WebviewView |
|---------|----------|-------------|
| Accessibility | Native (excellent) | Manual ARIA needed |
| VSCode aesthetic | Automatic | Manual theming via CSS vars |
| Performance | Negligible | Heavier (iframe + React) |
| Custom visuals | Limited | Unlimited |
| Keyboard nav | Built-in | Must implement |
| Status badges | Icon + text only | Full custom |

### Recommendation

**Use WebviewView** for HarnessTune's sidebar. The workspace list needs health indicators, status colors, uptime badges, and error counts — these require custom UI that TreeView cannot render. Use VSCode CSS variables (`--vscode-sideBar-background`, `--vscode-list-activeSelectionBackground`, etc.) to match the editor theme automatically.

Implement keyboard navigation and ARIA labels carefully to compensate for the accessibility gap.

**Confidence: HIGH**

---

## 7. Webview Panel Lifecycle and State Persistence

### Lifecycle States

```
createWebviewPanel()
    ↓
  ACTIVE (visible, JS running)
    ↓ (user switches tab)
  HIDDEN (JS context destroyed by default)
    ↓ (user closes tab)
  DISPOSED (permanent)
```

### State Persistence Strategy

VSCode destroys the webview JS context when the panel is hidden (not visible). Three options:

**Option 1: `getState()` / `setState()` (recommended for most state)**

Call `vscode.setState(state)` inside the webview whenever React state changes. On re-mount after hide, call `vscode.getState()` to restore. This is highly optimized — calling it 10 times/second has no measurable overhead. State survives hide/show cycles but not VS Code restart.

```typescript
// In React webview
const vscodeApi = acquireVsCodeApi();
// Restore on mount
const saved = vscodeApi.getState() as DashboardState | undefined;
const [state, setState] = useState(saved ?? defaultState);
// Save on every change
useEffect(() => { vscodeApi.setState(state); }, [state]);
```

**Option 2: `WebviewPanelSerializer` (for cross-restart persistence)**

Register a serializer for each panel viewType. VSCode calls `deserializeWebviewPanel()` on restart to re-create panels that were open. The serializer receives the persisted `state` blob (from `setState()` in the webview).

```typescript
vscode.window.registerWebviewPanelSerializer('harnesstune.dashboard', {
  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: DashboardState) {
    // restore panel content, re-set HTML, re-wire messaging
    DashboardPanel.restore(panel, extensionUri, state);
  }
});
```

**Activation event required:** `"onWebviewPanel:harnesstune.dashboard"` in `package.json`.

**Option 3: `retainContextWhenHidden: true` (avoid for most panels)**

Keeps the webview iframe and JS context alive even when the panel is hidden. Eliminates re-render cost on panel switch. However, it has high memory overhead — each retained panel holds a full browser context in memory. Use only for the terminal/chat panel where re-connecting a PTY on unhide is genuinely complex.

### Recommendation for HarnessTune

| Panel | Persistence Strategy |
|-------|---------------------|
| Dashboard | `getState/setState` + `WebviewPanelSerializer` |
| Schematic | `getState/setState` (graph data re-fetched from host on restore) |
| Chat / Terminal | `retainContextWhenHidden: true` (PTY reconnect is complex) |
| Sidebar WebviewView | `retainContextWhenHidden: true` by default for sidebar views |

**Confidence: HIGH**

---

## 8. Performance Considerations for Webview-Heavy Extensions

### Known Overhead Sources

1. **Each `WebviewPanel` is a full browser iframe process.** VSCode allocates a renderer process per webview group. Multiple simultaneous panels (dashboard + schematic + chat) will consume meaningful RAM — expect 80-150MB per active webview.

2. **`retainContextWhenHidden` multiplies memory cost.** A hidden but retained webview still holds its full JS heap. Don't retain panels the user has closed — only retain those that are "backgrounded but still in the workspace session."

3. **Frequent `postMessage` traffic.** Sending large JSON blobs every few seconds (e.g., log streaming) across the postMessage bridge has measurable latency. Strategy: batch updates (debounce at 250ms), send diffs not full state snapshots, use string IDs not full objects in messages.

4. **React re-render cost inside webviews.** Standard React optimization applies: `useMemo`, `useCallback`, `React.memo` for expensive graph/schematic renders.

5. **Mermaid.js / D3.js render cost.** For the agent schematic, large graphs (20+ nodes) can block the webview's main thread. Options: render in a Web Worker inside the webview, or pre-render SVG on the extension host and send it as a string.

### Optimization Recommendations

- **Virtualize the workspace list** if workspaces exceed 20 (use `react-window` or native scrolling with partial rendering)
- **Lazy-load panels** — don't create all workspace panels at startup; create on first selection
- **Dispose panels** when a workspace is closed (call `panel.dispose()`)
- **Use `WorkspaceView` (sidebar WebviewView) as the always-on state hub** — panels can be disposed and recreated cheaply if the sidebar always holds current state
- **Throttle schematic updates** — if agent topology changes frequently, debounce re-renders at 1-2s intervals; topology structure rarely changes, only node status does

**Confidence: MEDIUM** — patterns are well-established; actual memory figures depend on React app complexity.

---

## 9. Extension Bundling Setup

### Recommended Build Stack

- **Bundler:** esbuild (not webpack)
- **Language:** TypeScript with separate tsconfigs per target
- **Package scripts:**

```json
{
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "vscode:prepublish": "node esbuild.js --production"
  }
}
```

### What Gets Bundled Where

| Bundle | Target | Format | External |
|--------|--------|--------|---------|
| `dist/extension.js` | Node.js | CJS | `vscode`, native modules |
| `dist/webviews/dashboard.js` | Browser | ESM | nothing |
| `dist/webviews/schematic.js` | Browser | ESM | nothing |
| `dist/webviews/sidebar.js` | Browser | ESM | nothing |
| `dist/webviews/chat.js` | Browser | ESM | nothing |

**Critical:** `vscode` must be in `external` for the extension bundle — it is provided by the VSCode runtime and cannot be bundled. Never include it in webview bundles (webviews cannot access the `vscode` module directly; they communicate only via `acquireVsCodeApi()`).

**native modules:** If using `node-pty` (for Approach B terminal), native `.node` binaries must be copied into `dist/` and referenced with correct relative paths. This requires a post-build copy step and platform-specific packaging in `vsix`. Avoid this in v1.

### `.vscodeignore`

```
**
!dist/**
!package.json
!LICENSE
!node_modules/  # only if you have native deps not bundled
```

**Confidence: HIGH**

---

## 10. Diagram Rendering: Mermaid vs. D3.js

Since the agent schematic is a core feature, this deserves a dedicated recommendation.

### Mermaid.js

Pre-built diagram renderer for flowcharts, sequence diagrams, etc. Ships as a single JS bundle. Parse a text DSL (`graph TD; A --> B`) and renders SVG.

**Pros:** Zero graph layout code to write, readable DSL for defining agent topologies, active maintenance.
**Cons:** Limited customization (node shapes, click handlers, custom styling require overrides), cannot do custom physics-based layouts, large bundle size (~1.5MB minified).

**Best for:** Static or semi-static topology display where the agent graph structure is defined at setup time and doesn't change frequently.

### D3.js (Force-Directed Graph)

Full visualization toolkit. Build custom layouts, animated transitions, rich click handlers, custom node shapes.

**Pros:** Unlimited visual customization, force-directed layout feels "alive" for dynamic agent topologies, tight click-to-inspect integration.
**Cons:** Significant implementation effort for layout + interaction, steep learning curve, ~250KB bundle.

### Recommendation

**Use Mermaid.js for v1.** The agent schematic is primarily informational — engineers need to see topology and status, not animate it. Mermaid renders well, is easy to generate from agent config data, and requires zero layout code. Add `mermaid.initialize({ theme: 'dark' })` to match VSCode dark themes.

Add click handlers via Mermaid's `securityLevel: 'loose'` mode (allows custom click callbacks) or by post-processing the rendered SVG to attach event listeners.

For v2, consider migrating the schematic to a custom D3 force-directed graph if user feedback shows the need for richer interaction.

**Confidence: MEDIUM** — based on use case analysis; actual complexity depends on graph dynamism.

---

## 11. Key API References

| Capability | API | Docs |
|-----------|-----|------|
| Webview panel | `vscode.window.createWebviewPanel()` | [Webview API](https://code.visualstudio.com/api/extension-guides/webview) |
| Sidebar webview | `vscode.window.registerWebviewViewProvider()` | [UX Guidelines: Webviews](https://code.visualstudio.com/api/ux-guidelines/webviews) |
| Activity Bar icon | `contributes.viewsContainers` in package.json | [Views](https://code.visualstudio.com/api/ux-guidelines/views) |
| TreeView | `vscode.window.createTreeView()` | [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view) |
| Pseudoterminal | `vscode.window.createTerminal({ pty })` | [VS Code API](https://code.visualstudio.com/api/references/vscode-api) |
| Shell integration | `terminal.shellIntegration.executeCommand()` | [Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration) |
| State persistence | `acquireVsCodeApi().getState/setState` | [Webview API](https://code.visualstudio.com/api/extension-guides/webview) |
| Panel serialization | `registerWebviewPanelSerializer()` | [Webview API](https://code.visualstudio.com/api/extension-guides/webview) |
| Bundling | esbuild dual entry points | [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) |

---

## 12. Architecture Decisions Summary

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Sidebar UI | `WebviewView` with React | Custom visual indicators exceed TreeView capability |
| Main panels | `WebviewPanel` per workspace view | Standard pattern; allows multi-column layout |
| Terminal/chat | VSCode native PTY (Pseudoterminal) for v1 | Avoids native binary packaging complexity |
| Messaging | Typed message contracts + correlation IDs | Type safety across the postMessage bridge |
| State persistence | `getState/setState` + `WebviewPanelSerializer` | Low overhead, survives restarts |
| Build tool | esbuild with two entry point sets | 50x faster than webpack |
| Diagram lib | Mermaid.js for v1 | Zero layout code, good enough for topology display |
| Context retention | `retainContextWhenHidden` only for chat panel | Memory overhead not justified for data panels |

---

## 13. Critical Pitfalls to Avoid

1. **Calling `acquireVsCodeApi()` more than once per webview script** — it throws on the second call. Store the return value in module scope immediately.

2. **Trying to import `vscode` inside a webview bundle** — the `vscode` module is only available in the extension host process, never in the webview iframe. All VSCode API calls must happen host-side; webviews communicate via `postMessage` only.

3. **Using `retainContextWhenHidden: true` on all panels** — will cause visible memory pressure with 3+ workspace panels open. Use `getState/setState` instead.

4. **Forgetting `panel.onDidDispose()` cleanup** — if you don't remove the panel from your `Map` on dispose, you'll try to call `postMessage` on a disposed panel and get exceptions.

5. **Not registering `WebviewPanelSerializer`** — panels will not reopen on VS Code restart, which breaks workspace persistence.

6. **node-pty in v1** — native binary packaging has bitten many extensions at VSIX publish time. Defer until the PTY-in-webview feature is explicitly required.

7. **Webview UI Toolkit deprecation (January 2025)** — `@vscode/webview-ui-toolkit` was officially deprecated. Do not use it for new development. Use plain CSS with VSCode CSS variables, or a community alternative like `vscode-elements`.

---

## Sources

- [VSCode Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [VSCode UX Guidelines Overview](https://code.visualstudio.com/api/ux-guidelines/overview)
- [VSCode Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [VSCode Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [VSCode Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [Cline Extension WebviewProvider Architecture (DeepWiki)](https://deepwiki.com/cline/cline/2.4-webviewprovider)
- [Using React in VS Code Webviews — Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/)
- [esbuild for VSCode Extensions — datho7561](http://datho7561.dev/blog/vscode-webpack-to-esbuild/)
- [vscode-messenger RPC library — TypeFox](https://github.com/TypeFox/vscode-messenger)
- [react-vscode-webview-ipc](https://github.com/hbmartin/react-vscode-webview-ipc)
- [VSCode Webview Lifecycle — Symposium](https://symposium.dev/references/vscode-webview-lifecycle.html)
- [Multiple Webviews in a Single Extension — vogella](https://vogella.com/blog/multiple-webviews-single-extension/)
