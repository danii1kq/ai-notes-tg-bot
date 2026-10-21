import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The check of the Telegram Web App data.
 *
 * The Mini App sends the `initData` string it got from Telegram. The backend
 * signs it with the bot token and compares the result with the hash Telegram
 * put into the string, so nobody can read the notes without being the owner.
 */

export interface TelegramUser {
  id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

export interface InitDataResult {
  ok: boolean;
  user?: TelegramUser;
  error?: string;
}

/** The key of the secret: HMAC_SHA256(bot_token, "WebAppData"). */
function secretKey(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

/** Checks the `initData` of a Mini App. */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): InitDataResult {
  if (!initData) return { ok: false, error: "no init data" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "no hash in the init data" };

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const expected = createHmac("sha256", secretKey(botToken)).update(pairs.join("\n")).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, error: "the signature of the init data does not match" };
  }

  const authDate = Number(params.get("auth_date") ?? "0");
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, error: "no auth date in the init data" };
  }
  if (Date.now() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, error: "the init data is too old" };
  }

  const user = params.get("user");
  if (!user) return { ok: true };

  try {
    const parsed = JSON.parse(user) as TelegramUser;
    return { ok: true, user: parsed };
  } catch {
    return { ok: true };
  }
}
