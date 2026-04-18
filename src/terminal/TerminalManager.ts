import * as vscode from 'vscode';
import { ClaudeCodeTerminal } from './ClaudeCodeTerminal';
import type { AgentEvent } from '../types/agent';

export interface TerminalManagerOpenOptions {
  dangerouslySkipPermissions?: boolean;
}

interface TerminalEntry {
  terminal: vscode.Terminal;
  pty: ClaudeCodeTerminal;
}

/**
 * Maps workspaceId to vscode.Terminal instances backed by ClaudeCodeTerminal pseudoterminals.
 * Manages terminal lifecycle: creation, show/focus, dispose, and cleanup on close.
 */
export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, TerminalEntry>();
  private readonly closeListener: vscode.Disposable;

  constructor(private readonly onEvent: (event: AgentEvent) => void) {
    // Listen for terminal close events to clean up our map
    this.closeListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
      for (const [workspaceId, entry] of this.terminals) {
        if (entry.terminal === closedTerminal) {
          entry.pty.dispose();
          this.terminals.delete(workspaceId);
          break;
        }
      }
    });
  }

  /**
   * Open (or focus) a terminal for the given workspace.
   * - If a terminal already exists and is still open: show/focus it.
   * - If a terminal exists but was closed: remove stale entry, create new.
   * - Otherwise: create a new terminal.
   */
  openTerminal(
    workspaceId: string,
    workspaceName: string,
    workspaceRootPath: string,
    options?: TerminalManagerOpenOptions,
  ): void {
    const existing = this.terminals.get(workspaceId);

    if (existing) {
      // Terminal still alive (exitStatus is undefined while open)
      if (existing.terminal.exitStatus === undefined) {
        existing.terminal.show();
        return;
      }
      // Terminal was closed — clean up stale entry
      existing.pty.dispose();
      this.terminals.delete(workspaceId);
    }

    // Create new pseudoterminal and wrap in native VSCode terminal
    const pty = new ClaudeCodeTerminal(workspaceId, workspaceName, workspaceRootPath, {
      dangerouslySkipPermissions: options?.dangerouslySkipPermissions,
      onEvent: this.onEvent,
    });

    const terminal = vscode.window.createTerminal({
      name: `HarnessTune: ${workspaceName}`,
      pty,
    });

    this.terminals.set(workspaceId, { terminal, pty });
    terminal.show();
  }

  /** Returns the terminal entry for a workspace, or undefined. */
  getTerminal(workspaceId: string): TerminalEntry | undefined {
    return this.terminals.get(workspaceId);
  }

  /** Dispose all terminals: kill child processes, dispose pseudoterminals, clear map. */
  disposeAll(): void {
    for (const [, entry] of this.terminals) {
      entry.pty.dispose();
      entry.terminal.dispose();
    }
    this.terminals.clear();
  }

  dispose(): void {
    this.disposeAll();
    this.closeListener.dispose();
  }
}
