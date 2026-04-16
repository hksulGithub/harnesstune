import * as vscode from 'vscode';
import { WorkspaceRegistry } from './registry';
import { FileWatcherManager } from './watchers';
import { SecretStore } from './secrets';
import { SidebarViewProvider, DashboardPanel } from './panels';
import { StatusBarManager } from './statusbar';
import { WorkspaceRecord } from './types';
import { ClaudeCodeHookAdapter } from './adapters';
import { AgentEventStore } from './database';
import { AgentControlManager } from './controls';
import { NotificationService } from './notifications';
import type { AgentEvent } from './types';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('HarnessTune extension activating...');

  // ── Core services ────────────────────────────────────────────────────────────
  const registry = new WorkspaceRegistry(context);
  await registry.load();

  const watcherManager = new FileWatcherManager(context);
  const secretStore = new SecretStore(context.secrets);

  // ── Initial watcher setup for persisted workspaces ───────────────────────────
  for (const workspace of registry.getAll()) {
    watcherManager.watchWorkspace(workspace);
  }

  // ── Sync watchers on registry change ─────────────────────────────────────────
  const onRegistryChange = registry.onDidChange((updatedWorkspaces: WorkspaceRecord[]) => {
    const updatedIds = new Set(updatedWorkspaces.map(ws => ws.id));

    // Start watching any newly added workspaces
    for (const workspace of updatedWorkspaces) {
      watcherManager.watchWorkspace(workspace);
    }

    // Stop watching removed workspaces (watcher has no id in the new list)
    // We track this by checking if the watcher map has ids not in updatedIds.
    // FileWatcherManager exposes no direct id list, so we rely on watchWorkspace
    // being idempotent (it no-ops if already watching) and unwatchWorkspace
    // being called when we detect removal via the remove command directly.
    // The registry fires the full updated list, so we can derive removals by
    // comparing against the previous snapshot.
    void updatedIds; // used for clarity; see removeWorkspace command for explicit unwatch
  });

  context.subscriptions.push(onRegistryChange);

  // ── Commands ─────────────────────────────────────────────────────────────────

  const connectCmd = vscode.commands.registerCommand(
    'harnesstune.connectWorkspace',
    async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Connect Workspace',
      });
      if (!uris || uris.length === 0) {
        return;
      }
      const selectedPath = uris[0].fsPath;

      const name = await vscode.window.showInputBox({
        prompt: 'Workspace name',
        placeHolder: 'My Agent Workspace',
      });
      if (!name) {
        return;
      }

      try {
        const record = await registry.add(name, selectedPath);
        watcherManager.watchWorkspace(record);
        vscode.window.showInformationMessage(`HarnessTune: Connected workspace "${name}"`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`HarnessTune: Failed to connect workspace — ${msg}`);
      }
    }
  );

  const removeCmd = vscode.commands.registerCommand(
    'harnesstune.removeWorkspace',
    async () => {
      const workspaces = registry.getAll();
      if (workspaces.length === 0) {
        vscode.window.showInformationMessage('HarnessTune: No workspaces connected.');
        return;
      }

      const items = workspaces.map(ws => ({
        label: ws.name,
        description: ws.rootPath,
        id: ws.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select workspace to remove',
      });
      if (!selected) {
        return;
      }

      try {
        watcherManager.unwatchWorkspace(selected.id);
        await registry.remove(selected.id);
        vscode.window.showInformationMessage(`HarnessTune: Removed workspace "${selected.label}"`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`HarnessTune: Failed to remove workspace — ${msg}`);
      }
    }
  );

  const openCmd = vscode.commands.registerCommand(
    'harnesstune.openWorkspace',
    (workspaceId?: string) => {
      if (!workspaceId) {
        vscode.window.showInformationMessage('HarnessTune: No workspace selected');
        return;
      }
      const ws = registry.getById(workspaceId);
      if (ws) {
        vscode.window.showInformationMessage(`HarnessTune: Opening workspace "${ws.name}"`);
      } else {
        vscode.window.showWarningMessage(`HarnessTune: Workspace not found`);
      }
    }
  );

  const refreshCmd = vscode.commands.registerCommand(
    'harnesstune.refreshSidebar',
    () => vscode.window.showInformationMessage('HarnessTune: Refresh Sidebar (not yet implemented)')
  );

  context.subscriptions.push(connectCmd, removeCmd, openCmd, refreshCmd);

  // ── Sidebar WebviewView ─────────────────────────────────────────────────────
  const sidebarProvider = new SidebarViewProvider(context.extensionUri, registry);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
  );

  // ── Status bar ─────────────────────────────────────────────────────────────
  const statusBarManager = new StatusBarManager(registry);
  context.subscriptions.push(statusBarManager);

  // Expose services for use by later phases
  void secretStore; // referenced here so TypeScript doesn't warn; used in Phase 2+

  // ── Phase 2: Hook Server + Adapter ──────────────────────────────────────────
  // ClaudeCodeHookAdapter creates and manages its own HookServer internally
  const adapter = new ClaudeCodeHookAdapter(context.globalStorageUri);

  // ── Phase 2: Database ────────────────────────────────────────────────────────
  const eventStore = new AgentEventStore(context.globalStorageUri);
  await eventStore.init(context.extensionPath);

  // ── Phase 2: Controls ────────────────────────────────────────────────────────
  const controlManager = new AgentControlManager();

  // Wire pause checker into hook server for PreToolUse gate (via adapter delegation)
  adapter.setPauseChecker((sessionId: string) => controlManager.isPaused(sessionId));

  // ── Phase 2: Notifications ───────────────────────────────────────────────────
  const notificationService = new NotificationService(registry);

  // ── Phase 2: Event Pipeline ──────────────────────────────────────────────────
  // When adapter receives a hook event: store it, notify, and push to dashboard
  const onAdapterEvent = adapter.onDidReceiveEvent((event: AgentEvent) => {
    // 1. Persist event
    eventStore.insertEvent(event);

    // 2. Session lifecycle management
    if (event.eventType === 'SessionStart') {
      controlManager.registerSession(event.sessionId, event.workspaceId, event.model);
      if (event.raw && typeof event.raw === 'object' && 'pid' in event.raw) {
        const pid = (event.raw as { pid?: number }).pid;
        if (pid && pid > 0) {
          controlManager.updateSessionPid(event.sessionId, pid);
        }
      }
    } else if (event.eventType === 'SessionEnd' || event.eventType === 'Stop') {
      controlManager.unregisterSession(event.sessionId);
    }

    // 3. Notifications (toast for errors, status bar for info)
    notificationService.handleEvent(event);

    // 4. Push to dashboard if open — DashboardPanel.currentPanel is public static (set in Plan 03)
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({
        type: 'dashboard:agentEvents',
        events: [event],
      });
    }
  });
  context.subscriptions.push(onAdapterEvent);

  // Push session state changes to dashboard
  const onSessionChange = controlManager.onDidChangeSession((session) => {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({
        type: 'dashboard:agentUpdate',
        session,
      });
    }
  });
  context.subscriptions.push(onSessionChange);

  // ── Phase 2: Periodic flush ──────────────────────────────────────────────────
  const flushInterval = setInterval(() => eventStore.flush(), 30_000); // flush every 30s
  context.subscriptions.push({ dispose: () => clearInterval(flushInterval) });

  // Push all Phase 2 services to subscriptions for proper disposal
  context.subscriptions.push(eventStore, adapter, controlManager, notificationService);

  // ── Phase 2: Dashboard Command (real implementation) ─────────────────────────
  const dashboardCmd = vscode.commands.registerCommand(
    'harnesstune.showDashboard',
    () => {
      const panel = DashboardPanel.createOrShow(context.extensionUri);

      // Wire dashboard message handler (control actions from webview)
      const msgHandler = panel.onDidReceiveMessage((msg) => {
        switch (msg.type) {
          case 'agent:pause':
            controlManager.pauseAgent(msg.sessionId);
            break;
          case 'agent:resume':
            controlManager.resumeAgent(msg.sessionId);
            break;
          case 'agent:stop':
            controlManager.stopAgent(msg.sessionId);
            break;
          case 'dashboard:requestState': {
            // Send current sessions and summary to dashboard
            const sessions = msg.workspaceId
              ? controlManager.getSessionsForWorkspace(msg.workspaceId)
              : controlManager.getAllSessions();
            for (const session of sessions) {
              panel.postMessage({ type: 'dashboard:agentUpdate', session });
              const events = eventStore.getEventsBySession(session.sessionId, 20);
              panel.postMessage({ type: 'dashboard:agentEvents', events });
            }
            break;
          }
        }
      });
      context.subscriptions.push(msgHandler);
    }
  );
  context.subscriptions.push(dashboardCmd);

  // ── Phase 2: Dashboard Serializer (DASH-04) ───────────────────────────────────
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DashboardPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
        DashboardPanel.revive(panel, context.extensionUri);

        // After revive, send current state to the restored dashboard
        const dashboardPanel = DashboardPanel.currentPanel;
        if (dashboardPanel) {
          const msgHandler = dashboardPanel.onDidReceiveMessage((msg) => {
            switch (msg.type) {
              case 'agent:pause':
                controlManager.pauseAgent(msg.sessionId);
                break;
              case 'agent:resume':
                controlManager.resumeAgent(msg.sessionId);
                break;
              case 'agent:stop':
                controlManager.stopAgent(msg.sessionId);
                break;
              case 'dashboard:requestState': {
                const sessions = msg.workspaceId
                  ? controlManager.getSessionsForWorkspace(msg.workspaceId)
                  : controlManager.getAllSessions();
                for (const session of sessions) {
                  dashboardPanel.postMessage({ type: 'dashboard:agentUpdate', session });
                  const events = eventStore.getEventsBySession(session.sessionId, 20);
                  dashboardPanel.postMessage({ type: 'dashboard:agentEvents', events });
                }
                break;
              }
            }
          });
          context.subscriptions.push(msgHandler);
        }
      }
    })
  );

  // ── Phase 2: Agent Control Commands (CTRL-04) ─────────────────────────────────
  const pauseCmd = vscode.commands.registerCommand(
    'harnesstune.pauseAgent',
    async () => {
      const sessions = controlManager.getAllSessions().filter(s => s.controlState === 'running');
      if (sessions.length === 0) {
        vscode.window.showInformationMessage('HarnessTune: No running agents to pause.');
        return;
      }
      const items = sessions.map(s => ({
        label: s.sessionId,
        description: `${s.model || 'unknown model'} — ${s.agentRole || 'agent'}`,
        detail: `Workspace: ${s.workspaceId}`,
        sessionId: s.sessionId,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select agent to pause',
      });
      if (selected) {
        controlManager.pauseAgent(selected.sessionId);
        vscode.window.showInformationMessage(`HarnessTune: Paused agent ${selected.label}`);
      }
    }
  );

  const resumeCmd = vscode.commands.registerCommand(
    'harnesstune.resumeAgent',
    async () => {
      const sessions = controlManager.getAllSessions().filter(s => s.controlState === 'paused');
      if (sessions.length === 0) {
        vscode.window.showInformationMessage('HarnessTune: No paused agents to resume.');
        return;
      }
      const items = sessions.map(s => ({
        label: s.sessionId,
        description: `Paused since ${new Date(s.pausedAt || 0).toLocaleTimeString()}`,
        detail: `Workspace: ${s.workspaceId}`,
        sessionId: s.sessionId,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select agent to resume',
      });
      if (selected) {
        controlManager.resumeAgent(selected.sessionId);
        vscode.window.showInformationMessage(`HarnessTune: Resumed agent ${selected.label}`);
      }
    }
  );

  const stopCmd = vscode.commands.registerCommand(
    'harnesstune.stopAgent',
    async () => {
      const sessions = controlManager.getAllSessions().filter(
        s => s.controlState === 'running' || s.controlState === 'paused'
      );
      if (sessions.length === 0) {
        vscode.window.showInformationMessage('HarnessTune: No active agents to stop.');
        return;
      }
      const items = sessions.map(s => ({
        label: s.sessionId,
        description: `${s.controlState} — ${s.model || 'unknown'}`,
        detail: `Workspace: ${s.workspaceId}`,
        sessionId: s.sessionId,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select agent to stop',
      });
      if (selected) {
        controlManager.stopAgent(selected.sessionId);
        vscode.window.showInformationMessage(`HarnessTune: Stopping agent ${selected.label}`);
      }
    }
  );

  context.subscriptions.push(pauseCmd, resumeCmd, stopCmd);

  // ── Phase 2: Auto-connect existing workspaces ─────────────────────────────────
  for (const workspace of registry.getAll()) {
    adapter.connect(workspace.id, workspace.rootPath).catch(err => {
      console.error(`HarnessTune: Failed to connect workspace "${workspace.name}":`, err);
    });
  }

  // Connect new workspaces as they're added
  const onWorkspaceChange = registry.onDidChange((workspaces) => {
    // Reconnect logic: adapter.connect is idempotent
    for (const ws of workspaces) {
      adapter.connect(ws.id, ws.rootPath).catch(() => {});
    }
  });
  context.subscriptions.push(onWorkspaceChange);

  // Note: hookServer is started internally by adapter.connect() on first workspace connection.

  console.log('HarnessTune extension activated.');
}

export async function deactivate(): Promise<void> {
  console.log('HarnessTune extension deactivating...');
  // EventStore flush happens via dispose in subscriptions
}
