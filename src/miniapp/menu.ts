/**
 * The menu button of the bot.
 *
 * The button opens the Mini App with the notes. The address of the app has to
 * be an https link, Telegram accepts nothing else.
 */

export interface MenuButtonOptions {
  botToken: string;
  url: string;
  text?: string;
}

/** Sets the menu button of the bot. */
export async function setMenuButton(options: MenuButtonOptions): Promise<boolean> {
  if (!options.url) return false;

  const response = await fetch(
    `https://api.telegram.org/bot${options.botToken}/setChatMenuButton`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        menu_button: {
          type: "web_app",
          text: options.text ?? "Заметки",
          web_app: { url: options.url },
        },
      }),
    },
  );

  const payload = (await response.json()) as { ok: boolean; description?: string };
  if (!payload.ok) {
    throw new Error(payload.description ?? `the answer was ${response.status}`);
  }
  return true;
}
