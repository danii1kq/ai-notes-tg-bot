import { Bot } from "grammy";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export interface BotDeps {
  config: AppConfig;
  logger: Logger;
  /** Runs the whole pipeline for a text message. */
  onText: (text: string, userId: number, chatId: number) => Promise<void>;
  /** Short status text of the bot, shown for /status. */
  onStatus: (userId: number) => Promise<string>;
}

const HELP = [
  "Я превращаю твои мысли в заметки Obsidian.",
  "",
  "Просто пришли текст - я найду подходящую заметку или создам новую.",
  "Если нужно проверить факты, я сам полезу в интернет через DuckDuckGo.",
  "",
  "Команды:",
  "/start - это сообщение",
  "/status - что уже записано",
].join("\n");

/**
 * Creates the Telegram bot.
 *
 * The owner filter is the very first middleware: a message from anybody else
 * is dropped without an answer, so the bot stays a private tool.
 */
export function createBot(deps: BotDeps): Bot {
  const { config, logger } = deps;
  const bot = new Bot(config.telegram.botToken);

  bot.catch((error) => {
    logger.error("telegram error", { error: error.message });
  });

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from) return;
    if (!config.telegram.allowedUserIds.has(from.id)) {
      logger.warn("ignored a message from a user that is not allowed", {
        userId: from.id,
        username: from.username,
      });
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(HELP);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP);
  });

  bot.command("status", async (ctx) => {
    const status = await deps.onStatus(ctx.from?.id ?? 0);
    await ctx.reply(status);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;
    const userId = ctx.from?.id ?? 0;
    const chatId = ctx.chat.id;
    await deps.onText(text, userId, chatId);
  });

  return bot;
}
