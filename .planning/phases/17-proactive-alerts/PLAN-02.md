---
phase: 17
plan: 2
title: Notification delivery + status bar badge + extension wiring
wave: 2
depends_on: [1]
requirements: [ALRT-03, ALRT-04, ALRT-05]
files_modified:
  - src/statusbar/StatusBarManager.ts
  - src/extension.ts
autonomous: true
---

# Plan 2: Notification Delivery + Status Bar Badge + Extension Wiring

## Goal

Wire AlertEngine into the extension lifecycle: start on activation, dispose on deactivation. On alert transitions, show a single batched summary toast via `vscode.window.showWarningMessage` with a "View Fleet Dashboard" action. Add an alert badge to the status bar that shows unread alert count and clears when the user opens the fleet dashboard.

## must_haves

- AlertEngine is instantiated and started in extension.ts
- Alert transitions produce a single summary toast (not one per agent)
- Status bar shows alert count badge
- Badge clears when dashboard is opened
- FleetDataProvider is wired to AlertEngine (composing local + remote providers)

## Tasks

<task id="1">
<title>Add alert badge to StatusBarManager</title>
<read_first>
- src/statusbar/StatusBarManager.ts (current implementation — registry-driven, error count badge)
- src/types/alerts.ts (AlertCycleSummary from Plan 01)
</read_first>
<action>

**Modify `src/statusbar/StatusBarManager.ts`:**

Add a private `alertCount` field and methods to manage it:

```typescript
private alertCount = 0;
```

Add a public method `setAlertCount(count: number): void` that updates `alertCount` and calls `updateStatusBar()`.

Add a public method `clearAlertBadge(): void` that sets `alertCount = 0` and calls `updateStatusBar()`.

Modify the `updateStatusBar()` method to include alert count in the status bar text. The updated logic:

```typescript
private updateStatusBar(): void {
  const workspaces = this.registry.getAll();
  const runningCount = workspaces.reduce((sum, ws) => sum + ws.runningAgentCount, 0);
  const errorCount = workspaces.reduce((sum, ws) => sum + ws.errorCount, 0);

  let text = `$(pulse) HT: ${runningCount} running`;
  let hasIssue = false;

  if (errorCount > 0) {
    text += ` $(error) ${errorCount}`;
    hasIssue = true;
  }

  if (this.alertCount > 0) {
    text += ` $(bell) ${this.alertCount}`;
    hasIssue = true;
  }

  this.item.text = text;
  this.item.backgroundColor = hasIssue
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;
}
```

Note: Use `statusBarItem.warningBackground` (yellow/amber) instead of `statusBarItem.errorBackground` (red) so alerts are visually distinct from hard errors. The `$(bell)` codicon represents alert notifications.

</action>
<acceptance_criteria>
- StatusBarManager has `private alertCount = 0`
- StatusBarManager has `public setAlertCount(count: number): void`
- StatusBarManager has `public clearAlertBadge(): void`
- updateStatusBar() includes `$(bell) ${this.alertCount}` when alertCount > 0
- updateStatusBar() uses `statusBarItem.warningBackground` when either errorCount or alertCount > 0
</acceptance_criteria>
</task>

<task id="2">
<title>Wire AlertEngine into extension.ts — instantiation, notification handler, dashboard badge clear</title>
<read_first>
- src/extension.ts (full file — service instantiation patterns, NotificationService wiring at ~line 337, StatusBarManager at ~line 312, DashboardPanel.createOrShow at ~line 523, FleetDataProvider import at line 4 of DashboardPanel.ts)
- src/alerts/AlertEngine.ts (Plan 01 output)
- src/alerts/index.ts (Plan 01 output)
- src/providers/FleetDataProvider.ts (FleetDataProvider interface)
- src/providers/LocalFleetProvider.ts (constructor takes registry)
- src/providers/RemoteFleetProvider.ts (constructor takes Map<string, RelayClient> + registry)
- src/statusbar/StatusBarManager.ts (setAlertCount, clearAlertBadge from Task 1)
- src/types/alerts.ts (AlertCycleSummary, AlertTransition)
</read_first>
<action>

**Modify `src/extension.ts`:**

**Step 1: Add imports at the top of the file:**

```typescript
import { AlertEngine } from './alerts';
import { LocalFleetProvider } from './providers/LocalFleetProvider';
import { RemoteFleetProvider } from './providers/RemoteFleetProvider';
import type { FleetDataProvider } from './providers/FleetDataProvider';
import type { AlertCycleSummary } from './types/alerts';
```

**Step 2: Create a CompositeFleetProvider.**

After the status bar section (~line 313, after `context.subscriptions.push(statusBarManager)`), add:

```typescript
// ── Phase 17: Fleet Data Provider (composite local + remote) ──────────────
const localFleetProvider = new LocalFleetProvider(registry);
// remoteFleetClients will be populated as remote workspaces connect
const remoteFleetClients = new Map<string, RelayClient>();
const remoteFleetProvider = new RemoteFleetProvider(remoteFleetClients, registry);

/** Composite provider that merges local + remote fleet data */
const compositeFleetProvider: FleetDataProvider = {
  async getWorkspaceSummaries(days: number) {
    const [local, remote] = await Promise.all([
      localFleetProvider.getWorkspaceSummaries(days),
      remoteFleetProvider.getWorkspaceSummaries(days),
    ]);
    return [...local, ...remote];
  },
  async getWorkspaceDetail(workspaceId: string, days: number) {
    const ws = registry.getById(workspaceId);
    if (ws?.mode === 'remote') {
      return remoteFleetProvider.getWorkspaceDetail(workspaceId, days);
    }
    return localFleetProvider.getWorkspaceDetail(workspaceId, days);
  },
  async getAgentDetail(workspaceId: string, agentId: string, days: number) {
    const ws = registry.getById(workspaceId);
    if (ws?.mode === 'remote') {
      return remoteFleetProvider.getAgentDetail(workspaceId, agentId, days);
    }
    return localFleetProvider.getAgentDetail(workspaceId, agentId, days);
  },
};
```

