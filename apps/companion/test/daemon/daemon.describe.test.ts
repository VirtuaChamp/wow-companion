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

  it("aborts the signal it handed to a provider check that outlives the bound", async () => {
    let seen: AbortSignal | undefined;
    const provider: Provider = {
      id: "claude",
      describe: (signal) => {
        seen = signal;
        return new Promise(() => {});
      },
      run: okRun("x"),
    };
    const harness = startDaemon({
      describeTimeoutMs: 40,
      providers: new Map([["claude", provider]]),
    });
    cleanups.push(harness.stop);

    harness.link.push(hello());
    await waitForSent(harness.link, 3);

    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(true);
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

  it("answers an ask after a settings check that hangs, once the bound has passed", async () => {
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

  it("applies a settings message before an ask that arrives right after it, even when the provider check is slow", async () => {
    const seen: string[] = [];
    let slow = false;
    const claude: Provider = {
      id: "claude",
      describe: async () => {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 120));
        return { installed: true, enabled: true, models: ["m1", "m2"], efforts: ["low", "high"] };
      },
      run: async (input) => {
        seen.push(`claude:${input.model}`);
        return { ok: true, value: { sessionId: "s", text: "from claude" } };
      },
    };
    const codex: Provider = {
      id: "codex",
      describe: async () => ({ installed: true, enabled: true, models: ["c1"], efforts: ["low"] }),
      run: async (input) => {
        seen.push(`codex:${input.model}`);
        return { ok: true, value: { sessionId: "s", text: "from codex" } };
      },
    };
    const harness = startDaemon({
      describeMaxAgeMs: 0,
      providers: new Map([
        ["claude", claude],
        ["codex", codex],
      ]),
    });
    cleanups.push(harness.stop);
    harness.link.push(hello());
    harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
    await waitForSent(harness.link, 3);
    slow = true;

    harness.link.push({ t: "settings", chat: "default", provider: "codex", model: "c1" });
    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitFor(() => harness.link.sent().some((msg) => msg.t === "reply"));

    expect(seen).toEqual(["codex:c1"]);
    expect(harness.link.sent().some((msg) => msg.t === "error")).toBe(false);
    expect(harness.link.sent().find((msg) => msg.t === "reply")).toMatchObject({
      provider: "codex",
    });
  });
});
