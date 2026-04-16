import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'vscode';
import type { AgentEvent, AgentEventType, AgentTokenUsage } from '../types/agent';
import type { AgentBackendAdapter } from './AgentBackendAdapter';
import { HookServer } from '../server/HookServer';

interface HarnessHookEntry {
  type: 'http';
  url: string;
  timeout: number;
  _harnesstune: true;
}

export class ClaudeCodeHookAdapter implements AgentBackendAdapter {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';

  private hookServer: HookServer;
  private settingsPath: string;
  private connectedWorkspaces = new Set<string>();
  private serverStarted = false;

  private readonly _onDidReceiveEvent = new EventEmitter<AgentEvent>();
  readonly onDidReceiveEvent = this._onDidReceiveEvent.event;

  static readonly HOOK_EVENTS: AgentEventType[] = [
    'SessionStart', 'SessionEnd',
    'SubagentStart', 'SubagentStop',
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'Stop', 'StopFailure',
  ];

  constructor(storageUri: { fsPath: string }) {
    this.settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    this.hookServer = new HookServer(storageUri);
    this.hookServer.on('hookEvent', (raw: unknown) => {
      // Will be normalized per workspaceId when we have multi-workspace routing
      // For now, emit for all connected workspaces (first one is used)
      const workspaceId = this.connectedWorkspaces.values().next().value ?? 'unknown';
      const event = this.normalizeEvent(workspaceId as string, raw);
      this._onDidReceiveEvent.fire(event);
    });
  }

  async connect(workspaceId: string, _workspaceRootPath: string): Promise<void> {
    if (!this.serverStarted) {
      await this.hookServer.start();
      this.serverStarted = true;
    }
    this.connectedWorkspaces.add(workspaceId);
    this.injectHooks(this.hookServer.hookUrl);
  }

  async disconnect(workspaceId: string): Promise<void> {
    this.connectedWorkspaces.delete(workspaceId);
    if (this.connectedWorkspaces.size === 0) {
      this.removeHooks();
      this.hookServer.dispose();
      this.serverStarted = false;
    }
  }

  injectHooks(hookUrl: string): void {
    let settings: Record<string, unknown> = {};

    if (fs.existsSync(this.settingsPath)) {
      // Create backup before first modification
      const backupPath = this.settingsPath + '.harnesstune-backup';
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(this.settingsPath, backupPath);
      }
      settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Record<string, unknown>;
    } else {
      // Ensure directory exists
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    for (const eventName of ClaudeCodeHookAdapter.HOOK_EVENTS) {
      const existing = (hooks[eventName] ?? []) as unknown[];
      // Remove any existing harnesstune entries (idempotent)
      const filtered = existing.filter((e: unknown) =>
        !(e && typeof e === 'object' && '_harnesstune' in (e as object))
      );
      const newEntry: HarnessHookEntry = {
        type: 'http',
        url: hookUrl,
        timeout: 4,
        _harnesstune: true,
      };
      hooks[eventName] = [...filtered, newEntry];
    }

    settings.hooks = hooks;

    // Atomic write: temp file + rename
    const tmpPath = this.settingsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.settingsPath);
  }

  removeHooks(): void {
    if (!fs.existsSync(this.settingsPath)) { return; }
    const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Record<string, unknown>;
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

    for (const eventName of Object.keys(hooks)) {
      hooks[eventName] = hooks[eventName].filter((e: unknown) =>
        !(e && typeof e === 'object' && '_harnesstune' in (e as object))
      );
      if (hooks[eventName].length === 0) {
        delete hooks[eventName];
      }
    }

    settings.hooks = Object.keys(hooks).length > 0 ? hooks : undefined;

    const tmpPath = this.settingsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.settingsPath);
  }

  normalizeEvent(workspaceId: string, raw: unknown): AgentEvent {
    const p = raw as Record<string, unknown>;
    const tsRaw = p.timestamp as string | undefined;
    const timestamp = tsRaw ? (Date.parse(tsRaw) || Date.now()) : Date.now();

    let tokenUsage: AgentTokenUsage | undefined;
    if (p.usage && typeof p.usage === 'object') {
      const u = p.usage as Record<string, unknown>;
      tokenUsage = {
        inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : undefined,
        outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : undefined,
        cacheReadTokens: typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : undefined,
      };
    }

    return {
      id: crypto.randomUUID(),
      workspaceId,
      sessionId: (p.session_id as string) ?? '',
      agentId: (p.session_id as string) ?? '',
      eventType: (p.event as AgentEventType) ?? 'SessionStart',
      timestamp,
      toolName: p.tool_name as string | undefined,
      toolInput: p.tool_input,
      model: p.model as string | undefined,
      tokenUsage,
      error: p.error as string | undefined,
      raw,
    };
  }

  dispose(): void {
    this.removeHooks();
    this.hookServer.dispose();
    this._onDidReceiveEvent.dispose();
  }
}