**Step 3: Wire remote clients into the composite provider.**

In the `connectWorkspace()` function, inside the `if (workspace.mode === 'remote')` block, after the line `await adapter.connect(workspace.id, workspace.rootPath);`, add:

```typescript
// Register relay client for fleet data provider
const client = (adapter as RemoteAdapter).getClient();
if (client) {
  remoteFleetClients.set(workspace.id, client);
}
```

Also in the `removeWorkspace` command handler, inside the block that deletes relay tokens for remote workspaces (around line 108-111), add:

```typescript
remoteFleetClients.delete(selected.id);
```

**Step 4: Wire DashboardPanel to the composite fleet provider.**

In the `wireDashboardMessageHandler` function, add this line at the top of the function body:

```typescript
panel.setFleetProvider(compositeFleetProvider);
```

Also add it in the `showDashboard` command handler after `wireDashboardMessageHandler(panel)`:

```typescript
panel.setFleetProvider(compositeFleetProvider);
```

And in the dashboard serializer `deserializeWebviewPanel`, after `wireDashboardMessageHandler(dashboardPanel)`:

```typescript
dashboardPanel.setFleetProvider(compositeFleetProvider);
```

**Step 5: Instantiate AlertEngine and wire notification handler.**

After the composite fleet provider section, add:

```typescript
// ── Phase 17: Alert Engine ────────────────────────────────────────────────
const alertEngine = new AlertEngine(compositeFleetProvider, registry);

let activeAlertCount = 0;

const onAlerts = alertEngine.onDidDetectAlerts((summary: AlertCycleSummary) => {
  // Update alert count: add new problems, subtract recoveries
  activeAlertCount = Math.max(0, activeAlertCount + summary.problems.length - summary.recoveries.length);
  statusBarManager.setAlertCount(activeAlertCount);

  // Only toast for new problems (not recoveries)
  if (summary.problems.length > 0) {
    const failingCount = summary.problems.filter(t => t.currentState === 'failing').length;
    const staleCount = summary.problems.filter(t => t.currentState === 'stale').length;
    const degradedCount = summary.problems.filter(t => t.currentState === 'degraded').length;

    const parts: string[] = [];
    if (failingCount > 0) { parts.push(`${failingCount} failing`); }
    if (staleCount > 0) { parts.push(`${staleCount} stale`); }
    if (degradedCount > 0) { parts.push(`${degradedCount} degraded`); }

    const total = summary.problems.length;
    const msg = `${total} agent${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} attention: ${parts.join(', ')}`;

    vscode.window.showWarningMessage(`HarnessTune: ${msg}`, 'View Fleet Dashboard').then(action => {
      if (action === 'View Fleet Dashboard') {
        vscode.commands.executeCommand('harnesstune.showDashboard');
        activeAlertCount = 0;
        statusBarManager.clearAlertBadge();
      }
    });
  }
});
context.subscriptions.push(onAlerts);

// Start alert engine polling
alertEngine.start();
context.subscriptions.push(alertEngine);
```

**Step 6: Clear badge when dashboard is opened.**

In the `showDashboard` command handler (around line 523), after `wireDashboardMessageHandler(panel)`, add:

```typescript
// Clear alert badge when user views dashboard
activeAlertCount = 0;
statusBarManager.clearAlertBadge();
```

</action>
<acceptance_criteria>
- extension.ts imports `AlertEngine` from `'./alerts'`
- extension.ts imports `LocalFleetProvider` from `'./providers/LocalFleetProvider'`
- extension.ts imports `RemoteFleetProvider` from `'./providers/RemoteFleetProvider'`
- extension.ts creates `compositeFleetProvider` object implementing `FleetDataProvider`
- extension.ts instantiates `new AlertEngine(compositeFleetProvider, registry)`
- extension.ts calls `alertEngine.start()`
- extension.ts pushes `alertEngine` to `context.subscriptions`
- extension.ts subscribes to `alertEngine.onDidDetectAlerts`
- Alert handler calls `vscode.window.showWarningMessage` with batched summary string
- Alert handler calls `statusBarManager.setAlertCount()`
- showDashboard handler calls `statusBarManager.clearAlertBadge()`
- `npx tsc --noEmit` exits 0
</acceptance_criteria>
</task>

## Verification

- `npx tsc --noEmit` exits 0
- `grep -r "AlertEngine" src/extension.ts` returns matches for import and instantiation
- `grep -r "setAlertCount" src/statusbar/StatusBarManager.ts` returns a match
- `grep -r "clearAlertBadge" src/statusbar/StatusBarManager.ts` returns a match
- `grep -r "showWarningMessage" src/extension.ts` returns a match containing "agents need attention"
- `grep -r "compositeFleetProvider" src/extension.ts` returns matches
- `grep -r "setFleetProvider" src/extension.ts` returns matches
