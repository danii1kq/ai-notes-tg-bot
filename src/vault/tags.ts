/**
 * Tags of a note.
 *
 * A tag comes from the message of the owner (`#idea`) and ends up in the
 * frontmatter of the note, next to the tags the vault uses (`inbox`,
 * `telegram`).
 */

/** `#tag` inside a text. A heading (`# Title`) is not a tag, it has a space. */
const TAG_PATTERN = /#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 32;

/** Extracts the tags of a message: `#idea #work` -> `["idea", "work"]`. */
export function extractTags(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TAG_PATTERN)) {
    const raw = (match[1] ?? "").trim();
    if (!raw || /^\d+$/.test(raw)) continue;
    const tag = raw.toLowerCase();
    if (tag.length > MAX_TAG_LENGTH) continue;
    if (!found.includes(tag)) found.push(tag);
    if (found.length >= MAX_TAGS) break;
  }
  return found;
}

/** Reads the fields of the YAML frontmatter of a note. */
export function parseFrontmatter(content: string): Record<string, string> {
  const block = frontmatterBlock(content);
  if (block === null) return {};

  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    fields[key] = line.slice(separator + 1).trim();
  }
  return fields;
}

/** The lines between the two fences of the frontmatter, or null. */
function frontmatterBlock(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match ? (match[1] ?? "") : null;
}

/** Reads the tags of a note from its frontmatter. */
export function parseTags(content: string): string[] {
  const block = frontmatterBlock(content);
  if (block === null) return [];

  const lines = block.split(/\r?\n/);
  const index = lines.findIndex((line) => /^tags\s*:/i.test(line));
  if (index < 0) return [];

  const line = lines[index] ?? "";
  const inline = line.slice(line.indexOf(":") + 1).trim();

  // `tags: [inbox, telegram]` - the form the vault writes itself.
  if (inline.startsWith("[")) {
    return inline.replace(/^\[/, "").replace(/\]$/, "").split(",").map(cleanTag).filter(Boolean);
  }

  // A value that is not a list is not a list of tags.
  if (inline.length > 0) return [];

  // `tags:` followed by a block list.
  const items: string[] = [];
  for (const next of lines.slice(index + 1)) {
    const item = /^\s*-\s*(.+)$/.exec(next);
    if (!item) break;
    items.push(cleanTag(item[1] ?? ""));
  }
  return items.filter(Boolean);
}

/** Removes the quotes around a tag. */
function cleanTag(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

/**
 * Adds tags to the frontmatter of a note. The existing tags are kept, a note
 * without a frontmatter gets one, and a broken `tags` line is replaced.
 */
export function mergeTags(content: string, tags: string[], date: string): string {
  const wanted = tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0 && tag.length <= MAX_TAG_LENGTH);
  if (wanted.length === 0) return content;

  const existing = parseTags(content);
  const merged = [...existing];
  for (const tag of wanted) {
    if (!merged.includes(tag)) merged.push(tag);
  }
  if (merged.length === existing.length && existing.length > 0) return content;

  const line = `tags: [${merged.join(", ")}]`;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) {
    return `---\ndate: ${date}\n${line}\n---\n\n${content.trimStart()}`;
  }

  const block = match[1] ?? "";
  const nextBlock = /^tags\s*:/m.test(block)
    ? block.replace(/^tags\s*:.*$/m, line)
    : `${block}\n${line}`;
  return content.replace(match[0], `---\n${nextBlock}\n---`);
}
