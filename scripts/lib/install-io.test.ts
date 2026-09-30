import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeNewFile } from "./install-io.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "wowc-install-io-"));
  dirs.push(dir);
  return dir;
};

describe("writeNewFile", () => {
  it("creates a file that does not exist", () => {
    const path = join(tempDir(), "config.json");
    expect(writeNewFile(path, "new\n")).toEqual({ ok: true, value: undefined });
    expect(readFileSync(path, "utf-8")).toBe("new\n");
  });

  it("refuses to overwrite an existing file and leaves its bytes alone", () => {
    const path = join(tempDir(), "config.json");
    writeFileSync(path, "mine");
    const result = writeNewFile(path, "installer");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("not overwritten");
    expect(readFileSync(path, "utf-8")).toBe("mine");
  });
});
