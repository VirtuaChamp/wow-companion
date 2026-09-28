import { afterEach, describe, expect, it } from "vitest";
import type { Snapshot } from "@wow-companion/contracts";
import { createChat, emptyChatsState, beginAsk, completeAsk } from "../../src/core/chats.ts";
import type { ChatsState } from "../../src/core/chats.ts";
import { SLOT_BYTE_CAP, messageByteSize } from "../../src/transport/slots.ts";
import { hello, makeSnapshot, startDaemon, waitFor, waitForSent } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function chatsWithHistory(): ChatsState {
  const created = createChat(emptyChatsState, "c1", "Quests", "claude", 100);
  if (!created.ok) throw new Error("expected ok");
  const begun = beginAsk(created.value.state, "c1", "a1", "where is the inn", 101);
  if (!begun.ok) throw new Error("expected ok");
  const done = completeAsk(begun.value.state, "c1", "a1", { sessionId: "s", text: "north" }, 102);
  if (!done.ok) throw new Error("expected ok");
  return done.value.state;
}

describe("daemon.hello", () => {
  it("answers a hello with options, chats, history in that order", async () => {
    const harness = startDaemon({ initialChats: chatsWithHistory(), version: "1.2.3" });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    const sent = await waitForSent(harness.link, 3);

    expect(sent.map((msg) => msg.t)).toEqual(["options", "chats", "history"]);
    const options = sent[0];
    if (options?.t !== "options") throw new Error("expected options");
    expect(options.active).toEqual({ provider: "claude", model: "m1", effort: "low" });
    expect(options.companionVersion).toBe("1.2.3");
    expect(options.chat).toBeUndefined();
    expect(options.providers.map((provider) => provider.id)).toEqual(["claude", "codex", "cursor"]);
    const claude = options.providers[0];
    expect(claude).toMatchObject({
      id: "claude",
      installed: true,
      enabled: true,
      models: ["m1", "m2"],
      efforts: ["low", "high"],
      current: { model: "m1", effort: "low" },
    });
    const cursor = options.providers[2];
    expect(cursor).toMatchObject({ id: "cursor", enabled: false });
    const chats = sent[1];
    if (chats?.t !== "chats") throw new Error("expected chats");
    expect(chats.active).toBe("c1");
    const history = sent[2];
    if (history?.t !== "history") throw new Error("expected history");
    expect(history.chat).toBe("c1");
    expect(history.lines.map((line) => line.text)).toEqual(["where is the inn", "north"]);
  });

  it("sends nothing for an again hello", async () => {
    const harness = startDaemon({ initialChats: chatsWithHistory() });
    cleanups.push(harness.stop);

    harness.link.push(hello(true));
    harness.link.push({ t: "state", seq: 1, delta: { money: 5 } });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(harness.link.sent()).toEqual([]);
  });

  it("re-sends the same three messages when a fresh session says hello again after a wipe", async () => {
    const harness = startDaemon({ initialChats: chatsWithHistory() });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    await waitForSent(harness.link, 3);
    harness.link.push(hello());
    const sent = await waitForSent(harness.link, 6);

    expect(sent.slice(3).map((msg) => msg.t)).toEqual(["options", "chats", "history"]);
  });

  it("seeds a default chat when none exists so the first ask has somewhere to go", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);

    harness.link.push(hello());
    const sent = await waitForSent(harness.link, 3);

    const chats = sent[1];
    if (chats?.t !== "chats") throw new Error("expected chats");
    expect(chats.active).toBe("default");
    expect(chats.list).toEqual([
      {
        id: "default",
        name: "Default",
        provider: "claude",
        lastAt: 1000,
        running: false,
        unread: 0,
      },
    ]);
    const history = sent[2];
    expect(history).toEqual({ t: "history", chat: "default", lines: [] });
  });

  it("answers GET /state not_connected until a hello and a full snapshot have arrived", async () => {
    const stale: Partial<Snapshot> = makeSnapshot();
    const harness = startDaemon({ initialGame: stale });
    cleanups.push(harness.stop);

    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });

    harness.link.push(hello());
    await waitForSent(harness.link, 3);
    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });

    const { character, position, money } = makeSnapshot();
    harness.link.push({ t: "state", seq: 1, delta: { character, position, money } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });

    harness.link.push({ t: "state", seq: 2, delta: makeSnapshot() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.daemon.api.getState()).toEqual({ ok: true, value: makeSnapshot() });
  });

  it("treats state as not live after adopting a session on a restart, until every key has been refreshed", async () => {
    const harness = startDaemon({ initialGame: makeSnapshot() });
    cleanups.push(harness.stop);

    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });
    harness.link.push(hello(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });

    harness.link.push({ t: "state", seq: 1, delta: { money: 900 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });

    const { money: _money, ...rest } = makeSnapshot();
    void _money;
    harness.link.push({ t: "state", seq: 2, delta: rest });
    await waitFor(() => harness.daemon.api.getState().ok);
    expect(harness.daemon.api.getState()).toEqual({
      ok: true,
      value: { ...makeSnapshot(), money: 900 },
    });
  });

  it("serves state again after a full snapshot following the adoption, and drops it on a new session", async () => {
    const harness = startDaemon({ initialGame: makeSnapshot() });
    cleanups.push(harness.stop);
    harness.link.push(hello(true));
    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    await waitFor(() => harness.daemon.api.getState().ok);

    harness.link.push(hello());
    await waitForSent(harness.link, 3);
    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });
  });

  it("coalesces game.json writes: a burst of deltas is written once, as the latest merged snapshot", async () => {
    const harness = startDaemon({ gameWriteIntervalMs: 60 });
    cleanups.push(harness.stop);

    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    for (let index = 0; index < 10; index += 1) {
      harness.link.push({ t: "state", seq: 2 + index, delta: { money: 900 + index } });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.gameSaves).toHaveLength(0);
    await waitFor(() => harness.gameSaves.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(harness.gameSaves).toHaveLength(1);
    expect(harness.gameSaves[0]).toEqual({ ...makeSnapshot(), money: 909 });
  });

  it("writes at most once per interval across bursts", async () => {
    const harness = startDaemon({ gameWriteIntervalMs: 40 });
    cleanups.push(harness.stop);

    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    await waitFor(() => harness.gameSaves.length === 1);
    harness.link.push({ t: "state", seq: 2, delta: { money: 1 } });
    harness.link.push({ t: "state", seq: 3, delta: { money: 2 } });
    await waitFor(() => harness.gameSaves.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(harness.gameSaves).toHaveLength(2);
    expect(harness.gameSaves[1]?.money).toBe(2);
  });

  it("flushes a pending game.json write on stop", async () => {
    const harness = startDaemon({ gameWriteIntervalMs: 60_000 });
    cleanups.push(harness.stop);

    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    harness.link.push({ t: "state", seq: 2, delta: { money: 77 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.gameSaves).toHaveLength(0);

    await harness.stop();

    expect(harness.gameSaves).toHaveLength(1);
    expect(harness.gameSaves[0]?.money).toBe(77);
  });

  it("answers GET /state not_connected again once the link reports the game gone", async () => {
    const harness = startDaemon();
    cleanups.push(harness.stop);
    harness.link.push(hello());
    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    await waitFor(() => harness.daemon.api.getState().ok);

    harness.link.setConnected(false);
    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });

    harness.link.setConnected(true);
    expect(harness.daemon.api.getState().ok).toBe(true);
  });
});

