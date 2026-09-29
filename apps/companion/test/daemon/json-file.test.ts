import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRecord, readJsonFile, writeJsonAtomic } from "../../src/adapters/json-file.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wowc-json-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("daemon.json-file", () => {
  it("writes atomically, creating parent folders, and reads back", async () => {
    const file = path.join(dir, "nested", "a.json");
    expect(await writeJsonAtomic(file, { a: 1 })).toEqual({ ok: true, value: undefined });
    expect(await readJsonFile(file)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readdir(path.join(dir, "nested"))).toEqual(["a.json"]);
  });

  it("removes its temporary file when the final rename fails", async () => {
    const target = path.join(dir, "taken");
    await mkdir(target);
    await writeFile(path.join(target, "keep.txt"), "x");

    const result = await writeJsonAtomic(target, { a: 1 });

    expect(result).toEqual({ ok: false, error: "write_failed" });
    expect((await readdir(dir)).sort()).toEqual(["taken"]);
  });

  it("removes its temporary file when the write fails and leaves an existing file untouched", async () => {
    const file = path.join(dir, "a.json");
    await writeJsonAtomic(file, { a: 1 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(await writeJsonAtomic(file, circular)).toEqual({ ok: false, error: "write_failed" });

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: 1 });
    expect(await readdir(dir)).toEqual(["a.json"]);
  });

  it("classifies a missing, a malformed and an unreadable file", async () => {
    expect(await readJsonFile(path.join(dir, "absent.json"))).toEqual({
      ok: false,
      error: "read_missing",
    });
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, "{nope");
    expect(await readJsonFile(bad)).toEqual({ ok: false, error: "parse_failed" });
    const folder = path.join(dir, "folder.json");
    await mkdir(folder);
    expect(await readJsonFile(folder)).toEqual({ ok: false, error: "read_failed" });
  });

  it("isRecord accepts objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});
