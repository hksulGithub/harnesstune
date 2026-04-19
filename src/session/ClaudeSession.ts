import * as child_process from 'child_process';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { StreamJsonParser } from '../terminal/StreamJsonParser';
import type { StreamJsonEvent } from '../terminal/types';
import type { AgentEvent, AgentEventType, AgentTokenUsage } from '../types/agent';

export type SessionState = 'idle' | 'starting' | 'active' | 'ended';

export interface ClaudeSessionOptions {
  dangerouslySkipPermissions?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  content: string;
  toolName?: string;
  toolInput?: string;
  isError?: boolean;
  timestamp: number;
}

/**
 * Headless Claude Code session — spawns `claude -p` per turn, parses stream-JSON,
 * and emits structured events. No terminal/UI coupling.
 */
export class ClaudeSession extends EventEmitter {
  private process: child_process.ChildProcess | null = null;
  private parser = new StreamJsonParser();
  private _state: SessionState = 'idle';
  private _sessionId = '';
  private _messages: ChatMessage[] = [];

  constructor(
    private readonly workspaceId: string,
    private readonly workspaceName: string,
    private readonly workspaceRootPath: string,
    private readonly options?: ClaudeSessionOptions,
  ) {
    super();
  }

  get state(): SessionState { return this._state; }
  get sessionId(): string { return this._sessionId; }
  get messages(): ReadonlyArray<ChatMessage> { return this._messages; }

  /**
   * Send a user message. Spawns `claude -p "message"` (with `--resume` for follow-ups).
   * Emits 'message' for each chat message, 'agentEvent' for pipeline events,
   * 'stateChange' on state transitions.
   */
  sendMessage(text: string): void {
    if (this._state === 'starting') { return; }

    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    this._messages.push(userMsg);
    this.emit('message', userMsg);

    this.spawnTurn(text);
  }

  /** Interrupt the current turn. */
  interrupt(): void {
    this.killProcess();
  }

