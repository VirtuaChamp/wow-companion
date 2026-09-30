import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openHandledIds } from "../../src/adapters/handled-ids-store.ts";
import { createHandledIds } from "../../src/transport/handled-ids.ts";

describe("handled ids, in memory", () => {
  it("evicts the oldest id once the bound is passed", async () => {
    const ids = createHandledIds([], 3);
    for (const key of ["a", "b", "c", "d"]) {
      await ids.remember(key);
    }
    expect(["a", "b", "c", "d"].map((key) => ids.has(key))).toEqual([false, true, true, true]);
  });

  it("trims a loaded list longer than the bound to its newest entries", () => {
    const ids = createHandledIds(["a", "b", "c", "d", "e"], 3);
    expect(["a", "b", "c", "d", "e"].map((key) => ids.has(key))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("writes the list before remember resolves, and forgets an id whose write failed", async () => {
    const writes: (readonly string[])[] = [];
    let failing = false;
    const ids = createHandledIds([], 3, async (list) => {
      if (failing) return { ok: false, error: "write_failed" };
      writes.push(list);
      return { ok: true, value: undefined };
    });
    expect((await ids.remember("a")).ok).toBe(true);
    expect(writes).toEqual([["a"]]);
    failing = true;
    expect((await ids.remember("b")).ok).toBe(false);
    expect(ids.has("b")).toBe(false);
    failing = false;
    expect((await ids.remember("b")).ok).toBe(true);
    expect(writes.at(-1)).toEqual(["a", "b"]);
  });
});

describe("handled ids store", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "wowc-handled-ids-"));
    file = path.join(dir, "state", "handled-ids.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("starts empty when the file is missing", async () => {
    const opened = await openHandledIds(file);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value.has("ask:x")).toBe(false);
  });

  it("keeps what it remembered across a reopen", async () => {
    const first = await openHandledIds(file);
    if (!first.ok) throw new Error("open");
    await first.value.remember("cmd:cmd-1");
    const second = await openHandledIds(file);
    expect(second.ok && second.value.has("cmd:cmd-1")).toBe(true);
  });

  it("keeps at most the bound in the file and drops the oldest", async () => {
    const opened = await openHandledIds(file, 3);
    if (!opened.ok) throw new Error("open");
    for (const key of ["a", "b", "c", "d", "e"]) {
      await opened.value.remember(key);
    }
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(["c", "d", "e"]);
  });

  it("fails loudly on a file that is not JSON", async () => {
    await writeState(file, "{not json");
    expect(await openHandledIds(file)).toEqual({ ok: false, error: "parse_failed" });
  });

  it("fails loudly on JSON that is not a list of strings", async () => {
    await writeState(file, JSON.stringify({ ids: ["a"] }));
    expect(await openHandledIds(file)).toEqual({ ok: false, error: "parse_failed" });
    await writeState(file, JSON.stringify(["a", 7]));
    expect(await openHandledIds(file)).toEqual({ ok: false, error: "parse_failed" });
  });
});

async function writeState(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}
