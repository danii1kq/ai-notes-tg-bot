export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_PATTERN = /(token|secret|password|api[_-]?key|authorization)/i;

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/(oc_sk_[A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1***");
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_PATTERN.test(key) ? "***" : redact(item);
    }
    return out;
  }
  return value;
}

export type Logger = {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(scope: string): Logger;
};

export function createLogger(level: LogLevel = "info", scope = "bot"): Logger {
  const threshold = LEVELS[level];

  const emit = (entryLevel: LogLevel, message: string, context?: Record<string, unknown>) => {
    if (LEVELS[entryLevel] < threshold) return;
    const payload = {
      ts: new Date().toISOString(),
      level: entryLevel,
      scope,
      message,
      ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
    };
    const line = JSON.stringify(payload);
    if (entryLevel === "error") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
    child: (childScope: string) => createLogger(level, `${scope}:${childScope}`),
  };
}
