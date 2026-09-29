import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readChatsState, writeChatsState } from "../src/adapters/state-store.ts";
import type { ChatsState } from "../src/core/chats.ts";

const sample: ChatsState = {
  activeId: "c1",
  chats: [
    {
      id: "c1",
      name: "Quests",
      titleSource: "user",
      provider: "claude",
      sessionId: "s1",
      unread: 0,
      lastAt: 1000,
      history: [{ who: "you", text: "hi", at: 999 }],
    },
  ],
};

describe("state-store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "wowc-state-store-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes then reads back an identical ChatsState", async () => {
    const filePath = path.join(dir, "chats.json");

    const written = await writeChatsState(filePath, sample);
    expect(written).toEqual({ ok: true, value: undefined });

    const read = await readChatsState(filePath);
    expect(read).toEqual({ ok: true, value: sample });
  });

  it("writes atomically: no leftover temp file after a successful write", async () => {
    const filePath = path.join(dir, "chats.json");

    await writeChatsState(filePath, sample);

    const entries = await readdir(dir);
    expect(entries).toEqual(["chats.json"]);
  });

  it("reading a missing file returns read_missing", async () => {
    const result = await readChatsState(path.join(dir, "missing.json"));
    expect(result).toEqual({ ok: false, error: "read_missing" });
  });

  it("reading malformed JSON returns parse_failed", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeFile(filePath, "not json", "utf8");

    const result = await readChatsState(filePath);
    expect(result).toEqual({ ok: false, error: "parse_failed" });
  });

  it("reading a structurally wrong file returns parse_failed", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeFile(filePath, JSON.stringify({ activeId: "c1" }), "utf8");

    const result = await readChatsState(filePath);
    expect(result).toEqual({ ok: false, error: "parse_failed" });
  });

  it("a second write overwrites the first and still round-trips", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeChatsState(filePath, sample);

    const updated: ChatsState = {
      activeId: "c2",
      chats: [
        ...sample.chats,
        {
          id: "c2",
          name: "Second",
          titleSource: "auto",
          provider: "codex",
          unread: 0,
          lastAt: 1001,
          history: [],
        },
      ],
    };
    await writeChatsState(filePath, updated);

    const read = await readChatsState(filePath);
    expect(read).toEqual({ ok: true, value: updated });
  });

  it("the file on disk holds the written JSON verbatim", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeChatsState(filePath, sample);

    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual(sample);
  });

  it("a stale runningAskId on disk is dropped on read: a run never survives a restart", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeFile(
      filePath,
      JSON.stringify({
        activeId: "c1",
        chats: [
          {
            id: "c1",
            name: "Quests",
            provider: "claude",
            runningAskId: "ask-stale",
            unread: 0,
            lastAt: 1000,
            history: [],
          },
        ],
      }),
      "utf8",
    );

    const result = await readChatsState(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chats[0]?.runningAsk).toBeUndefined();
    }
  });

  it("duplicate chat ids in the stored file are rejected as parse_failed", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeFile(
      filePath,
      JSON.stringify({
        activeId: "c1",
        chats: [
          { id: "c1", name: "A", provider: "claude", unread: 0, lastAt: 1000, history: [] },
          { id: "c1", name: "B", provider: "codex", unread: 0, lastAt: 1001, history: [] },
        ],
      }),
      "utf8",
    );

    const result = await readChatsState(filePath);
    expect(result).toEqual({ ok: false, error: "parse_failed" });
  });

  it("an activeId that names no stored chat is rejected as parse_failed", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeFile(
      filePath,
      JSON.stringify({
        activeId: "ghost",
        chats: [{ id: "c1", name: "A", provider: "claude", unread: 0, lastAt: 1000, history: [] }],
      }),
      "utf8",
    );

    expect(await readChatsState(filePath)).toEqual({ ok: false, error: "parse_failed" });
  });

  it("a non-empty activeId with no chats is rejected as parse_failed", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeFile(filePath, JSON.stringify({ activeId: "c1", chats: [] }), "utf8");

    expect(await readChatsState(filePath)).toEqual({ ok: false, error: "parse_failed" });
  });

  it("an empty state with an empty activeId reads back", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeFile(filePath, JSON.stringify({ activeId: "", chats: [] }), "utf8");

    expect(await readChatsState(filePath)).toEqual({
      ok: true,
      value: { activeId: "", chats: [] },
    });
  });

  it("a file written before automatic titles migrates: Default and Chat N are auto, every other name is the user's", async () => {
    const filePath = path.join(dir, "chats.json");
    const legacy = (id: string, name: string) => ({
      id,
      name,
      provider: "claude",
      unread: 0,
      lastAt: 1,
      history: [],
    });
    await writeFile(
      filePath,
      JSON.stringify({
        activeId: "c1",
        chats: [
          legacy("c1", "Default"),
          legacy("c2", "Chat 12"),
          legacy("c3", "Gearing up"),
          legacy("c4", "Chat two"),
          legacy("c5", "My Chat 3"),
        ],
      }),
      "utf8",
    );

    const result = await readChatsState(filePath);
    expect(result.ok && result.value.chats.map((chat) => chat.titleSource)).toEqual([
      "auto",
      "auto",
      "user",
      "user",
      "user",
    ]);
  });

  it("an unknown title source is a parse failure", async () => {
    const filePath = path.join(dir, "chats.json");
    await writeFile(
      filePath,
      JSON.stringify({
        activeId: "c1",
        chats: [
          {
            id: "c1",
            name: "Bad",
            titleSource: "robot",
            provider: "claude",
            unread: 0,
            lastAt: 1,
            history: [],
          },
        ],
      }),
      "utf8",
    );

    expect(await readChatsState(filePath)).toEqual({ ok: false, error: "parse_failed" });
  });
});
