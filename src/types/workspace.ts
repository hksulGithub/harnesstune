/** Status of an agent workspace */
export type WorkspaceStatus = 'running' | 'idle' | 'warning' | 'error' | 'stale' | 'relay_unreachable' | 'auth_error' | 'unknown';

/** Backend adapter type for a workspace */
export type BackendType = 'claude-code' | 'openclaw' | 'remote';

/** Whether the workspace is local or remote */
export type WorkspaceMode = 'local' | 'remote';

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
  /** Whether this workspace is local or remote */
  mode: WorkspaceMode;
  /** Optional connection config (host/port); authToken stored separately in SecretStore */
  connectionConfig?: {
    host?: string;
    port?: number;
  };
  /** Relay URL for remote workspaces (e.g., 'https://harnesstune-relay.vercel.app/api') */
  relayUrl?: string;
  /** Channel ID on the relay for this workspace */
  channelId?: string;
  /** Polling interval in milliseconds (default 30000) */
  pollInterval?: number;
  /** ISO 8601 cursor for incremental report fetching */
  lastCursor?: string;
}

/** Shape of the registry JSON file stored at globalStorageUri */
export interface WorkspaceRegistryData {
  version: 1 | 2;
  workspaces: WorkspaceRecord[];
}

/** Interface for workspace registry operations */
export interface IWorkspaceRegistry {
  getAll(): WorkspaceRecord[];
  getById(id: string): WorkspaceRecord | undefined;
  add(name: string, rootPath: string, backendType?: BackendType, options?: { mode?: WorkspaceMode; relayUrl?: string; channelId?: string; pollInterval?: number }): Promise<WorkspaceRecord>;
  remove(id: string): Promise<void>;
  update(id: string, changes: Partial<Pick<WorkspaceRecord, 'status' | 'runningAgentCount' | 'errorCount' | 'backendType' | 'mode' | 'relayUrl' | 'pollInterval' | 'lastCursor'>>): Promise<void>;
  onDidChange: import('vscode').Event<WorkspaceRecord[]>;
}

/** Compile-time exhaustiveness check — pass a `never` value to trigger TS error */
export function assertNeverBackendType(x: never): never {
  throw new Error(`Unexpected BackendType: ${x}`);
}
