import type { AgentEvent } from '../types/agent';
import type { Disposable, Event } from 'vscode';

export interface AgentBackendAdapter extends Disposable {
  readonly id: string;
  readonly name: string;
  connect(workspaceId: string, workspaceRootPath: string): Promise<void>;
  disconnect(workspaceId: string): Promise<void>;
  onDidReceiveEvent: Event<AgentEvent>;
}
