import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { userSettings } from "../db/schema.js";
import { isLanguage, type Language } from "../i18n/index.js";

export interface LanguageOptions {
  /** The language of a new user, English by default. */
  defaultLanguage: Language;
  /** The language of the owner of the bot. */
  ownerLanguage: Language;
  /** The user ids of the owner. */
  ownerIds: Set<number>;
}

export interface LanguageStore {
  db: Database["db"];
  options: LanguageOptions;
}

/**
 * The language of a user.
 *
 * The choice of the user is kept in the database. A user that never chose
 * gets the language of the owner, if it is the owner, and the default
 * language otherwise.
 */
export async function resolveLanguage(store: LanguageStore, userId: number): Promise<Language> {
  const rows = await store.db
    .select()
    .from(userSettings)
    .where(eq(userSettings.telegramUserId, String(userId)))
    .limit(1);

  const row = rows[0];
  if (row && isLanguage(row.language)) return row.language;

  const language = store.options.ownerIds.has(userId)
    ? store.options.ownerLanguage
    : store.options.defaultLanguage;

  // The language of the first time is kept, so it does not change under the
  // feet of the user.
  await store.db
    .insert(userSettings)
    .values({
      telegramUserId: String(userId),
      language,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: userSettings.telegramUserId,
      set: { language, updatedAt: new Date().toISOString() },
    })
    .catch(() => undefined);

  return language;
}

/** Remembers the language the user has chosen. */
export async function saveLanguage(
  store: LanguageStore,
  userId: number,
  language: Language,
): Promise<void> {
  const now = new Date().toISOString();
  await store.db
    .insert(userSettings)
    .values({
      telegramUserId: String(userId),
      language,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSettings.telegramUserId,
      set: { language, updatedAt: now },
    });
}
