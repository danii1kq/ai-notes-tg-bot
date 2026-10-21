import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Environment contract of the bot. Everything the process needs is validated
 * once, at start-up, so a misconfigured deployment fails loudly instead of
 * failing inside a Telegram handler ten minutes later.
 */
const envSchema = z.object({
  // --- Telegram -----------------------------------------------------------
  TELEGRAM_BOT_TOKEN: z.string().min(10, "TELEGRAM_BOT_TOKEN is required"),
  /** Comma separated list of Telegram user ids allowed to talk to the bot. */
  ALLOWED_TELEGRAM_ID: z.string().min(1, "ALLOWED_TELEGRAM_ID is required"),

  // --- Obsidian vault -----------------------------------------------------
  OBSIDIAN_VAULT_PATH: z.string().min(1, "OBSIDIAN_VAULT_PATH is required"),
  TIMEZONE: z.string().default("Asia/Almaty"),

  // --- Hermes Agent -------------------------------------------------------
  HERMES_BIN: z.string().default("hermes"),
  HERMES_MODEL: z.string().default("minimax-m3.1-flash-free"),
  HERMES_FALLBACK_MODEL: z.string().default("deepseek-v4.1-flash"),
  HERMES_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  HERMES_MAX_TURNS: z.coerce.number().int().positive().default(16),
  HERMES_WORKSPACE: z.string().default("/app/hermes-workspace"),

  // --- LLM relay (OpenCode Go) -------------------------------------------
  LLM_PROVIDER_BASE_URL: z.string().default("https://opencode.ai/zen/go/v1"),
  LLM_PROXY_HOST: z.string().default("127.0.0.1"),
  LLM_PROXY_PORT: z.coerce.number().int().positive().default(11434),
  LLM_API_KEY: z.string().default(""),
  LLM_SESSION_ID: z.string().default(""),

  // --- Local state --------------------------------------------------------
  DB_PATH: z.string().default("/app/data/app.db"),
  VAULT_EVENTS_FILE: z.string().default("/app/data/vault-events.json"),
  VAULT_RETRY_DELAY_MS: z.coerce.number().int().positive().default(500),
  VAULT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  VAULT_SETTLE_DELAY_MS: z.coerce.number().int().positive().default(1000),

  // --- Mini App -----------------------------------------------------------
  /** The public address of the Mini App, for the menu button of the bot. */
  MINI_APP_URL: z.string().default(""),
  /** The token for the browser: outside of Telegram there is no init data. */
  MINI_APP_TOKEN: z.string().default(""),
  /** The folder with the built frontend. */
  WEB_ROOT: z.string().default("/app/web"),

  // --- Misc ---------------------------------------------------------------
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Text sent right after a message is accepted; empty disables the ack. */
  BOT_ACK: z.string().default(""),
  /** Health endpoint of the application. */
  HEALTH_HOST: z.string().default("0.0.0.0"),
  HEALTH_PORT: z.coerce.number().int().positive().default(8080),
});

export type AppConfig = {
  telegram: {
    botToken: string;
    allowedUserIds: Set<number>;
  };
  vault: {
    path: string;
    timeZone: string;
    retryDelayMs: number;
    maxAttempts: number;
    settleDelayMs: number;
    eventsFile: string;
  };
  hermes: {
    bin: string;
    model: string;
    fallbackModel: string;
    timeoutMs: number;
    maxTurns: number;
    workspace: string;
  };
  llm: {
    providerBaseUrl: string;
    proxyHost: string;
    proxyPort: number;
    apiKey: string;
    sessionId: string;
  };
  db: {
    path: string;
  };
  miniApp: {
    url: string;
    token: string;
    webRoot: string;
  };
  logLevel: "debug" | "info" | "warn" | "error";
  botAck: string;
  health: {
    host: string;
    port: number;
  };
};

/**
 * Finds the Hermes Agent binary. The name from the environment is looked up
 * in the PATH, and when it is not there the standard place inside HERMES_HOME
 * is used, so the agent is found even when the process was started without
 * the prepared PATH.
 */
function resolveHermesBin(value: string, env: NodeJS.ProcessEnv): string {
  if (value.includes(path.sep) || value.includes("/")) return value;

  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, value);
    if (existsSync(candidate)) return candidate;
  }

  const home = env.HERMES_HOME ?? "/home/node/.hermes";
  const candidate = path.join(home, "hermes-agent", value);
  return existsSync(candidate) ? candidate : value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const raw = parsed.data;
  const allowedUserIds = new Set(
    raw.ALLOWED_TELEGRAM_ID.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        const id = Number.parseInt(value, 10);
        if (!Number.isFinite(id)) {
          throw new Error(`ALLOWED_TELEGRAM_ID contains a non numeric id: "${value}"`);
        }
        return id;
      }),
  );

  if (allowedUserIds.size === 0) {
    throw new Error("ALLOWED_TELEGRAM_ID must contain at least one Telegram user id");
  }

  return {
    telegram: {
      botToken: raw.TELEGRAM_BOT_TOKEN,
      allowedUserIds,
    },
    vault: {
      path: raw.OBSIDIAN_VAULT_PATH,
      timeZone: raw.TIMEZONE,
      retryDelayMs: raw.VAULT_RETRY_DELAY_MS,
      maxAttempts: raw.VAULT_MAX_ATTEMPTS,
      settleDelayMs: raw.VAULT_SETTLE_DELAY_MS,
      eventsFile: raw.VAULT_EVENTS_FILE,
    },
    hermes: {
      bin: resolveHermesBin(raw.HERMES_BIN, env),
      model: raw.HERMES_MODEL,
      fallbackModel: raw.HERMES_FALLBACK_MODEL,
      timeoutMs: raw.HERMES_TIMEOUT_MS,
      maxTurns: raw.HERMES_MAX_TURNS,
      workspace: raw.HERMES_WORKSPACE,
    },
    llm: {
      providerBaseUrl: raw.LLM_PROVIDER_BASE_URL,
      proxyHost: raw.LLM_PROXY_HOST,
      proxyPort: raw.LLM_PROXY_PORT,
      apiKey: raw.LLM_API_KEY,
      sessionId: raw.LLM_SESSION_ID,
    },
    db: {
      path: raw.DB_PATH,
    },
    miniApp: {
      url: raw.MINI_APP_URL,
      token: raw.MINI_APP_TOKEN,
      webRoot: raw.WEB_ROOT,
    },
    logLevel: raw.LOG_LEVEL,
    botAck: raw.BOT_ACK,
    health: {
      host: raw.HEALTH_HOST,
      port: raw.HEALTH_PORT,
    },
  };
}
