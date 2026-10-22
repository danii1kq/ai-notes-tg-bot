import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/index.js";
import { isLanguage, messages } from "../src/i18n/index.js";
import { resolveLanguage, saveLanguage } from "../src/settings/language.js";

async function makeStore() {
  const root = await mkdtemp(path.join(tmpdir(), "language-"));
  const { client, db } = await createDatabase(path.join(root, "app.db"));
  return {
    client,
    store: {
      db,
      options: {
        defaultLanguage: "en" as const,
        ownerLanguage: "ru" as const,
        ownerIds: new Set([42]),
      },
    },
  };
}

describe("the languages", () => {
  it("knows English and Russian", () => {
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("ru")).toBe(true);
    expect(isLanguage("de")).toBe(false);
  });

  it("has the same texts in both languages", () => {
    const en = messages("en");
    const ru = messages("ru");
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    expect(en.help).not.toBe(ru.help);
  });
});

describe("resolveLanguage", () => {
  it("gives the owner the language of the owner", async () => {
    const { client, store } = await makeStore();
    expect(await resolveLanguage(store, 42)).toBe("ru");
    client.close();
  });

  it("gives the other users the default language", async () => {
    const { client, store } = await makeStore();
    expect(await resolveLanguage(store, 7)).toBe("en");
    client.close();
  });

  it("keeps the language the user has chosen", async () => {
    const { client, store } = await makeStore();
    await saveLanguage(store, 42, "en");
    expect(await resolveLanguage(store, 42)).toBe("en");
    client.close();
  });
});
