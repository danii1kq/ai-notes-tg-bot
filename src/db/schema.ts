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

export const schema = { notesLog, processedUpdates };
