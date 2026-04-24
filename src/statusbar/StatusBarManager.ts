import * as vscode from 'vscode';
import { WorkspaceRegistry } from '../registry';

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private alertCount = 0;

  constructor(private readonly registry: WorkspaceRegistry) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'harnesstune.showDashboard';
    this.item.tooltip = 'HarnessTune — Click to open dashboard';
    this.updateStatusBar();
    this.item.show();

    registry.onDidChange(() => this.updateStatusBar());
  }

  public setAlertCount(count: number): void {
    this.alertCount = count;
    this.updateStatusBar();
  }

  public clearAlertBadge(): void {
    this.alertCount = 0;
    this.updateStatusBar();
  }

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

  public dispose(): void {
    this.item.dispose();
  }
}
