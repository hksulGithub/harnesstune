import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),           // UUID
  channelId: text('channel_id').notNull().references(() => channels.id),
  direction: text('direction').notNull(), // 'to_agent' | 'from_agent'
  body: text('body').notNull(),          // JSON string
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const rateLimits = sqliteTable('rate_limits', {
  tokenId: text('token_id').notNull(),
  windowStart: integer('window_start').notNull(),  // unix epoch minute
  count: integer('count').notNull().default(1),
}, (table) => ({
  pk: primaryKey({ columns: [table.tokenId, table.windowStart] }),
}));
