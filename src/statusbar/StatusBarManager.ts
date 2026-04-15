import * as vscode from 'vscode';
import { WorkspaceRegistry } from '../registry';

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly registry: WorkspaceRegistry) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'harnesstune.showDashboard';
    this.item.tooltip = 'HarnessTune — Click to open dashboard';
    this.updateStatusBar();
    this.item.show();

    registry.onDidChange(() => this.updateStatusBar());
  }

  private updateStatusBar(): void {
    const workspaces = this.registry.getAll();
    const runningCount = workspaces.reduce((sum, ws) => sum + ws.runningAgentCount, 0);
    const errorCount = workspaces.reduce((sum, ws) => sum + ws.errorCount, 0);

    if (errorCount > 0) {
      this.item.text = `$(pulse) HT: ${runningCount} running $(error) ${errorCount}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      this.item.text = `$(pulse) HT: ${runningCount} running`;
      this.item.backgroundColor = undefined;
    }
  }

  public dispose(): void {
    this.item.dispose();
  }
}
