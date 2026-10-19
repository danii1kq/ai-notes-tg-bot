import { type FSWatcher, watch } from "node:fs";
import path from "node:path";

/**
 * Watches the vault and remembers when a path was last touched.
 *
 * Syncthing rewrites a file by renaming a temporary file over it, so a write
 * that races with a sync can silently disappear. Before touching a file we ask
 * the watcher whether that file was just changed; if it was, we pause for a
 * moment and let the sync settle.
 */
export class VaultWatcher {
  private readonly lastChanged = new Map<string, number>();
  private watcher: FSWatcher | null = null;

  constructor(private readonly vaultRoot: string) {}

  start(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.vaultRoot, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const full = path.join(this.vaultRoot, filename.toString());
        this.lastChanged.set(full, Date.now());
        // Keep the map bounded: a long lived process would otherwise grow it
        // with every touched file.
        if (this.lastChanged.size > 2000) {
          const oldest = this.lastChanged.keys().next();
          if (!oldest.done) this.lastChanged.delete(oldest.value);
        }
      });
    } catch {
      // Recursive watching is not available everywhere; the guard falls back
      // to mtime based detection, so this is not fatal.
      this.watcher = null;
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  /** True when the path changed less than `withinMs` milliseconds ago. */
  recentlyChanged(absolutePath: string, withinMs: number): boolean {
    const changedAt = this.lastChanged.get(path.resolve(absolutePath));
    if (changedAt === undefined) return false;
    return Date.now() - changedAt < withinMs;
  }
}
