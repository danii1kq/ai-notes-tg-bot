import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../logger.js";
import { appendEvent, type VaultEvent } from "./events.js";
import type { VaultGuard, WriteResult } from "./guard.js";
import { noteFileName, resolveInsideVault, toRelative } from "./paths.js";

export interface NoteInfo {
  relativePath: string;
  title: string;
  mtimeMs: number;
  size: number;
}

export interface SearchHit {
  relativePath: string;
  title: string;
  line?: number;
  snippet?: string;
}

export interface VaultOperationsDeps {
  guard: VaultGuard;
  eventsFile: string;
  timeZone: string;
  logger: Logger;
}

const MAX_SCANNED_BYTES = 512 * 1024;
const MAX_SEARCH_HITS = 60;

/**
 * The file operations exposed to Hermes Agent as MCP tools and used by the
 * application itself when the agent is not able to run.
 */
export class VaultOperations {
  constructor(private readonly deps: VaultOperationsDeps) {}

  private get vaultRoot(): string {
    return this.deps.guard.vaultRoot;
  }

  /** Lists every markdown note of the vault (or of a sub folder). */
  async listNotes(relativeDir?: string): Promise<NoteInfo[]> {
    const root = relativeDir ? resolveInsideVault(this.vaultRoot, relativeDir) : this.vaultRoot;
    const notes: NoteInfo[] = [];

    const walk = async (directory: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
        const info = await stat(full).catch(() => null);
        notes.push({
          relativePath: toRelative(this.vaultRoot, full),
          title: entry.name.replace(/\.md$/i, ""),
          mtimeMs: info?.mtimeMs ?? 0,
          size: info?.size ?? 0,
        });
      }
    };

    await walk(root);
    notes.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return notes;
  }

  /** Titles of all notes; used to build wiki links. */
  async noteTitles(): Promise<string[]> {
    const notes = await this.listNotes();
    return notes.map((note) => note.title);
  }

  /**
   * Searches the vault. `files` matches note names, `content` matches the
   * text inside the notes. Both accept a glob (`*.md`) or a plain substring.
   */
  async searchFiles(params: {
    target?: "files" | "content";
    pattern: string;
    path?: string;
    file_glob?: string;
  }): Promise<SearchHit[]> {
    const target = params.target ?? "files";
    const pattern = params.pattern?.trim() ?? "";
    if (!pattern) return [];

    const root = params.path ? resolveInsideVault(this.vaultRoot, params.path) : this.vaultRoot;
    const notes = await this.listNotes(toRelative(this.vaultRoot, root));
    const glob = params.file_glob?.trim();
    const hits: SearchHit[] = [];

    if (target === "files") {
      const matcher = buildMatcher(pattern);
      for (const note of notes) {
        if (glob && !matchesGlob(note.relativePath, glob)) continue;
        if (matcher(note.title) || matcher(note.relativePath)) {
          hits.push({ relativePath: note.relativePath, title: note.title });
        }
      }
      return hits.slice(0, MAX_SEARCH_HITS);
    }

    const contentMatcher = buildContentMatcher(pattern);
    for (const note of notes) {
      if (glob && !matchesGlob(note.relativePath, glob)) continue;
      const full = path.join(this.vaultRoot, note.relativePath);
      const info = await stat(full).catch(() => null);
      if (!info || info.size > MAX_SCANNED_BYTES) continue;
      const content = await readFile(full, "utf8").catch(() => "");
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (contentMatcher(line)) {
          hits.push({
            relativePath: note.relativePath,
            title: note.title,
            line: index + 1,
            snippet: line.trim().slice(0, 240),
          });
          if (hits.length >= MAX_SEARCH_HITS) return hits;
        }
      }
    }
    return hits;
  }

  /** Reads a note. */
  async readFile(
    targetPath: string,
  ): Promise<{ relativePath: string; content: string; lines: number }> {
    const absolute = resolveInsideVault(this.vaultRoot, targetPath);
    const content = await readFile(absolute, "utf8");
    return {
      relativePath: toRelative(this.vaultRoot, absolute),
      content,
      lines: content.split("\n").length,
    };
  }

  /**
   * Creates or overwrites a note. New notes always start with the Obsidian
   * YAML frontmatter and every mention of an existing note becomes a wiki link.
   */
  async writeNote(
    targetPath: string,
    content: string,
    options: { source?: VaultEvent["source"]; autoLink?: boolean } = {},
  ): Promise<WriteResult> {
    const absolute = resolveInsideVault(this.vaultRoot, targetPath);
    const titles = options.autoLink === false ? [] : await this.noteTitles();
    const selfTitle = path.basename(absolute).replace(/\.md$/i, "");
    const linked = autoLinkEntities(content, titles, selfTitle);
    const withFrontmatter = ensureFrontmatter(linked, this.currentDate());

    const result = await this.deps.guard.write(absolute, withFrontmatter);
    await this.record(result, options.source ?? "agent");
    return result;
  }

  /** Appends a block to an existing note, keeping the rest of the content. */
  async appendNote(
    targetPath: string,
    block: string,
    options: { source?: VaultEvent["source"] } = {},
  ): Promise<WriteResult> {
    const absolute = resolveInsideVault(this.vaultRoot, targetPath);
    const result = await this.deps.guard.append(absolute, block);
    await this.record(result, options.source ?? "agent");
    return result;
  }

  /** Creates a note from a title, used by the fallback path. */
  async createNoteFromTitle(
    title: string,
    body: string,
    source: VaultEvent["source"] = "fallback",
  ) {
    return this.writeNote(noteFileName(title), body, { source });
  }

  /** Current date in the configured time zone (YYYY-MM-DD). */
  currentDate(): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: this.deps.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  /** Current date and time in the configured time zone. */
  currentDateTime(): string {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: this.deps.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  }

  private async record(result: WriteResult, source: VaultEvent["source"]): Promise<void> {
    const event: VaultEvent = {
      action: result.action,
      path: result.relativePath,
      title: path.basename(result.relativePath).replace(/\.md$/i, ""),
      at: new Date().toISOString(),
      bytes: result.bytes,
      source,
    };
    try {
      await appendEvent(this.deps.eventsFile, event);
    } catch (error) {
      this.deps.logger.warn("could not record the vault event", { error: String(error) });
    }
  }
}

