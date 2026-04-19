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
 * VSCode Pseudoterminal implementation that spawns `claude -p` per turn.
 *
 * Each user message spawns a new `claude -p "message" --output-format stream-json --verbose`
 * process. Follow-up turns use `--resume sessionId` to continue the conversation.
 * This avoids the hanging issue with `--input-format stream-json`.
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
        // Regular character input — only accept when not running a turn
        if (this.state !== 'starting') {
          this.inputBuffer += data;
          this._onDidWrite.fire(data);
        }
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
    const line = this.inputBuffer.trim();
    this.inputBuffer = '';
    this._onDidWrite.fire('\r\n');

    if (this.state === 'idle' || this.state === 'ended') {
      if (line.length === 0) {
        // Bare Enter on idle/ended — show instructions
        this._onDidWrite.fire('\x1b[2mType a message and press Enter to start a session.\x1b[0m\r\n');
        this._onDidWrite.fire(OutputFormatter.formatInputPrefix());
        return;
      }
      // First message — start a new session
      this.sendTurn(line);
      return;
    }

    if (this.state === 'active') {
      if (line.length === 0) {
        this._onDidWrite.fire(OutputFormatter.formatInputPrefix());
        return;
      }
      // Follow-up message — resume session
      this.sendTurn(line);
    }
  }

  /**
   * Spawn a `claude -p "message"` process for a single turn.
   * Uses `--resume sessionId` for follow-up turns.
   */
  private sendTurn(message: string): void {
    this.state = 'starting';
    this.parser.reset();

    this._onDidWrite.fire('\x1b[2mThinking...\x1b[0m\r\n');

    // Resolve claude binary path from the extension host's PATH (which has NVM).
    // Avoids picking up stale global installs (e.g. /opt/homebrew/bin/claude).
    const claudePath = ClaudeCodeTerminal.resolveClaudePath();
    const args = [
      '-p', message,
      '--verbose',
      '--output-format', 'stream-json',
    ];
    if (this.sessionId) {
      args.push('--resume', this.sessionId);
    }
    if (this.options?.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    try {
      this.process = child_process.spawn(claudePath, args, {
        cwd: this.workspaceRootPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._onDidWrite.fire(`\x1b[1;31mFailed to start Claude Code: ${msg}\x1b[0m\r\n`);
      this.state = this.sessionId ? 'active' : 'ended';
      this._onDidWrite.fire(OutputFormatter.formatInputPrefix());
      return;
    }

    // ── stdout → parser → formatter → terminal ──────────────────────────────
    this.process.stdout?.on('data', (chunk: Buffer) => {
      const events = this.parser.feed(chunk.toString());
      for (const event of events) {
        this.captureSessionId(event);

        const formatted = OutputFormatter.format(event);
        if (formatted) {
          this._onDidWrite.fire(formatted);
        }

        if (this.options?.onEvent) {
          this.options.onEvent(this.normalizeStreamEvent(event));
        }
      }
    });

    // ── stderr → red text ───────────────────────────────────────────────────
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        this._onDidWrite.fire(`\x1b[31m${text}\x1b[0m\r\n`);
      }
    });

    // ── Process exit ────────────────────────────────────────────────────────
    this.process.on('close', (code) => {
      this.process = null;

      if (code === 0) {
        // Turn completed successfully — ready for next input
        this.state = 'active';
        this._onDidWrite.fire(OutputFormatter.formatInputPrefix());
      } else {
        // Error exit
        this._onDidWrite.fire(`\x1b[2m--- Turn ended with exit code ${code} ---\x1b[0m\r\n`);
        this.state = this.sessionId ? 'active' : 'ended';
        this._onDidWrite.fire(OutputFormatter.formatInputPrefix());
      }
    });

    this.process.on('error', (err) => {
      this._onDidWrite.fire(`\x1b[1;31mProcess error: ${err.message}\x1b[0m\r\n`);
      this.state = this.sessionId ? 'active' : 'ended';
      this.process = null;
      this._onDidWrite.fire(OutputFormatter.formatInputPrefix());
    });
  }

  /**
   * Resolve the full path to the `claude` binary using the extension host's PATH.
   * Falls back to 'claude' (bare name) if `which` fails.
   */
  private static resolveClaudePath(): string {
    try {
      return child_process.execSync('which claude', {
        encoding: 'utf-8',
        env: { ...process.env },
      }).trim();
    } catch {
      return 'claude';
    }
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
   * Normalize a stream-JSON event into the shared AgentEvent type.
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
