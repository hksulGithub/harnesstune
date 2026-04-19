/** Status of an agent workspace */
export type WorkspaceStatus = 'running' | 'idle' | 'warning' | 'error' | 'unknown';

/** Backend adapter type for a workspace */
export type BackendType = 'claude-code' | 'openclaw';

/** A workspace record stored in the registry JSON file */
export interface WorkspaceRecord {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Human-readable workspace name */
  name: string;
  /** Absolute path to the agent workspace directory */
  rootPath: string;
  /** Current status of the workspace */
  status: WorkspaceStatus;
  /** ISO 8601 timestamp when workspace was added to registry */
  addedAt: string;
  /** ISO 8601 timestamp of last status update */
  lastUpdatedAt: string;
  /** Number of currently running agents in this workspace */
  runningAgentCount: number;
  /** Number of errors since last clear */
  errorCount: number;
  /** Backend adapter type for this workspace */
  backendType: BackendType;
  /** Optional connection config (host/port); authToken stored separately in SecretStore */
  connectionConfig?: {
    host?: string;
    port?: number;
  };
}

/** Shape of the registry JSON file stored at globalStorageUri */
export interface WorkspaceRegistryData {
  version: 1;
  workspaces: WorkspaceRecord[];
}

/** Interface for workspace registry operations */
export interface IWorkspaceRegistry {
  getAll(): WorkspaceRecord[];
  getById(id: string): WorkspaceRecord | undefined;
  add(name: string, rootPath: string, backendType?: BackendType): Promise<WorkspaceRecord>;
  remove(id: string): Promise<void>;
  update(id: string, changes: Partial<Pick<WorkspaceRecord, 'status' | 'runningAgentCount' | 'errorCount'>>): Promise<void>;
  onDidChange: import('vscode').Event<WorkspaceRecord[]>;
}
