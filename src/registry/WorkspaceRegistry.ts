import * as vscode from 'vscode';
import { IWorkspaceRegistry, WorkspaceRecord, WorkspaceRegistryData, BackendType, WorkspaceMode } from '../types/workspace';

export class WorkspaceRegistry implements IWorkspaceRegistry {
  private readonly registryUri: vscode.Uri;
  private workspaces: WorkspaceRecord[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<WorkspaceRecord[]>();

  /** Fires whenever the workspace list changes (add, remove, update) */
  public readonly onDidChange: vscode.Event<WorkspaceRecord[]> = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.registryUri = vscode.Uri.joinPath(context.globalStorageUri, 'workspaces.json');
  }

  /** Load registry data from disk. Must be called once after construction. */
  public async load(): Promise<void> {
    try {
      const raw = await vscode.workspace.fs.readFile(this.registryUri);
      const text = Buffer.from(raw).toString('utf-8');
      const data: WorkspaceRegistryData = JSON.parse(text);
      if (data.version === 1) {
        // v1 → v2 migration: add mode: 'local' to all existing records
        this.workspaces = data.workspaces.map(ws => ({
          ...ws,
          backendType: ws.backendType ?? 'claude-code',
          mode: 'local' as const,
        }));
        // Persist migrated data as v2
        await this.persist();
      } else if (data.version === 2) {
        this.workspaces = data.workspaces.map(ws => ({
          ...ws,
          backendType: ws.backendType ?? 'claude-code',
        }));
      } else {
        throw new Error(`Unsupported registry version: ${(data as { version: number }).version}`);
      }
    } catch (err: unknown) {
      // If file doesn't exist (FileNotFound), initialize with empty state
      if (
        err instanceof vscode.FileSystemError &&
        err.code === 'FileNotFound'
      ) {
        this.workspaces = [];
      } else if (
        err instanceof Error &&
        (err.message.includes('ENOENT') || err.message.includes('EntryNotFound'))
      ) {
        this.workspaces = [];
      } else {
        // Re-throw unexpected errors
        throw err;
      }
    }
  }

  /** Returns a shallow copy of all workspace records. */
  public getAll(): WorkspaceRecord[] {
    return [...this.workspaces];
  }

  /** Returns a workspace record by its UUID, or undefined if not found. */
  public getById(id: string): WorkspaceRecord | undefined {
    return this.workspaces.find(ws => ws.id === id);
  }

  /**
   * Add a new workspace to the registry.
   * Validates that rootPath is an absolute path (skipped for remote workspaces).
   * Rejects duplicates by rootPath (skipped for remote workspaces).
   */
  public async add(
    name: string,
    rootPath: string,
    backendType: BackendType = 'claude-code',
    options?: { mode?: WorkspaceMode; relayUrl?: string; channelId?: string; pollInterval?: number }
  ): Promise<WorkspaceRecord> {
    const isRemote = options?.mode === 'remote';

    if (!isRemote) {
      // Validate absolute path: starts with '/' (macOS/Linux) or drive letter (Windows)
      const isAbsolute = /^\//.test(rootPath) || /^[a-zA-Z]:\\/.test(rootPath);
      if (!isAbsolute) {
        throw new Error(`rootPath must be an absolute path, got: ${rootPath}`);
      }

      // Check for duplicate rootPath (local workspaces only)
      const existing = this.workspaces.find(ws => ws.rootPath === rootPath);
      if (existing) {
        throw new Error(`Workspace at path "${rootPath}" is already registered as "${existing.name}"`);
      }
    }

    const now = new Date().toISOString();

    // For remote workspaces, derive a sentinel rootPath from channelId
    const resolvedRootPath = isRemote
      ? 'remote://' + (options?.channelId ?? name)
      : rootPath;

    const record: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name,
      rootPath: resolvedRootPath,
      status: 'unknown',
      addedAt: now,
      lastUpdatedAt: now,
      runningAgentCount: 0,
      errorCount: 0,
      backendType: isRemote ? 'remote' : backendType,
      mode: options?.mode ?? 'local',
      ...(isRemote && {
        relayUrl: options?.relayUrl,
        channelId: options?.channelId,
        pollInterval: options?.pollInterval,
      }),
    };

    this.workspaces.push(record);
    await this.persist();
    this._onDidChange.fire(this.getAll());
    return record;
  }

  /**
   * Remove a workspace by id.
   * Throws if the id is not found.
   */
  public async remove(id: string): Promise<void> {
    const index = this.workspaces.findIndex(ws => ws.id === id);
    if (index === -1) {
      throw new Error(`Workspace with id "${id}" not found in registry`);
    }
    this.workspaces.splice(index, 1);
    await this.persist();
    this._onDidChange.fire(this.getAll());
  }

  /**
   * Update status fields for a workspace.
   * Sets lastUpdatedAt to current timestamp.
   */
  public async update(
    id: string,
    changes: Partial<Pick<WorkspaceRecord, 'name' | 'status' | 'runningAgentCount' | 'errorCount' | 'backendType' | 'mode' | 'relayUrl' | 'pollInterval' | 'lastCursor' | 'lastMessageCursor'>>
  ): Promise<void> {
    const record = this.workspaces.find(ws => ws.id === id);
    if (!record) {
      throw new Error(`Workspace with id "${id}" not found in registry`);
    }
    Object.assign(record, changes, { lastUpdatedAt: new Date().toISOString() });
    await this.persist();
    this._onDidChange.fire(this.getAll());
  }

  /** Serialize registry to JSON and write to globalStorageUri. */
  private async persist(): Promise<void> {
    // Ensure the parent directory exists
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);

    const data: WorkspaceRegistryData = {
      version: 2,
      workspaces: this.workspaces,
    };
    const json = JSON.stringify(data, null, 2);
    const bytes = Buffer.from(json, 'utf-8');
    await vscode.workspace.fs.writeFile(this.registryUri, bytes);
  }
}
