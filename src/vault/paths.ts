import path from "node:path";

/** Raised when a path would escape the vault root. */
export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPathError";
  }
}

/**
 * Resolves a caller supplied path against the vault root and guarantees the
 * result stays inside the vault. The agent may pass absolute paths (the
 * Obsidian skill works with absolute paths) or paths relative to the vault.
 */
export function resolveInsideVault(vaultRoot: string, candidate: string): string {
  const root = path.resolve(vaultRoot);
  const raw = candidate.trim();
  if (!raw) {
    throw new VaultPathError("Empty path");
  }
  if (raw.includes("\0")) {
    throw new VaultPathError("Path contains a null byte");
  }

  const target = path.resolve(root, raw);
  const relative = path.relative(root, target);
  if (relative === "") return root;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new VaultPathError(`Path escapes the vault: ${candidate}`);
  }
  return target;
}

/** Absolute path -> path relative to the vault root (posix separators). */
export function toRelative(vaultRoot: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(vaultRoot), path.resolve(absolutePath));
  return relative.split(path.sep).join("/");
}

/**
 * Turns a note title into a safe file name. Obsidian titles may contain
 * slashes, quotes or colons; the file name must not.
 */
export function sanitizeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .trim();
  const safe = cleaned.length > 0 ? cleaned : "Untitled";
  return safe.length > 120 ? safe.slice(0, 120).trim() : safe;
}

/** Builds the file name of a note from its title. */
export function noteFileName(title: string): string {
  const base = sanitizeFileName(title);
  return base.toLowerCase().endsWith(".md") ? base : `${base}.md`;
}
