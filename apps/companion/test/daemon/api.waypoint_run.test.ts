import { afterEach, describe, expect, it } from "vitest";
import { X_WOWC_RUN_HEADER } from "@wow-companion/contracts";
import type { CompanionToGame } from "@wow-companion/contracts";
import {
  fakeProvider,
  hello,
  makeSnapshot,
  serve,
  startDaemon,
  waitFor,
  waitForSent,
} from "./helpers.ts";
import type { Harness, RunInput } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function postWaypoint(base: string, runId: string | undefined, label: string): Promise<Response> {
  return fetch(`${base}/waypoint`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(runId === undefined ? {} : { [X_WOWC_RUN_HEADER]: runId }),
    },
    body: JSON.stringify({ uiMapId: 85, x: 40, y: 60, label }),
  });
}

type Reply = Extract<CompanionToGame, { t: "reply" }>;

function repliesOf(harness: Harness): Reply[] {
  return harness.link.sent().filter((msg): msg is Reply => msg.t === "reply");
}

describe("api.waypoint_run", () => {
  it("lands each waypoint in the reply of the ask its run id names, with two asks running at once", async () => {
    const started: { askText: string; runId: string }[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let base = "";
    const run = async (input: RunInput) => {
      started.push({ askText: input.prompt, runId: input.runId });
      if (started.length === 2) release();
      await bothStarted;
      const response = await postWaypoint(base, input.runId, `pin for ${input.prompt}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      return {
        ok: true as const,
        value: { sessionId: `s-${input.prompt}`, text: `done ${input.prompt}` },
      };
    };
    const harness = startDaemon({ providers: new Map([["claude", fakeProvider("claude", run)]]) });
    cleanups.push(harness.stop);
    const served = await serve(harness.daemon);
    cleanups.push(() => served.server.close());
    base = served.base;

    harness.link.push(hello());
    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    harness.link.push({ t: "cmd", id: "cmd-1", chat: "default", name: "new", arg: "Second" });
    await waitForSent(harness.link, 6);
    const chatsMessages = harness.link.sent().filter((msg) => msg.t === "chats");
    const last = chatsMessages[chatsMessages.length - 1];
    const secondChat = last?.t === "chats" ? last.active : "";
    expect(secondChat).not.toBe("default");

    harness.link.push({ t: "ask", id: "ask-A", chat: "default", text: "A", mentions: [] });
    harness.link.push({ t: "ask", id: "ask-B", chat: secondChat, text: "B", mentions: [] });

    await waitFor(() => repliesOf(harness).length === 2);
    const replies = repliesOf(harness);
    const replyA = replies.find((reply) => reply.id === "ask-A");
    const replyB = replies.find((reply) => reply.id === "ask-B");
    expect(replyA?.waypoint).toEqual({ uiMapId: 85, x: 40, y: 60, label: "pin for A" });
    expect(replyB?.waypoint).toEqual({ uiMapId: 85, x: 40, y: 60, label: "pin for B" });
    expect(replyA?.chat).toBe("default");
    expect(replyB?.chat).toBe(secondChat);

    expect(started).toHaveLength(2);
    for (const entry of started) {
      expect(entry.runId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(["ask-A", "ask-B"]).not.toContain(entry.runId);
    }
    expect(started[0]?.runId).not.toBe(started[1]?.runId);
  });

  it("answers 409 no_active_ask for an unknown run id, a finished run and a missing header", async () => {
    let finishedRun = "";
    const run = async (input: RunInput) => {
      finishedRun = input.runId;
      return { ok: true as const, value: { sessionId: "s", text: "done" } };
    };
    const harness = startDaemon({ providers: new Map([["claude", fakeProvider("claude", run)]]) });
    cleanups.push(harness.stop);
    const { server, base } = await serve(harness.daemon);
    cleanups.push(() => server.close());

    harness.link.push(hello());
    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    harness.link.push({ t: "ask", id: "ask-1", chat: "default", text: "hi", mentions: [] });
    await waitFor(() => repliesOf(harness).length === 1);

    for (const runId of ["run-unknown", finishedRun, undefined]) {
      const response = await postWaypoint(base, runId, "late");
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ ok: false, error: "no_active_ask" });
    }
    expect(repliesOf(harness)[0]?.waypoint).toBeUndefined();
  });
});
