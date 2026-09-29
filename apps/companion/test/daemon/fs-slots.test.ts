import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFsSlots } from "../../src/adapters/fs-slots.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wowc-fs-slots-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("daemon.fs-slots", () => {
  it("writes text and bytes", async () => {
    const fs = createFsSlots();
    const text = path.join(dir, "r.lua");
    const bytes = path.join(dir, "001.wav");
    await fs.writeFile(text, "WoWCompanion_Deliver('x', {})");
    await fs.writeFile(bytes, new Uint8Array([1, 2, 3]));
    expect(await readFile(text, "utf8")).toBe("WoWCompanion_Deliver('x', {})");
    expect([...(await readFile(bytes))]).toEqual([1, 2, 3]);
  });

  it("reports an existing empty file as present and a missing one as absent", async () => {
    const fs = createFsSlots();
    const file = path.join(dir, "002.wav");
    expect(await fs.exists(file)).toBe(false);
    await fs.writeFile(file, new Uint8Array(0));
    expect(await fs.exists(file)).toBe(true);
  });

  it("removes a file so it reads as absent, and treats an already absent file as removed", async () => {
    const fs = createFsSlots();
    const file = path.join(dir, "003.wav");
    await fs.writeFile(file, new Uint8Array(0));
    await fs.remove(file);
    expect(await fs.exists(file)).toBe(false);
    await expect(fs.remove(file)).resolves.toBeUndefined();
  });

  it("re-creates a removed file as an empty file", async () => {
    const fs = createFsSlots();
    const file = path.join(dir, "004.wav");
    await fs.writeFile(file, new Uint8Array(0));
    await fs.remove(file);
    await fs.writeFile(file, new Uint8Array(0));
    expect(await fs.exists(file)).toBe(true);
    expect((await readFile(file)).length).toBe(0);
  });

  it("renames a temp file over an existing target, replacing its content", async () => {
    const fs = createFsSlots();
    const target = path.join(dir, "r.lua");
    const temp = path.join(dir, "r.lua.tmp");
    await writeFile(target, "old");
    await fs.writeFile(temp, "new");
    await fs.rename(temp, target);
    expect(await readFile(target, "utf8")).toBe("new");
    expect(await fs.exists(temp)).toBe(false);
  });

  it("throws on an error other than a missing file so the caller retries", async () => {
    const fs = createFsSlots();
    const folder = path.join(dir, "folder");
    await mkdir(folder);
    await writeFile(path.join(folder, "inner"), "x");
    await expect(fs.remove(folder)).rejects.toThrow();
    await expect(
      fs.rename(path.join(dir, "absent.tmp"), path.join(dir, "r.lua")),
    ).rejects.toThrow();
  });

  it("rejects a write into a folder that does not exist", async () => {
    const fs = createFsSlots();
    await expect(fs.writeFile(path.join(dir, "missing", "r.lua"), "x")).rejects.toThrow();
  });
});
