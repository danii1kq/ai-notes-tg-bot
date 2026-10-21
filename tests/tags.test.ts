import { describe, expect, it } from "vitest";
import { extractTags, mergeTags, parseTags } from "../src/vault/tags.js";

describe("extractTags", () => {
  it("finds the tags of a message", () => {
    expect(extractTags("идея для бизнеса #idea #work")).toEqual(["idea", "work"]);
  });

  it("keeps the tag names in lower case", () => {
    expect(extractTags("#Idea")).toEqual(["idea"]);
  });

  it("does not treat a heading as a tag", () => {
    expect(extractTags("# Заголовок\nтекст")).toEqual([]);
  });

  it("skips the tags that are only numbers", () => {
    expect(extractTags("цена #2026")).toEqual([]);
  });

  it("ignores the tags that are repeated", () => {
    expect(extractTags("#idea #idea")).toEqual(["idea"]);
  });
});

describe("parseTags", () => {
  it("reads the tags of the frontmatter", () => {
    expect(parseTags("---\ndate: 2026-10-22\ntags: [inbox, telegram]\n---\n\ntext")).toEqual([
      "inbox",
      "telegram",
    ]);
  });

  it("returns nothing when there is no frontmatter", () => {
    expect(parseTags("just text")).toEqual([]);
  });
});

describe("mergeTags", () => {
  it("adds a tag to an existing list", () => {
    const result = mergeTags(
      "---\ndate: 2026-10-22\ntags: [inbox]\n---\n\ntext",
      ["idea"],
      "2026-10-22",
    );
    expect(result).toContain("tags: [inbox, idea]");
  });

  it("keeps the note as it is when the tag is already there", () => {
    const note = "---\ndate: 2026-10-22\ntags: [inbox, idea]\n---\n\ntext";
    expect(mergeTags(note, ["idea"], "2026-10-22")).toBe(note);
  });

  it("creates the frontmatter when it is missing", () => {
    const result = mergeTags("text", ["idea"], "2026-10-22");
    expect(result.startsWith("---\ndate: 2026-10-22\ntags: [idea]\n---")).toBe(true);
  });

  it("replaces a broken tags line", () => {
    const result = mergeTags(
      "---\ndate: 2026-10-22\ntags: broken\n---\n\ntext",
      ["idea"],
      "2026-10-22",
    );
    expect(result).toContain("tags: [idea]");
    expect(result).not.toContain("tags: broken");
  });
});
