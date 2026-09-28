import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettings, writeSettings } from "../../src/adapters/settings-store.ts";
import { chatChoice, dropChatChoice, perChatFrom } from "../../src/core/settings.ts";
import type { Settings } from "../../src/core/settings.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wowc-settings-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sample: Settings = {
  global: { provider: "claude", model: "m1", effort: "low" },
  perChat: { c1: { model: "m2", effort: "high" }, c2: { model: "c1" } },
};

describe("daemon.settings-store", () => {
  it("round-trips settings through the file", async () => {
    const file = path.join(dir, "state", "settings.json");
    expect(await writeSettings(file, sample)).toEqual({ ok: true, value: undefined });
    expect(await readSettings(file)).toEqual({ ok: true, value: sample });
  });

  it("round-trips a global choice without an effort", async () => {
    const file = path.join(dir, "settings.json");
    const bare: Settings = { global: { provider: "codex", model: "c1" }, perChat: {} };
    await writeSettings(file, bare);
    expect(await readSettings(file)).toEqual({ ok: true, value: bare });
  });

  it("reports a missing file as read_missing", async () => {
    expect(await readSettings(path.join(dir, "absent.json"))).toEqual({
      ok: false,
      error: "read_missing",
    });
  });

  it("reports a malformed file as parse_failed and never resets it", async () => {
    const file = path.join(dir, "settings.json");
    await writeFile(file, "{not json", "utf8");
    expect(await readSettings(file)).toEqual({ ok: false, error: "parse_failed" });
    await writeFile(file, JSON.stringify({ global: { provider: "gpt", model: "x" }, perChat: {} }));
    expect(await readSettings(file)).toEqual({ ok: false, error: "parse_failed" });
    await writeFile(
      file,
      JSON.stringify({ global: { provider: "claude", model: "x" }, perChat: { c1: { model: 3 } } }),
    );
    expect(await readSettings(file)).toEqual({ ok: false, error: "parse_failed" });
  });

  it("leaves no temporary file behind after a write", async () => {
    const file = path.join(dir, "settings.json");
    await writeSettings(file, sample);
    expect(await readdir(dir)).toEqual(["settings.json"]);
  });

  it("keeps a chat id such as __proto__ as data and never reads inherited members", async () => {
    const file = path.join(dir, "settings.json");
    await writeFile(
      file,
      '{"global":{"provider":"claude","model":"m1"},"perChat":{"__proto__":{"model":"evil"},"c1":{"model":"m2"}}}',
    );

    const read = await readSettings(file);

    if (!read.ok) throw new Error("expected ok");
    expect(chatChoice(read.value, "__proto__")).toEqual({ model: "evil" });
    expect(chatChoice(read.value, "c1")).toEqual({ model: "m2" });
    for (const inherited of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(chatChoice(read.value, inherited)).toBeUndefined();
    }
    expect(Object.getPrototypeOf(read.value.perChat)).toBeNull();
    expect(({} as Record<string, unknown>).model).toBeUndefined();
    expect(dropChatChoice(read.value, "c1").perChat).toEqual(
      perChatFrom([["__proto__", { model: "evil" }]]),
    );
  });
});