/** Adds the Obsidian frontmatter when the note does not have one yet. */
export function ensureFrontmatter(content: string, date: string): string {
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("---")) return content;
  return `---\ndate: ${date}\ntags: [inbox, telegram]\n---\n\n${content.trimStart()}`;
}

const WIKILINK = /\[\[[^\]]*\]\]/g;
const PLACEHOLDER = "\u0000";

/**
 * Wraps every mention of an existing note into a wiki link. Text that is
 * already a wiki link is left untouched, and a note never links to itself.
 */
export function autoLinkEntities(text: string, titles: string[], selfTitle: string): string {
  if (titles.length === 0) return text;

  const placeholders: string[] = [];
  const masked = text.replace(WIKILINK, (match) => {
    placeholders.push(match);
    return `${PLACEHOLDER}${placeholders.length - 1}${PLACEHOLDER}`;
  });

  const sorted = [...new Set(titles)]
    .filter((title) => title.length > 2 && title.toLowerCase() !== selfTitle.toLowerCase())
    .sort((a, b) => b.length - a.length);

  let linked = masked;
  for (const title of sorted) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\w\\[])(${escaped})(?![\\w\\]])`, "giu");
    linked = linked.replace(pattern, "[[$1]]");
  }

  return linked.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g"),
    (_match, index: string) => placeholders[Number(index)] ?? "",
  );
}

/** Builds a matcher for file names: a glob when the pattern has wildcards. */
function buildMatcher(pattern: string): (value: string) => boolean {
  if (hasGlob(pattern)) {
    const regex = globToRegExp(pattern);
    return (value) => regex.test(value);
  }
  const needle = pattern.toLowerCase();
  return (value) => value.toLowerCase().includes(needle);
}

/** Builds a matcher for note content: a regular expression when possible. */
function buildContentMatcher(pattern: string): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern, "i");
    return (line) => regex.test(line);
  } catch {
    const needle = pattern.toLowerCase();
    return (line) => line.toLowerCase().includes(needle);
  }
}

function hasGlob(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withStars = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${withStars}$`, "i");
}

function matchesGlob(value: string, glob: string): boolean {
  return globToRegExp(glob).test(path.basename(value)) || globToRegExp(glob).test(value);
}
