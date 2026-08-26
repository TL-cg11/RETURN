import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const museums = sqliteTable('museums', { id:text('id').primaryKey(), name:text('name').notNull(), createdAt:integer('created_at').notNull() });
export const submissions = sqliteTable('submissions', {
  id:text('id').primaryKey(), museumId:text('museum_id').notNull(), objectId:text('object_id').notNull(), kind:text('kind').notNull(), title:text('title').notNull(),
  description:text('description').notNull(), source:text('source').notNull(), consent:text('consent').notNull(), requestedOutcome:text('requested_outcome').notNull(),
  status:text('status').notNull().default('received'), createdAt:integer('created_at').notNull(),
});
export const approvals = sqliteTable('approvals', {
  id:text('id').primaryKey(), museumId:text('museum_id').notNull(), objectId:text('object_id').notNull(), risk:text('risk').notNull(), snapshot:text('snapshot').notNull(),
  snapshotHash:text('snapshot_hash').notNull(), objectVersion:integer('object_version').notNull(), status:text('status').notNull().default('pending'), resolution:text('resolution'),
  createdAt:integer('created_at').notNull(), resolvedAt:integer('resolved_at'),
});
export const activity = sqliteTable('activity', {
  id:text('id').primaryKey(), museumId:text('museum_id').notNull(), actor:text('actor').notNull(), action:text('action').notNull(), detail:text('detail').notNull(), createdAt:integer('created_at').notNull(),
});
