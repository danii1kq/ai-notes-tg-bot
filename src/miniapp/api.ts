import { readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Language } from "../i18n/index.js";
import type { Logger } from "../logger.js";
import type { VaultOperations } from "../vault/operations.js";
import { validateInitData } from "./auth.js";

export interface SummaryEntry {
  /** The day of the summary, `2026-10-21`. */
  date: string;
  /** The text of the summary. */
  summary: string;
  /** The file of the month with the summary. */
  file: string;
}

export interface MiniAppOptions {
  vault: VaultOperations;
  botToken: string;
  /** The token for the browser: there is no init data outside of Telegram. */
  browserToken: string;
  logger: Logger;
  /** The folder with the built frontend. */
  webRoot: string;
  /** The summaries of the days, they are shown at the top of the list. */
  summaries?: () => Promise<SummaryEntry[]>;
  /** The file for the data that was not accepted, for the diagnostics. */
  debugFile?: string;
  /** The name of the bot, for the button that opens the chat with it. */
  botUsername?: () => string;
  /** The language of a user, for the texts of the app. */
  language?: (userId: number) => Promise<Language>;
  /** The language of the app when there is no user behind the request. */
  defaultLanguage?: Language;
  /** The id of the owner, for the requests from the browser. */
  ownerId?: number;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * The Mini App of the notes.
 *
 * The frontend is a static build that lives in the image, the data comes from
 * the vault through a small API. Every request is checked: the Mini App sends
 * the signed data of Telegram, the browser sends the token of the owner.
 */
export function createMiniApp(options: MiniAppOptions) {
  const { vault, botToken, browserToken, logger, webRoot } = options;

  return async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(request, response, url, pathname);
      return true;
    }

