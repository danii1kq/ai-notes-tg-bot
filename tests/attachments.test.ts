import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attachmentKind, embedMarkdown, saveAttachment } from "../src/vault/attachments.js";

describe("saveAttachment", () => {
  it("stores the file in the attachments folder", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "attach-"));
    const saved = await saveAttachment(
      vault,
      "photo of the board.jpg",
      new Uint8Array([1, 2, 3]),
      "2026-10-22",
    );

    expect(saved.relativePath).toBe("attachments/2026-10-22_photo of the board.jpg");
    expect(saved.bytes).toBe(3);
    expect(saved.kind).toBe("image");

    const content = await readFile(path.join(vault, saved.relativePath));
    expect(content.byteLength).toBe(3);
  });

  it("does not overwrite a file with the same name", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "attach-"));
    const first = await saveAttachment(vault, "note.pdf", new Uint8Array([1]), "2026-10-22");
    const second = await saveAttachment(vault, "note.pdf", new Uint8Array([2]), "2026-10-22");

    expect(first.name).toBe("2026-10-22_note.pdf");
    expect(second.name).toBe("2026-10-22_note_2.pdf");
  });

  it("keeps the file inside the vault", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "attach-"));
    const saved = await saveAttachment(
      vault,
      "../../escape.txt",
      new Uint8Array([1]),
      "2026-10-22",
    );
    expect(saved.relativePath.startsWith("attachments/")).toBe(true);
    expect(saved.name).not.toContain("..");
  });
});

describe("attachmentKind", () => {
  it("knows the kinds of the files", () => {
    expect(attachmentKind("a.png")).toBe("image");
    expect(attachmentKind("a.mp4")).toBe("video");
    expect(attachmentKind("a.mp3")).toBe("audio");
    expect(attachmentKind("a.pdf")).toBe("document");
  });
});

describe("embedMarkdown", () => {
  it("builds the embed of a file", () => {
    expect(embedMarkdown("2026-10-22_photo.jpg")).toBe("![[2026-10-22_photo.jpg]]");
  });
});
