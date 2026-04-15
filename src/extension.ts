import * as vscode from 'vscode';
import { WorkspaceRegistry } from './registry';
import { FileWatcherManager } from './watchers';
import { SecretStore } from './secrets';
import { WorkspaceRecord } from './types';

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
    () => vscode.window.showInformationMessage('HarnessTune: Open Workspace (not yet implemented)')
  );

  const refreshCmd = vscode.commands.registerCommand(
    'harnesstune.refreshSidebar',
    () => vscode.window.showInformationMessage('HarnessTune: Refresh Sidebar (not yet implemented)')
  );

  const dashboardCmd = vscode.commands.registerCommand(
    'harnesstune.showDashboard',
    () => vscode.window.showInformationMessage('HarnessTune: Show Dashboard (not yet implemented)')
  );

  context.subscriptions.push(connectCmd, removeCmd, openCmd, refreshCmd, dashboardCmd);

  // Expose services for use by sidebar/panel providers in later plans
  void secretStore; // referenced here so TypeScript doesn't warn; used in Plans 03+

  console.log('HarnessTune extension activated.');
}

export function deactivate(): void {
  console.log('HarnessTune extension deactivated.');
}
