import type { AgentBackendAdapter } from './AgentBackendAdapter';

export type BackendType = 'claude-code' | 'openclaw';

export interface WorkspaceConnectionConfig {
  backendType: BackendType;
  host: string;        // defaults to 'localhost'
  port?: number;
  authToken?: string;  // from SecretStore at runtime, NOT stored in WorkspaceRecord
}

export interface AdapterFactory {
  createAdapter(config: WorkspaceConnectionConfig): AgentBackendAdapter;
}
