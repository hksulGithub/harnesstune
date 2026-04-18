import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as crypto from 'crypto';
import { StreamJsonParser } from './StreamJsonParser';
import { OutputFormatter } from './OutputFormatter';
import type {
  StreamJsonEvent,
  TerminalSessionState,
} from './types';
import type { AgentEvent, AgentEventType, AgentTokenUsage } from '../types/agent';

export interface ClaudeCodeTerminalOptions {
  dangerouslySkipPermissions?: boolean;
  onEvent?: (event: AgentEvent) => void;
}

/**
 * VSCode Pseudoterminal implementation that spawns `claude --output-format stream-json`
 * as a child process, parses the newline-delimited JSON output, and renders formatted
 * text into the terminal.
 */
export class ClaudeCodeTerminal implements vscode.Pseudoterminal {
  // ── Pseudoterminal events ──────────────────────────────────────────────────
  private readonly _onDidWrite = new vscode.EventEmitter<string>();
  readonly onDidWrite = this._onDidWrite.event;

  private readonly _onDidClose = new vscode.EventEmitter<number | void>();
  readonly onDidClose = this._onDidClose.event;

  // ── Private state ──────────────────────────────────────────────────────────
  private process: child_process.ChildProcess | null = null;
  private parser = new StreamJsonParser();
  private state: TerminalSessionState = 'idle';
  private inputBuffer = '';
  private sessionId = '';

  constructor(
    private readonly workspaceId: string,
    private readonly workspaceName: string,
    private readonly workspaceRootPath: string,
    private readonly options?: ClaudeCodeTerminalOptions,
  ) {}

  // ── Pseudoterminal interface ────────────────────────────────────────────────

  open(_initialDimensions?: vscode.TerminalDimensions): void {
    this._onDidWrite.fire(OutputFormatter.formatPrompt(this.workspaceName));
    this._onDidWrite.fire(OutputFormatter.formatInputPrefix());
    this.state = 'idle';
  }

  handleInput(data: string): void {
    switch (data) {
      case '\r': // Enter
        this.handleEnter();
        break;

      case '\x7f': // Backspace
        if (this.inputBuffer.length > 0) {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          // Move cursor back, overwrite with space, move back again
          this._onDidWrite.fire('\x1b[D \x1b[D');
        }
        break;

      case '\x03': // Ctrl+C
        if (this.process && !this.process.killed) {
          this.process.kill('SIGINT');
        }
        break;

      default:
        // Regular character input
        this.inputBuffer += data;
        this._onDidWrite.fire(data);
        break;
    }
  }

  close(): void {
    this.killProcess();
    this.parser.reset();
  }

  // ── Public accessors ────────────────────────────────────────────────────────

  /** Returns the PID of the child process, if running. */
  getProcessPid(): number | undefined {
    return this.process?.pid;
  }

  /** Dispose emitters and kill the child process. */
  dispose(): void {
    this.close();
    this._onDidWrite.dispose();
    this._onDidClose.dispose();
  }

  // ── Private methods ─────────────────────────────────────────────────────────

  private handleEnter(): void {
    if (this.state === 'idle' || this.state === 'ended') {
      this._onDidWrite.fire('\r\n');
      this.startSession();
      return;
    }

    if (this.state === 'active') {
      const line = this.inputBuffer.trim();
      this.inputBuffer = '';
      this._onDidWrite.fire('\r\n');

      if (line.length > 0 && this.process?.stdin?.writable) {
        this.process.stdin.write(line + '\n');
        this._onDidWrite.fire('\x1b[2mThinking...\x1b[0m\r\n');
      }
    }
  }

