import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceRegistry } from './registry';
import { FileWatcherManager } from './watchers';
import { SecretStore } from './secrets';
import { SidebarViewProvider, DashboardPanel, SchematicPanel, ChatPanel, ChatManager, ReportPanel } from './panels';
import { buildTopology } from './topology';
import { StatusBarManager } from './statusbar';
import { WorkspaceRecord } from './types';
import type { WorkspaceStatus, AgentEvent } from './types';
import { ClaudeCodeHookAdapter, AdapterRegistry, OpenClawAdapter, RemoteAdapter } from './adapters';
import type { WorkspaceConnectionConfig, AgentBackendAdapter, BackendType } from './adapters';
import { RelayClient } from './relay';
import { AgentEventStore } from './database';
import { AgentControlManager } from './controls';
import { NotificationService } from './notifications';
import { ScaffoldService } from './scaffold';
import { AlertEngine } from './alerts';
import { LocalFleetProvider } from './providers/LocalFleetProvider';
import { RemoteFleetProvider } from './providers/RemoteFleetProvider';
import type { FleetDataProvider } from './providers/FleetDataProvider';
import type { AlertCycleSummary } from './types/alerts';
// TerminalManager replaced by ChatManager (webview-based chat panels)

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
      const name = path.basename(selectedPath);

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
        // Clean up relay token for remote workspaces
        const wsToRemove = registry.getById(selected.id);
        if (wsToRemove?.mode === 'remote') {
          await secretStore.deleteRelayToken(selected.id);
          remoteFleetClients.delete(selected.id);
        }

        // Disconnect active adapter if running
        const activeAdapter = activeAdapters.get(selected.id);
        if (activeAdapter) {
          await activeAdapter.disconnect(selected.id);
          activeAdapter.dispose();
          activeAdapters.delete(selected.id);
        }

        watcherManager.unwatchWorkspace(selected.id);
        await registry.remove(selected.id);
        vscode.window.showInformationMessage(`HarnessTune: Removed workspace "${selected.label}"`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`HarnessTune: Failed to remove workspace — ${msg}`);
      }
    }
  );

  // ── Phase 5: Create Workspace from template ─────────────────────────────────
  const createWorkspaceCmd = vscode.commands.registerCommand(
    'harnesstune.createWorkspace',
    async () => {
      const scaffoldService = new ScaffoldService(context.extensionUri);
      let templates: Awaited<ReturnType<ScaffoldService['listTemplates']>>;
      try {
        templates = await scaffoldService.listTemplates();
      } catch (err) {
        vscode.window.showErrorMessage('HarnessTune: Failed to load templates.');
        return;
      }
      if (templates.length === 0) {
        vscode.window.showErrorMessage('HarnessTune: No templates found.');
        return;
      }

      // Step 1: Pick template
      const templateItems = templates.map(t => ({
        label: t.manifest.name,
        description: t.manifest.description,
        templateName: t.name,
        manifest: t.manifest,
      }));
      const selectedTemplate = await vscode.window.showQuickPick(templateItems, {
        placeHolder: 'Select a workspace template',
      });
      if (!selectedTemplate) { return; }

      // Step 2: Collect variables
      const vars: Record<string, string> = {};
      for (const varName of selectedTemplate.manifest.variables) {
        const defaultValue = varName === 'MODEL' ? 'claude-opus-4-5' : '';
        const value = await vscode.window.showInputBox({
          prompt: `Enter value for ${varName}`,
          placeHolder: defaultValue || varName.toLowerCase().replace(/_/g, ' '),
          value: defaultValue,
          ignoreFocusOut: true,
        });
        if (value === undefined) { return; } // user cancelled
        vars[varName] = value;
      }

      // Step 3: Pick target directory
      const folderUris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Workspace Folder',
      });
      if (!folderUris || folderUris.length === 0) { return; }
      const targetDir = folderUris[0].fsPath;

      // Step 4: Conflict check
      for (const relPath of selectedTemplate.manifest.files) {
        const destUri = vscode.Uri.joinPath(vscode.Uri.file(targetDir), relPath);
        try {
          await vscode.workspace.fs.stat(destUri);
          // File exists -- warn
          const overwrite = await vscode.window.showWarningMessage(
            `File "${relPath}" already exists in target directory. Overwrite?`,
            'Overwrite', 'Cancel'
          );
          if (overwrite !== 'Overwrite') { return; }
          break; // one warning is enough
        } catch {
          // File doesn't exist -- good
        }
      }

      // Step 5: Scaffold
      try {
        await scaffoldService.scaffold(selectedTemplate.templateName, selectedTemplate.manifest, targetDir, vars);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`HarnessTune: Scaffold failed — ${msg}`);
        return;
      }

      // Step 6: Register + connect
      const name = vars['AGENT_NAME'] || path.basename(targetDir);
      try {
        const record = await registry.add(name, targetDir, selectedTemplate.manifest.backendType);
        watcherManager.watchWorkspace(record);
        await connectWorkspace(record);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`HarnessTune: Failed to register workspace — ${msg}`);
        return;
      }

      vscode.window.showInformationMessage(`HarnessTune: Workspace "${name}" created.`);
    }
  );
  context.subscriptions.push(createWorkspaceCmd);

  const openCmd = vscode.commands.registerCommand(
    'harnesstune.openWorkspace',
    async (workspaceId?: string) => {
      if (!workspaceId) {
        vscode.window.showInformationMessage('HarnessTune: No workspace selected');
        return;
      }
      const ws = registry.getById(workspaceId);
      if (!ws) {
        vscode.window.showWarningMessage(`HarnessTune: Workspace not found`);
        return;
      }

      // ── Create/reveal all panels ──
      // Reuse panels already restored by serializers (reload scenario) to
      // preserve the user's 2x2 layout. Only create panels that don't exist yet
      // (fresh start or user closed them). Skip reveal() when panels were
      // already open — reveal() brings a tab to front and can disrupt layout.

      // Column 1: Dashboard — reuse if serializer restored it
      const dashboardExisted = !!DashboardPanel.currentPanel;
      const dashboard = DashboardPanel.currentPanel ?? DashboardPanel.createOrShow(context.extensionUri, vscode.ViewColumn.One);
      wireDashboardMessageHandler(dashboard);

      // Column 1: Schematic — reuse if serializer restored it
      const schematic = SchematicPanel.currentPanel ?? SchematicPanel.createOrShow(context.extensionUri, vscode.ViewColumn.One);
      wireSchematicMessageHandler(schematic);

      // Column 2: Chat — reuse if serializer restored it (avoids duplicate panel)
      if (ws.mode !== 'remote') {
        const config = vscode.workspace.getConfiguration('harnesstune');
        const skipPermissions = config.get<boolean>('dangerouslySkipPermissions', false);
        if (ChatPanel.currentPanel) {
          // Panel exists (serializer or prior open) — wire session only, don't create panel
          chatManager.openChat(ws.id, ws.name, ws.rootPath, {
            dangerouslySkipPermissions: skipPermissions,
          }, ws.backendType);
        } else {
          chatManager.showChat(ws.id, ws.name, ws.rootPath, {
            dangerouslySkipPermissions: skipPermissions,
          }, ws.backendType, vscode.ViewColumn.Two);
        }
      }

      // Column 2: Reports — always call createOrShow so workspace info is updated
      // (serializer-restored panels have empty workspaceId/workspaceName)
      const reports = ReportPanel.createOrShow(context.extensionUri, ws.id, ws.name, vscode.ViewColumn.Two);
      wireReportsMessageHandler(reports);

      // Only reveal Dashboard if we freshly created it — serializer-restored
      // panels are already in the user's chosen position.
      if (!dashboardExisted) {
        dashboard.reveal();
      }

      // Broadcast active workspace to all open panels (including sidebar for highlight)
      const setActiveMsg = { type: 'workspace:setActive' as const, workspaceId: ws.id };
      dashboard.postMessage(setActiveMsg);
      schematic.postMessage(setActiveMsg);
      reports.postMessage(setActiveMsg);
      sidebarProvider.postMessage(setActiveMsg);

      // Proactively send timeline data after a short delay — the webview's HTML was
      // just regenerated by createOrShow, so the React app needs time to mount and
      // register its message listener before it can receive postMessage calls.
      setTimeout(() => {
        sendTimelineData(reports, ws.id, ws.name, ws.status);
      }, 500);
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

  // ── Phase 17: Fleet Data Provider (composite local + remote) ──────────────
  const localFleetProvider = new LocalFleetProvider(registry);
  const remoteFleetClients = new Map<string, RelayClient>();
  const remoteFleetProvider = new RemoteFleetProvider(remoteFleetClients, registry);

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

  // ── Phase 17: Alert Engine ────────────────────────────────────────────────
  const alertEngine = new AlertEngine(compositeFleetProvider, registry);

  let activeAlertCount = 0;

  const onAlerts = alertEngine.onDidDetectAlerts((summary: AlertCycleSummary) => {
    activeAlertCount = Math.max(0, activeAlertCount + summary.problems.length - summary.recoveries.length);
    statusBarManager.setAlertCount(activeAlertCount);

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

  alertEngine.start();
  context.subscriptions.push(alertEngine);

  // Expose services for use by later phases
  void secretStore; // referenced here so TypeScript doesn't warn; used in Phase 2+

  // ── Phase 5: Adapter Registry + per-workspace adapters ─────────────────────
  const adapterRegistry = new AdapterRegistry();
  const claudeCodeAdapter = new ClaudeCodeHookAdapter(context.globalStorageUri);
  adapterRegistry.register('claude-code', { createAdapter: () => claudeCodeAdapter });
  adapterRegistry.register('openclaw', { createAdapter: () => new OpenClawAdapter() });

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

    if (workspace.mode === 'remote') {
      // Remote workspace — create RemoteAdapter directly
      const token = await secretStore.getRelayToken(workspace.id);
      if (!token) {
        console.error(`HarnessTune: No relay token found for remote workspace "${workspace.name}"`);
        await registry.update(workspace.id, { status: 'auth_error' as WorkspaceStatus });
        return;
      }
      try {
        const adapter = new RemoteAdapter(
          workspace.relayUrl!,
          token,
          workspace.channelId!,
          workspace.pollInterval ?? 30_000,
          { reportCursor: workspace.lastCursor, messageCursor: workspace.lastMessageCursor },
        );
        const sub = adapter.onDidReceiveEvent(handleEvent);
        context.subscriptions.push(sub);

        // Wire status changes to registry updates
        const statusSub = adapter.onStatusChange(async ({ status, lastHeartbeatAt: _lh }) => {
          const wsStatus = status as WorkspaceStatus;
          await registry.update(workspace.id, { status: wsStatus });
          // Persist cursors on each poll cycle
          const cursors = adapter.getCursors();
          if (cursors.reportCursor) {
            await registry.update(workspace.id, { lastCursor: cursors.reportCursor, lastMessageCursor: cursors.messageCursor });
          }
        });
        context.subscriptions.push(statusSub);

        await adapter.connect(workspace.id, workspace.rootPath);
        activeAdapters.set(workspace.id, adapter);
        context.subscriptions.push(adapter);

        // Register relay client for fleet data provider
        const client = adapter.getClient();
        if (client) {
          remoteFleetClients.set(workspace.id, client);
        }
      } catch (err) {
        console.error(`HarnessTune: Failed to connect remote workspace "${workspace.name}":`, err);
      }
      return;
    }

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

  // ── Phase 2: Dashboard message handler ──────────────────────────────────────
  let dashboardMsgHandler: vscode.Disposable | undefined;
  function wireDashboardMessageHandler(panel: DashboardPanel): void {
    panel.setFleetProvider(compositeFleetProvider);
    dashboardMsgHandler?.dispose();
    dashboardMsgHandler = panel.onDidReceiveMessage((msg) => {
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
            panel.postMessage({ type: 'dashboard:agentUpdate', session });
            const events = eventStore.getEventsBySession(session.sessionId, 20);
            panel.postMessage({ type: 'dashboard:agentEvents', events });
          }
          break;
        }
      }
    });
  }

  // ── Phase 2: Dashboard Command (real implementation) ─────────────────────────
  const dashboardCmd = vscode.commands.registerCommand(
    'harnesstune.showDashboard',
    () => {
      const panel = DashboardPanel.createOrShow(context.extensionUri);
      wireDashboardMessageHandler(panel);
      // Clear alert badge when user views dashboard
      activeAlertCount = 0;
      statusBarManager.clearAlertBadge();
    }
  );
  context.subscriptions.push(dashboardCmd);

  // ── Phase 2: Dashboard Serializer (DASH-04) ───────────────────────────────────
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DashboardPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
        DashboardPanel.revive(panel, context.extensionUri);
        const dashboardPanel = DashboardPanel.currentPanel;
        if (dashboardPanel) {
          wireDashboardMessageHandler(dashboardPanel);
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
  let schematicMsgHandler: vscode.Disposable | undefined;
  function wireSchematicMessageHandler(panel: SchematicPanel): void {
    schematicMsgHandler?.dispose();
    schematicMsgHandler = panel.onDidReceiveMessage((msg) => {
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

  // ── Phase 10: Report Timeline Panel ──────────────────────────────────────────

  /** Fetch timeline data for a workspace and send it to the report panel. */
  async function sendTimelineData(panel: ReportPanel, wsId: string, wsName: string, wsStatus: string) {
    let items: import('@harnesstune/shared').TimelineItem[] = [];
    let loopIterations: Record<string, import('@harnesstune/shared').RalphReportBody[]> = {};

    const adapter = activeAdapters.get(wsId);
    console.log(`[HarnessTune:Reports] sendTimelineData wsId=${wsId} wsName=${wsName} hasAdapter=${!!adapter} adapterHasGetTimeline=${adapter ? 'getTimelineItems' in adapter : 'N/A'}`);
    if (adapter && 'getTimelineItems' in adapter) {
      const remote = adapter as RemoteAdapter;
      const result = await remote.getTimelineItems();
      items = result.items;
      loopIterations = result.loopIterations;
      console.log(`[HarnessTune:Reports] Remote path: ${items.length} items`);
    } else {
      // Local workspace — pull reports from AgentEventStore
      const result = eventStore.getTimelineItems(wsId);
      items = result.items;
      loopIterations = result.loopIterations;
      console.log(`[HarnessTune:Reports] Local path: ${items.length} items, kinds: ${items.slice(0, 5).map(i => i.kind).join(',')}`);
    }

    const initial = items.slice(0, 20);
    console.log(`[HarnessTune:Reports] Sending ${initial.length} items (hasMore=${items.length > 20})`);
    panel.postMessage({ type: 'timeline:update', workspaceId: wsId, items: initial, hasMore: items.length > 20 });
    panel.postMessage({ type: 'timeline:loopIterations', workspaceId: wsId, loopIterations });
    panel.postMessage({ type: 'chat:workspaceInfo', workspaceId: wsId, workspaceName: wsName });
    const status = wsStatus === 'error' ? 'error' : (wsStatus === 'stale' ? 'stale' : 'connected');
    panel.postMessage({ type: 'timeline:connectionStatus', workspaceId: wsId, status: status as 'connected' | 'stale' | 'error' });
  }

  // ── Phase 10: Reports message handler ──────────────────────────────────────
  function wireReportsMessageHandler(panel: ReportPanel): void {
    const listener = panel.onDidReceiveMessage(async (msg) => {
      const currentWsId = panel.getWorkspaceId();
      const currentWs = registry.getAll().find(w => w.id === currentWsId);

      if (msg.type === 'timeline:requestInitial') {
        console.log(`[HarnessTune:Reports] timeline:requestInitial received, currentWsId=${currentWsId}, found=${!!currentWs}`);
        if (currentWs) {
          await sendTimelineData(panel, currentWs.id, currentWs.name, currentWs.status);
        }
      }
      if (msg.type === 'timeline:sendMessage') {
        const remote = activeAdapters.get(currentWsId) as RemoteAdapter | undefined;
        const client = remote?.getClient();
        if (client) {
          try {
            await client.postMessage(msg.text, msg.inReplyToReportId);
            panel.postMessage({ type: 'reports:messageSent', workspaceId: currentWsId, success: true });
          } catch {
            panel.postMessage({ type: 'reports:messageSent', workspaceId: currentWsId, success: false });
          }
        }
      }
      if (msg.type === 'timeline:loadMore') {
        // deferred
      }
    });
    panel.setMessageListener(listener);
  }

  const openReportsCmd = vscode.commands.registerCommand(
    'harnesstune.openReports',
    async (workspaceId?: string) => {
      const ws = workspaceId
        ? registry.getAll().find(w => w.id === workspaceId)
        : registry.getAll()[0];
      if (!ws) {
        vscode.window.showWarningMessage('HarnessTune: No workspace found.');
        return;
      }

      const panel = ReportPanel.createOrShow(context.extensionUri, ws.id, ws.name);
      wireReportsMessageHandler(panel);
    },
  );
  context.subscriptions.push(openReportsCmd);

  // ── Phase 10: Report Panel Serializer ────────────────────────────────────────
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(ReportPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        ReportPanel.revive(panel, context.extensionUri);
      },
    })
  );

  // ── Phase 4: Chat Manager (webview-based, replaces TerminalManager) ────────
  const chatManager = new ChatManager(context.extensionUri, (event: AgentEvent) => {
    // Feed chat session stream-JSON events into the same pipeline as hook events
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
  context.subscriptions.push(chatManager);

  // Chat serializer — restores the panel shell so VS Code preserves the layout.
  // The session is re-wired when the user opens a workspace.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(ChatPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        ChatPanel.revive(panel, context.extensionUri);
      },
    })
  );

  // Interrupt chat session (bound to Escape when chat panel is focused)
  const interruptChatCmd = vscode.commands.registerCommand(
    'harnesstune.interruptChat',
    () => {
      const panel = chatManager.getPanel();
      if (panel) {
        panel.postMessage({ type: 'chat:triggerInterrupt' as any });
      }
      // Also send interrupt directly via the webview message channel
      chatManager.interruptActive();
    }
  );
  context.subscriptions.push(interruptChatCmd);

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

      chatManager.showChat(ws.id, ws.name, ws.rootPath, {
        dangerouslySkipPermissions: skipPermissions,
      }, ws.backendType);
    }
  );
  context.subscriptions.push(openTerminalCmd);

  // ── Phase 5: Configure Workspace — backend type switching ─────────────────
  const configureCmd = vscode.commands.registerCommand(
    'harnesstune.configureWorkspace',
    async (workspaceId?: string) => {
      let workspace: WorkspaceRecord | undefined;

      if (workspaceId) {
        workspace = registry.getById(workspaceId);
      } else {
        // Step 1: Pick workspace via quickpick
        const workspaces = registry.getAll();
        if (workspaces.length === 0) {
          vscode.window.showInformationMessage('HarnessTune: No workspaces registered.');
          return;
        }

        const wsItems = workspaces.map(ws => ({
          label: ws.name,
          description: `${ws.backendType} — ${ws.rootPath}`,
          workspaceId: ws.id,
        }));
        const selectedWs = await vscode.window.showQuickPick(wsItems, {
          placeHolder: 'Select workspace to configure',
        });
        if (!selectedWs) { return; }

        workspace = registry.getById(selectedWs.workspaceId);
      }
      if (!workspace) { return; }

      // Delegate to remote configure flow for remote workspaces
      if (workspace.mode === 'remote') {
        await vscode.commands.executeCommand('harnesstune.configureRemoteWorkspace', workspace.id);
        return;
      }

      // Step 2: Pick new backend type
      const backendTypes: Array<{ label: string; description: string; value: BackendType }> = [
        { label: 'Claude Code', description: 'Interactive Claude Code agent via hooks', value: 'claude-code' },
        { label: 'OpenClaw', description: 'OpenClaw agent via JSONL file tailing', value: 'openclaw' },
        { label: 'Remote', description: 'Remote agent via relay server', value: 'remote' },
      ];
      const selectedBackend = await vscode.window.showQuickPick(backendTypes, {
        placeHolder: `Current backend: ${workspace.backendType}. Select new backend type:`,
      });
      if (!selectedBackend) { return; }

      if (selectedBackend.value === workspace.backendType) {
        vscode.window.showInformationMessage(`HarnessTune: Workspace "${workspace.name}" is already using ${workspace.backendType}.`);
        return;
      }

      // Step 3: Disconnect old adapter
      const oldAdapter = activeAdapters.get(workspace.id);
      if (oldAdapter) {
        try {
          await oldAdapter.disconnect(workspace.id);
          oldAdapter.dispose();
        } catch (err) {
          console.error('HarnessTune: Error disconnecting old adapter:', err);
        }
        activeAdapters.delete(workspace.id);
      }

      // Step 4: Update registry with new backendType
      try {
        await registry.update(workspace.id, { backendType: selectedBackend.value });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`HarnessTune: Failed to update workspace — ${msg}`);
        return;
      }

      // Step 5: Reconnect with new adapter via connectWorkspace
      const updatedWorkspace = registry.getById(workspace.id);
      if (updatedWorkspace) {
        try {
          await connectWorkspace(updatedWorkspace);
        } catch (err) {
          console.error('HarnessTune: Error connecting new adapter:', err);
          vscode.window.showErrorMessage(`HarnessTune: Backend changed but failed to connect new adapter.`);
          return;
        }
      }

      vscode.window.showInformationMessage(
        `HarnessTune: Workspace "${workspace.name}" switched to ${selectedBackend.value}.`
      );
    }
  );
  context.subscriptions.push(configureCmd);

  // ── Phase 9: Add Remote Workspace command ────────────────────────────────────
  const addRemoteCmd = vscode.commands.registerCommand('harnesstune.addRemoteWorkspace', async () => {
    // Step 1: Relay URL
    const relayUrl = await vscode.window.showInputBox({
      title: 'Add Remote Workspace (1/2)',
      prompt: 'Enter the relay URL (e.g., https://harnesstune-relay.vercel.app/api)',
      placeHolder: 'https://harnesstune-relay.vercel.app/api',
      validateInput: (value) => {
        try {
          const url = new URL(value);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            return 'URL must use http or https protocol';
          }
          return undefined;
        } catch {
          return 'Enter a valid URL';
        }
      },
    });
    if (!relayUrl) { return; } // user cancelled

    // Normalize: append /api if not already ending with /api
    const normalizedUrl = relayUrl.endsWith('/api') ? relayUrl : relayUrl.replace(/\/+$/, '') + '/api';

    // Step 2: Agent token (password mode)
    const token = await vscode.window.showInputBox({
      title: 'Add Remote Workspace (2/2)',
      prompt: 'Enter the agent Bearer token',
      password: true,
      validateInput: (value) => value.trim().length === 0 ? 'Token cannot be empty' : undefined,
    });
    if (!token) { return; } // user cancelled

    // Step 3: Auto health-check + auto-discover channelId + save
    let channelId: string;
    try {
      const tempClient = new RelayClient({ relayUrl: normalizedUrl, token: token.trim(), channelId: '' });
      await tempClient.checkHealth();
      channelId = await tempClient.discoverChannelId();
    } catch (err) {
      const retry = await vscode.window.showErrorMessage(
        `Could not connect to relay: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'Retry', 'Cancel'
      );
      if (retry === 'Retry') {
        await vscode.commands.executeCommand('harnesstune.addRemoteWorkspace');
      }
      return;
    }

    // Auto-name from channel metadata or relay hostname
    let workspaceName: string;
    try {
      const client = new RelayClient({ relayUrl: normalizedUrl, token: token.trim(), channelId });
      const channel = await client.getChannel();
      workspaceName = channel.name ?? new URL(normalizedUrl).hostname;
    } catch {
      workspaceName = new URL(normalizedUrl).hostname;
    }

    // Save to registry
    const record = await registry.add(workspaceName, 'remote://' + channelId, 'remote', {
      mode: 'remote',
      relayUrl: normalizedUrl,
      channelId,
    });

    // Store token in SecretStore
    await secretStore.setRelayToken(record.id, token.trim());

    // Connect the workspace (starts polling)
    await connectWorkspace(record);

    vscode.window.showInformationMessage(`Remote workspace "${workspaceName}" added successfully.`);
  });
  context.subscriptions.push(addRemoteCmd);

  // ── Phase 9: Message Agent command ───────────────────────────────────────────
  const messageAgentCmd = vscode.commands.registerCommand('harnesstune.messageAgent', async (workspaceId?: string) => {
    if (!workspaceId) { return; }
    const workspace = registry.getById(workspaceId);
    if (!workspace || workspace.mode !== 'remote') { return; }

    const text = await vscode.window.showInputBox({
      title: `Message Agent: ${workspace.name}`,
      prompt: 'Enter message to send to the agent',
      placeHolder: 'Type your message...',
    });
    if (!text) { return; }

    const adapter = activeAdapters.get(workspaceId);
    if (adapter && adapter instanceof RemoteAdapter) {
      const client = adapter.getClient();
      if (client) {
        try {
          await client.postMessage(text);
          vscode.window.showInformationMessage(`Message sent to ${workspace.name}.`);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to send message: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }
  });
  context.subscriptions.push(messageAgentCmd);

  // ── Phase 9: Configure Remote Workspace command ───────────────────────────────
  const configureRemoteCmd = vscode.commands.registerCommand('harnesstune.configureRemoteWorkspace', async (workspaceId?: string) => {
    if (!workspaceId) { return; }
    const workspace = registry.getById(workspaceId);
    if (!workspace || workspace.mode !== 'remote') { return; }

    const choice = await vscode.window.showQuickPick(
      ['Update Relay URL', 'Update Poll Interval', 'Re-enter Token', 'Rename'],
      { title: `Configure: ${workspace.name}` }
    );
    if (!choice) { return; }

    switch (choice) {
      case 'Update Relay URL': {
        const url = await vscode.window.showInputBox({ value: workspace.relayUrl, prompt: 'Relay URL' });
        if (url) { await registry.update(workspaceId, { relayUrl: url }); }
        break;
      }
      case 'Update Poll Interval': {
        const interval = await vscode.window.showInputBox({
          value: String((workspace.pollInterval ?? 30000) / 1000),
          prompt: 'Poll interval in seconds (15-300)',
        });
        if (interval) {
          const ms = Math.max(15, Math.min(300, parseInt(interval, 10))) * 1000;
          await registry.update(workspaceId, { pollInterval: ms });
        }
        break;
      }
      case 'Re-enter Token': {
        const newToken = await vscode.window.showInputBox({ password: true, prompt: 'New Bearer token' });
        if (newToken) {
          await secretStore.setRelayToken(workspaceId, newToken.trim());
          // Reconnect with new token
          const existingAdapter = activeAdapters.get(workspaceId);
          if (existingAdapter) {
            await existingAdapter.disconnect(workspaceId);
            existingAdapter.dispose();
            activeAdapters.delete(workspaceId);
          }
          const updated = registry.getById(workspaceId);
          if (updated) { await connectWorkspace(updated); }
        }
        break;
      }
      case 'Rename': {
        const newName = await vscode.window.showInputBox({ value: workspace.name, prompt: 'Workspace name' });
        if (newName) { await registry.update(workspaceId, { name: newName }); }
        break;
      }
    }
  });
  context.subscriptions.push(configureRemoteCmd);

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

  // Auto-open chat for the first workspace so the panel isn't empty on reload.
  // Defer with setTimeout so VS Code serializers have a chance to fire first.
  // Without this, showChat() creates a new Chat panel before the serializer
  // restores the existing one → duplicate Chat panels on reload.
  const allWorkspaces = registry.getAll();
  if (allWorkspaces.length > 0) {
    const firstWs = allWorkspaces[0];
    const config = vscode.workspace.getConfiguration('harnesstune');
    const skipPermissions = config.get<boolean>('dangerouslySkipPermissions', false);
    setTimeout(() => {
      if (ChatPanel.currentPanel) {
        // Serializer already restored the panel — just wire the session
        chatManager.openChat(firstWs.id, firstWs.name, firstWs.rootPath, {
          dangerouslySkipPermissions: skipPermissions,
        }, firstWs.backendType);
      } else {
        // Fresh start — create the panel
        chatManager.showChat(firstWs.id, firstWs.name, firstWs.rootPath, {
          dangerouslySkipPermissions: skipPermissions,
        }, firstWs.backendType);
      }
    }, 200);
  }

  // Auto-wire Reports panel if serializer restored it — bind to first workspace
  // and proactively send timeline data. Same defer pattern as Chat above so
  // serializers have a chance to fire first.
  if (allWorkspaces.length > 0) {
    const firstWs = allWorkspaces[0];
    setTimeout(() => {
      if (ReportPanel.currentPanel) {
        // bindWorkspace updates workspace info + regenerates HTML without reveal()
        ReportPanel.currentPanel.bindWorkspace(firstWs.id, firstWs.name);
        wireReportsMessageHandler(ReportPanel.currentPanel);
        // Defer data push so the fresh React mount has time to register its message listener
        setTimeout(() => {
          if (ReportPanel.currentPanel) {
            sendTimelineData(ReportPanel.currentPanel, firstWs.id, firstWs.name, firstWs.status);
          }
        }, 300);
      }
    }, 250);
  }

  // Close the Welcome tab only on first-run (no HT panels were serializer-restored).
  // When VS Code restores a 2x2 layout, mutating tabs here destroys a quadrant.
  const anyPanelRestored =
    DashboardPanel.currentPanel ||
    SchematicPanel.currentPanel ||
    ChatPanel.currentPanel ||
    ReportPanel.currentPanel;
  if (!anyPanelRestored) {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.label === 'Welcome') {
          vscode.window.tabGroups.close(tab);
        }
      }
    }
  }

  console.log('HarnessTune extension activated.');
}

export async function deactivate(): Promise<void> {
  console.log('HarnessTune extension deactivating...');
  // EventStore flush happens via dispose in subscriptions
}
