import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Every note the bot created or extended, with the moment it happened. */
export const notesLog = sqliteTable("notes_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull(),
  action: text("action").notNull(),
  path: text("path").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  bytes: integer("bytes").notNull(),
  telegramUserId: text("telegram_user_id"),
});

/** Telegram update ids that were already handled, so nothing runs twice. */
export const processedUpdates = sqliteTable("processed_updates", {
  updateId: text("update_id").primaryKey(),
  processedAt: text("processed_at").notNull(),
  telegramUserId: text("telegram_user_id"),
});

/**
 * Every write of the bot, kept so it can be undone with /undo: an appended
 * block, a created note or an overwritten one.
 */
export const undoLog = sqliteTable("undo_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull(),
  action: text("action").notNull(),
  path: text("path").notNull(),
  title: text("title").notNull(),
  /** The appended block, for the append. */
  block: text("block"),
  /** The content before the write, for the overwrite. */
  previous: text("previous"),
  /** When the write was undone. */
  undoneAt: text("undone_at"),
  telegramUserId: text("telegram_user_id"),
});

/**
 * The summary of every day, so the file of the month can be written again and
 * a day is never summarised twice.
 */
export const dailySummaries = sqliteTable("daily_summaries", {
  date: text("date").primaryKey(),
  file: text("file").notNull(),
  summary: text("summary").notNull(),
  notesCount: integer("notes_count").notNull(),
  createdAt: text("created_at").notNull(),
});

export const schema = { notesLog, processedUpdates, undoLog, dailySummaries };
