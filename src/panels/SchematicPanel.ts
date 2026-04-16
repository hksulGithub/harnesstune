import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../types/messages';

export class SchematicPanel {
  public static readonly viewType = 'harnesstune.schematic';
  // Must be public static so extension.ts and other modules can check if panel is open
  // and push events to it. Do NOT make private.
  public static currentPanel: SchematicPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly _onDidReceiveMessage = new vscode.EventEmitter<WebviewToHostMessage>();
  public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;

  public static createOrShow(extensionUri: vscode.Uri): SchematicPanel {
    if (SchematicPanel.currentPanel) {
      SchematicPanel.currentPanel.reveal();
      return SchematicPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      SchematicPanel.viewType,
      'HarnessTune Schematic',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        retainContextWhenHidden: false,
      },
    );

    SchematicPanel.currentPanel = new SchematicPanel(panel, extensionUri);
    return SchematicPanel.currentPanel;
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    SchematicPanel.currentPanel = new SchematicPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(
      () => {
        SchematicPanel.currentPanel = undefined;
        this.dispose();
      },
      null,
      this.disposables,
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => {
        this._onDidReceiveMessage.fire(msg);
      },
      null,
      this.disposables,
    );
  }

  public postMessage(message: HostToWebviewMessage): void {
    this.panel.webview.postMessage(message);
  }

  public reveal(): void {
    this.panel.reveal();
  }

  public dispose(): void {
    SchematicPanel.currentPanel = undefined;
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
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'schematic.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'schematic.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
  <title>HarnessTune Schematic</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