describe("daemon.hello history sizing", () => {
  it("sends the newest history lines that fit one slot, in order, and keeps the full transcript", async () => {
    const created = createChat(emptyChatsState, "c1", "Long", "claude", 1);
    if (!created.ok) throw new Error("expected ok");
    const lines = Array.from({ length: 200 }, (_, index) => ({
      who: "you" as const,
      text: `line ${String(index)} ${"x".repeat(1000)}`,
      at: index,
    }));
    const long: ChatsState = {
      ...created.value.state,
      chats: created.value.state.chats.map((chat) => ({ ...chat, history: lines })),
    };
    const harness = startDaemon({ initialChats: long });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    const sent = await waitForSent(harness.link, 3);

    const history = sent[2];
    if (history?.t !== "history") throw new Error("expected history");
    expect(history.lines.length).toBeGreaterThan(0);
    expect(history.lines.length).toBeLessThan(200);
    expect(history.lines).toEqual(
      lines.slice(200 - history.lines.length).map(({ who, text, at }) => ({ who, text, at })),
    );
    expect(messageByteSize("x".repeat(17), history)).toBeLessThanOrEqual(SLOT_BYTE_CAP);
    expect(
      messageByteSize("x".repeat(17), {
        ...history,
        lines: lines.slice(199 - history.lines.length),
      }),
    ).toBeGreaterThan(SLOT_BYTE_CAP);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.saves.at(-1)?.chats[0]?.history).toHaveLength(200);
  });

  it("sends an empty history when a single line cannot fit a slot", async () => {
    const created = createChat(emptyChatsState, "c1", "Huge", "claude", 1);
    if (!created.ok) throw new Error("expected ok");
    const huge: ChatsState = {
      ...created.value.state,
      chats: created.value.state.chats.map((chat) => ({
        ...chat,
        history: [{ who: "you" as const, text: "y".repeat(70_000), at: 1 }],
      })),
    };
    const harness = startDaemon({ initialChats: huge });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    const sent = await waitForSent(harness.link, 3);

    expect(sent[2]).toEqual({ t: "history", chat: "c1", lines: [] });
  });
});
