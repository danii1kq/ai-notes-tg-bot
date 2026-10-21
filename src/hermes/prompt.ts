export interface PromptContext {
  /** Current time in the configured time zone. */
  now: Date;
  timeZone: string;
  /** Absolute path of the vault. */
  vaultPath: string;
  /** Titles of the notes that already exist (used for wiki links and targets). */
  noteTitles: string[];
  /** The file that came with the message, if there was one. */
  attachment?: { name: string; relativePath: string };
}

/**
 * Builds the prompt for Hermes Agent.
 *
 * The rules that do not change live in the agent workspace (`.hermes.md`), so
 * the prompt itself only carries the message of the user and the facts that
 * change per request: the current time, the vault path and the notes that
 * already exist.
 */
export function buildPrompt(userText: string, ctx: PromptContext): string {
  const dateTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: ctx.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ctx.now);

  const titles = ctx.noteTitles.slice(0, 60);

  const sections = [
    userText.trim(),
    "",
    "---",
    "Служебный контекст (не цитируй его в ответе):",
    `- Текущее время: ${dateTime} (${ctx.timeZone})`,
    `- Хранилище Obsidian: ${ctx.vaultPath}`,
    titles.length > 0
      ? `- Уже существующие заметки: ${titles.map((title) => `"${title}"`).join(", ")}`
      : "- Хранилище пока пустое, первая заметка будет создана.",
    ...(ctx.attachment
      ? [
          `- К сообщению приложен файл: ${ctx.attachment.relativePath}. Вставь его в заметку как ![[${ctx.attachment.name}]] и скажи, что это за файл.`,
        ]
      : []),
    "- Ответь одной короткой строкой о результате работы с заметкой.",
  ];

  return sections.join("\n");
}
