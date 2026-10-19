import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  noteFileName,
  resolveInsideVault,
  sanitizeFileName,
  toRelative,
  VaultPathError,
} from "../src/vault/paths.js";

const VAULT = path.resolve(path.sep === "\\" ? "C:\\vault" : "/opt/obsidian-vault");

describe("resolveInsideVault", () => {
  it("resolves a relative path inside the vault", () => {
    expect(resolveInsideVault(VAULT, "Ideas.md")).toBe(path.join(VAULT, "Ideas.md"));
  });

  it("keeps an absolute path that is inside the vault", () => {
    const resolved = resolveInsideVault(VAULT, path.join(VAULT, "Notes", "Ideas.md"));
    expect(resolved.endsWith(path.join("Notes", "Ideas.md"))).toBe(true);
  });

  it("rejects a path that escapes the vault", () => {
    expect(() => resolveInsideVault(VAULT, "../../etc/passwd")).toThrow(VaultPathError);
  });

  it("rejects an absolute path outside of the vault", () => {
    expect(() =>
      resolveInsideVault(VAULT, path.resolve(path.sep === "\\" ? "C:\\Windows" : "/etc", "passwd")),
    ).toThrow(VaultPathError);
  });

  it("rejects an empty path", () => {
    expect(() => resolveInsideVault(VAULT, "   ")).toThrow(VaultPathError);
  });
});

describe("toRelative", () => {
  it("returns a posix path relative to the vault", () => {
    expect(toRelative(VAULT, path.join(VAULT, "a", "b.md"))).toBe("a/b.md");
  });
});

describe("sanitizeFileName", () => {
  it("removes characters that are not allowed in a file name", () => {
    expect(sanitizeFileName('Ideas: "for 2026"/plan?')).toBe("Ideas for 2026 plan");
  });

  it("keeps a name that is already safe", () => {
    expect(sanitizeFileName("Business ideas")).toBe("Business ideas");
  });

  it("falls back to Untitled for an empty title", () => {
    expect(sanitizeFileName("   ")).toBe("Untitled");
  });
});

describe("noteFileName", () => {
  it("adds the markdown extension", () => {
    expect(noteFileName("Ideas")).toBe("Ideas.md");
  });

  it("does not add the extension twice", () => {
    expect(noteFileName("Ideas.md")).toBe("Ideas.md");
  });
});
