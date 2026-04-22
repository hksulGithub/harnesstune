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

  public static createOrShow(extensionUri: vscode.Uri, viewColumn: vscode.ViewColumn = vscode.ViewColumn.Two): SchematicPanel {
    if (SchematicPanel.currentPanel) {
      try {
        SchematicPanel.currentPanel.panel.reveal();
        return SchematicPanel.currentPanel;
      } catch {
        // Panel was disposed by VSCode — fall through to create a new one
        SchematicPanel.currentPanel = undefined;
      }
    }

    const panel = vscode.window.createWebviewPanel(
      SchematicPanel.viewType,
      'Schematic',
      viewColumn,
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
    panel.title = 'Schematic';
    SchematicPanel.currentPanel = new SchematicPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(
      () => {
        if (SchematicPanel.currentPanel === this) {
          SchematicPanel.currentPanel = undefined;
        }
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
    try {
      this.panel.webview.postMessage(message);
    } catch {
      // Panel already disposed
    }
  }

  public reveal(): void {
    try {
      this.panel.reveal();
    } catch {
      // Panel already disposed by VSCode
      SchematicPanel.currentPanel = undefined;
    }
  }

  private disposed = false;

  public dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    if (SchematicPanel.currentPanel === this) {
      SchematicPanel.currentPanel = undefined;
    }
    this._onDidReceiveMessage.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
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
  <title>Schematic</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
