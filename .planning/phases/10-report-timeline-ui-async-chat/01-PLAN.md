---
phase: 10
plan: 1
title: "Extension Host Infrastructure + Panel Scaffold"
wave: 1
depends_on: []
estimated_tasks: 2
objective: "Build the extension host plumbing for timeline data (types, RelayClient.getMessages, RemoteAdapter timeline merge, ReportPanel singleton) and the webview scaffold (esbuild entry, index.tsx, App.tsx shell) so Plan 02 can focus purely on React components."
---

# Plan 01 — Extension Host Infrastructure + Panel Scaffold

## Task 1: Types, RelayClient, RemoteAdapter Timeline Merge

<read_first>
- src/types/messages.ts (existing HostToWebviewMessage / WebviewToHostMessage)
- src/relay/RelayClient.ts (existing methods, add getMessages)
- src/adapters/RemoteAdapter.ts (existing poll loop, add message polling + timeline merge)
- packages/shared/src/reports.ts (ReportEnvelope, ReportType)
- packages/harnesstune-relay/src/routes/messages.ts (relay messages API shape)
</read_first>

<action>

### 1a. Add TimelineItem type to packages/shared/src/reports.ts

Add after ReportEnvelope:

```typescript
/** A message from the relay messages API */
export interface RelayMessage {
  id: string;
  channelId: string;
  direction: 'to_agent' | 'from_agent';
  body: { text: string; sentAt: string; inReplyToReportId?: string };
  createdAt: string;
}

/** Unified timeline item — report or chat message */
export type TimelineItem =
  | { kind: 'report'; data: ReportEnvelope; at: string }
  | { kind: 'message'; data: RelayMessage; at: string };
```

### 1b. Add getMessages to RelayClient (src/relay/RelayClient.ts)

Add method after getReport():

```typescript
/** Fetch messages since cursor. Returns array of RelayMessage. */
async getMessages(since?: string, limit = 50): Promise<RelayMessage[]> {
  const params = new URLSearchParams();
  if (since) { params.set('since', since); }
  params.set('limit', String(limit));
  const url = `/channels/${this.channelId}/messages${params.toString() ? '?' + params.toString() : ''}`;
  const res = await this.doFetch(url, { timeout: 5000 });
  if (!res.ok) { throw new RelayError(res.status, await res.text()); }
  const data = await res.json() as { messages?: RelayMessage[] } | RelayMessage[];
  return (data as { messages?: RelayMessage[] }).messages ?? (data as RelayMessage[]);
}
```

Import RelayMessage from @harnesstune/shared at top of RelayClient.ts.

### 1c. Add postMessageWithReply to RelayClient

Extend the existing postMessage to accept optional inReplyToReportId:

```typescript
async postMessage(text: string, inReplyToReportId?: string): Promise<void> {
  const body: Record<string, unknown> = { text, sentAt: new Date().toISOString() };
  if (inReplyToReportId) { body.inReplyToReportId = inReplyToReportId; }
  const payload = { direction: 'to_agent', body };
  const res = await this.doFetch(`/channels/${this.channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
    timeout: 5000,
  });
  if (!res.ok) { throw new RelayError(res.status, await res.text()); }
}
```

### 1d. Add timeline message types to src/types/messages.ts

Add to HostToWebviewMessage:
```typescript
| { type: 'timeline:update'; workspaceId: string; items: TimelineItem[]; hasMore: boolean }
| { type: 'timeline:loopIterations'; workspaceId: string; loopIterations: Record<string, RalphReportBody[]> }
| { type: 'timeline:append'; workspaceId: string; items: TimelineItem[] }
| { type: 'timeline:connectionStatus'; workspaceId: string; status: 'connected' | 'stale' | 'error' }
```

Add to WebviewToHostMessage:
```typescript
| { type: 'timeline:requestInitial'; workspaceId: string }
| { type: 'timeline:loadMore'; workspaceId: string; before: string }
| { type: 'timeline:sendMessage'; workspaceId: string; text: string; inReplyToReportId?: string }
```

Import TimelineItem and RalphReportBody from @harnesstune/shared.

### 1e. Add timeline merge to RemoteAdapter

Add a `messageCursor` field alongside existing `cursor` (which becomes `reportCursor`). Add a `getTimelineItems()` method that:
1. Calls `this.client.getReports(this.reportCursor)` — filters out heartbeats (report.type !== 'heartbeat')
2. Calls `this.client.getMessages(this.messageCursor)`
3. Wraps each into TimelineItem
4. Sorts merged array by `at` timestamp descending (newest first)
5. Updates both cursors

Add to RemoteAdapter class:

```typescript
private messageCursor: string | undefined;

