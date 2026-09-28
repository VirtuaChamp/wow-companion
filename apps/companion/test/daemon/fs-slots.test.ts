import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
  it("writes text and bytes and reads them back", async () => {
    const fs = createFsSlots();
    const text = path.join(dir, "r.lua");
    const bytes = path.join(dir, "001.wav");
    await fs.writeFile(text, "WoWCompanion_Deliver('x', {})");
    await fs.writeFile(bytes, new Uint8Array([1, 2, 3]));
    expect(await readFile(text, "utf8")).toBe("WoWCompanion_Deliver('x', {})");
    expect(await fs.readFile(bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("reads an empty file as an empty array, not as missing", async () => {
    const fs = createFsSlots();
    const file = path.join(dir, "002.wav");
    await fs.writeFile(file, new Uint8Array(0));
    expect(await fs.readFile(file)).toEqual(new Uint8Array(0));
  });

  it("returns undefined for a missing file", async () => {
    const fs = createFsSlots();
    expect(await fs.readFile(path.join(dir, "absent.wav"))).toBeUndefined();
  });

  it("throws on a read error other than a missing file so the caller retries", async () => {
    const fs = createFsSlots();
    const folder = path.join(dir, "folder");
    await mkdir(folder);
    await expect(fs.readFile(folder)).rejects.toThrow();
  });

  it("rejects a write into a folder that does not exist", async () => {
    const fs = createFsSlots();
    await expect(fs.writeFile(path.join(dir, "missing", "r.lua"), "x")).rejects.toThrow();
  });
});
