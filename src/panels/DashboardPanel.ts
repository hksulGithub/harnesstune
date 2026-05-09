import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../types/messages';
import type { FleetDataProvider } from '../providers/FleetDataProvider';

export class DashboardPanel {
  public static readonly viewType = 'harnesstune.dashboard';
  // Must be public static so extension.ts and other modules can check if panel is open
  // and push events to it. Do NOT make private.
  public static currentPanel: DashboardPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly _onDidReceiveMessage = new vscode.EventEmitter<WebviewToHostMessage>();
  public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;

  private fleetProvider: FleetDataProvider | null = null;

  public setFleetProvider(provider: FleetDataProvider): void {
    this.fleetProvider = provider;
  }

  public static createOrShow(extensionUri: vscode.Uri, viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): DashboardPanel {
    if (DashboardPanel.currentPanel) {
      try {
        // Don't pass viewColumn — let restored/existing panels stay where they are.
        // Forcing a viewColumn collapses user-arranged layouts (e.g. 2x2 → 1x2).
        DashboardPanel.currentPanel.panel.reveal();
        return DashboardPanel.currentPanel;
      } catch (e) {
        // Panel was disposed by VSCode — fall through to create a new one
        DashboardPanel.currentPanel = undefined;
      }
    }
    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Dashboard',
      viewColumn,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
        retainContextWhenHidden: true,
      },
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
    return DashboardPanel.currentPanel;
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.title = 'Dashboard';
    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

    this.panel.onDidDispose(
      () => {
        // Guard: only clear currentPanel if it still points to THIS instance.
        // Without this, a late-firing onDidDispose from an old panel can wipe
        // the reference to a newly created panel (async dispose race).
        if (DashboardPanel.currentPanel === this) {
          DashboardPanel.currentPanel = undefined;
        }
        this.dispose();
      },
      null,
      this.disposables,
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => {
        void this.handleFleetMessage(msg);
        this._onDidReceiveMessage.fire(msg);
      },
      null,
      this.disposables,
    );
  }

  private async handleFleetMessage(msg: WebviewToHostMessage): Promise<void> {
    if (!this.fleetProvider) { return; }
    switch (msg.type) {
      case 'fleet:requestOverview': {
        try {
          const summaries = await this.fleetProvider.getWorkspaceSummaries(msg.days);
          this.postMessage({ type: 'fleet:overview', summaries });
        } catch (err) {
          this.postMessage({ type: 'fleet:error', scope: 'fleet', message: String(err) });
        }
        break;
      }
      case 'fleet:requestWorkspaceDetail': {
        try {
          const detail = await this.fleetProvider.getWorkspaceDetail(msg.workspaceId, msg.days);
          this.postMessage({ type: 'fleet:workspaceDetail', workspaceId: msg.workspaceId, detail });
        } catch (err) {
          this.postMessage({ type: 'fleet:error', scope: 'workspace', message: String(err) });
        }
        break;
      }
      case 'fleet:requestAgentDetail': {
        try {
          const detail = await this.fleetProvider.getAgentDetail(msg.workspaceId, msg.agentId, msg.days);
          this.postMessage({ type: 'fleet:agentDetail', workspaceId: msg.workspaceId, agentId: msg.agentId, detail });
        } catch (err) {
          this.postMessage({ type: 'fleet:error', scope: 'agent', message: String(err) });
        }
        break;
      }
      default:
        break;
    }
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
    } catch (e) {
      // Panel already disposed by VSCode
      DashboardPanel.currentPanel = undefined;
    }
  }

  private disposed = false;

  public dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    if (DashboardPanel.currentPanel === this) {
      DashboardPanel.currentPanel = undefined;
    }
    this._onDidReceiveMessage.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
    // Don't call this.panel.dispose() here — onDidDispose already calls
    // dispose(), so re-calling panel.dispose() is re-entrant and can corrupt
    // the singleton reference during restore/reload cycles.
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'dashboard.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'dashboard.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
