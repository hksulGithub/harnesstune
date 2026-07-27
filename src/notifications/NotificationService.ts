import * as vscode from 'vscode';
import type { AgentEvent } from '../types/agent';
import type { IWorkspaceRegistry } from '../types/workspace';

export class NotificationService implements vscode.Disposable {
  constructor(private readonly registry: IWorkspaceRegistry) {}

  async handleEvent(event: AgentEvent): Promise<void> {
    switch (event.eventType) {
      case 'PostToolUseFailure':
      case 'StopFailure': {
        // Toast suppressed: these fire on every non-zero bash exit (file/grep/
        // ls of a missing path, etc.), which the user normally ignores. The
        // workspace error count badge in the sidebar still surfaces the tally,
        // and full details remain visible in the Fleet Dashboard.
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
