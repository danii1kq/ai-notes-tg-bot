import { and, eq, gte, lt } from "drizzle-orm";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/index.js";
import { dailySummaries, notesLog } from "../db/schema.js";
import type { HermesClient } from "../hermes/client.js";
import type { Logger } from "../logger.js";
import { normalizeDashes, type VaultOperations } from "../vault/operations.js";
import { localDate, localDayStartMs, monthFileName, monthTitle, previousDay } from "./time.js";

export interface DailyDeps {
  config: AppConfig;
  db: Database["db"];
  vault: VaultOperations;
  hermes: HermesClient;
  logger: Logger;
}

export interface DailySummary {
  /** The day the summary is about, `2026-10-21`. */
  day: string;
  /** The file of the month, `october_2026.md`. */
  file: string;
  summary: string;
  notesCount: number;
}

interface DayNote {
  title: string;
  path: string;
  action: string;
  excerpt: string;
}

const MAX_EXCERPT = 700;

/**
 * Makes the summary of a day and writes it into the file of the month.
 *
 * Nothing happens when the owner did not write anything that day: the day is
 * simply missing in the file of the month.
 */
export async function runDailySummary(deps: DailyDeps, day: string): Promise<DailySummary | null> {
  const notes = await collectNotesOfDay(deps, day);
  if (notes.length === 0) {
    deps.logger.info("no notes that day, the summary is skipped", { day });
    return null;
  }

  const existing = await deps.db
    .select()
    .from(dailySummaries)
    .where(eq(dailySummaries.date, day))
    .limit(1);
  if (existing.length > 0) {
    deps.logger.info("the summary of the day exists already", { day });
    return null;
  }

  const prompt = buildSummaryPrompt(day, notes);
  const run = await deps.hermes.run(prompt, { toolsets: "safe" });
  if (!run.ok) {
    deps.logger.error("the agent did not make the summary", { day, error: run.error });
    return null;
  }

  const summary = cleanSummary(run.text);
  if (!summary) {
    deps.logger.warn("the summary of the day is empty", { day });
    return null;
  }

  const file = await writeSection(deps.vault, day, summary);
  await deps.db.insert(dailySummaries).values({
    date: day,
    file,
    summary,
    notesCount: notes.length,
    createdAt: new Date().toISOString(),
  });

  deps.logger.info("the summary of the day is written", { day, file, notes: notes.length });
  return { day, file, summary, notesCount: notes.length };
}

/** The summary of yesterday, the day the owner would want to read. */
export async function runDailySummaryForYesterday(deps: DailyDeps): Promise<DailySummary | null> {
  const today = localDate(new Date(), deps.config.vault.timeZone);
  return runDailySummary(deps, previousDay(today));
}

/**
 * Makes the summaries that are missing after a restart.
 *
 * The days are taken from the oldest to the newest, so the sections of the
 * file of the month stay in the right order.
 */
export async function catchUpDailySummaries(deps: DailyDeps, days = 3): Promise<DailySummary[]> {
  const today = localDate(new Date(), deps.config.vault.timeZone);
  const wanted: string[] = [];
  let day = today;
  for (let counter = 0; counter < days; counter += 1) {
    day = previousDay(day);
    wanted.unshift(day);
  }

  const summaries: DailySummary[] = [];
  for (const wantedDay of wanted) {
    const summary = await runDailySummary(deps, wantedDay);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

/** The notes the owner wrote during a day. */
export async function collectNotesOfDay(deps: DailyDeps, day: string): Promise<DayNote[]> {
  const timeZone = deps.config.vault.timeZone;
  const start = new Date(localDayStartMs(day, timeZone)).toISOString();
  const end = new Date(localDayStartMs(nextDay(day), timeZone)).toISOString();

  const rows = await deps.db
    .select()
    .from(notesLog)
    .where(and(gte(notesLog.createdAt, start), lt(notesLog.createdAt, end)))
    .orderBy(notesLog.id);

  const notes: DayNote[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    const file = await deps.vault.readFile(row.path).catch(() => null);
    notes.push({
      title: row.title,
      path: row.path,
      action: row.action,
      excerpt: file ? excerptOf(file.content) : "",
    });
  }

  return notes;
}

/** The next day of a day, `2026-10-21` -> `2026-10-22`. */
function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const stamp = Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + 1);
  const next = new Date(stamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The text of a note without the frontmatter, shortened. */
function excerptOf(content: string): string {
  const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const text = withoutFrontmatter.trim();
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT)}...` : text;
}

/** The prompt of the agent that makes the summary. */
export function buildSummaryPrompt(day: string, notes: DayNote[]): string {
  const list = notes
    .map((note, index) => {
      const parts = [`${index + 1}. Заметка «${note.title}» (${note.path})`];
      if (note.excerpt) parts.push(note.excerpt);
      return parts.join("\n");
    })
    .join("\n\n");

  return [
    `Ты ведёшь ежедневный журнал владельца. Ниже заметки, которые он записал за ${day}.`,
    "",
    list,
    "",
    "Напиши короткий вывод (2-6 предложений) о том, что было сделано за этот день:",
    "над чем шла работа, какие решения приняты, какие идеи появились.",
    "Пиши по-русски, обычным текстом: без заголовков, без списков, без длинных тире.",
    "Ответь только текстом вывода.",
  ].join("\n");
}

/** Cleans the answer of the agent: no quotes, no long dashes, no headers. */
export function cleanSummary(text: string): string {
  const cleaned = normalizeDashes(text)
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/, "")
    .replace(/^(вывод|итог|резюме)\s*[:—-]\s*/i, "")
    .replace(/^#+\s*/gm, "")
    .trim();

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const text2 = lines
    .join("\n")
    .replace(/^["']|["']$/g, "")
    .trim();
  return text2.length > 3000 ? `${text2.slice(0, 2997)}...` : text2;
}

/**
 * Writes the section of a day into the file of the month.
 *
 * The file of the month holds one section per day. A day that comes again
 * replaces its own section, the other days stay as they are.
 */
export async function writeSection(
  vault: VaultOperations,
  day: string,
  summary: string,
): Promise<string> {
  const file = monthFileName(day);
  const section = `## ${day}\n\n${summary}`;
  const current = await vault.readFile(file).catch(() => null);

  if (!current) {
    const header = `---\ndate: ${day.slice(0, 7)}-01\ntags: [journal, daily]\n---\n\n# ${monthTitle(day)}\n`;
    await vault.writeNote(file, `${header}\n${section}`, { source: "agent", autoLink: false });
    return file;
  }

  const content = current.content;
  const heading = `## ${day}`;
  const index = content.indexOf(heading);
  if (index < 0) {
    await vault.appendNote(file, `\n${section}`, { source: "agent" });
    return file;
  }

  const nextHeading = content.indexOf("\n## ", index + heading.length);
  const end = nextHeading < 0 ? content.length : nextHeading;
  const next = `${content.slice(0, index)}${section}\n${content.slice(end).replace(/^\n+/, "")}`;
  await vault.writeNote(file, next, { source: "agent", autoLink: false });
  return file;
}
