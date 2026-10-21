import { Bot, type Context } from "grammy";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { describeAttachment, downloadAttachment } from "./attachments.js";

export interface BotDeps {
  config: AppConfig;
  logger: Logger;
  /** Runs the whole pipeline for a text message. */
  onText: (text: string, userId: number, chatId: number) => Promise<void>;
  /** Short status text of the bot, shown for /status. */
  onStatus: (userId: number) => Promise<string>;
  /** Searches the vault, shown for /search. */
  onSearch: (query: string, userId: number) => Promise<string>;
  /** Undoes the last write of the bot, shown for /undo. */
  onUndo: (userId: number, confirmed: boolean) => Promise<string>;
  /** Lists the notes of the inbox, shown for /inbox. */
  onInbox: (userId: number) => Promise<string>;
  /** Saves a file of the owner and writes a note about it. */
  onAttachment: (input: {
    caption: string;
    file: { name: string; data: Uint8Array };
    userId: number;
    chatId: number;
  }) => Promise<void>;
}

const HELP = [
  "Я превращаю твои мысли в заметки Obsidian.",
  "",
  "Просто пришли текст - я найду подходящую заметку или создам новую.",
  "Если нужно проверить факты, я сам полезу в интернет через DuckDuckGo.",
  "Теги пиши прямо в сообщении: #идея #работа - они попадут в заметку.",
  "",
  "Команды:",
  "/start - это сообщение",
  "/status - что уже записано",
  "/search запрос - найти заметку по слову",
  "/inbox - что ещё не разобрано",
  "/undo - отменить мою последнюю запись",
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

  bot.command("search", async (ctx) => {
    const query = ctx.match?.trim() ?? "";
    const result = await deps.onSearch(query, ctx.from?.id ?? 0);
    await ctx.reply(result);
  });

  bot.command("inbox", async (ctx) => {
    const result = await deps.onInbox(ctx.from?.id ?? 0);
    await ctx.reply(result);
  });

  bot.command("undo", async (ctx) => {
    const confirmed = (ctx.match ?? "").trim().toLowerCase() === "confirm";
    const result = await deps.onUndo(ctx.from?.id ?? 0, confirmed);
    await ctx.reply(result);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;
    const userId = ctx.from?.id ?? 0;
    const chatId = ctx.chat.id;
    await deps.onText(text, userId, chatId);
  });

  // A file of the owner: it is saved in the vault and gets a note.
  const handleFile = async (ctx: Context): Promise<void> => {
    const attachment = describeAttachment(ctx);
    if (!attachment) return;

    const userId = ctx.from?.id ?? 0;
    const chatId = ctx.chat?.id ?? 0;
    const caption = ctx.message?.caption?.trim() ?? "";

    try {
      const data = await downloadAttachment(bot, config.telegram.botToken, attachment.fileId);
      await deps.onAttachment({
        caption,
        file: { name: attachment.fileName, data },
        userId,
        chatId,
      });
    } catch (error) {
      logger.error("could not save the file", {
        error: String(error),
        fileName: attachment.fileName,
      });
      await ctx
        .reply("⚠️ Не смог сохранить файл. Максимальный размер - 20 МБ.")
        .catch(() => undefined);
    }
  };

  bot.on("message:document", handleFile);
  bot.on("message:photo", handleFile);
  bot.on("message:video", handleFile);
  bot.on("message:audio", handleFile);
  bot.on("message:voice", handleFile);

  return bot;
}