    // Everything else belongs to the frontend: the page itself and the assets
    // of the build. The paths of the assets are relative, so they are asked
    // for from the root of the app.
    await serveStatic(response, pathname);
    return true;
  };

  async function handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    pathname: string,
  ): Promise<void> {
    if (!isAllowed(request, url)) {
      logger.warn("a request to the mini app was not allowed", { path: pathname });
      sendJson(response, 401, { ok: false, error: "not allowed" });
      return;
    }

    try {
      if (pathname === "/api/config") {
        const userId = await currentUserId(request, url);
        const language = userId
          ? ((await options.language?.(userId)) ?? options.defaultLanguage ?? "en")
          : (options.defaultLanguage ?? "en");
        sendJson(response, 200, {
          ok: true,
          botUsername: options.botUsername?.() ?? "",
          language,
        });
        return;
      }

      if (pathname === "/api/summaries") {
        const entries = options.summaries ? await options.summaries() : [];
        sendJson(response, 200, { ok: true, summaries: entries });
        return;
      }

      if (pathname === "/api/notes") {
        const limit = clamp(Number(url.searchParams.get("limit") ?? 60), 1, 200);
        const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
        const notes = await vault.listNotesDetailed(limit + offset);
        sendJson(response, 200, { ok: true, notes: notes.slice(offset) });
        return;
      }

      if (pathname === "/api/note") {
        const target = url.searchParams.get("path") ?? "";
        if (!target) {
          sendJson(response, 400, { ok: false, error: "no path" });
          return;
        }
        const file = await vault.readFile(target);
        sendJson(response, 200, {
          ok: true,
          note: {
            path: file.relativePath,
            content: file.content,
            bytes: Buffer.byteLength(file.content, "utf8"),
          },
        });
        return;
      }

      if (pathname === "/api/search") {
        const query = (url.searchParams.get("q") ?? "").trim();
        if (!query) {
          sendJson(response, 200, { ok: true, hits: [] });
          return;
        }
        const byName = await vault.searchFiles({ target: "files", pattern: query });
        const byContent = await vault.searchFiles({ target: "content", pattern: query });
        const seen = new Set<string>();
        const hits = [];
        for (const hit of [...byName, ...byContent]) {
          if (seen.has(hit.relativePath)) continue;
          seen.add(hit.relativePath);
          hits.push({
            path: hit.relativePath,
            title: hit.title,
            line: hit.line ?? null,
            snippet: hit.snippet ?? "",
          });
          if (hits.length >= 40) break;
        }
        sendJson(response, 200, { ok: true, hits });
        return;
      }

      if (pathname === "/api/file") {
        const target = url.searchParams.get("path") ?? "";
        const file = await vault.readBinary(target).catch(() => null);
        if (!file) {
          sendJson(response, 404, { ok: false, error: "no file" });
          return;
        }
        const type =
          CONTENT_TYPES[path.extname(file.relativePath).toLowerCase()] ??
          "application/octet-stream";
        response.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
        response.end(Buffer.from(file.data));
        return;
      }

      sendJson(response, 404, { ok: false, error: "unknown endpoint" });
    } catch (error) {
      logger.error("the mini app api failed", { path: pathname, error: String(error) });
      sendJson(response, 500, { ok: false, error: "the server could not answer" });
    }
  }

  /**
   * The user behind the request: the signed data of Telegram carries the id,
   * the browser of the owner is the owner itself.
   */
  async function currentUserId(request: IncomingMessage, url: URL): Promise<number | undefined> {
    const initData = request.headers["x-telegram-init-data"];
    if (typeof initData === "string" && initData.length > 0) {
      const result = validateInitData(initData, botToken);
      return result.ok ? result.user?.id : undefined;
    }

    const header = request.headers["x-auth-token"];
    const token = typeof header === "string" ? header : url.searchParams.get("token");
    if (token && browserToken && token === browserToken) return options.ownerId;
    return undefined;
  }

  /** The signed data of Telegram or the token of the owner. */
  function isAllowed(request: IncomingMessage, url: URL): boolean {
    const initData = request.headers["x-telegram-init-data"];
    if (typeof initData === "string" && initData.length > 0) {
      const result = validateInitData(initData, botToken);
      if (result.ok) return true;
      logger.warn("the init data of telegram was not accepted", {
        reason: result.error,
        length: initData.length,
        fields: [...new URLSearchParams(initData).keys()],
      });
      void saveDebug(initData);
      return false;
    }

    const header = request.headers["x-auth-token"];
    const token = typeof header === "string" ? header : url.searchParams.get("token");
    if (token && browserToken && token === browserToken) return true;

    logger.warn("a request to the mini app came without the data of telegram", {
      path: url.pathname,
    });
    return false;
  }

  /**
   * Keeps the last rejected data of Telegram in a file, so the problem can be
   * looked at. The file is only written when the path is set.
   */
  async function saveDebug(initData: string): Promise<void> {
    if (!options.debugFile) return;
    try {
      await writeFile(options.debugFile, initData, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      logger.warn("could not write the debug file", { error: String(error) });
    }
  }

  async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
    const root = path.resolve(webRoot);
    const relative = pathname
      .replace(/^\/app\//, "")
      .replace(/^\//, "")
      .trim();
    const target = path.resolve(root, relative === "" ? "index.html" : relative);
    const inside = path.relative(root, target);
    if (inside.startsWith("..") || path.isAbsolute(inside)) {
      sendJson(response, 403, { ok: false, error: "forbidden" });
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) {
      // A missing file with an extension is a missing file, not a page.
      if (path.extname(relative) !== "") {
        sendJson(response, 404, { ok: false, error: "not found" });
        return;
      }
      // The Mini App is a single page, every unknown path leads to it.
      const index = path.resolve(root, "index.html");
      const html = await readFile(index).catch(() => null);
      if (!html) {
        sendJson(response, 404, { ok: false, error: "the mini app is not built" });
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }

    const body = await readFile(target);
    const type = CONTENT_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream";
    response.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    response.end(body);
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
