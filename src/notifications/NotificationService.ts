import * as vscode from 'vscode';
import type { AgentEvent } from '../types/agent';
import type { IWorkspaceRegistry } from '../types/workspace';

export class NotificationService implements vscode.Disposable {
  constructor(private readonly registry: IWorkspaceRegistry) {}

  async handleEvent(event: AgentEvent): Promise<void> {
    switch (event.eventType) {
      case 'PostToolUseFailure':
      case 'StopFailure': {
        const errorMsg = event.error ?? 'Unknown error';
        const action = await vscode.window.showErrorMessage(
          `HarnessTune: Agent "${event.agentId}" error — ${errorMsg}`,
          'View Details'
        );
        if (action === 'View Details') {
          vscode.commands.executeCommand('harnesstune.showDashboard');
        }
        // Increment workspace errorCount
        const workspace = this.registry.getById(event.workspaceId);
        if (workspace) {
          await this.registry.update(event.workspaceId, {
            errorCount: workspace.errorCount + 1,
          });
        }
        break;
      }

      case 'SessionStart': {
        const workspace = this.registry.getById(event.workspaceId);
        if (workspace) {
          await this.registry.update(event.workspaceId, {
            status: 'running',
            runningAgentCount: workspace.runningAgentCount + 1,
          });
        }
        // No toast for info events
        break;
      }

      case 'SessionEnd':
      case 'Stop': {
        const workspace = this.registry.getById(event.workspaceId);
        if (workspace) {
          const newCount = Math.max(0, workspace.runningAgentCount - 1);
          await this.registry.update(event.workspaceId, {
            runningAgentCount: newCount,
            status: newCount === 0 ? 'idle' : workspace.status,
          });
        }
        // No toast for info events
        break;
      }

      default:
        // All other events: no notification, no status bar update
        break;
    }
  }

  dispose(): void {
    // No-op: no subscriptions to clean up
  }
}
