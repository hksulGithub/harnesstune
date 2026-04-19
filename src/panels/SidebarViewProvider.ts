import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { WorkspaceRegistry } from '../registry';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../types/messages';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'harnesstune.sidebarView';

  private webview: vscode.Webview | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly registry: WorkspaceRegistry,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webview = webviewView.webview;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      switch (msg.type) {
        case 'ready':
          this.postMessage({ type: 'workspaces:update', workspaces: this.registry.getAll() });
          break;
        case 'workspace:open':
          vscode.commands.executeCommand('harnesstune.openWorkspace', msg.workspaceId);
          break;
        case 'workspace:remove':
          this.registry.remove(msg.workspaceId);
          break;
        case 'workspace:configure':
          vscode.commands.executeCommand('harnesstune.configureWorkspace', msg.workspaceId);
          break;
        case 'workspace:connect':
          vscode.commands.executeCommand('harnesstune.connectWorkspace');
          break;
        case 'workspace:refresh':
          this.postMessage({ type: 'workspaces:update', workspaces: this.registry.getAll() });
          break;
      }
    });

    // Keep sidebar in sync with registry changes
    this.registry.onDidChange(workspaces => {
      this.postMessage({ type: 'workspaces:update', workspaces });
    });
  }

  private postMessage(message: HostToWebviewMessage): void {
    this.webview?.postMessage(message);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
  <title>HarnessTune</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
