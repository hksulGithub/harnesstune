import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import type { AgentEvent, AgentEventType } from '../types/agent';
import type { OpenClawEvent } from '../types/openclaw';
import type { ChatMessage, SessionState } from './ClaudeSession';

const TYPE_MAP: Record<string, AgentEventType> = {
  session_start: 'SessionStart',
  session_end: 'SessionEnd',
  tool_use: 'PreToolUse',
  tool_result: 'PostToolUse',
};

/**
 * Read-only log viewer session for OpenClaw workspaces.
 * Tails JSONL files and emits chat-style messages.
 * sendMessage() is a no-op -- this is a log viewer, not interactive chat.
 */
export class OpenClawLogSession extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private offsets = new Map<string, number>();
  private _state: SessionState = 'idle';
  private _sessionId: string;
  private _messages: ChatMessage[] = [];

  constructor(
    private readonly workspaceId: string,
    private readonly workspaceName: string,
    private readonly _workspaceRootPath: string,
  ) {
    super();
    this._sessionId = `openclaw-log-${crypto.randomUUID().slice(0, 8)}`;
  }

  get state(): SessionState { return this._state; }
  get sessionId(): string { return this._sessionId; }
  get messages(): ReadonlyArray<ChatMessage> { return this._messages; }

  /** Start tailing JSONL files */
  start(): void {
    if (this._state !== 'idle') { return; }
    this._state = 'active';
    this.emit('stateChange', this._state);

    const watchDir = path.join(os.homedir(), '.harnesstune', 'openclaw');
    const pattern = path.join(watchDir, '**', 'events.jsonl');

    this.watcher = chokidar.watch(pattern, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    this.watcher.on('add', (filePath: string) => this.readIncremental(filePath));
    this.watcher.on('change', (filePath: string) => this.readIncremental(filePath));
  }

  /** No-op -- log viewer does not support interactive input */
  sendMessage(_text: string): void {
    // Intentional no-op: OpenClaw log viewer is read-only
  }

  /** Interrupt -- no-op for log viewer */
  interrupt(): void {
    // No process to interrupt
  }

  private readIncremental(filePath: string): void {
    let offset = this.offsets.get(filePath) ?? 0;
    let data: Buffer;
    try {
      const fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      if (stat.size <= offset) { fs.closeSync(fd); return; }
      data = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, data, 0, data.length, offset);
      fs.closeSync(fd);
      this.offsets.set(filePath, stat.size);
    } catch { return; }

    const lines = data.toString('utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      try {
        const raw: OpenClawEvent = JSON.parse(trimmed);
        // Emit as chat message
        const msg: ChatMessage = {
          role: 'system',
          content: `[${raw.type}] ${raw.agent_id}: ${JSON.stringify(raw.data ?? {})}`,
          timestamp: Date.now(),
        };
        this._messages.push(msg);
        this.emit('message', msg);

        // Emit as agent event for the pipeline
        const eventType = TYPE_MAP[raw.type] ?? 'SessionStart';
        const tsRaw = raw.timestamp;
        const timestamp = tsRaw ? (Date.parse(tsRaw) || Date.now()) : Date.now();
        const agentEvent: AgentEvent = {
          id: crypto.randomUUID(),
          sessionId: raw.agent_id || this._sessionId,
          agentId: raw.agent_id || this._sessionId,
          workspaceId: this.workspaceId,
          eventType,
          timestamp,
          raw,
        };
        this.emit('agentEvent', agentEvent);
      } catch {
        // skip malformed lines
      }
    }
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
    }
    this._state = 'ended';
    this.emit('stateChange', this._state);
  }
}
