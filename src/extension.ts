import * as vscode from 'vscode';
import { WorkspaceRegistry } from './registry';
import { FileWatcherManager } from './watchers';
import { SecretStore } from './secrets';
import { SidebarViewProvider, DashboardPanel, SchematicPanel } from './panels';
import { buildTopology } from './topology';
import { StatusBarManager } from './statusbar';
import { WorkspaceRecord } from './types';
import { ClaudeCodeHookAdapter, AdapterRegistry } from './adapters';
import type { WorkspaceConnectionConfig, AgentBackendAdapter } from './adapters';
import { AgentEventStore } from './database';
import { AgentControlManager } from './controls';
import { NotificationService } from './notifications';
import { TerminalManager } from './terminal';
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

  // ── Phase 5: Adapter Registry + per-workspace adapters ─────────────────────
  const adapterRegistry = new AdapterRegistry();
  const claudeCodeAdapter = new ClaudeCodeHookAdapter(context.globalStorageUri);
  adapterRegistry.register('claude-code', { createAdapter: () => claudeCodeAdapter });
  // OpenClaw factory registered in Plan 03; placeholder until then:
  // adapterRegistry.register('openclaw', { createAdapter: () => new OpenClawAdapter() });

  const activeAdapters = new Map<string, AgentBackendAdapter>();

  // ── Phase 2: Database ────────────────────────────────────────────────────────
  const eventStore = new AgentEventStore(context.globalStorageUri);
  await eventStore.init(context.extensionPath);

  // ── Phase 2: Controls ────────────────────────────────────────────────────────
  const controlManager = new AgentControlManager();

  // Wire pause checker into hook server for PreToolUse gate (via adapter delegation)
  claudeCodeAdapter.setPauseChecker((sessionId: string) => controlManager.isPaused(sessionId));

  // ── Phase 2: Notifications ───────────────────────────────────────────────────
  const notificationService = new NotificationService(registry);

  // Track all session IDs seen during this activation (including stopped ones)
  // so the schematic only shows sessions from this VS Code session, not old DB cruft
  const seenSessionIds = new Set<string>();

  // ── Phase 2: Event Pipeline ──────────────────────────────────────────────────
  // Shared event handler used by both claudeCodeAdapter and connectWorkspace() per-workspace adapters
  function handleEvent(event: AgentEvent): void {
    seenSessionIds.add(event.sessionId);

    // 1. Persist event
    eventStore.insertEvent(event);

    // 2. Session lifecycle management
    // Claude Code does NOT fire SessionStart hooks — auto-register on first-seen event
    if (!controlManager.getSession(event.sessionId)) {
      if (event.eventType !== 'SessionEnd' && event.eventType !== 'Stop') {
        controlManager.registerSession(event.sessionId, event.workspaceId, event.model);
        if (event.raw && typeof event.raw === 'object' && 'pid' in event.raw) {
          const pid = (event.raw as { pid?: number }).pid;
          if (pid && pid > 0) {
            controlManager.updateSessionPid(event.sessionId, pid);
          }
        }
      }
    }
    if (event.eventType === 'SessionEnd' || event.eventType === 'Stop') {
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

    // 5. Push to schematic if open — rebuild topology with new event
    if (SchematicPanel.currentPanel) {
      const allHierarchyEvents: AgentEvent[] = [];
      for (const ws of registry.getAll()) {
        allHierarchyEvents.push(...eventStore.getHierarchyEvents(ws.id));
      }
      const topology = buildTopology(allHierarchyEvents, undefined, seenSessionIds);
      SchematicPanel.currentPanel.postMessage({
        type: 'schematic:topologyUpdate',
        state: topology,
      });
    }
  }

  // Wire the Claude Code adapter to the shared event handler
  const onAdapterEvent = claudeCodeAdapter.onDidReceiveEvent(handleEvent);
  context.subscriptions.push(onAdapterEvent);

  // Per-workspace adapter connect function — idempotent, routes by backendType
  async function connectWorkspace(workspace: WorkspaceRecord): Promise<void> {
    if (activeAdapters.has(workspace.id)) { return; } // idempotent
    const config: WorkspaceConnectionConfig = {
      backendType: workspace.backendType ?? 'claude-code',
      host: workspace.connectionConfig?.host ?? 'localhost',
      port: workspace.connectionConfig?.port,
    };
    try {
      const adapter = adapterRegistry.create(config);
      const sub = adapter.onDidReceiveEvent(handleEvent);
      context.subscriptions.push(sub);
      await adapter.connect(workspace.id, workspace.rootPath);
      activeAdapters.set(workspace.id, adapter);
      context.subscriptions.push(adapter);
    } catch (err) {
      console.error(`HarnessTune: Failed to connect workspace "${workspace.name}":`, err);
    }
  }

  // Push session state changes to dashboard and schematic
  const onSessionChange = controlManager.onDidChangeSession((session) => {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({
        type: 'dashboard:agentUpdate',
        session,
      });
    }

    // Also update schematic on session state changes
    if (SchematicPanel.currentPanel) {
      const allHierarchyEvents: AgentEvent[] = [];
      for (const ws of registry.getAll()) {
        allHierarchyEvents.push(...eventStore.getHierarchyEvents(ws.id));
      }
      const topology = buildTopology(allHierarchyEvents, undefined, seenSessionIds);
      SchematicPanel.currentPanel.postMessage({
        type: 'schematic:topologyUpdate',
        state: topology,
      });
    }
  });
  context.subscriptions.push(onSessionChange);

  // ── Phase 2: Periodic flush ──────────────────────────────────────────────────
  const flushInterval = setInterval(() => eventStore.flush(), 30_000); // flush every 30s
  context.subscriptions.push({ dispose: () => clearInterval(flushInterval) });

  // Push all Phase 2 services to subscriptions for proper disposal
  context.subscriptions.push(eventStore, claudeCodeAdapter, controlManager, notificationService);

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

  // ── Phase 3: Schematic Command ──────────────────────────────────────────────
  const schematicCmd = vscode.commands.registerCommand(
    'harnesstune.showSchematic',
    () => {
      const panel = SchematicPanel.createOrShow(context.extensionUri);
      wireSchematicMessageHandler(panel);
    }
  );
  context.subscriptions.push(schematicCmd);

  // ── Phase 3: Schematic Serializer (D-20) ───────────────────────────────────
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(SchematicPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
        SchematicPanel.revive(panel, context.extensionUri);
        const schematicPanel = SchematicPanel.currentPanel;
        if (schematicPanel) {
          wireSchematicMessageHandler(schematicPanel);
        }
      }
    })
  );

  // ── Phase 3: Schematic message handler ──────────────────────────────────────
  function wireSchematicMessageHandler(panel: SchematicPanel): void {
    const msgHandler = panel.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'schematic:requestState': {
          // Rebuild full topology from stored hierarchy events
          const allHierarchyEvents: AgentEvent[] = [];
          const workspaces = msg.workspaceId
            ? [msg.workspaceId]
            : registry.getAll().map(ws => ws.id);
          for (const wsId of workspaces) {
            allHierarchyEvents.push(...eventStore.getHierarchyEvents(wsId));
          }
          const topology = buildTopology(allHierarchyEvents, msg.workspaceId ?? undefined, seenSessionIds);
          panel.postMessage({ type: 'schematic:topologyUpdate', state: topology });

          // Also send workspace list for the workspace selector
          panel.postMessage({
            type: 'workspaces:update',
            workspaces: registry.getAll(),
          });
          break;
        }
        case 'schematic:selectNode': {
          // Click-to-inspect: send the selected node's session + events via schematic:nodeDetail
          const session = controlManager.getAllSessions().find(
            s => s.sessionId === msg.sessionId
          ) ?? null;
          const events = eventStore.getEventsBySession(msg.sessionId, 50);
          panel.postMessage({
            type: 'schematic:nodeDetail',
            session,
            events,
          });
          break;
        }
      }
    });
    context.subscriptions.push(msgHandler);
  }

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

  // ── Phase 4: Terminal Manager ──────────────────────────────────────────────
  const terminalManager = new TerminalManager((event: AgentEvent) => {
    // Feed terminal stream-JSON events into the same pipeline as hook events
    seenSessionIds.add(event.sessionId);

    // 1. Persist
    eventStore.insertEvent(event);

    // 2. Session lifecycle
    if (!controlManager.getSession(event.sessionId)) {
      if (event.eventType !== 'SessionEnd' && event.eventType !== 'Stop') {
        controlManager.registerSession(event.sessionId, event.workspaceId, event.model);
      }
    }
    if (event.eventType === 'SessionEnd' || event.eventType === 'Stop') {
      controlManager.unregisterSession(event.sessionId);
    }

    // 3. Notifications
    notificationService.handleEvent(event);

    // 4. Push to dashboard
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.postMessage({
        type: 'dashboard:agentEvents',
        events: [event],
      });
    }

    // 5. Push to schematic
    if (SchematicPanel.currentPanel) {
      const allHierarchyEvents: AgentEvent[] = [];
      for (const ws of registry.getAll()) {
        allHierarchyEvents.push(...eventStore.getHierarchyEvents(ws.id));
      }
      const topology = buildTopology(allHierarchyEvents, undefined, seenSessionIds);
      SchematicPanel.currentPanel.postMessage({
        type: 'schematic:topologyUpdate',
        state: topology,
      });
    }
  });
  context.subscriptions.push(terminalManager);

  const openTerminalCmd = vscode.commands.registerCommand(
    'harnesstune.openTerminal',
    async (workspaceId?: string) => {
      let ws: WorkspaceRecord | undefined;

      if (workspaceId) {
        ws = registry.getById(workspaceId);
      } else {
        // Prompt user to pick a workspace
        const workspaces = registry.getAll();
        if (workspaces.length === 0) {
          vscode.window.showInformationMessage('HarnessTune: No workspaces connected. Connect a workspace first.');
          return;
        }
        if (workspaces.length === 1) {
          ws = workspaces[0];
        } else {
          const items = workspaces.map(w => ({
            label: w.name,
            description: w.rootPath,
            id: w.id,
          }));
          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select workspace to open terminal for',
          });
          if (!selected) { return; }
          ws = registry.getById(selected.id);
        }
      }

      if (!ws) {
        vscode.window.showWarningMessage('HarnessTune: Workspace not found');
        return;
      }

      const config = vscode.workspace.getConfiguration('harnesstune');
      const skipPermissions = config.get<boolean>('dangerouslySkipPermissions', false);

      terminalManager.openTerminal(ws.id, ws.name, ws.rootPath, {
        dangerouslySkipPermissions: skipPermissions,
      });
    }
  );
  context.subscriptions.push(openTerminalCmd);

  // ── Phase 5: Configure Workspace stub (full implementation in Plan 02/03) ─────
  const configureCmd = vscode.commands.registerCommand(
    'harnesstune.configureWorkspace',
    async () => {
      vscode.window.showInformationMessage('HarnessTune: Configure Workspace — coming in Plan 02/03');
    }
  );
  context.subscriptions.push(configureCmd);

  // ── Phase 5: Auto-connect existing workspaces via AdapterRegistry ─────────────
  for (const workspace of registry.getAll()) {
    connectWorkspace(workspace).catch(err => {
      console.error(`HarnessTune: Failed to connect workspace "${workspace.name}":`, err);
    });
  }

  // Connect new workspaces as they're added
  const onWorkspaceChange = registry.onDidChange((workspaces) => {
    for (const ws of workspaces) {
      connectWorkspace(ws).catch(() => {});
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
