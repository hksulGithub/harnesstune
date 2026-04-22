import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../types/messages';

/**
 * Singleton WebviewPanel for the chat interface.
 * Uses createWebviewPanel (like Dashboard/Schematic) so it can be
 * dragged to any position — editor area, side panel, bottom panel, etc.
 */
export class ChatPanel {
  public static readonly viewType = 'harnesstune.chat';
  public static currentPanel: ChatPanel | undefined;
  private static lastViewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly _onDidReceiveMessage = new vscode.EventEmitter<WebviewToHostMessage>();
  public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;

  /** Currently active workspace id shown in this panel */
  public activeWorkspaceId: string | undefined;

  public static createOrShow(extensionUri: vscode.Uri, viewColumn?: vscode.ViewColumn): ChatPanel {
    if (ChatPanel.currentPanel) {
      try {
        ChatPanel.currentPanel.panel.reveal();
        return ChatPanel.currentPanel;
      } catch {
        // Panel was disposed by VSCode — fall through to create a new one
        ChatPanel.currentPanel = undefined;
      }
    }

    const col = viewColumn ?? ChatPanel.lastViewColumn;
    const panel = vscode.window.createWebviewPanel(
      ChatPanel.viewType,
      'Chat',
      col,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        retainContextWhenHidden: true,
      },
    );

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
    return ChatPanel.currentPanel;
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.title = 'Chat';
    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.viewColumn) {
          ChatPanel.lastViewColumn = e.webviewPanel.viewColumn;
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        if (ChatPanel.currentPanel === this) {
          ChatPanel.currentPanel = undefined;
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
      ChatPanel.currentPanel = undefined;
    }
  }

  public isReady(): boolean {
    return ChatPanel.currentPanel !== undefined;
  }

  private disposed = false;

  public dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    if (ChatPanel.currentPanel === this) {
      ChatPanel.currentPanel = undefined;
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
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
