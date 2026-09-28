import { afterEach, describe, expect, it } from "vitest";
import type { ProviderError } from "@wow-companion/contracts";
import { createChat, emptyChatsState } from "../../src/core/chats.ts";
import {
  fakeProvider,
  hello,
  makeSnapshot,
  okRun,
  startDaemon,
  waitFor,
  waitForSent,
} from "./helpers.ts";
import type { Harness, RunInput } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function connected(overrides: Parameters<typeof startDaemon>[0] = {}): Promise<Harness> {
  const harness = startDaemon(overrides);
  cleanups.push(harness.stop);
  harness.link.push(hello());
  harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
  await waitForSent(harness.link, 3);
  return harness;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

describe("daemon.ask", () => {
  it("runs the ask and answers with a reply carrying the ask id, chat and provider", async () => {
    const seen: RunInput[] = [];
    const harness = await connected({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            seen.push(input);
            return { ok: true, value: { sessionId: "s", text: "Head north.\nThen east." } };
          }),
        ],
      ]),
    });

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "where is the inn",
      mentions: [{ kind: "quest", questId: 7 }],
    });
    const sent = (await waitForSent(harness.link, 6)).slice(3);

    expect(sent.map((msg) => msg.t)).toEqual(["chats", "chats", "reply"]);
    expect(sent[2]).toEqual({
      t: "reply",
      id: "a1",
      chat: "default",
      provider: "claude",
      summary: "Head north.",
      full: "Head north.\nThen east.",
    });
    expect(seen[0]?.prompt).toBe("where is the inn");
    expect(seen[0]?.system).toContain("quest 7");
    expect(seen[0]?.system).toContain("level 10");
  });

  it("maps provider events to progress messages under the ask id", async () => {
    const harness = await connected({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (_input, onEvent) => {
            onEvent({ kind: "session", id: "s" });
            onEvent({ kind: "text", delta: "hm" });
            onEvent({ kind: "tool", name: "find_npc" });
            onEvent({ kind: "tool", name: "find_quest", failure: "boom" });
            return { ok: true, value: { sessionId: "s", text: "ok" } };
          }),
        ],
      ]),
    });

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitForSent(harness.link, 9);

    const progress = harness.link.sent().filter((msg) => msg.t === "progress");
    expect(progress).toEqual([
      { t: "progress", id: "a1", status: "thinking" },
      { t: "progress", id: "a1", status: "tool", detail: "find_npc" },
      { t: "progress", id: "a1", status: "tool", detail: "find_quest" },
    ]);
  });

  it("runs an ask normally before a full snapshot has arrived, while GET /state stays not_connected", async () => {
    const seen: RunInput[] = [];
    const harness = startDaemon({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            seen.push(input);
            return { ok: true, value: { sessionId: "s", text: "answer" } };
          }),
        ],
      ]),
    });
    cleanups.push(harness.stop);
    harness.link.push(hello());
    await waitForSent(harness.link, 3);

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "hi",
      mentions: [{ kind: "quest", questId: 7 }],
    });
    const sent = await waitForSent(harness.link, 6);

    expect(sent.slice(3).map((msg) => msg.t)).toEqual(["chats", "chats", "reply"]);
    expect(sent[5]).toMatchObject({ t: "reply", id: "a1", full: "answer" });
    expect(seen[0]?.system).toContain("not arrived yet");
    expect(seen[0]?.system).toContain("quest 7");
    expect(harness.daemon.api.getState()).toEqual({ ok: false, error: "not_connected" });
  });

  it("creates a chat named Chat <n+1> for an ask that names an unknown chat", async () => {
    const harness = await connected();

    harness.link.push({ t: "ask", id: "a1", chat: "stray", text: "hi", mentions: [] });
    await waitForSent(harness.link, 9);

    const chats = harness.link.sent().filter((msg) => msg.t === "chats");
    const last = chats.at(-1);
    if (last?.t !== "chats") throw new Error("expected chats");
    expect(last.list.find((chat) => chat.id === "stray")?.name).toBe("Chat 2");
    expect(harness.link.sent().find((msg) => msg.t === "reply")).toMatchObject({ chat: "stray" });
  });

  it("maps every provider error to an error message carrying the ask id", async () => {
    const codes: ProviderError[] = [
      "provider_missing",
      "provider_auth",
      "provider_disabled",
      "provider_failed",
      "timeout",
      "cancelled",
    ];
    for (const code of codes) {
      const harness = await connected({
        providers: new Map([
          ["claude", fakeProvider("claude", async () => ({ ok: false as const, error: code }))],
        ]),
      });
      harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
      await waitForSent(harness.link, 6);
      expect(harness.link.sent().at(-1)).toMatchObject({ t: "error", id: "a1", code });
      await harness.stop();
    }
  });

  it("retries once without the session and with a transcript summary on session_unknown", async () => {
    const seen: RunInput[] = [];
    const harness = await connected({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            seen.push(input);
            if (seen.length === 2) return { ok: false as const, error: "session_unknown" as const };
            return {
              ok: true as const,
              value: {
                sessionId: `s${String(seen.length)}`,
                text: `answer ${String(seen.length)}`,
              },
            };
          }),
        ],
      ]),
    });

    harness.link.push({
      t: "ask",
      id: "a1",
      chat: "default",
      text: "first question",
      mentions: [],
    });
    await waitForSent(harness.link, 6);
    harness.link.push({
      t: "ask",
      id: "a2",
      chat: "default",
      text: "second question",
      mentions: [],
    });
    await waitForSent(harness.link, 11);

    expect(seen).toHaveLength(3);
    expect(seen[1]?.sessionId).toBe("s1");
    expect(seen[2]?.sessionId).toBeUndefined();
    expect(seen[2]?.system).toContain("first question");
    expect(seen[2]?.prompt).toBe("second question");
    const replies = harness.link.sent().filter((msg) => msg.t === "reply");
    expect(replies.at(-1)).toMatchObject({ id: "a2", full: "answer 3" });
    expect(harness.link.sent().filter((msg) => msg.t === "error")).toEqual([]);
  });

  it("answers provider_disabled for a provider disabled in config.json without running it", async () => {
    let runs = 0;
    const initialChats = createChat(emptyChatsState, "c9", "Cursor chat", "cursor", 5);
    if (!initialChats.ok) throw new Error("expected ok");
    const harness = startDaemon({
      initialChats: initialChats.value.state,
      providers: new Map([
        [
          "cursor",
          fakeProvider("cursor", async () => {
            runs += 1;
            return { ok: true, value: { sessionId: "s", text: "x" } };
          }),
        ],
      ]),
    });
    cleanups.push(harness.stop);
    harness.link.push(hello());
    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    await waitForSent(harness.link, 3);

    harness.link.push({ t: "ask", id: "a1", chat: "c9", text: "hi", mentions: [] });
    await settle();

    expect(harness.link.sent().find((msg) => msg.t === "error")).toMatchObject({
      id: "a1",
      code: "provider_disabled",
    });
    expect(runs).toBe(0);
  });

  it("answers an oversized reply with too_large and never delivers the reply", async () => {
    const harness = await connected({
      providers: new Map([["claude", fakeProvider("claude", okRun("x"))]]),
    });
    const original = harness.link.send.bind(harness.link);
    harness.link.send = (msg) =>
      msg.t === "reply" ? { ok: false, error: "too_large" } : original(msg);

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitForSent(harness.link, 6);

    expect(harness.link.sent().at(-1)).toMatchObject({ t: "error", id: "a1", code: "too_large" });
    expect(harness.link.sent().some((msg) => msg.t === "reply")).toBe(false);
  });

  it("logs slots_exhausted for a reply the link cannot place and sends nothing more", async () => {
    const logs: string[] = [];
    const harness = await connected({
      log: (line) => logs.push(line),
      providers: new Map([["claude", fakeProvider("claude", okRun("x"))]]),
    });
    const original = harness.link.send.bind(harness.link);
    harness.link.send = (msg) =>
      msg.t === "reply" ? { ok: false, error: "slots_exhausted" } : original(msg);

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitFor(() => logs.some((line) => line.includes("slots exhausted")));

    expect(harness.link.sent().some((msg) => msg.t === "reply")).toBe(false);
    expect(harness.link.sent().some((msg) => msg.t === "error")).toBe(false);
  });

  it("ends an ask with an error reply and releases the chat when something throws around the run", async () => {
    let failNow = false;
    let armed = false;
    let calls = 0;
    const harness = await connected({
      now: () => {
        calls += 1;
        if (failNow) {
          failNow = false;
          throw new Error("clock exploded");
        }
        return 1000 + calls;
      },
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async () => {
            failNow = !armed;
            armed = true;
            return { ok: true, value: { sessionId: "s", text: "answer" } };
          }),
        ],
      ]),
    });

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "error"));
    const error = harness.link.sent().find((msg) => msg.t === "error");
    expect(error).toMatchObject({ t: "error", id: "a1", code: "provider_failed" });
    const chats = harness.link.sent().filter((msg) => msg.t === "chats");
    const last = chats.at(-1);
    if (last?.t !== "chats") throw new Error("expected chats");
    expect(last.list[0]?.running).toBe(false);

    harness.link.push({ t: "ask", id: "a2", chat: "default", text: "again", mentions: [] });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));
    expect(harness.link.sent().find((msg) => msg.t === "reply")).toMatchObject({ id: "a2" });
    expect(harness.link.sent().filter((msg) => msg.t === "error")).toHaveLength(1);
  });

  it("uses the global choice for chats whose id is an Object.prototype member", async () => {
    const seen: RunInput[] = [];
    const harness = await connected({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            seen.push(input);
            return { ok: true, value: { sessionId: "s", text: "ok" } };
          }),
        ],
      ]),
    });

    for (const chat of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      harness.link.push({ t: "ask", id: `ask-${chat}`, chat, text: "hi", mentions: [] });
      await waitFor(() =>
        harness.link.sent().some((msg) => msg.t === "reply" && msg.id === `ask-${chat}`),
      );
    }

    expect(seen).toHaveLength(4);
    for (const input of seen) {
      expect(input.model).toBe("m1");
      expect(input.effort).toBe("low");
    }
  });
});
