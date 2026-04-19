import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'vscode';
import type { AgentBackendAdapter } from './AgentBackendAdapter';
import type { AgentEvent, AgentEventType } from '../types/agent';
import type { OpenClawEvent } from '../types/openclaw';

const TYPE_MAP: Record<string, AgentEventType> = {
  session_start: 'SessionStart',
  session_end: 'SessionEnd',
  tool_use: 'PreToolUse',
  tool_result: 'PostToolUse',
};

export class OpenClawAdapter implements AgentBackendAdapter {
  readonly id = 'openclaw';
  readonly name = 'OpenClaw';

  private readonly _onDidReceiveEvent = new EventEmitter<AgentEvent>();
  readonly onDidReceiveEvent = this._onDidReceiveEvent.event;

  private watchers = new Map<string, chokidar.FSWatcher>();
  private offsets = new Map<string, number>(); // absolute filePath -> last byte offset

  async connect(workspaceId: string, _workspaceRootPath: string): Promise<void> {
    if (this.watchers.has(workspaceId)) { return; } // idempotent
    const watchDir = path.join(os.homedir(), '.harnesstune', 'openclaw');
    const pattern = path.join(watchDir, '**', 'events.jsonl');

    const watcher = chokidar.watch(pattern, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    watcher.on('add', (filePath: string) => this.readIncremental(workspaceId, filePath));
    watcher.on('change', (filePath: string) => this.readIncremental(workspaceId, filePath));

    this.watchers.set(workspaceId, watcher);
  }

  async disconnect(workspaceId: string): Promise<void> {
    const watcher = this.watchers.get(workspaceId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(workspaceId);
    }
  }

  /** Read from last byte offset to EOF, parse each complete line as JSON */
  readIncremental(workspaceId: string, filePath: string): void {
    let offset = this.offsets.get(filePath) ?? 0;
    let data: Buffer;
    try {
      const fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      if (stat.size <= offset) {
        fs.closeSync(fd);
        return;
      }
      data = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, data, 0, data.length, offset);
      fs.closeSync(fd);
      this.offsets.set(filePath, stat.size);
    } catch {
      return; // file deleted or inaccessible -- skip silently
    }

    const text = data.toString('utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      try {
        const raw: OpenClawEvent = JSON.parse(trimmed);
        const event = this.normalizeEvent(workspaceId, raw);
        this._onDidReceiveEvent.fire(event);
      } catch {
        // Malformed JSON line -- skip silently (same pattern as StreamJsonParser)
      }
    }
  }

  /** Map OpenClawEvent to AgentEvent */
  normalizeEvent(workspaceId: string, raw: OpenClawEvent): AgentEvent {
    const eventType = TYPE_MAP[raw.type];
    if (!eventType) {
      console.warn('OpenClawAdapter: unknown event type, defaulting to SessionStart:', raw.type);
    }
    const agentId = raw.agent_id || `openclaw-${crypto.randomUUID()}`;
    const tsRaw = raw.timestamp;
    const timestamp = tsRaw ? (Date.parse(tsRaw) || Date.now()) : Date.now();

    return {
      id: crypto.randomUUID(),
      sessionId: agentId,
      agentId,
      workspaceId,
      eventType: eventType ?? 'SessionStart',
      timestamp,
      raw,
    };
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close().catch(() => {});
    }
    this.watchers.clear();
    this.offsets.clear();
    this._onDidReceiveEvent.dispose();
  }
}
