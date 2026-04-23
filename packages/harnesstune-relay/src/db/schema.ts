import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),           // UUID
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const tokens = sqliteTable('tokens', {
  id: text('id').primaryKey(),           // UUID
  channelId: text('channel_id').notNull().references(() => channels.id),
  tokenHash: text('token_hash').notNull(),  // SHA-256 hex digest
  label: text('label'),                     // human-readable label
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),           // UUID
  channelId: text('channel_id').notNull().references(() => channels.id),
  type: text('type').notNull(),          // 'briefing' | 'ralph' | 'heartbeat'
  body: text('body').notNull(),          // JSON string
  agentId: text('agent_id'),            // nullable — existing rows get NULL (backward compatible)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),           // UUID
  channelId: text('channel_id').notNull().references(() => channels.id),
  direction: text('direction').notNull(), // 'to_agent' | 'from_agent'
  body: text('body').notNull(),          // JSON string
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),                 // UUID
  channelId: text('channel_id').notNull().references(() => channels.id),
  agentId: text('agent_id').notNull(),         // platform-specific identifier, unique within channel
  name: text('name'),                          // nullable human-readable name
  platform: text('platform').notNull(),        // freeform: 'paperclip', 'claude-desktop', 'claude-code', 'openclaw'
  schedule: text('schedule'),                  // nullable cron expression or description
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),  // nullable
  status: text('status').notNull().default('unknown'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  // Enforce one agent identity per channel at the DB level (D-02)
  channelAgentUniq: uniqueIndex('agents_channel_agent_uniq').on(table.channelId, table.agentId),
}));

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),                 // UUID
  channelId: text('channel_id').notNull().references(() => channels.id),
  agentId: text('agent_id').notNull(),         // platform-specific identifier
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }).notNull(),
  status: text('status').notNull(),            // 'success' | 'failure' | 'timeout' | 'running'
  durationMs: integer('duration_ms').notNull(),
  logExcerpt: text('log_excerpt'),             // nullable
  errorSummary: text('error_summary'),         // nullable
  tokenUsage: text('token_usage'),             // JSON string, nullable
  costCents: integer('cost_cents'),            // nullable
});

export const rateLimits = sqliteTable('rate_limits', {
  tokenId: text('token_id').notNull(),
  windowStart: integer('window_start').notNull(),  // unix epoch minute
  count: integer('count').notNull().default(1),
}, (table) => ({
  pk: primaryKey({ columns: [table.tokenId, table.windowStart] }),
}));
