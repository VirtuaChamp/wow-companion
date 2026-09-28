import { afterEach, describe, expect, it } from "vitest";
import { fakeProvider, hello, makeSnapshot, okRun, startDaemon, waitForSent } from "./helpers.ts";
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

function blockedProvider(): {
  provider: ReturnType<typeof fakeProvider>;
  release: () => void;
  seen: RunInput[];
} {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen: RunInput[] = [];
  const provider = fakeProvider("claude", async (input) => {
    seen.push(input);
    await new Promise<void>((resolve) => {
      gate.then(resolve);
      input.signal.addEventListener("abort", () => resolve());
    });
    return input.signal.aborted
      ? { ok: false as const, error: "cancelled" as const }
      : { ok: true as const, value: { sessionId: "s", text: "done" } };
  });
  return { provider, release, seen };
}

describe("daemon.chats", () => {
  it("cmd new mints an id, names the chat, then sends chats, history and options", async () => {
    const harness = await connected();

    harness.link.push({ t: "cmd", chat: "default", name: "new", arg: "Second" });
    const sent = (await waitForSent(harness.link, 6)).slice(3);

    expect(sent.map((msg) => msg.t)).toEqual(["chats", "history", "options"]);
    if (sent[0]?.t !== "chats") throw new Error("expected chats");
    expect(sent[0].active).toBe("id1");
    expect(sent[0].list.map((chat) => chat.name).sort()).toEqual(["Default", "Second"]);
    expect(harness.saves.at(-1)?.activeId).toBe("id1");
  });

  it("cmd new without an arg names the chat Chat <n+1>", async () => {
    const harness = await connected();

    harness.link.push({ t: "cmd", chat: "default", name: "new" });
    const sent = (await waitForSent(harness.link, 6)).slice(3);

    if (sent[0]?.t !== "chats") throw new Error("expected chats");
    expect(sent[0].list.find((chat) => chat.id === "id1")?.name).toBe("Chat 2");
  });

  it("cmd open re-sends chats, history and options when the active chat changes", async () => {
    const harness = await connected();
    harness.link.push({ t: "cmd", chat: "default", name: "new", arg: "Second" });
    await waitForSent(harness.link, 6);

    harness.link.push({ t: "cmd", chat: "default", name: "open" });
    const sent = (await waitForSent(harness.link, 9)).slice(6);

    expect(sent.map((msg) => msg.t)).toEqual(["chats", "history", "options"]);
    if (sent[0]?.t !== "chats") throw new Error("expected chats");
    expect(sent[0].active).toBe("default");
  });

  it("cmd open on the already active chat sends chats and history but no options", async () => {
    const harness = await connected();

    harness.link.push({ t: "cmd", chat: "default", name: "open" });
    const sent = (await waitForSent(harness.link, 5)).slice(3);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sent.map((msg) => msg.t)).toEqual(["chats", "history"]);
    expect(harness.link.sent()).toHaveLength(5);
  });

  it("cmd rename and reset update the chat and answer with chats", async () => {
    const harness = await connected();

    harness.link.push({ t: "cmd", chat: "default", name: "rename", arg: "Renamed" });
    const renamed = (await waitForSent(harness.link, 4)).at(-1);
    if (renamed?.t !== "chats") throw new Error("expected chats");
    expect(renamed.list[0]?.name).toBe("Renamed");

    harness.link.push({ t: "cmd", chat: "default", name: "reset" });
    const sent = (await waitForSent(harness.link, 6)).slice(4);
    expect(sent.map((msg) => msg.t)).toEqual(["chats", "history"]);
  });

  it("cmd rename without an arg changes nothing", async () => {
    const harness = await connected();

    harness.link.push({ t: "cmd", chat: "default", name: "rename" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(harness.link.sent()).toHaveLength(3);
  });

  it("deleting the last chat seeds a fresh default chat", async () => {
    const harness = await connected();

    harness.link.push({ t: "cmd", chat: "default", name: "delete" });
    const sent = (await waitForSent(harness.link, 5)).slice(3);

    expect(sent.map((msg) => msg.t)).toEqual(["chats", "history"]);
    if (sent[0]?.t !== "chats") throw new Error("expected chats");
    expect(sent[0].active).toBe("default");
    expect(sent[0].list).toHaveLength(1);
  });

  it("ignores a command on a chat it does not have", async () => {
    const harness = await connected();

    harness.link.push({ t: "cmd", chat: "ghost", name: "open" });
    harness.link.push({ t: "cmd", chat: "ghost", name: "delete" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(harness.link.sent()).toHaveLength(3);
  });

  it("answers busy with the ask id for a second ask on a running chat and runs another chat in parallel", async () => {
    const blocked = blockedProvider();
    const harness = await connected({ providers: new Map([["claude", blocked.provider]]) });
    harness.link.push({ t: "cmd", chat: "default", name: "new", arg: "Second" });
    await waitForSent(harness.link, 6);

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "one", mentions: [] });
    harness.link.push({ t: "ask", id: "a2", chat: "default", text: "two", mentions: [] });
    harness.link.push({ t: "ask", id: "a3", chat: "id1", text: "three", mentions: [] });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const busy = harness.link.sent().filter((msg) => msg.t === "error");
    expect(busy).toEqual([{ t: "error", id: "a2", code: "busy", message: expect.any(String) }]);
    expect(blocked.seen.map((input) => input.prompt).sort()).toEqual(["one", "three"]);
    blocked.release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(harness.link.sent().filter((msg) => msg.t === "reply")).toHaveLength(2);
  });

  it("cancel aborts the running ask and reports cancelled with the ask id", async () => {
    const blocked = blockedProvider();
    const harness = await connected({ providers: new Map([["claude", blocked.provider]]) });

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "one", mentions: [] });
    await waitForSent(harness.link, 4);
    harness.link.push({ t: "cmd", chat: "default", name: "cancel" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const errors = harness.link.sent().filter((msg) => msg.t === "error");
    expect(errors).toEqual([{ t: "error", id: "a1", code: "cancelled", message: "cancelled" }]);
  });

  it("delete on a running chat answers busy", async () => {
    const blocked = blockedProvider();
    const harness = await connected({ providers: new Map([["claude", blocked.provider]]) });

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "one", mentions: [] });
    await waitForSent(harness.link, 4);
    harness.link.push({ t: "cmd", chat: "default", name: "delete" });
    await waitForSent(harness.link, 5);

    expect(harness.link.sent().at(-1)).toMatchObject({ t: "error", code: "busy" });
    blocked.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("persists chats after each change", async () => {
    const harness = await connected({
      providers: new Map([["claude", fakeProvider("claude", okRun("x"))]]),
    });

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitForSent(harness.link, 6);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const last = harness.saves.at(-1);
    expect(last?.chats[0]?.history.map((line) => line.text)).toEqual(["hi", "x"]);
    expect(last?.chats[0]?.sessionId).toBe("s-1");
  });
});
