export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogStream = "stdout" | "stderr";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_PATTERN = /(token|secret|password|api[_-]?key|authorization)/i;

/**
 * The secrets that can slip into a log as a part of a text.
 *
 * - the key of the model provider, `oc_sk_...`,
 * - the token of the bot of Telegram, `123456789:AA...`,
 * - the header of the authorization, `Bearer ...`,
 * - the token of the owner in the address of the Mini App, `?token=...`.
 */
const SECRET_VALUES: Array<[RegExp, string]> = [
  [/oc_sk_[A-Za-z0-9]{4}[A-Za-z0-9]+/g, "oc_sk_***"],
  [/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, "***"],
  [/\bBearer\s+[A-Za-z0-9._-]{12,}/g, "Bearer ***"],
  [/([?&]token=)[^&\s"']+/gi, "$1***"],
  [/([?&]hash=)[^&\s"']+/gi, "$1***"],
];

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const [pattern, replacement] of SECRET_VALUES) {
      result = result.replace(pattern, replacement);
    }
    return result;
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

export function createLogger(
  level: LogLevel = "info",
  scope = "bot",
  stream: LogStream = "stdout",
): Logger {
  const threshold = LEVELS[level];
  const write = (line: string, entryLevel: LogLevel) => {
    if (entryLevel === "error" || stream === "stderr") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  const emit = (entryLevel: LogLevel, message: string, context?: Record<string, unknown>) => {
    if (LEVELS[entryLevel] < threshold) return;
    const payload = {
      ts: new Date().toISOString(),
      level: entryLevel,
      scope,
      message,
      ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
    };
    write(JSON.stringify(payload), entryLevel);
  };

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
    child: (childScope: string) => createLogger(level, `${scope}:${childScope}`, stream),
  };
}
