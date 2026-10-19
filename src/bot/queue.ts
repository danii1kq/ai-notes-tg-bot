import type { Logger } from "../logger.js";

/**
 * Runs the jobs one after another.
 *
 * The agent works on the vault, so two messages must never be processed at
 * the same time: the second one would read a half written note.
 */
export class MessageQueue {
  private readonly pending: Array<() => Promise<void>> = [];
  private running = false;

  constructor(private readonly logger: Logger) {}

  push(job: () => Promise<void>): void {
    this.pending.push(job);
    void this.drain();
  }

  get size(): number {
    return this.pending.length;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      try {
        await job();
      } catch (error) {
        this.logger.error("a queued job failed", { error: String(error) });
      }
    }
    this.running = false;
  }
}
