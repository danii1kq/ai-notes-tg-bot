import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
import { HermesClient } from "./hermes/client.js";
import { createLlmProxy } from "./llm/proxy.js";
import { createLogger } from "./logger.js";
import { processMessage } from "./pipeline.js";
import { VaultGuard } from "./vault/guard.js";
import { VaultOperations } from "./vault/operations.js";
import { VaultWatcher } from "./vault/watcher.js";

/**
 * Runs one message through the whole pipeline without Telegram.
 *
 * Usage: node dist/selftest.js "текст заметки"
 *
 * It is the smoke test of a deployment: the same agent, the same vault tools
 * and the same fallback writer, only the Telegram part is left out.
 */
async function main(): Promise<void> {
  const text = process.argv.slice(2).join(" ").trim();
  if (!text) {
    process.stderr.write("usage: node dist/selftest.js <text>\n");
    process.exit(2);
  }

  const config = loadConfig();
  const logger = createLogger(config.logLevel, "selftest");

  await mkdir(config.vault.path, { recursive: true });
  await mkdir(path.dirname(path.resolve(config.vault.eventsFile)), { recursive: true });
  await mkdir(path.dirname(path.resolve(config.db.path)), { recursive: true });

  const { client } = await createDatabase(config.db.path);

  const watcher = new VaultWatcher(config.vault.path);
  watcher.start();

  const guard = new VaultGuard({
    vaultRoot: config.vault.path,
    retryDelayMs: config.vault.retryDelayMs,
    maxAttempts: config.vault.maxAttempts,
    settleDelayMs: config.vault.settleDelayMs,
    watcher,
  });

  const vault = new VaultOperations({
    guard,
    eventsFile: config.vault.eventsFile,
    timeZone: config.vault.timeZone,
    logger: logger.child("vault"),
  });

  const proxy = createLlmProxy({
    host: config.llm.proxyHost,
    port: config.llm.proxyPort,
    targetBaseUrl: config.llm.providerBaseUrl,
    apiKey: config.llm.apiKey,
    sessionId: config.llm.sessionId || `selftest-${process.pid}`,
    logger: logger.child("llm"),
  });
  await proxy.start();

  const hermes = new HermesClient({
    bin: config.hermes.bin,
    model: config.hermes.model,
    fallbackModel: config.hermes.fallbackModel,
    timeoutMs: config.hermes.timeoutMs,
    maxTurns: config.hermes.maxTurns,
    workspace: config.hermes.workspace,
    env: process.env,
    logger: logger.child("hermes"),
  });

  const result = await processMessage(text, 0, { config, hermes, vault, logger });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  watcher.stop();
  await proxy.stop();
  client.close();
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
