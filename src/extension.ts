import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  console.log('HarnessTune extension activating...');

  // Register commands (implementations added in Plan 02 and Plan 03)
  const connectCmd = vscode.commands.registerCommand(
    'harnesstune.connectWorkspace',
    () => vscode.window.showInformationMessage('HarnessTune: Connect Workspace (not yet implemented)')
  );
  const removeCmd = vscode.commands.registerCommand(
    'harnesstune.removeWorkspace',
    () => vscode.window.showInformationMessage('HarnessTune: Remove Workspace (not yet implemented)')
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

  console.log('HarnessTune extension activated.');
}

export function deactivate(): void {
  console.log('HarnessTune extension deactivated.');
}
