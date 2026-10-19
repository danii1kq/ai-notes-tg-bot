import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveInsideVault, toRelative } from "./paths.js";
import type { VaultWatcher } from "./watcher.js";

/** Error codes that mean "somebody else is touching the file right now". */
const TRANSIENT_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ETXTBSY", "ENOTEMPTY", "EEXIST"]);

export class VaultWriteError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "VaultWriteError";
  }
}

export type WriteAction = "create" | "overwrite" | "append";

export interface WriteResult {
  action: WriteAction;
  /** Absolute path of the written file. */
  path: string;
  /** Path relative to the vault root. */
  relativePath: string;
  /** File name of the note without the extension. */
  title: string;
  bytes: number;
  /** True when the content was read back unchanged after the write. */
  verified: boolean;
  attempts: number;
  /** Syncthing conflict copies found next to the file. */
  conflictFiles: string[];
  notes: string[];
}

export interface VaultGuardOptions {
  vaultRoot: string;
  retryDelayMs?: number;
  maxAttempts?: number;
  settleDelayMs?: number;
  /** Delay between the write and the verification read. */
  verifyDelayMs?: number;
  watcher?: VaultWatcher;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && TRANSIENT_CODES.has(code);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * Writes notes in a way that survives Syncthing.
 *
 * Every write goes to a temporary file in the same directory and is then
 * renamed over the target, so a reader never sees a half written note. When a
 * write fails because the file is momentarily locked, or when the content is
 * changed right after our rename, the operation is retried with a delay.
 */
export class VaultGuard {
  readonly vaultRoot: string;
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;
  private readonly settleDelayMs: number;
  private readonly verifyDelayMs: number;
  private readonly watcher: VaultWatcher | undefined;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: VaultGuardOptions) {
    this.vaultRoot = path.resolve(options.vaultRoot);
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.settleDelayMs = options.settleDelayMs ?? 1000;
    this.verifyDelayMs = options.verifyDelayMs ?? 400;
    this.watcher = options.watcher;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Overwrites (or creates) a note. */
  async write(targetPath: string, content: string): Promise<WriteResult> {
    const absolute = resolveInsideVault(this.vaultRoot, targetPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    const existed = await this.exists(absolute);
    const payload = content.endsWith("\n") ? content : `${content}\n`;

    return this.runWithRetry(absolute, payload, existed ? "overwrite" : "create");
  }

  /** Appends a block to a note without ever truncating existing content. */
  async append(targetPath: string, block: string): Promise<WriteResult> {
    const absolute = resolveInsideVault(this.vaultRoot, targetPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    const current = await this.readIfExists(absolute);
    const separator =
      current === null || current === ""
        ? ""
        : current.endsWith("\n\n")
          ? ""
          : current.endsWith("\n")
            ? "\n"
            : "\n\n";
    const payload = `${current ?? ""}${separator}${block.endsWith("\n") ? block : `${block}\n`}`;

    return this.runWithRetry(absolute, payload, "append");
  }

  private async runWithRetry(
    absolute: string,
    payload: string,
    action: WriteAction,
  ): Promise<WriteResult> {
    const notes: string[] = [];
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.settle(absolute);
        await this.atomicWrite(absolute, payload);

        const verification = await this.verify(absolute, payload, action);
        if (verification.ok) {
          const conflictFiles = await this.findConflictFiles(absolute);
          return {
            action,
            path: absolute,
            relativePath: toRelative(this.vaultRoot, absolute),
            title: path.basename(absolute).replace(/\.md$/i, ""),
            bytes: Buffer.byteLength(payload, "utf8"),
            verified: true,
            attempts: attempt,
            conflictFiles,
            notes: [...notes, ...verification.notes],
          };
        }

        notes.push(verification.note);
        lastError = new Error(verification.note);
        await this.sleep(this.retryDelayMs);
      } catch (error) {
        if (!isTransient(error)) throw error;
        lastError = error;
        notes.push(`attempt ${attempt}: ${errorCode(error) ?? "unknown error"}`);
        await this.sleep(this.retryDelayMs);
      }
    }

    throw new VaultWriteError(
      `Could not write ${toRelative(this.vaultRoot, absolute)} after ${this.maxAttempts} attempts: ${
        (lastError as Error | undefined)?.message ?? "unknown error"
      }`,
      this.maxAttempts,
    );
  }

  /**
   * Waits a moment when the file looks like it is being synced right now.
   * The check uses the fs.watch based watcher when available and falls back to
   * the modification time.
   */
  private async settle(absolute: string): Promise<void> {
    const recentlyTouched =
      this.watcher?.recentlyChanged(absolute, this.settleDelayMs * 2) ?? false;
    if (!recentlyTouched) {
      const info = await this.statIfExists(absolute);
      if (info && Date.now() - info.mtimeMs < this.settleDelayMs) {
        await this.sleep(this.settleDelayMs);
      }
      return;
    }
    await this.sleep(this.settleDelayMs);
  }

  /** Writes to a temp file in the same directory and renames it over the target. */
  private async atomicWrite(absolute: string, payload: string): Promise<void> {
    const directory = path.dirname(absolute);
    const temp = path.join(
      directory,
      `.${path.basename(absolute)}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await writeFile(temp, payload, { encoding: "utf8", flag: "wx" });
      await rename(temp, absolute);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Reads the file back after the write. A concurrent Syncthing update may
   * have replaced our content; for appends we accept the file as long as our
   * block survived, because the rest of the note is newer data, not a loss.
   */
  private async verify(
    absolute: string,
    payload: string,
    action: WriteAction,
  ): Promise<{ ok: boolean; note: string; notes: string[] }> {
    await this.sleep(this.verifyDelayMs);
    const actual = await this.readIfExists(absolute);
    if (actual === null) {
      return { ok: false, note: "file disappeared right after the write", notes: [] };
    }
    if (actual === payload) {
      return { ok: true, note: "", notes: [] };
    }
    if (action === "append" && actual.includes(payload)) {
      return {
        ok: true,
        note: "the note was updated concurrently, the appended block was preserved",
        notes: ["the note was updated concurrently, the appended block was preserved"],
      };
    }
    return {
      ok: false,
      note: "the file changed right after the write, retrying",
      notes: ["the file changed right after the write, retrying"],
    };
  }

  /** Syncthing writes conflicts as `<name>.sync-conflict-<date>-<time>.md`. */
  private async findConflictFiles(absolute: string): Promise<string[]> {
    const directory = path.dirname(absolute);
    const base = path.basename(absolute);
    const stem = base.replace(/\.md$/i, "");
    try {
      const entries = await readdir(directory);
      return entries
        .filter(
          (entry) =>
            entry.startsWith(`.${stem}.sync-conflict-`) ||
            entry.startsWith(`${stem}.sync-conflict-`),
        )
        .map((entry) => path.join(directory, entry));
    } catch {
      return [];
    }
  }

  private async exists(absolute: string): Promise<boolean> {
    try {
      await access(absolute, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async statIfExists(absolute: string): Promise<{ mtimeMs: number } | null> {
    try {
      return await stat(absolute);
    } catch {
      return null;
    }
  }

  private async readIfExists(absolute: string): Promise<string | null> {
    try {
      return await readFile(absolute, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  }
}
