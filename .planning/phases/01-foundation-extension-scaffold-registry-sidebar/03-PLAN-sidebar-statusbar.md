---
phase: 01-foundation-extension-scaffold-registry-sidebar
plan: 03
type: execute
wave: 3
depends_on: [01, 02]
files_modified:
  - src/webview/sidebar/index.tsx
  - src/webview/sidebar/App.tsx
  - src/webview/sidebar/components/WorkspaceList.tsx
  - src/webview/sidebar/components/WorkspaceItem.tsx
  - src/webview/sidebar/components/StatusBadge.tsx
  - src/webview/sidebar/styles/sidebar.css
  - src/webview/sidebar/vscodeApi.ts
  - src/panels/SidebarViewProvider.ts
  - src/panels/index.ts
  - src/statusbar/StatusBarManager.ts
  - src/statusbar/index.ts
  - src/extension.ts
  - esbuild.mjs
autonomous: false
requirements: [SIDE-01, SIDE-02, SIDE-03, SIDE-04, SIDE-05]

must_haves:
  truths:
    - "Sidebar shows each workspace with a status badge that uses color + shape (never color alone)"
    - "Clicking a workspace in the sidebar opens its workspace view in the editor area"
    - "Status bar item shows running agent count (zero when no agents active)"
    - "Sidebar updates when workspaces are added or removed"
  artifacts:
    - path: "src/webview/sidebar/App.tsx"
      provides: "React root component for sidebar WebviewView"
      min_lines: 30
    - path: "src/webview/sidebar/components/StatusBadge.tsx"
      provides: "Accessible status badge with color + shape SVG"
      exports: ["StatusBadge"]
    - path: "src/panels/SidebarViewProvider.ts"
      provides: "WebviewViewProvider registered for harnesstune.sidebarView"
      exports: ["SidebarViewProvider"]
    - path: "src/statusbar/StatusBarManager.ts"
      provides: "Status bar item with running agent count and error badge"
      exports: ["StatusBarManager"]
  key_links:
    - from: "src/panels/SidebarViewProvider.ts"
      to: "src/registry/WorkspaceRegistry.ts"
      via: "subscribes to onDidChange, posts HostToWebviewMessage"
      pattern: "onDidChange"
    - from: "src/webview/sidebar/App.tsx"
      to: "src/panels/SidebarViewProvider.ts"
      via: "postMessage WebviewToHostMessage on workspace click"
      pattern: "postMessage"
    - from: "src/statusbar/StatusBarManager.ts"
      to: "src/registry/WorkspaceRegistry.ts"
      via: "subscribes to onDidChange, computes running count"
      pattern: "onDidChange"
    - from: "src/extension.ts"
      to: "src/panels/SidebarViewProvider.ts"
      via: "registerWebviewViewProvider('harnesstune.sidebarView', provider)"
      pattern: "registerWebviewViewProvider"
---

<objective>
Build the sidebar WebviewView (React app showing workspace list with accessible status badges), the SidebarViewProvider (extension host bridge), and the status bar item (running agent count + error badge). Wire everything into extension.ts so the sidebar renders on activation and updates live.

Purpose: This is the user's primary entry point into HarnessTune. The sidebar must render workspaces, communicate status accessibly, and allow click-to-open.
Output: Functional sidebar with workspace list, status badges (color+shape), click-to-open, and a live status bar item.
</objective>

<execution_context>
@/Users/hksul/.claude/get-shit-done/workflows/execute-plan.md
@/Users/hksul/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/research/SUMMARY.md
@.planning/phases/01-foundation-extension-scaffold-registry-sidebar/01-01-SUMMARY.md
@.planning/phases/01-foundation-extension-scaffold-registry-sidebar/01-02-SUMMARY.md

<interfaces>
<!-- From Plan 01 types — the contracts sidebar renders against -->

From src/types/workspace.ts:
```typescript
export type WorkspaceStatus = 'running' | 'idle' | 'warning' | 'error' | 'unknown';
export interface WorkspaceRecord {
  id: string;
  name: string;
  rootPath: string;
  status: WorkspaceStatus;
  addedAt: string;
  lastUpdatedAt: string;
  runningAgentCount: number;
  errorCount: number;
}
```

