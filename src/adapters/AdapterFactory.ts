import type { AgentBackendAdapter } from './AgentBackendAdapter';
import type { BackendType } from '../types/workspace';

export type { BackendType } from '../types/workspace';

export interface WorkspaceConnectionConfig {
  backendType: BackendType;
  host: string;        // defaults to 'localhost'
  port?: number;
  authToken?: string;  // from SecretStore at runtime, NOT stored in WorkspaceRecord
}

export interface AdapterFactory {
  createAdapter(config: WorkspaceConnectionConfig): AgentBackendAdapter;
}