  /** Kill and clean up. */
  dispose(): void {
    this.killProcess();
    this.parser.reset();
    this.removeAllListeners();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private setState(next: SessionState): void {
    if (this._state === next) { return; }
    this._state = next;
    this.emit('stateChange', next);
  }

  private spawnTurn(message: string): void {
    this.setState('starting');
    this.parser.reset();

    const thinkingMsg: ChatMessage = { role: 'system', content: 'Thinking...', timestamp: Date.now() };
    this._messages.push(thinkingMsg);
    this.emit('message', thinkingMsg);

    const claudePath = ClaudeSession.resolveClaudePath();
    const args = ['-p', message, '--verbose', '--output-format', 'stream-json'];
    if (this._sessionId) { args.push('--resume', this._sessionId); }
    if (this.options?.dangerouslySkipPermissions) { args.push('--dangerously-skip-permissions'); }

    try {
      this.process = child_process.spawn(claudePath, args, {
        cwd: this.workspaceRootPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errMsg: ChatMessage = { role: 'error', content: `Failed to start Claude Code: ${msg}`, timestamp: Date.now() };
      this._messages.push(errMsg);
      this.emit('message', errMsg);
      this.setState(this._sessionId ? 'active' : 'ended');
      return;
    }

    this.process.stdout?.on('data', (chunk: Buffer) => {
      const events = this.parser.feed(chunk.toString());
      for (const event of events) {
        this.captureSessionId(event);
        this.processStreamEvent(event);
        this.emit('agentEvent', this.normalizeStreamEvent(event));
      }
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        const errMsg: ChatMessage = { role: 'error', content: text, timestamp: Date.now() };
        this._messages.push(errMsg);
        this.emit('message', errMsg);
      }
    });

    this.process.on('close', (code) => {
      this.process = null;
      // Remove the "Thinking..." placeholder
      const thinkIdx = this._messages.lastIndexOf(thinkingMsg);
      if (thinkIdx !== -1 && this._messages[thinkIdx] === thinkingMsg) {
        this._messages.splice(thinkIdx, 1);
      }

      if (code === 0) {
        this.setState('active');
      } else {
        const errMsg: ChatMessage = {
          role: 'system',
          content: `Turn ended with exit code ${code}`,
          timestamp: Date.now(),
        };
        this._messages.push(errMsg);
        this.emit('message', errMsg);
        this.setState(this._sessionId ? 'active' : 'ended');
      }
      this.emit('turnComplete');
    });

    this.process.on('error', (err) => {
      const errMsg: ChatMessage = { role: 'error', content: `Process error: ${err.message}`, timestamp: Date.now() };
      this._messages.push(errMsg);
      this.emit('message', errMsg);
      this.setState(this._sessionId ? 'active' : 'ended');
      this.process = null;
      this.emit('turnComplete');
    });
  }

  private processStreamEvent(event: StreamJsonEvent): void {
    switch (event.type) {
      case 'assistant': {
        for (const block of event.message.content) {
          if (block.type === 'text') {
            const msg: ChatMessage = { role: 'assistant', content: block.text, timestamp: Date.now() };
            this._messages.push(msg);
            this.emit('message', msg);
          }
        }
        break;
      }
      case 'tool_use': {
        const summary = this.summarizeInput(event.input);
        const msg: ChatMessage = {
          role: 'tool',
          content: summary,
          toolName: event.name,
          toolInput: typeof event.input === 'string' ? event.input : JSON.stringify(event.input),
          timestamp: Date.now(),
        };
        this._messages.push(msg);
        this.emit('message', msg);
        break;
      }
      case 'tool_result': {
        if (event.is_error) {
          const preview = event.content.length > 200
            ? event.content.slice(0, 200) + '...'
            : event.content;
          const msg: ChatMessage = { role: 'error', content: preview, isError: true, timestamp: Date.now() };
          this._messages.push(msg);
          this.emit('message', msg);
        }
        break;
      }
      case 'error': {
        const msg: ChatMessage = { role: 'error', content: event.error.message, timestamp: Date.now() };
        this._messages.push(msg);
        this.emit('message', msg);
        break;
      }
      case 'system': {
        if (event.message) {
          const msg: ChatMessage = { role: 'system', content: event.message, timestamp: Date.now() };
          this._messages.push(msg);
          this.emit('message', msg);
        }
        break;
      }
      // 'result' events are suppressed (usage/cost)
    }
  }

  private captureSessionId(event: StreamJsonEvent): void {
    if (this._sessionId) { return; }
    if (event.type === 'system' && event.session_id) {
      this._sessionId = event.session_id;
    } else if (event.type === 'result' && event.session_id) {
      this._sessionId = event.session_id;
    }
  }

  private killProcess(): void {
    if (!this.process || this.process.killed) { return; }
    const proc = this.process;
    proc.kill('SIGTERM');
    const timer = setTimeout(() => { if (!proc.killed) { proc.kill('SIGKILL'); } }, 3000);
    proc.on('close', () => clearTimeout(timer));
  }

  private summarizeInput(input: unknown): string {
    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      if (typeof obj.file_path === 'string') { return obj.file_path; }
      if (typeof obj.path === 'string') { return obj.path; }
      if (typeof obj.command === 'string') {
        return obj.command.length > 60 ? obj.command.slice(0, 60) + '...' : obj.command;
      }
    }
    const raw = JSON.stringify(input);
    return raw.length > 80 ? raw.slice(0, 80) + '...' : raw;
  }

  private normalizeStreamEvent(event: StreamJsonEvent): AgentEvent {
    const effectiveSessionId = this._sessionId || 'unknown';
    let eventType: AgentEventType;
    let toolName: string | undefined;
    let toolInput: unknown;
    let tokenUsage: AgentTokenUsage | undefined;
    let error: string | undefined;

    switch (event.type) {
      case 'system': eventType = 'SessionStart'; break;
      case 'assistant': eventType = 'SessionStart'; break;
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
      default: eventType = 'SessionStart'; break;
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
}