  private startSession(): void {
    this.state = 'starting';
    this.parser.reset();
    this.sessionId = '';
    this.inputBuffer = '';

    this._onDidWrite.fire('\x1b[2mStarting Claude Code session...\x1b[0m\r\n');

    const args = ['--output-format', 'stream-json'];
    if (this.options?.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    try {
      this.process = child_process.spawn('claude', args, {
        cwd: this.workspaceRootPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._onDidWrite.fire(`\x1b[1;31mFailed to start Claude Code: ${msg}\x1b[0m\r\n`);
      this.state = 'ended';
      this.showRestartPrompt();
      return;
    }

    this.state = 'active';

    // ── stdout → parser → formatter → terminal ──────────────────────────────
    this.process.stdout?.on('data', (chunk: Buffer) => {
      const events = this.parser.feed(chunk.toString());
      for (const event of events) {
        // Capture session_id from system or result events
        this.captureSessionId(event);

        // Render to terminal
        const formatted = OutputFormatter.format(event);
        if (formatted) {
          this._onDidWrite.fire(formatted);
        }

        // Emit normalized event for pipeline integration
        if (this.options?.onEvent) {
          this.options.onEvent(this.normalizeStreamEvent(event));
        }
      }
    });

    // ── stderr → red text ───────────────────────────────────────────────────
    this.process.stderr?.on('data', (chunk: Buffer) => {
      this._onDidWrite.fire(`\x1b[31m${chunk.toString()}\x1b[0m`);
    });

    // ── Process exit ────────────────────────────────────────────────────────
    this.process.on('close', (code) => {
      const reason = code === 0 ? 'completed' : `exit code ${code}`;
      this._onDidWrite.fire(OutputFormatter.formatSessionEnd(reason));
      this.state = 'ended';
      this.process = null;
      this.showRestartPrompt();
    });

    this.process.on('error', (err) => {
      this._onDidWrite.fire(`\x1b[1;31mProcess error: ${err.message}\x1b[0m\r\n`);
      this.state = 'ended';
      this.process = null;
      this.showRestartPrompt();
    });
  }

  private showRestartPrompt(): void {
    this._onDidWrite.fire('\x1b[2mPress Enter to start a new session...\x1b[0m\r\n');
    this._onDidWrite.fire(OutputFormatter.formatInputPrefix());
  }

  private captureSessionId(event: StreamJsonEvent): void {
    if (this.sessionId) { return; }
    if (event.type === 'system' && event.session_id) {
      this.sessionId = event.session_id;
    } else if (event.type === 'result' && event.session_id) {
      this.sessionId = event.session_id;
    }
  }

  private killProcess(): void {
    if (!this.process || this.process.killed) { return; }

    const proc = this.process;
    proc.kill('SIGTERM');

    // Force kill after 3 seconds if still alive
    const forceKillTimer = setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 3000);

    proc.on('close', () => {
      clearTimeout(forceKillTimer);
    });

    this._onDidClose.fire();
  }

  /**
   * Normalize a stream-JSON event into the shared AgentEvent type,
   * following the same pattern as ClaudeCodeHookAdapter.normalizeEvent().
   */
  private normalizeStreamEvent(event: StreamJsonEvent): AgentEvent {
    const effectiveSessionId = this.sessionId || 'unknown';

    let eventType: AgentEventType;
    let toolName: string | undefined;
    let toolInput: unknown;
    let tokenUsage: AgentTokenUsage | undefined;
    let error: string | undefined;

    switch (event.type) {
      case 'system':
        eventType = 'SessionStart';
        break;

      case 'assistant':
        // Assistant events carry text; no specific lifecycle mapping.
        // Use SessionStart for consistency (first event from the model).
        eventType = 'SessionStart';
        break;

      case 'tool_use':
        eventType = 'PreToolUse';
        toolName = event.name;
        toolInput = event.input;
        break;

      case 'tool_result':
        eventType = event.is_error ? 'PostToolUseFailure' : 'PostToolUse';
        break;

      case 'result':
        eventType = 'SessionEnd';
        tokenUsage = {
          inputTokens: event.usage.input_tokens,
          outputTokens: event.usage.output_tokens,
          cacheReadTokens: event.usage.cache_read_input_tokens,
        };
        break;

      case 'error':
        eventType = 'StopFailure';
        error = event.error.message;
        break;

      default:
        eventType = 'SessionStart';
        break;
    }

    return {
      id: crypto.randomUUID(),
      workspaceId: this.workspaceId,
      sessionId: effectiveSessionId,
      agentId: effectiveSessionId,
      eventType,
      timestamp: Date.now(),
      toolName,
      toolInput,
      tokenUsage,
      error,
      raw: event,
    };
  }
}