/** Get timeline items (reports + messages, heartbeats filtered) */
async getTimelineItems(): Promise<{ items: TimelineItem[]; loopIterations: Record<string, RalphReportBody[]> }> {
  if (!this.client) { return { items: [], loopIterations: {} }; }

  const [reports, messages] = await Promise.all([
    this.client.getReports(this.reportCursor),
    this.client.getMessages(this.messageCursor),
  ]);

  const items: TimelineItem[] = [];
  const loopMap: Record<string, RalphReportBody[]> = {};

  for (const report of reports) {
    if (!this.reportCursor || report.generatedAt > this.reportCursor) {
      this.reportCursor = report.generatedAt;
    }
    // Track heartbeats for stale detection but don't include in timeline
    if (report.type === 'heartbeat') {
      this.lastHeartbeatAt = Date.now();
      continue;
    }
    items.push({ kind: 'report', data: report, at: report.generatedAt });
    // Collect ralph iterations by loopId
    if (report.type === 'ralph') {
      const body = report.body as RalphReportBody;
      if (!loopMap[body.loopId]) { loopMap[body.loopId] = []; }
      loopMap[body.loopId].push(body);
    }
  }

  for (const msg of messages) {
    if (!this.messageCursor || msg.createdAt > this.messageCursor) {
      this.messageCursor = msg.createdAt;
    }
    items.push({ kind: 'message', data: msg, at: msg.createdAt });
  }

  items.sort((a, b) => b.at.localeCompare(a.at)); // newest first
  return { items, loopIterations: loopMap };
}
```

Rename existing `cursor` field to `reportCursor`. Update `getCursor()` to return `{ reportCursor, messageCursor }` and update constructor/connect to accept both cursors.

Also update the existing `poll()` method to use `reportCursor` (rename from `cursor`).

</action>

<acceptance_criteria>
- grep -q "RelayMessage" packages/shared/src/reports.ts
- grep -q "TimelineItem" packages/shared/src/reports.ts
- grep -q "getMessages" src/relay/RelayClient.ts
- grep -q "timeline:update" src/types/messages.ts
- grep -q "timeline:sendMessage" src/types/messages.ts
- grep -q "getTimelineItems" src/adapters/RemoteAdapter.ts
- grep -q "messageCursor" src/adapters/RemoteAdapter.ts
- grep -q "heartbeat.*continue" src/adapters/RemoteAdapter.ts
- npx tsc --noEmit exits 0
</acceptance_criteria>

---

## Task 2: ReportPanel Singleton + esbuild Entry + Extension Wiring

<read_first>
- src/panels/DashboardPanel.ts (singleton pattern to replicate)
- src/panels/index.ts (barrel exports)
- src/webview/dashboard/index.tsx (entry point pattern)
- src/webview/dashboard/vscodeApi.ts (acquireVsCodeApi pattern)
- esbuild.mjs (entry points array)
- src/extension.ts (command registration, serializer, panel creation)
- package.json (contributes.commands, contributes.viewsContainers, activationEvents)
</read_first>

<action>

### 2a. Create src/panels/ReportPanel.ts

Singleton WebviewPanel following DashboardPanel pattern exactly:

```typescript
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../types/messages';

export class ReportPanel {
  public static readonly viewType = 'harnesstune.reports';
  public static currentPanel: ReportPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly workspaceId: string;
  private readonly workspaceName: string;

  private readonly _onDidReceiveMessage = new vscode.EventEmitter<WebviewToHostMessage>();
  public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;

