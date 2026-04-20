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
