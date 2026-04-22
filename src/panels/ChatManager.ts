import * as vscode from 'vscode';
import { ClaudeSession, OpenClawLogSession } from '../session';
import type { ChatMessage, SessionState } from '../session';
import type { AgentEvent } from '../types/agent';
import type { BackendType } from '../types/workspace';
import { ChatPanel } from './ChatPanel';

export interface ChatManagerOpenOptions {
  dangerouslySkipPermissions?: boolean;
}

interface ChatEntry {
  session: ClaudeSession | OpenClawLogSession;
  disposables: vscode.Disposable[];
  workspaceName: string;
}

/**
 * Manages per-workspace ClaudeSession instances wired to the singleton ChatPanel.
 * Switching workspaces swaps the active session — only one chat visible at a time.
 */
export class ChatManager implements vscode.Disposable {
  private readonly entries = new Map<string, ChatEntry>();
  private readonly extensionUri: vscode.Uri;
  private panelMessageHandler: vscode.Disposable | undefined;

  constructor(
    extensionUri: vscode.Uri,
    private readonly onEvent: (event: AgentEvent) => void,
  ) {
    this.extensionUri = extensionUri;
  }

  private getOrCreatePanel(viewColumn?: vscode.ViewColumn): ChatPanel {
    return ChatPanel.createOrShow(this.extensionUri, viewColumn);
  }

  private get chatPanel(): ChatPanel | undefined {
    return ChatPanel.currentPanel;
  }

  openChat(
    workspaceId: string,
    workspaceName: string,
    workspaceRootPath: string,
    options?: ChatManagerOpenOptions,
    backendType: BackendType = 'claude-code',
  ): void {
    // Create session if it doesn't exist yet
    if (!this.entries.has(workspaceId)) {
      const session = backendType === 'openclaw'
        ? new OpenClawLogSession(workspaceId, workspaceName, workspaceRootPath)
        : new ClaudeSession(workspaceId, workspaceName, workspaceRootPath, {
            dangerouslySkipPermissions: options?.dangerouslySkipPermissions,
          });

      // Start the OpenClaw log session immediately
      if (session instanceof OpenClawLogSession) {
        session.start();
      }

      const disposables: vscode.Disposable[] = [];

      // Wire session events → panel (only when this workspace is active)
      session.on('message', (msg: ChatMessage) => {
        const panel = this.chatPanel;
        if (panel && panel.activeWorkspaceId === workspaceId) {
          panel.postMessage({ type: 'chat:message', message: msg });
        }
      });

      session.on('stateChange', (state: SessionState) => {
        const panel = this.chatPanel;
        if (panel && panel.activeWorkspaceId === workspaceId) {
          panel.postMessage({ type: 'chat:stateChange', state });
        }
      });

      session.on('agentEvent', (event: AgentEvent) => {
        this.onEvent(event);
      });

      // When a turn completes, re-send history so the spliced "Thinking..." placeholder is removed
      session.on('turnComplete', () => {
        const panel = this.chatPanel;
        if (panel && panel.activeWorkspaceId === workspaceId && panel.isReady()) {
          panel.postMessage({ type: 'chat:history', messages: [...session.messages] });
        }
      });

      this.entries.set(workspaceId, { session, disposables, workspaceName });
    }

    // If the panel is already open, switch to this workspace.
    // If not, just prepare the session — don't force-reopen a panel the user closed.
    if (this.chatPanel) {
      this.switchToWorkspace(workspaceId);
    }
  }

  /** Open the chat panel AND switch to this workspace. Use for explicit "show chat" actions. */
  showChat(
    workspaceId: string,
    workspaceName: string,
    workspaceRootPath: string,
    options?: ChatManagerOpenOptions,
    backendType: BackendType = 'claude-code',
    viewColumn?: vscode.ViewColumn,
  ): void {
    this.openChat(workspaceId, workspaceName, workspaceRootPath, options, backendType);
    this.getOrCreatePanel(viewColumn);
    this.switchToWorkspace(workspaceId);
  }

  private switchToWorkspace(workspaceId: string): void {
    const panel = this.chatPanel;
    if (!panel) { return; }

    panel.activeWorkspaceId = workspaceId;

    // Dispose previous panel message handler
    this.panelMessageHandler?.dispose();

    const entry = this.entries.get(workspaceId);
    if (!entry) { return; }

    // Wire panel messages → active session
    this.panelMessageHandler = panel.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'chat:sendMessage':
          entry.session.sendMessage(msg.text);
          break;
        case 'chat:interrupt':
          entry.session.interrupt();
          break;
        case 'chat:requestHistory': {
          const wsInfo = this.getWorkspaceInfo(workspaceId);
          if (wsInfo) {
            panel.postMessage({ type: 'chat:workspaceInfo', workspaceId: wsInfo.id, workspaceName: wsInfo.name });
          }
          panel.postMessage({ type: 'chat:history', messages: [...entry.session.messages] });
          panel.postMessage({ type: 'chat:stateChange', state: entry.session.state });
          break;
        }
      }
    });

    // Send workspace info + current history to panel
    if (panel.isReady()) {
      const ws = this.getWorkspaceInfo(workspaceId);
      if (ws) {
        panel.postMessage({ type: 'chat:workspaceInfo', workspaceId: ws.id, workspaceName: ws.name });
      }
      panel.postMessage({ type: 'chat:history', messages: [...entry.session.messages] });
      panel.postMessage({ type: 'chat:stateChange', state: entry.session.state });

      // Notify the panel if this is a read-only OpenClaw log viewer
      if (entry.session instanceof OpenClawLogSession) {
        panel.postMessage({
          type: 'chat:setReadOnly' as any,
          reason: "Log viewer -- this workspace doesn't support interactive chat.",
        });
      }
    }
  }

  private getWorkspaceInfo(workspaceId: string): { id: string; name: string } | undefined {
    const entry = this.entries.get(workspaceId);
    if (!entry) { return undefined; }
    return { id: workspaceId, name: entry.workspaceName };
  }

  getPanel(): ChatPanel | undefined {
    return this.chatPanel;
  }

  /** Interrupt the currently active workspace's session. */
  interruptActive(): void {
    const panel = this.chatPanel;
    if (!panel?.activeWorkspaceId) { return; }
    const entry = this.entries.get(panel.activeWorkspaceId);
    entry?.session.interrupt();
  }

  dispose(): void {
    this.panelMessageHandler?.dispose();
    for (const [, entry] of this.entries) {
      entry.session.dispose();
      for (const d of entry.disposables) { d.dispose(); }
    }
    this.entries.clear();
    this.chatPanel?.dispose();
  }
}
