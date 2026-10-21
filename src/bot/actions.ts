import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { undoLog } from "../db/schema.js";
import type { Logger } from "../logger.js";
import type { VaultOperations } from "../vault/operations.js";

export interface ActionDeps {
  vault: VaultOperations;
  db: Database["db"];
  logger: Logger;
}

/** The notes that wait for a confirmation of the owner. */
const pendingDeletes = new Map<string, { path: string; title: string }>();

const MAX_RESULTS = 12;

/** Searches the vault by the name of a note and by the text inside the notes. */
export async function searchNotes(query: string, deps: ActionDeps): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return "Напиши запрос: /search кофе";

  const byName = await deps.vault.searchFiles({ target: "files", pattern: trimmed });
  const byContent = await deps.vault.searchFiles({ target: "content", pattern: trimmed });

  const lines: string[] = [];
  const seen = new Set<string>();

  for (const hit of byName) {
    if (seen.has(hit.relativePath)) continue;
    seen.add(hit.relativePath);
    lines.push(`• ${hit.title} - ${hit.relativePath}`);
  }

  for (const hit of byContent) {
    if (seen.has(hit.relativePath)) continue;
    seen.add(hit.relativePath);
    lines.push(`• ${hit.title} - ${hit.relativePath}:${hit.line ?? 0}`);
    if (hit.snippet) lines.push(`  ${hit.snippet}`);
  }

  if (lines.length === 0) return `Ничего не нашлось по запросу «${trimmed}».`;
  const shown = lines.slice(0, MAX_RESULTS);
  const hidden = lines.length - shown.length;
  const tail = hidden > 0 ? `\nи ещё ${hidden}` : "";
  return `🔎 По запросу «${trimmed}»:\n${shown.join("\n")}${tail}`;
}

/** Lists the notes that are still in the inbox. */
export async function listInbox(deps: ActionDeps): Promise<string> {
  const notes = await deps.vault.listByTag("inbox");
  if (notes.length === 0) return "📥 В инбоксе пусто.";
  const lines = notes.slice(0, MAX_RESULTS).map((note) => `• ${note.title} - ${note.relativePath}`);
  return `📥 В инбоксе (${notes.length}):\n${lines.join("\n")}`;
}

/**
 * Undoes the last write of the bot.
 *
 * An appended block is removed from the note, an overwritten note gets its
 * old content back and a created note is deleted. A note that was changed
 * after the bot wrote it is never deleted without a confirmation.
 */
export async function undoLast(
  deps: ActionDeps,
  userId: number,
  confirmed = false,
): Promise<string> {
  const rows = await deps.db
    .select()
    .from(undoLog)
    .where(and(isNull(undoLog.undoneAt), eq(undoLog.telegramUserId, String(userId))))
    .orderBy(desc(undoLog.id))
    .limit(1);

  const entry = rows[0];
  if (!entry) return "↩️ Отменять нечего: последних записей я не делал.";

  const pending = pendingDeletes.get(String(userId));

  if (entry.action === "append") {
    if (!entry.block) return "↩️ Не помню, что именно дописал. Запись осталась как есть.";
    const result = await deps.vault.removeBlock(entry.path, entry.block);
    if (!result.removed) {
      return `↩️ В заметке «${entry.title}» не нашлось моей записи, ничего не менял.`;
    }
    await markUndone(deps, entry.id);
    return `↩️ Убрал свою запись из «${entry.title}».`;
  }

  if (entry.action === "overwrite") {
    if (!entry.previous) return "↩️ Не помню прежнее содержимое заметки.";
    await deps.vault.writeNote(entry.path, entry.previous, { source: "agent", autoLink: false });
    await markUndone(deps, entry.id);
    return `↩️ Вернул прежнее содержимое заметки «${entry.title}».`;
  }

  // The note was created by the bot. It is only deleted when nobody touched
  // it in the meantime, otherwise the owner has to confirm it.
  if (!confirmed) {
    const changed = await wasChangedAfter(entry.path, entry.createdAt, deps);
    if (changed) {
      pendingDeletes.set(String(userId), { path: entry.path, title: entry.title });
      return `⚠️ Заметку «${entry.title}» меняли после того, как я её создал. Удалить всё равно? Ответь /undo confirm.`;
    }
  } else if (!pending || pending.path !== entry.path) {
    return "↩️ Нечего подтверждать.";
  }

  pendingDeletes.delete(String(userId));
  const result = await deps.vault.deleteNote(entry.path);
  if (!result.removed) return `↩️ Заметки «${entry.title}» уже нет.`;
  await markUndone(deps, entry.id);
  return `↩️ Удалил заметку «${entry.title}».`;
}

/** Marks the entry of the log as undone. */
async function markUndone(deps: ActionDeps, id: number): Promise<void> {
  await deps.db
    .update(undoLog)
    .set({ undoneAt: new Date().toISOString() })
    .where(eq(undoLog.id, id));
}

/** True when the file was changed after the bot wrote it. */
async function wasChangedAfter(
  relativePath: string,
  createdAt: string,
  deps: ActionDeps,
): Promise<boolean> {
  const info = await deps.vault.statOf(relativePath);
  if (!info) return false;
  const writtenAt = Date.parse(createdAt);
  if (!Number.isFinite(writtenAt)) return false;
  return info.mtimeMs > writtenAt + 5_000;
}