  public static createOrShow(extensionUri: vscode.Uri, workspaceId: string, workspaceName: string): ReportPanel {
    if (ReportPanel.currentPanel) {
      ReportPanel.currentPanel.reveal();
      return ReportPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      ReportPanel.viewType,
      `HarnessTune Reports - ${workspaceName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        retainContextWhenHidden: false,
      },
    );

    ReportPanel.currentPanel = new ReportPanel(panel, extensionUri, workspaceId, workspaceName);
    return ReportPanel.currentPanel;
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    ReportPanel.currentPanel = new ReportPanel(panel, extensionUri, '', '');
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, workspaceId: string, workspaceName: string) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.workspaceId = workspaceId;
    this.workspaceName = workspaceName;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => {
      ReportPanel.currentPanel = undefined;
      this.dispose();
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      this._onDidReceiveMessage.fire(msg);
    }, null, this.disposables);
  }

  public postMessage(message: HostToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  public reveal(): void {
    this.panel.reveal();
  }

  public dispose(): void {
    ReportPanel.currentPanel = undefined;
    this._onDidReceiveMessage.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
    this.panel.dispose();
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'reports.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'reports.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
  <title>HarnessTune Reports - ${this.workspaceName}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
```

### 2b. Add ReportPanel to src/panels/index.ts

```typescript
export { ReportPanel } from './ReportPanel';
```

### 2c. Add esbuild entry for reports webview

In esbuild.mjs, add after chatConfig:

```javascript
const reportsConfig = {
  entryPoints: ['src/webview/reports/index.tsx'],
  bundle: true,
  outfile: 'dist/webview/reports.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
};
```

Add `reportsConfig` to both the watch and build Promise.all arrays.

### 2d. Create webview scaffold

Create `src/webview/reports/vscodeApi.ts` — identical pattern to dashboard/vscodeApi.ts.

Create `src/webview/reports/index.tsx`:
```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/reports.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
```

Create `src/webview/reports/App.tsx` — shell component:
```typescript
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { HostToWebviewMessage } from '../../types/messages';
import type { TimelineItem, RalphReportBody } from '@harnesstune/shared';
import vscode from './vscodeApi';

type FilterTab = 'all' | 'briefings' | 'ralph' | 'chat';

interface AppState {
  items: TimelineItem[];
  loopIterations: Record<string, RalphReportBody[]>;
  filter: FilterTab;
  connectionStatus: 'connected' | 'stale' | 'error';
  workspaceName: string;
  workspaceId: string;
  hasMore: boolean;
  loading: boolean;
  replyTo: { reportId: string; reportType: string; timestamp: string } | null;
}

export default function App() {
  const savedState = vscode.getState() as Partial<AppState> | null;
  const [items, setItems] = useState<TimelineItem[]>(savedState?.items ?? []);
  const [loopIterations, setLoopIterations] = useState<Record<string, RalphReportBody[]>>(savedState?.loopIterations ?? {});
  const [filter, setFilter] = useState<FilterTab>(savedState?.filter ?? 'all');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'stale' | 'error'>(savedState?.connectionStatus ?? 'connected');
  const [workspaceName, setWorkspaceName] = useState(savedState?.workspaceName ?? '');
  const [workspaceId, setWorkspaceId] = useState(savedState?.workspaceId ?? '');
  const [hasMore, setHasMore] = useState(savedState?.hasMore ?? true);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<AppState['replyTo']>(null);

  // Persist state
  useEffect(() => {
    vscode.setState({ items, loopIterations, filter, connectionStatus, workspaceName, workspaceId, hasMore });
  }, [items, loopIterations, filter, connectionStatus, workspaceName, workspaceId, hasMore]);

  // Message handler
  useEffect(() => {
    const handler = (event: MessageEvent<HostToWebviewMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'timeline:update':
          setItems(msg.items);
          setHasMore(msg.hasMore);
          setWorkspaceId(msg.workspaceId);
          setLoading(false);
          break;
        case 'timeline:loopIterations':
          setLoopIterations(msg.loopIterations);
          break;
        case 'timeline:append':
          setItems(prev => [...msg.items, ...prev]);
          break;
        case 'timeline:connectionStatus':
          setConnectionStatus(msg.status);
          break;
        case 'chat:workspaceInfo':
          setWorkspaceName(msg.workspaceName);
          setWorkspaceId(msg.workspaceId);
          break;
      }
    };
    window.addEventListener('message', handler);
    // Request initial data
    vscode.postMessage({ type: 'timeline:requestInitial', workspaceId: '' });
    return () => window.removeEventListener('message', handler);
  }, []);

  // Filter items
  const filteredItems = items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'briefings') return item.kind === 'report' && item.data.type === 'briefing';
    if (filter === 'ralph') return item.kind === 'report' && item.data.type === 'ralph';
    if (filter === 'chat') return item.kind === 'message';
    return true;
  });

  const handleSend = useCallback((text: string) => {
    vscode.postMessage({
      type: 'timeline:sendMessage',
      workspaceId,
      text,
      inReplyToReportId: replyTo?.reportId,
    });
    setReplyTo(null);
  }, [workspaceId, replyTo]);

  const handleLoadMore = useCallback(() => {
    const oldest = items[items.length - 1];
    if (oldest) {
      vscode.postMessage({ type: 'timeline:loadMore', workspaceId, before: oldest.at });
    }
  }, [items, workspaceId]);

  const handleReply = useCallback((reportId: string, reportType: string, timestamp: string) => {
    setReplyTo({ reportId, reportType, timestamp });
  }, []);

  // Render placeholder — components built in Plan 02
  return (
    <div className="report-panel">
      <div className="report-panel__placeholder">
        Reports panel — components loading...
      </div>
    </div>
  );
}
```

Create `src/webview/reports/styles/reports.css` — minimal reset:
```css
body {
  margin: 0;
  padding: 0;
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
}

.report-panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.report-panel__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--vscode-descriptionForeground);
}
```

### 2e. Wire ReportPanel in extension.ts

Import ReportPanel from './panels'.

Register command `harnesstune.openReports`:
```typescript
const openReportsCmd = vscode.commands.registerCommand(
  'harnesstune.openReports',
  async (workspaceId?: string) => {
    // Find workspace — if no workspaceId, pick first remote workspace
    const ws = workspaceId
      ? registry.getAll().find(w => w.id === workspaceId)
      : registry.getAll().find(w => w.mode === 'remote');
    if (!ws) {
      vscode.window.showWarningMessage('HarnessTune: No remote workspace found.');
      return;
    }

    const panel = ReportPanel.createOrShow(context.extensionUri, ws.id, ws.name);

    // Get adapter and send initial data
    const adapter = adapterRegistry.get(ws.id);
    if (adapter && 'getTimelineItems' in adapter) {
      const remote = adapter as RemoteAdapter;
      const { items, loopIterations } = await remote.getTimelineItems();
      const initial = items.slice(0, 20);
      panel.postMessage({ type: 'timeline:update', workspaceId: ws.id, items: initial, hasMore: items.length > 20 });
      panel.postMessage({ type: 'timeline:loopIterations', workspaceId: ws.id, loopIterations });
      panel.postMessage({ type: 'chat:workspaceInfo', workspaceId: ws.id, workspaceName: ws.name });
      // Send connection status
      const status = ws.status === 'error' ? 'error' : (ws.status === 'stale' ? 'stale' : 'connected');
      panel.postMessage({ type: 'timeline:connectionStatus', workspaceId: ws.id, status: status as 'connected' | 'stale' | 'error' });
    }

    // Handle webview messages
    panel.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'timeline:sendMessage') {
        const remote = adapterRegistry.get(ws.id) as RemoteAdapter | undefined;
        const client = remote?.getClient();
        if (client) {
          try {
            await client.postMessage(msg.text, msg.inReplyToReportId);
            panel.postMessage({ type: 'reports:messageSent', workspaceId: ws.id, success: true });
          } catch {
            panel.postMessage({ type: 'reports:messageSent', workspaceId: ws.id, success: false });
          }
        }
      }
      if (msg.type === 'timeline:loadMore') {
        const remote = adapterRegistry.get(ws.id) as RemoteAdapter | undefined;
        if (remote) {
          // Fetch older items using the 'before' cursor
          // RemoteAdapter will need a getOlderItems method — added below
        }
      }
    });
  },
);
context.subscriptions.push(openReportsCmd);
```

Register serializer for panel persistence:
```typescript
vscode.window.registerWebviewPanelSerializer(ReportPanel.viewType, {
  async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
    ReportPanel.revive(panel, context.extensionUri);
  },
});
```

Add to package.json contributes.commands:
```json
{ "command": "harnesstune.openReports", "title": "HarnessTune: Open Reports" }
```

### 2f. Update sidebar WorkspaceItem click handler

In the sidebar, when a remote workspace item is clicked (or double-clicked), fire `harnesstune.openReports` with the workspaceId. Find the existing click handler in `src/webview/sidebar/components/WorkspaceItem.tsx` and add a condition: if workspace.mode === 'remote', post message `{ type: 'workspace:open', workspaceId }` which routes to openReports in extension.ts.

</action>

<acceptance_criteria>
- grep -q "ReportPanel" src/panels/ReportPanel.ts
- grep -q "ReportPanel" src/panels/index.ts
- grep -q "reports" esbuild.mjs
- test -f src/webview/reports/index.tsx
- test -f src/webview/reports/App.tsx
- test -f src/webview/reports/vscodeApi.ts
- test -f src/webview/reports/styles/reports.css
- grep -q "harnesstune.openReports" src/extension.ts
- grep -q "ReportPanel.viewType" src/extension.ts
- node esbuild.mjs exits 0
</acceptance_criteria>
