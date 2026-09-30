import { afterEach, describe, expect, it } from "vitest";
import type { GameToCompanion } from "@wow-companion/contracts";
import type { ChatsState } from "../../src/core/chats.ts";
import { hello, makeSnapshot, startDaemon, waitFor, waitForSent } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

type Event =
  | { kind: "save"; state: ChatsState }
  | { kind: "committed"; msg: GameToCompanion }
  | { kind: "released"; msg: GameToCompanion };

type Control = { block?: Promise<void>; failing: boolean };

async function connected(options: { newId?: () => string } = {}): Promise<{
  harness: Harness;
  events: Event[];
  control: Control;
}> {
  const events: Event[] = [];
  const control: Control = { failing: false };
  const harness = startDaemon({
    commitRetryMs: 10,
    ...(options.newId === undefined ? {} : { newId: options.newId }),
    chatsStore: {
      async save(state) {
        await control.block;
        if (control.failing) {
          throw new Error("disk full");
        }
        events.push({ kind: "save", state });
      },
    },
  });
  cleanups.push(harness.stop);
  harness.link.committed = async (msg) => {
    events.push({ kind: "committed", msg });
    return true;
  };
  harness.link.release = (msg) => {
    events.push({ kind: "released", msg });
  };
  harness.link.push(hello());
  harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
  await waitForSent(harness.link, 3);
  events.length = 0;
  return { harness, events, control };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("daemon.commit", () => {
  it("tells the link an ask was committed only after its user line was saved", async () => {
    const { harness, events, control } = await connected();
    let release: () => void = () => undefined;
    control.block = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await pause(60);
    expect(events.some((event) => event.kind === "committed")).toBe(false);
    release();
    await waitFor(() => events.some((event) => event.kind === "committed"));
    const committedAt = events.findIndex((event) => event.kind === "committed");
    const savedBefore = events.slice(0, committedAt).filter((event) => event.kind === "save");
    expect(savedBefore.length).toBeGreaterThan(0);
    const lastSave = savedBefore.at(-1);
    const lines =
      lastSave?.kind === "save"
        ? (lastSave.state.chats.find((chat) => chat.id === "default")?.history ?? [])
        : [];
    expect(lines.some((line) => line.who === "you" && line.text === "hi")).toBe(true);
  });

  it("tells the link a cmd was committed only after the chats state holding its effect was saved", async () => {
    const { harness, events, control } = await connected();
    let release: () => void = () => undefined;
    control.block = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "new", arg: "Second" });
    await pause(60);
    expect(events.some((event) => event.kind === "committed")).toBe(false);
    release();
    await waitFor(() => events.some((event) => event.kind === "committed"));
    const committedAt = events.findIndex((event) => event.kind === "committed");
    const lastSave = events
      .slice(0, committedAt)
      .filter((event) => event.kind === "save")
      .at(-1);
    expect(lastSave?.kind === "save" && lastSave.state.chats.some((c) => c.name === "Second")).toBe(
      true,
    );
  });

  it("commits a message the daemon refused too, so the addon stops repainting it", async () => {
    const { harness, events } = await connected();
    harness.link.push({ t: "cmd", id: "cmd-2", chat: "ghost", name: "open" });
    await waitFor(() => events.some((event) => event.kind === "committed"));
    expect(events.some((event) => event.kind === "committed")).toBe(true);
  });

  it("does not commit while the state write fails, and commits once a write succeeds", async () => {
    const { harness, events, control } = await connected();
    control.failing = true;
    harness.link.push({ t: "cmd", id: "cmd-3", chat: "default", name: "new", arg: "Third" });
    await pause(120);
    expect(events.some((event) => event.kind === "committed")).toBe(false);
    control.failing = false;
    await waitFor(() => events.some((event) => event.kind === "committed"));
    const committedAt = events.findIndex((event) => event.kind === "committed");
    expect(events.slice(0, committedAt).some((event) => event.kind === "save")).toBe(true);
  });

  it("does not commit a cmd whose handler threw: it is released for redelivery and applied once it succeeds", async () => {
    let calls = 0;
    const { harness, events } = await connected({
      newId: () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return `id${String(calls)}`;
      },
    });
    const cmd: GameToCompanion = {
      t: "cmd",
      id: "cmd-t1",
      chat: "default",
      name: "new",
      arg: "Once",
    };
    harness.link.push(cmd);
    await waitFor(() => events.some((event) => event.kind === "released"));
    await pause(60);
    expect(events.some((event) => event.kind === "committed")).toBe(false);
    harness.link.push(cmd);
    await waitFor(() => events.some((event) => event.kind === "committed"));
    const lastSave = events.filter((event) => event.kind === "save").at(-1);
    const names =
      lastSave?.kind === "save" ? lastSave.state.chats.filter((c) => c.name === "Once") : [];
    expect(names).toHaveLength(1);
    expect(events.filter((event) => event.kind === "released")).toHaveLength(1);
  });

  it("after three failed applications sends the addon an error for the message and commits it", async () => {
    const { harness, events } = await connected({
      newId: () => {
        throw new Error("boom");
      },
    });
    const cmd: GameToCompanion = { t: "cmd", id: "cmd-t2", chat: "default", name: "new" };
    harness.link.push(cmd);
    await waitFor(() => events.filter((event) => event.kind === "released").length === 1);
    harness.link.push(cmd);
    await waitFor(() => events.filter((event) => event.kind === "released").length === 2);
    expect(events.some((event) => event.kind === "committed")).toBe(false);
    harness.link.push(cmd);
    await waitFor(() => events.some((event) => event.kind === "committed"));
    expect(events.filter((event) => event.kind === "released")).toHaveLength(2);
    expect(harness.link.sent()).toContainEqual({
      t: "error",
      id: "cmd-t2",
      chat: "default",
      code: "daemon_error",
      message: "the companion could not apply this message",
    });
  });

  it("does not commit an items, state or hello message: only asks and cmds", async () => {
    const { harness, events } = await connected();
    harness.link.push({ t: "state", seq: 2, delta: {} });
    harness.link.push(hello(true));
    harness.link.push({ t: "items", req: "req-1", items: [] });
    await pause(80);
    expect(events.filter((event) => event.kind === "committed")).toEqual([]);
    harness.link.push({ t: "cmd", id: "cmd-9", chat: "default", name: "open" });
    await waitFor(() => events.some((event) => event.kind === "committed"));
    expect(events.filter((event) => event.kind === "committed")).toHaveLength(1);
  });
});
