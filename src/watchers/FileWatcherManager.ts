import * as vscode from 'vscode';
import { WorkspaceRecord } from '../types/workspace';

export class FileWatcherManager {
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly _onDidWorkspaceChange = new vscode.EventEmitter<string>();

  /** Fires the workspace id when a file change is detected (debounced 500ms). */
  public readonly onDidWorkspaceChange: vscode.Event<string> = this._onDidWorkspaceChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Start watching a workspace directory for file changes.
   * Uses RelativePattern with an absolute base Uri to avoid glob ambiguity.
   */
  public watchWorkspace(workspace: WorkspaceRecord): void {
    // Avoid creating duplicate watchers
    if (this.watchers.has(workspace.id)) {
      return;
    }

    const base = vscode.Uri.file(workspace.rootPath);
    const pattern = new vscode.RelativePattern(base, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const handler = () => this.handleFileChanged(workspace.id);
    watcher.onDidChange(handler);
    watcher.onDidCreate(handler);
    watcher.onDidDelete(handler);

    this.watchers.set(workspace.id, watcher);
    this.context.subscriptions.push(watcher);
  }

  /**
   * Stop watching a workspace and clean up resources.
   */
  public unwatchWorkspace(workspaceId: string): void {
    const watcher = this.watchers.get(workspaceId);
    if (watcher) {
      watcher.dispose();
      this.watchers.delete(workspaceId);
    }

    const timer = this.debounceTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(workspaceId);
    }
  }

  /** Dispose all watchers and timers. */
  public dispose(): void {
    for (const id of this.watchers.keys()) {
      this.unwatchWorkspace(id);
    }
    this._onDidWorkspaceChange.dispose();
  }

  /**
   * Debounced file change handler.
   * Resets 500ms timer on each event; fires only after activity settles.
   */
  private handleFileChanged(workspaceId: string): void {
    const existing = this.debounceTimers.get(workspaceId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(workspaceId);
      this._onDidWorkspaceChange.fire(workspaceId);
    }, 500);
    this.debounceTimers.set(workspaceId, timer);
  }
}