From src/types/status.ts:
```typescript
export type StatusShape = 'circle' | 'triangle' | 'square' | 'diamond';
export interface StatusIndicator {
  status: WorkspaceStatus;
  color: string;
  shape: StatusShape;
  label: string;
  svgPath: string;
}
export const STATUS_INDICATORS: Record<WorkspaceStatus, StatusIndicator>;
```

From src/types/messages.ts:
```typescript
export type HostToWebviewMessage =
  | { type: 'workspaces:update'; workspaces: WorkspaceRecord[] }
  | { type: 'workspace:statusChanged'; workspaceId: string; status: WorkspaceStatus; runningAgentCount: number; errorCount: number }
  | { type: 'workspace:removed'; workspaceId: string }
  | { type: 'workspace:added'; workspace: WorkspaceRecord };

export type WebviewToHostMessage =
  | { type: 'workspace:connect'; name: string; rootPath: string }
  | { type: 'workspace:remove'; workspaceId: string }
  | { type: 'workspace:open'; workspaceId: string }
  | { type: 'workspace:refresh' }
  | { type: 'ready' };
```

From src/registry/WorkspaceRegistry.ts:
```typescript
export class WorkspaceRegistry implements IWorkspaceRegistry {
  getAll(): WorkspaceRecord[];
  onDidChange: vscode.Event<WorkspaceRecord[]>;
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create React sidebar app with workspace list and accessible status badges</name>
  <files>src/webview/sidebar/index.tsx, src/webview/sidebar/App.tsx, src/webview/sidebar/components/WorkspaceList.tsx, src/webview/sidebar/components/WorkspaceItem.tsx, src/webview/sidebar/components/StatusBadge.tsx, src/webview/sidebar/styles/sidebar.css, src/webview/sidebar/vscodeApi.ts</files>
  <read_first>
    - src/types/workspace.ts (WorkspaceRecord, WorkspaceStatus — data shape for rendering)
    - src/types/messages.ts (HostToWebviewMessage, WebviewToHostMessage — message contracts)
    - src/types/status.ts (STATUS_INDICATORS — color/shape/label mappings for badges)
    - .planning/research/SUMMARY.md (acquireVsCodeApi once, VSCode CSS variables, accessibility requirements)
  </read_first>
  <action>
**src/webview/sidebar/vscodeApi.ts:**
```typescript
// acquireVsCodeApi() MUST be called exactly once per webview and stored in module scope.
// Calling it twice throws. This is the #1 most common webview bug.
import type { WebviewToHostMessage, HostToWebviewMessage } from '../../types/messages';

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
```

**src/webview/sidebar/index.tsx:**
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/sidebar.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
```

**src/webview/sidebar/App.tsx:**
React component that:
1. Maintains `workspaces: WorkspaceRecord[]` state (initially empty)
2. On mount, posts `{ type: 'ready' }` to host via `vscode.postMessage`
3. Listens for `message` events on `window`, dispatches on `event.data.type`:
   - `'workspaces:update'` -> replace entire workspaces state
   - `'workspace:added'` -> append to workspaces state
   - `'workspace:removed'` -> filter out by workspaceId
   - `'workspace:statusChanged'` -> update matching workspace's status/counts
4. Renders `<WorkspaceList workspaces={workspaces} />`
5. If workspaces is empty, renders a centered message: "No workspaces connected" with a "Connect Workspace" button that posts `{ type: 'workspace:connect', name: '', rootPath: '' }` (host handles the dialog)

**src/webview/sidebar/components/WorkspaceList.tsx:**
Takes `workspaces: WorkspaceRecord[]` prop. Maps over array rendering `<WorkspaceItem>` for each.

**src/webview/sidebar/components/WorkspaceItem.tsx:**
Takes `workspace: WorkspaceRecord` prop. Renders:
- A clickable `<div>` with `role="button"` and `tabIndex={0}` for keyboard accessibility
- `<StatusBadge status={workspace.status} />` on the left
- Workspace name as primary text
- Workspace rootPath as secondary text (truncated, `opacity: 0.7`)
- Running agent count badge if > 0: `"N running"`
- Error count badge if > 0: styled with `var(--vscode-errorForeground)`
- onClick and onKeyDown (Enter/Space): posts `{ type: 'workspace:open', workspaceId: workspace.id }`
- Context: right-click or secondary action shows remove option (posts `{ type: 'workspace:remove', workspaceId: workspace.id }`)

