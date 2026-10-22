import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";

const BASE = {
  TELEGRAM_BOT_TOKEN: "1234567890:AAHtesttokenvalue1234567890abcdef",
  ALLOWED_TELEGRAM_ID: "42",
  OBSIDIAN_VAULT_PATH: "/vault",
};

describe("the secrets in the log", () => {
  it("hides the token of the bot", () => {
    const logger = createLogger("info", "test");
    const line = capture(logger, { token: "1234567890:AAHtesttokenvalue1234567890abcdef" });
    expect(line).not.toContain("AAHtesttokenvalue");
    expect(line).toContain("***");
  });

  it("hides the key of the model in a text", () => {
    const logger = createLogger("info", "test");
    const line = capture(logger, { note: "the key is oc_sk_abcdef1234567890 here" });
    expect(line).not.toContain("oc_sk_abcdef1234567890");
  });

  it("hides the token in an address", () => {
    const logger = createLogger("info", "test");
    const line = capture(logger, { url: "https://notes.example.com/?token=secretvalue123" });
    expect(line).not.toContain("secretvalue123");
  });

  it("hides the header of the authorization", () => {
    const logger = createLogger("info", "test");
    const line = capture(logger, { header: "Bearer abcdefghijklmnopqrst" });
    expect(line).not.toContain("abcdefghijklmnopqrst");
  });
});

describe("the webhook", () => {
  it("needs the secret of Telegram", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        TELEGRAM_MODE: "webhook",
        TELEGRAM_WEBHOOK_URL: "https://notes.example.com/webhook",
      } as NodeJS.ProcessEnv),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it("needs an https address", () => {
    expect(() =>
      loadConfig({
        ...BASE,
        TELEGRAM_MODE: "webhook",
        TELEGRAM_WEBHOOK_URL: "http://notes.example.com/webhook",
        TELEGRAM_WEBHOOK_SECRET: "a-secret-that-is-long-enough",
      } as NodeJS.ProcessEnv),
    ).toThrow(/https/);
  });

  it("takes the secret when it is there", () => {
    const config = loadConfig({
      ...BASE,
      TELEGRAM_MODE: "webhook",
      TELEGRAM_WEBHOOK_URL: "https://notes.example.com/webhook",
      TELEGRAM_WEBHOOK_SECRET: "a-secret-that-is-long-enough",
    } as NodeJS.ProcessEnv);
    expect(config.telegram.webhookSecret).toBe("a-secret-that-is-long-enough");
  });
});

/** Writes one line of the log and gives it back. */
function capture(
  logger: ReturnType<typeof createLogger>,
  context: Record<string, unknown>,
): string {
  const original = process.stdout.write.bind(process.stdout);
  let line = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    line += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    logger.info("a test", context);
  } finally {
    process.stdout.write = original;
  }
  return line;
}
