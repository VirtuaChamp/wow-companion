import { afterEach, describe, expect, it } from "vitest";
import type { Provider } from "@wow-companion/contracts";
import {
  fakeProvider,
  hello,
  makeSnapshot,
  okRun,
  startDaemon,
  waitFor,
  waitForSent,
} from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function hungProvider(): Provider {
  return {
    id: "claude",
    describe: () => new Promise(() => {}),
    run: okRun("x"),
  };
}

describe("daemon.describe", () => {
  it("bounds a hung provider check with a timeout and reports why", async () => {
    const harness = startDaemon({
      describeTimeoutMs: 40,
      providers: new Map([["claude", hungProvider()]]),
    });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    const sent = await waitForSent(harness.link, 3);

    const options = sent[0];
    if (options?.t !== "options") throw new Error("expected options");
    expect(options.providers[0]).toMatchObject({ id: "claude", installed: false, enabled: false });
    expect(options.providers[0]?.reason).toContain("timed out");
  });

  it("keeps handling messages while a provider check is still running", async () => {
    const harness = startDaemon({
      describeTimeoutMs: 400,
      providers: new Map([["claude", hungProvider()]]),
    });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    harness.link.push({ t: "cmd", chat: "default", name: "new", arg: "Second" });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "chats"));

    expect(
      harness.link
        .sent()
        .some((msg) => msg.t === "options" && msg.providers[0]?.reason?.includes("timed out")),
    ).toBe(false);
    expect(harness.daemon.api.getState().ok).toBe(true);
    await waitFor(() =>
      harness.link
        .sent()
        .some((msg) => msg.t === "options" && msg.providers[0]?.reason?.includes("timed out")),
    );
  });

  it("does not let a hung check for settings block an ask", async () => {
    const provider: Provider = {
      id: "claude",
      describe: () => new Promise(() => {}),
      run: async () => ({ ok: true, value: { sessionId: "s", text: "answered" } }),
    };
    const harness = startDaemon({
      describeTimeoutMs: 400,
      providers: new Map([["claude", provider]]),
    });
    cleanups.push(harness.stop);
    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    harness.link.push({ t: "settings", provider: "claude", model: "m1" });
    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });

    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));
    expect(harness.link.sent().find((msg) => msg.t === "reply")).toMatchObject({ id: "a1" });
  });

  it("bounds a hung pre-describe probe refresh too", async () => {
    const harness = startDaemon({
      describeTimeoutMs: 40,
      beforeDescribe: () => new Promise(() => {}),
      providers: new Map([["claude", fakeProvider("claude", okRun("x"))]]),
    });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    const sent = await waitForSent(harness.link, 3);

    expect(sent[0]?.t).toBe("options");
  });

  it("turns a provider check that throws into a disabled provider with a reason", async () => {
    const provider: Provider = {
      id: "claude",
      describe: () => Promise.reject(new Error("boom")),
      run: okRun("x"),
    };
    const harness = startDaemon({ providers: new Map([["claude", provider]]) });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    const sent = await waitForSent(harness.link, 3);

    if (sent[0]?.t !== "options") throw new Error("expected options");
    expect(sent[0].providers[0]).toMatchObject({ installed: false, enabled: false });
  });
});