**src/webview/sidebar/components/StatusBadge.tsx:**
Takes `status: WorkspaceStatus` prop. Renders:
- Import `STATUS_INDICATORS` from types
- Lookup indicator by status
- Render inline SVG (16x16 viewBox="0 0 24 24") using `indicator.svgPath`
- Fill color: `indicator.color` (VSCode CSS variable)
- For idle status (outline only): use `fill="none"` and `stroke={indicator.color}`
- `aria-label={indicator.label}` on the SVG element
- `title` element inside SVG with indicator.label text

CRITICAL: Status badges use BOTH color AND shape (SIDE-02). Each status has a unique shape: running=filled circle, idle=outline circle, warning=triangle, error=diamond, unknown=square.

**src/webview/sidebar/styles/sidebar.css:**
- Use VSCode CSS variables exclusively: `--vscode-sideBar-background`, `--vscode-sideBar-foreground`, `--vscode-list-activeSelectionBackground`, `--vscode-list-hoverBackground`, `--vscode-list-activeSelectionForeground`
- No hardcoded colors anywhere
- `.workspace-item`: padding 6px 12px, display flex, align-items center, gap 8px, cursor pointer, border-radius 3px
- `.workspace-item:hover`: background `var(--vscode-list-hoverBackground)`
- `.workspace-item:focus-visible`: outline 1px solid `var(--vscode-focusBorder)`
- `.workspace-name`: font-size 13px (VSCode standard), color `var(--vscode-sideBar-foreground)`
- `.workspace-path`: font-size 11px, opacity 0.7, overflow hidden, text-overflow ellipsis, white-space nowrap
- `.badge`: font-size 11px, padding 1px 6px, border-radius 8px
- `.badge-error`: background `var(--vscode-errorForeground)`, color `var(--vscode-editor-background)`
- `.empty-state`: text-align center, padding 20px, color `var(--vscode-descriptionForeground)`
- `body`: margin 0, padding 0, background `var(--vscode-sideBar-background)`, color `var(--vscode-sideBar-foreground)`, font-family `var(--vscode-font-family)`, font-size `var(--vscode-font-size)`
  </action>
  <verify>
    <automated>cd /Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune && npx tsc --project tsconfig.webview.json --noEmit && echo "WEBVIEW TYPES OK"</automated>
  </verify>
  <acceptance_criteria>
    - src/webview/sidebar/vscodeApi.ts calls `acquireVsCodeApi()` exactly once at module scope
    - src/webview/sidebar/App.tsx posts `{ type: 'ready' }` on mount via useEffect
    - src/webview/sidebar/App.tsx handles all four HostToWebviewMessage types in message listener
    - src/webview/sidebar/components/StatusBadge.tsx imports STATUS_INDICATORS and renders SVG with aria-label
    - src/webview/sidebar/components/StatusBadge.tsx renders different SVG paths per status (not just different colors)
    - src/webview/sidebar/components/WorkspaceItem.tsx has role="button" and tabIndex={0} on clickable element
    - src/webview/sidebar/components/WorkspaceItem.tsx posts `workspace:open` message on click
    - src/webview/sidebar/styles/sidebar.css contains `--vscode-sideBar-background` (uses VSCode CSS vars)
    - src/webview/sidebar/styles/sidebar.css does NOT contain any hex color values (#xxx) or rgb() values
    - `npx tsc --project tsconfig.webview.json --noEmit` exits 0
  </acceptance_criteria>
  <done>React sidebar app renders workspace list with accessible status badges (color+shape). Clicking a workspace sends open message to host. Empty state shows connect prompt. All styling uses VSCode CSS variables.</done>
</task>

<task type="auto">
  <name>Task 2: Create SidebarViewProvider, StatusBarManager, and wire into extension.ts</name>
  <files>src/panels/SidebarViewProvider.ts, src/panels/index.ts, src/statusbar/StatusBarManager.ts, src/statusbar/index.ts, src/extension.ts, esbuild.mjs</files>
  <read_first>
    - src/extension.ts (current state after Plan 02 — has registry, watchers, secrets)
    - src/registry/WorkspaceRegistry.ts (onDidChange event, getAll method)
    - src/types/messages.ts (HostToWebviewMessage, WebviewToHostMessage contracts)
    - src/webview/sidebar/App.tsx (expects 'workspaces:update' message on 'ready')
    - package.json (view container and view IDs to match)
  </read_first>
  <action>
**src/panels/SidebarViewProvider.ts:**

Class `SidebarViewProvider` implements `vscode.WebviewViewProvider`.

Static `viewType = 'harnesstune.sidebarView'` (must match package.json view id exactly).

Constructor takes `extensionUri: vscode.Uri`, `registry: WorkspaceRegistry`.

`resolveWebviewView(webviewView, context, token)`:
1. Store reference to `webviewView.webview`
2. Set `webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')] }`
3. Set `webviewView.webview.html` to HTML template (see below)
4. Listen for messages from webview (`webviewView.webview.onDidReceiveMessage`):
   - `'ready'` -> send `{ type: 'workspaces:update', workspaces: this.registry.getAll() }`
   - `'workspace:open'` -> execute command `vscode.commands.executeCommand('harnesstune.openWorkspace', msg.workspaceId)` (placeholder: show info message with workspace name for now; full workspace view panel comes in Phase 2)
   - `'workspace:remove'` -> call `this.registry.remove(msg.workspaceId)`
   - `'workspace:connect'` -> execute command `vscode.commands.executeCommand('harnesstune.connectWorkspace')`
   - `'workspace:refresh'` -> send full workspace list update
5. Subscribe to `registry.onDidChange` -> post `{ type: 'workspaces:update', workspaces }` to webview

HTML template function `getHtmlForWebview(webview: vscode.Webview): string`:
- Generate nonce using `crypto.randomBytes(16).toString('hex')` for CSP
- Content Security Policy meta tag: `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';`
- `<div id="root"></div>`
- Script tag with nonce loading the sidebar bundle: `<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar.js'))}"></script>`
- Inline style tag for base body styles (or link to CSS if bundled separately)

**src/statusbar/StatusBarManager.ts:**

Class `StatusBarManager`.

Constructor takes `registry: WorkspaceRegistry`.

On construction:
1. Create status bar item: `vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)`
2. Set `item.command = 'harnesstune.showDashboard'`
3. Call `updateStatusBar()` to set initial text
4. Subscribe to `registry.onDidChange` -> call `updateStatusBar()`
5. Show the item: `item.show()`

`updateStatusBar()`:
- Sum `runningAgentCount` across all workspaces from `registry.getAll()`
- Sum `errorCount` across all workspaces
- If errors > 0: `item.text = "$(pulse) HT: ${runningCount} running $(error) ${errorCount}"`
- If no errors: `item.text = "$(pulse) HT: ${runningCount} running"`
- `item.tooltip = "HarnessTune — Click to open dashboard"`
- If errors > 0: `item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')`
- If no errors: `item.backgroundColor = undefined`

`dispose()`: dispose the status bar item.

**Update src/extension.ts:**

Add after existing initialization:
1. Create `SidebarViewProvider` with `context.extensionUri` and `registry`
2. Register: `context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider))`
3. Create `StatusBarManager` with `registry`
4. Push `statusBarManager` to `context.subscriptions` (if it implements Disposable, or wrap in `{ dispose: () => statusBarManager.dispose() }`)
5. Update `harnesstune.openWorkspace` command: for now, show info message "Opening workspace: {name}" (full panel creation is Phase 2 scope)

**Update esbuild.mjs:**

Ensure the sidebar webview entry point `src/webview/sidebar/index.tsx` is configured (it should already be from Plan 01, but verify the path matches and add JSX loader config if needed):
- Add `loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' }` to sidebar config if not present
- Verify outfile is `dist/webview/sidebar.js`
  </action>
  <verify>
    <automated>cd /Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune && npx tsc --project tsconfig.extension.json --noEmit && npx tsc --project tsconfig.webview.json --noEmit && node esbuild.mjs && test -f dist/extension.js && test -f dist/webview/sidebar.js && echo "FULL BUILD OK"</automated>
  </verify>
  <acceptance_criteria>
    - src/panels/SidebarViewProvider.ts contains `static viewType = 'harnesstune.sidebarView'`
    - src/panels/SidebarViewProvider.ts implements `vscode.WebviewViewProvider` (contains `resolveWebviewView`)
    - src/panels/SidebarViewProvider.ts sets CSP with nonce: contains `Content-Security-Policy` and `nonce-`
    - src/panels/SidebarViewProvider.ts sets `enableScripts: true` in webview options
    - src/panels/SidebarViewProvider.ts sets `localResourceRoots` pointing to dist directory
    - src/panels/SidebarViewProvider.ts handles 'ready' message by sending workspaces:update
    - src/panels/SidebarViewProvider.ts subscribes to registry.onDidChange
    - src/statusbar/StatusBarManager.ts creates status bar item with text containing "HT:"
    - src/statusbar/StatusBarManager.ts subscribes to registry.onDidChange for live updates
    - src/statusbar/StatusBarManager.ts uses $(error) codicon when errorCount > 0
    - src/extension.ts contains `registerWebviewViewProvider` call with `harnesstune.sidebarView`
    - src/extension.ts instantiates both SidebarViewProvider and StatusBarManager
    - esbuild.mjs produces dist/webview/sidebar.js (ESM browser bundle)
    - Both `npx tsc --project tsconfig.extension.json --noEmit` and `npx tsc --project tsconfig.webview.json --noEmit` exit 0
    - `node esbuild.mjs` exits 0 and both dist/extension.js and dist/webview/sidebar.js exist
  </acceptance_criteria>
  <done>SidebarViewProvider renders React app in WebviewView, receives workspace data from registry, handles click-to-open messages. StatusBarManager shows live running agent count with error badge. Both update reactively when registry changes.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Verify sidebar renders and status bar works in VSCode</name>
  <what-built>Complete Phase 1 sidebar and status bar: extension scaffold, workspace registry with JSON persistence, React sidebar WebviewView with status badges (color + shape), and status bar item showing running agent count.</what-built>
  <how-to-verify>
    1. Open VSCode in the harnesstune project directory
    2. Press F5 to launch Extension Development Host
    3. In the new VSCode window, check the Activity Bar — "HarnessTune" icon should appear
    4. Click the HarnessTune icon — sidebar should open showing "No workspaces connected" with a "Connect Workspace" button
    5. Open Command Palette (Cmd+Shift+P), type "HarnessTune" — verify all 5 commands appear: Connect Workspace, Remove Workspace, Open Workspace, Refresh Sidebar, Show Dashboard
    6. Run "HarnessTune: Connect Workspace" — folder picker should open
    7. Select any directory and enter a name — workspace should appear in the sidebar with a status badge
    8. Verify the status badge has BOTH a shape AND color (not just a colored dot)
    9. Check the status bar at the bottom — should show "HT: 0 running"
    10. Click the workspace in the sidebar — should show an info message with the workspace name
    11. Close and reopen VSCode Extension Development Host — the workspace should still appear in the sidebar (persistence test)
    12. Run "HarnessTune: Remove Workspace" — select the workspace — it should disappear from the sidebar
  </how-to-verify>
  <resume-signal>Type "approved" if all checks pass, or describe any issues you see.</resume-signal>
</task>

</tasks>

<verification>
- Extension loads without errors in Extension Development Host (F5)
- Sidebar renders React workspace list via WebviewView
- Status badges use color + shape (never color alone) — visible in sidebar
- Connect Workspace command adds a workspace that persists across restarts
- Remove Workspace command removes a workspace from sidebar immediately
- Click on workspace triggers open action
- Status bar shows running agent count (0 when idle)
- Both tsconfig projects compile without errors
- esbuild produces both dist/extension.js and dist/webview/sidebar.js
</verification>

<success_criteria>
- All 5 Phase 1 success criteria from ROADMAP are met:
  1. Connect an existing directory as workspace — persists after restart
  2. Remove a workspace — disappears from sidebar immediately
  3. Sidebar shows workspaces with accessible status badges (color + shape)
  4. Clicking workspace opens its view
  5. Status bar shows running agent count (zero when idle)
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-extension-scaffold-registry-sidebar/01-03-SUMMARY.md`
</output>
