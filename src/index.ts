import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import type { Bot } from "grammy";
import { createBot } from "./bot/bot.js";
import { MessageQueue } from "./bot/queue.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
import { notesLog } from "./db/schema.js";
import { HermesClient } from "./hermes/client.js";
import { createLlmProxy } from "./llm/proxy.js";
import { createLogger } from "./logger.js";
import { processMessage } from "./pipeline.js";
import { VaultGuard } from "./vault/guard.js";
import { VaultOperations } from "./vault/operations.js";
import { VaultWatcher } from "./vault/watcher.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, "bot");

  logger.info("starting", {
    vault: config.vault.path,
    model: config.hermes.model,
    fallbackModel: config.hermes.fallbackModel,
    allowedUsers: [...config.telegram.allowedUserIds],
  });

  await mkdir(config.vault.path, { recursive: true });
  await mkdir(path.dirname(path.resolve(config.db.path)), { recursive: true });
  await mkdir(path.dirname(path.resolve(config.vault.eventsFile)), { recursive: true });

  const { client, db } = await createDatabase(config.db.path);

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

  // The model provider is reached through a local proxy: it adds the session
  // header the OpenCode Go relay requires and keeps the key out of the agent.
  const proxy = createLlmProxy({
    host: config.llm.proxyHost,
    port: config.llm.proxyPort,
    targetBaseUrl: config.llm.providerBaseUrl,
    apiKey: config.llm.apiKey,
    sessionId: config.llm.sessionId || `tg-obsidian-${process.pid}`,
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

  const queue = new MessageQueue(logger.child("queue"));

  const bot: Bot = createBot({
    config,
    logger: logger.child("telegram"),
    onText: async (text, userId, chatId) => {
      queue.push(async () => {
        if (config.botAck) {
          await bot.api.sendMessage(chatId, config.botAck).catch(() => undefined);
        }
        try {
          const result = await processMessage(text, userId, {
            config,
            hermes,
            vault,
            logger: logger.child("pipeline"),
          });
          await bot.api.sendMessage(chatId, result.status);
          await db.insert(notesLog).values({
            createdAt: new Date().toISOString(),
            action: result.action,
            path: result.path,
            title: result.title,
            source: result.usedFallback ? "fallback" : "agent",
            bytes: 0,
            telegramUserId: String(userId),
          });
        } catch (error) {
          logger.error("could not process the message", { error: String(error) });
          await bot.api
            .sendMessage(chatId, "⚠️ Не смог записать заметку, попробуй ещё раз.")
            .catch(() => undefined);
        }
      });
    },
    onStatus: async () => {
      const rows = await db.select().from(notesLog).orderBy(notesLog.id).limit(5);
      if (rows.length === 0) return "Пока ничего не записано.";
      const lines = rows.map((row) => `• ${row.title} (${row.action})`);
      return `Последние записи:\n${lines.join("\n")}`;
    },
  });

  const healthServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "telegram-to-obsidian-ai-agent" }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
  });
  await new Promise<void>((resolve) => {
    healthServer.listen(config.health.port, config.health.host, () => {
      logger.info("health endpoint listening", {
        host: config.health.host,
        port: config.health.port,
      });
      resolve();
    });
  });

  const stop = async (signal: string) => {
    logger.info("stopping", { signal });
    watcher.stop();
    await proxy.stop();
    healthServer.close();
    client.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  await bot.start({
    onStart: (info) => logger.info("the bot is polling Telegram", { username: info.username }),
    drop_pending_updates: true,
  });
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
