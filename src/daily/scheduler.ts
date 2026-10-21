import type { Logger } from "../logger.js";
import { localDate, nextLocalMidnightMs, previousDay } from "./time.js";

export interface DailySchedulerOptions {
  timeZone: string;
  logger: Logger;
  /** Makes the summary of a day. */
  run: (day: string) => Promise<void>;
  /** The current moment, for the tests. */
  now?: () => Date;
}

export interface DailyScheduler {
  /** Stops the scheduler. */
  stop: () => void;
  /** When the next summary is made. */
  nextRunAt: () => Date;
}

/**
 * Runs the summary of the day every midnight.
 *
 * The moment of the next run is calculated in the time zone of the owner, so
 * the summary of a day is ready right after that day is over.
 */
export function startDailyScheduler(options: DailySchedulerOptions): DailyScheduler {
  const now = options.now ?? (() => new Date());
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let next = nextLocalMidnightMs(now(), options.timeZone);

  const schedule = () => {
    if (stopped) return;
    const current = now();
    next = nextLocalMidnightMs(current, options.timeZone);
    const delay = Math.max(1000, next - current.getTime());

    timer = setTimeout(() => {
      void fire();
    }, delay);
  };

  const fire = async () => {
    if (stopped) return;
    const day = previousDay(localDate(now(), options.timeZone));
    try {
      await options.run(day);
    } catch (error) {
      options.logger.error("the daily summary failed", { day, error: String(error) });
    }
    schedule();
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    nextRunAt: () => new Date(next),
  };
}
