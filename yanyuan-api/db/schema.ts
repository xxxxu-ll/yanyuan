import { integer, real, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  name: text('name').notNull(),
  appearance: text('appearance').notNull(),
  progress: text('progress').notNull().default('{"visited":[],"cats":[],"coins":0}'),
  x: real('x').notNull(), y: real('y').notNull(),
  dir: text('dir').notNull().default('down'),
  moving: integer('moving').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  seenAt: integer('seen_at').notNull().default(0),
  lastChatAt: integer('last_chat_at').notNull().default(0),
}, (t) => [uniqueIndex('players_token_hash_idx').on(t.tokenHash), index('players_seen_idx').on(t.seenAt)]);

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  name: text('name').notNull(),
  text: text('text').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('messages_created_idx').on(t.createdAt)]);

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(), hits: integer('hits').notNull().default(0), expiresAt: integer('expires_at').notNull(),
});
