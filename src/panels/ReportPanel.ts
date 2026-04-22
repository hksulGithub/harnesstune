import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../types/messages';

export class ReportPanel {
  public static readonly viewType = 'harnesstune.reports';
  public static currentPanel: ReportPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private workspaceId: string;
  private workspaceName: string;

  private readonly _onDidReceiveMessage = new vscode.EventEmitter<WebviewToHostMessage>();
  public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;

  /** Listeners registered by extension.ts — disposed & re-registered on workspace switch */
  private messageListenerDisposable: vscode.Disposable | undefined;

  public static createOrShow(extensionUri: vscode.Uri, workspaceId: string, workspaceName: string, viewColumn: vscode.ViewColumn = vscode.ViewColumn.Two): ReportPanel {
    if (ReportPanel.currentPanel) {
      try {
        // Dispose previous message listener so extension.ts can re-wire for the new workspace
        ReportPanel.currentPanel.messageListenerDisposable?.dispose();
        ReportPanel.currentPanel.messageListenerDisposable = undefined;
        ReportPanel.currentPanel.workspaceId = workspaceId;
        ReportPanel.currentPanel.workspaceName = workspaceName;
        ReportPanel.currentPanel.panel.title = `Reports - ${workspaceName}`;
        // Regenerate HTML to force a fresh React mount — clears stale vscode.getState()
        ReportPanel.currentPanel.panel.webview.html = ReportPanel.currentPanel.getHtmlForWebview(ReportPanel.currentPanel.panel.webview);
        ReportPanel.currentPanel.reveal();
        return ReportPanel.currentPanel;
      } catch {
        // Panel was disposed by VSCode — fall through to create a new one
        ReportPanel.currentPanel = undefined;
      }
    }

    const panel = vscode.window.createWebviewPanel(
      ReportPanel.viewType,
      `Reports - ${workspaceName}`,
      viewColumn,
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
    panel.title = 'Reports';
    ReportPanel.currentPanel = new ReportPanel(panel, extensionUri, '', '');
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, workspaceId: string, workspaceName: string) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.workspaceId = workspaceId;
    this.workspaceName = workspaceName;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(() => {
      if (ReportPanel.currentPanel === this) {
        ReportPanel.currentPanel = undefined;
      }
      this.dispose();
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      this._onDidReceiveMessage.fire(msg);
    }, null, this.disposables);
  }

  public postMessage(message: HostToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  public getWorkspaceId(): string {
    return this.workspaceId;
  }

  /** Update workspace binding without revealing the panel (avoids layout disruption on reload). */
  public bindWorkspace(workspaceId: string, workspaceName: string): void {
    this.messageListenerDisposable?.dispose();
    this.messageListenerDisposable = undefined;
    this.workspaceId = workspaceId;
    this.workspaceName = workspaceName;
    this.panel.title = `Reports - ${workspaceName}`;
    // Regenerate HTML to force a fresh React mount — clears stale vscode.getState()
    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
  }

  public reveal(): void {
    try {
      this.panel.reveal();
    } catch {
      // Panel already disposed by VSCode
      ReportPanel.currentPanel = undefined;
    }
  }

  /** Register a message listener (disposes previous one on workspace switch). */
  public setMessageListener(listener: vscode.Disposable): void {
    this.messageListenerDisposable?.dispose();
    this.messageListenerDisposable = listener;
  }

  private disposed = false;

  public dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    if (ReportPanel.currentPanel === this) {
      ReportPanel.currentPanel = undefined;
    }
    this.messageListenerDisposable?.dispose();
    this._onDidReceiveMessage.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
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
  <title>Reports - ${this.workspaceName}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
