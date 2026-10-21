import type { AppConfig } from "./config.js";
import type { HermesClient } from "./hermes/client.js";
import { buildPrompt } from "./hermes/prompt.js";
import type { Logger } from "./logger.js";
import { readEvents, type VaultEvent } from "./vault/events.js";
import { normalizeDashes, type VaultOperations } from "./vault/operations.js";
import { extractTags, mergeTags } from "./vault/tags.js";

export interface PipelineDeps {
  config: AppConfig;
  hermes: HermesClient;
  vault: VaultOperations;
  logger: Logger;
}

export interface ProcessResult {
  /** Short status line that is sent back to Telegram. */
  status: string;
  action: "create" | "overwrite" | "append" | "none";
  title: string;
  path: string;
  usedFallback: boolean;
  agentText: string;
  /** The block that was appended, so the append can be undone. */
  block?: string;
}

/**
 * The whole pipeline of one message: the text goes to Hermes Agent, the agent
 * works with the vault, and the bot reports what happened in one line.
 */
export async function processMessage(
  text: string,
  telegramUserId: number,
  deps: PipelineDeps,
): Promise<ProcessResult> {
  const startedAt = Date.now();
  const titles = await deps.vault.noteTitles();
  const tags = extractTags(text);

  const prompt = buildPrompt(text, {
    now: new Date(),
    timeZone: deps.config.vault.timeZone,
    vaultPath: deps.config.vault.path,
    noteTitles: titles,
  });

  deps.logger.info("running the agent", {
    chars: text.length,
    model: deps.config.hermes.model,
    userId: telegramUserId,
    tags,
  });
  const run = await deps.hermes.run(prompt);
  deps.logger.info("the agent finished", {
    ok: run.ok,
    durationMs: run.durationMs,
    model: run.model,
    usedFallback: run.usedFallback,
  });

  const events = await readEvents(deps.config.vault.eventsFile);
  const fresh = events.filter((event) => Date.parse(event.at) >= startedAt - 1500);

  if (fresh.length > 0) {
    const last = fresh[fresh.length - 1] as VaultEvent;
    if (tags.length > 0) {
      await applyTags(deps.vault, last.path, tags);
    }
    return {
      status: statusFor(last),
      action: last.action,
      title: last.title,
      path: last.path,
      usedFallback: false,
      agentText: run.text,
      ...(last.block ? { block: last.block } : {}),
    };
  }

  // The agent did not touch the vault. Either it failed, or it decided that
  // the message does not need a note. In both cases the message is stored
  // anyway, so the thought is never lost.
  deps.logger.warn("the agent did not write anything, using the fallback writer", {
    ok: run.ok,
    error: run.error,
  });
  return fallbackWrite(text, deps, run.text);
}

/** Writes the message into the vault without the agent. */
async function fallbackWrite(
  text: string,
  deps: PipelineDeps,
  agentText: string,
): Promise<ProcessResult> {
  const title = deriveTitle(text);
  const existing = await findRelatedNote(text, title, deps.vault);
  const stamp = deps.vault.currentDateTime();
  const tags = extractTags(text);

  if (existing) {
    const block = `## ${stamp}\n\n${text.trim()}\n`;
    const result = await deps.vault.appendNote(existing, block, { source: "fallback" });
    if (tags.length > 0) {
      await applyTags(deps.vault, result.relativePath, tags);
    }
    return {
      status: `📥 Добавил запись в «${result.title}»`,
      action: "append",
      title: result.title,
      path: result.relativePath,
      usedFallback: true,
      agentText,
      block: normalizeDashes(block),
    };
  }

  const result = await deps.vault.createNoteFromTitle(title, text.trim(), "fallback");
  if (tags.length > 0) {
    await applyTags(deps.vault, result.relativePath, tags);
  }
  return {
    status: `📝 Создал заметку «${result.title}»`,
    action: "create",
    title: result.title,
    path: result.relativePath,
    usedFallback: true,
    agentText,
  };
}

/**
 * Puts the tags of the message into the frontmatter of the note. The agent
 * may or may not have done it, so the tags are added here as well: the note
 * always carries them.
 */
async function applyTags(
  vault: VaultOperations,
  relativePath: string,
  tags: string[],
): Promise<void> {
  const file = await vault.readFile(relativePath).catch(() => null);
  if (!file) return;
  const merged = mergeTags(file.content, tags, vault.currentDate());
  if (merged === file.content) return;
  await vault
    .writeNote(relativePath, merged, { source: "agent", autoLink: false })
    .catch(() => undefined);
}

/** Looks for a note that is about the same topic as the message. */
async function findRelatedNote(
  text: string,
  title: string,
  vault: VaultOperations,
): Promise<string | null> {
  const keywords = extractKeywords(text);
  if (keywords.length === 0) return null;

  for (const keyword of keywords) {
    const hits = await vault.searchFiles({ target: "files", pattern: keyword });
    if (hits.length > 0) {
      return (hits[0] as { relativePath: string }).relativePath;
    }
  }

  const exact = await vault.searchFiles({ target: "files", pattern: title });
  if (exact.length > 0) {
    return (exact[0] as { relativePath: string }).relativePath;
  }
  return null;
}

/** Builds a short title out of the message. */
export function deriveTitle(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? text;
  const cleaned = firstLine
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Заметка";
  const words = cleaned.split(" ").slice(0, 7).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}...` : words;
}

/** Words that are likely to appear in the title of a related note. */
export function extractKeywords(text: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "from",
    "have",
    "has",
    "was",
    "were",
    "but",
    "not",
    "you",
    "your",
    "our",
    "его",
    "как",
    "что",
    "это",
    "для",
    "или",
    "но",
    "так",
    "все",
    "она",
    "они",
    "мой",
    "моя",
    "мои",
    "чтобы",
    "если",
    "уже",
    "ещё",
    "еще",
    "который",
  ]);
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((word) => word.trim())
        .filter((word) => word.length > 3 && !stop.has(word)),
    ),
  ].slice(0, 6);
}

function statusFor(event: VaultEvent): string {
  switch (event.action) {
    case "create":
      return `📝 Создал заметку «${event.title}»`;
    case "overwrite":
      return `📝 Обновил заметку «${event.title}»`;
    case "append":
      return `📥 Добавил запись в «${event.title}»`;
    default:
      return `📝 Готово: «${event.title}»`;
  }
}
