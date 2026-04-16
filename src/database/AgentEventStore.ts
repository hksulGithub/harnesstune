import * as fs from 'fs';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import type { AgentEvent } from '../types/agent';

export interface SessionSummary {
  totalEvents: number;
  toolUses: number;
  errors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
}

export class AgentEventStore {
  private db!: Database;
  private readonly dbPath: string;

  constructor(
    storageUri: { fsPath: string },
    private readonly extensionPath?: string
  ) {
    this.dbPath = path.join(storageUri.fsPath, 'agent-events.sqlite');
  }

  async init(extensionPath?: string): Promise<void> {
    const extPath = extensionPath ?? this.extensionPath;

    let SQL: Awaited<ReturnType<typeof initSqlJs>>;
    if (extPath) {
      SQL = await initSqlJs({
        locateFile: (file: string) => path.join(extPath, 'dist', file),
      });
    } else {
      SQL = await initSqlJs();
    }

    if (fs.existsSync(this.dbPath)) {
      const data = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(data);
    } else {
      this.db = new SQL.Database();
    }

    this.createSchema();
  }

  private createSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tool_name TEXT,
        tool_input TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        error TEXT,
        parent_tool_use_id TEXT,
        raw TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session ON agent_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_workspace ON agent_events(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON agent_events(timestamp DESC);
    `);

    // Migration: add parent_tool_use_id column to existing databases
    try {
      this.db.run(`ALTER TABLE agent_events ADD COLUMN parent_tool_use_id TEXT`);
    } catch {
      // Column already exists — ignore
    }
  }

  insertEvent(event: AgentEvent): void {
    if (!event.id || !event.workspaceId || !event.sessionId || !event.agentId) {
      throw new Error('AgentEvent missing required fields: id, workspaceId, sessionId, agentId');
    }

    this.db.run(
      `INSERT INTO agent_events (
        id, workspace_id, session_id, agent_id, event_type, timestamp,
        tool_name, tool_input, model, input_tokens, output_tokens, cache_read_tokens,
        error, parent_tool_use_id, raw
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.workspaceId,
        event.sessionId,
        event.agentId,
        event.eventType,
        event.timestamp,
        event.toolName ?? null,
        event.toolInput !== undefined ? JSON.stringify(event.toolInput) : null,
        event.model ?? null,
        event.tokenUsage?.inputTokens ?? null,
        event.tokenUsage?.outputTokens ?? null,
        event.tokenUsage?.cacheReadTokens ?? null,
        event.error ?? null,
        event.parentToolUseId ?? null,
        JSON.stringify(event.raw),
      ]
    );
  }

  getEventsBySession(sessionId: string, limit = 10): AgentEvent[] {
    const stmt = this.db.prepare(
      `SELECT * FROM agent_events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`
    );
    stmt.bind([sessionId, limit]);
    return this.collectRows(stmt);
  }

  getEventsByWorkspace(workspaceId: string, limit = 50): AgentEvent[] {
    const stmt = this.db.prepare(
      `SELECT * FROM agent_events WHERE workspace_id = ? ORDER BY timestamp DESC LIMIT ?`
    );
    stmt.bind([workspaceId, limit]);
    return this.collectRows(stmt);
  }

  getSessionSummary(sessionId: string): SessionSummary {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as totalEvents,
        SUM(CASE WHEN tool_name IS NOT NULL THEN 1 ELSE 0 END) as toolUses,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors,
        COALESCE(SUM(input_tokens), 0) as totalInputTokens,
        COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
        COALESCE(SUM(cache_read_tokens), 0) as totalCacheReadTokens
      FROM agent_events
      WHERE session_id = ?
    `);
    stmt.bind([sessionId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        totalEvents: Number(row['totalEvents'] ?? 0),
        toolUses: Number(row['toolUses'] ?? 0),
        errors: Number(row['errors'] ?? 0),
        totalInputTokens: Number(row['totalInputTokens'] ?? 0),
        totalOutputTokens: Number(row['totalOutputTokens'] ?? 0),
        totalCacheReadTokens: Number(row['totalCacheReadTokens'] ?? 0),
      };
    }
    stmt.free();
    return { totalEvents: 0, toolUses: 0, errors: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0 };
  }

  getWorkspaceSummary(workspaceId: string): SessionSummary {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as totalEvents,
        SUM(CASE WHEN tool_name IS NOT NULL THEN 1 ELSE 0 END) as toolUses,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors,
        COALESCE(SUM(input_tokens), 0) as totalInputTokens,
        COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
        COALESCE(SUM(cache_read_tokens), 0) as totalCacheReadTokens
      FROM agent_events
      WHERE workspace_id = ?
    `);
    stmt.bind([workspaceId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        totalEvents: Number(row['totalEvents'] ?? 0),
        toolUses: Number(row['toolUses'] ?? 0),
        errors: Number(row['errors'] ?? 0),
        totalInputTokens: Number(row['totalInputTokens'] ?? 0),
        totalOutputTokens: Number(row['totalOutputTokens'] ?? 0),
        totalCacheReadTokens: Number(row['totalCacheReadTokens'] ?? 0),
      };
    }
    stmt.free();
    return { totalEvents: 0, toolUses: 0, errors: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0 };
  }

  flush(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const tmpPath = this.dbPath + '.tmp';
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, this.dbPath);
  }

  dispose(): void {
    this.flush();
    this.db.close();
  }

  private collectRows(stmt: ReturnType<Database['prepare']>): AgentEvent[] {
    const events: AgentEvent[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      events.push(this.rowToEvent(row));
    }
    stmt.free();
    return events;
  }

  private rowToEvent(row: Record<string, unknown>): AgentEvent {
    let toolInput: unknown = undefined;
    if (row['tool_input'] && typeof row['tool_input'] === 'string') {
      try {
        toolInput = JSON.parse(row['tool_input']);
      } catch {
        toolInput = row['tool_input'];
      }
    }

    let raw: unknown = {};
    if (row['raw'] && typeof row['raw'] === 'string') {
      try {
        raw = JSON.parse(row['raw']);
      } catch {
        raw = row['raw'];
      }
    }

    return {
      id: String(row['id']),
      workspaceId: String(row['workspace_id']),
      sessionId: String(row['session_id']),
      agentId: String(row['agent_id']),
      eventType: String(row['event_type']) as AgentEvent['eventType'],
      timestamp: Number(row['timestamp']),
      toolName: row['tool_name'] ? String(row['tool_name']) : undefined,
      toolInput,
      model: row['model'] ? String(row['model']) : undefined,
      tokenUsage: (row['input_tokens'] || row['output_tokens'] || row['cache_read_tokens'])
        ? {
            inputTokens: row['input_tokens'] ? Number(row['input_tokens']) : undefined,
            outputTokens: row['output_tokens'] ? Number(row['output_tokens']) : undefined,
            cacheReadTokens: row['cache_read_tokens'] ? Number(row['cache_read_tokens']) : undefined,
          }
        : undefined,
      error: row['error'] ? String(row['error']) : undefined,
      parentToolUseId: row['parent_tool_use_id'] ? String(row['parent_tool_use_id']) : undefined,
      raw,
    };
  }

  getHierarchyEvents(workspaceId: string): AgentEvent[] {
    const stmt = this.db.prepare(
      `SELECT * FROM agent_events
       WHERE workspace_id = ?
         AND event_type IN ('SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop')
       ORDER BY timestamp ASC`
    );
    stmt.bind([workspaceId]);
    return this.collectRows(stmt);
  }
}
