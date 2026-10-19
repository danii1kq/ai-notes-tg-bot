import { mkdir } from "node:fs/promises";
import path from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { schema } from "./schema.js";

export type Database = {
  client: Client;
  db: LibSQLDatabase<typeof schema>;
};

/** Opens the local SQLite database and makes sure the tables exist. */
export async function createDatabase(filePath: string): Promise<Database> {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  const client = createClient({ url: `file:${path.resolve(filePath)}` });
  const db = drizzle(client, { schema });
  await ensureSchema(client);
  return { client, db };
}

/** Creates the tables when they are missing. */
export async function ensureSchema(client: Client): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS notes_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      action TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      telegram_user_id TEXT
    )`,
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS processed_updates (
      update_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL,
      telegram_user_id TEXT
    )`,
  );
  await client.execute("CREATE INDEX IF NOT EXISTS notes_log_created_at ON notes_log (created_at)");
}
