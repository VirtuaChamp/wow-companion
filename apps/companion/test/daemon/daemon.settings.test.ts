import { afterEach, describe, expect, it } from "vitest";
import type { CompanionToGame } from "@wow-companion/contracts";
import { fakeProvider, hello, makeSnapshot, okRun, startDaemon, waitForSent } from "./helpers.ts";
import type { RunInput } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function connected(
  overrides: Parameters<typeof startDaemon>[0] = {},
): Promise<ReturnType<typeof startDaemon>> {
  const harness = startDaemon(overrides);
  cleanups.push(harness.stop);
  harness.link.push(hello());
  harness.link.push({ t: "state", seq: 1, delta: makeSnapshot() });
  await waitForSent(harness.link, 3);
  return harness;
}

function after(sent: CompanionToGame[], count: number): CompanionToGame[] {
  return sent.slice(count);
}

describe("daemon.settings", () => {
  it("answers a refused settings message with bad_settings and then options", async () => {
    const harness = await connected();

    harness.link.push({ t: "settings", provider: "claude", model: "nope" });
    const sent = after(await waitForSent(harness.link, 5), 3);

    expect(sent[0]).toEqual({
      t: "error",
      code: "bad_settings",
      message: "model is not offered by this provider",
    });
    expect(sent[1]?.t).toBe("options");
    if (sent[1]?.t !== "options") return;
    expect(sent[1].active).toEqual({ provider: "claude", model: "m1", effort: "low" });
    expect(harness.settingsSaves).toEqual([]);
  });

  it("refuses an unsupported effort and a config-disabled provider", async () => {
    const harness = await connected();

    harness.link.push({ t: "settings", provider: "claude", model: "m1", effort: "max" });
    harness.link.push({ t: "settings", provider: "cursor", model: "u1" });
    const sent = after(await waitForSent(harness.link, 7), 3);

    expect(sent.map((msg) => msg.t)).toEqual(["error", "options", "error", "options"]);
    expect(sent[0]).toMatchObject({ code: "bad_settings" });
    expect(sent[2]).toMatchObject({ code: "bad_settings", message: "provider is not enabled" });
  });

  it("applies a global choice, persists it and re-sends options", async () => {
    const harness = await connected();

    harness.link.push({ t: "settings", provider: "claude", model: "m2", effort: "high" });
    const sent = after(await waitForSent(harness.link, 4), 3);

    expect(sent).toHaveLength(1);
    if (sent[0]?.t !== "options") throw new Error("expected options");
    expect(sent[0].active).toEqual({ provider: "claude", model: "m2", effort: "high" });
    expect(sent[0].providers[0]?.current).toEqual({ model: "m2", effort: "high" });
    expect(harness.settingsSaves.at(-1)?.global).toEqual({
      provider: "claude",
      model: "m2",
      effort: "high",
    });
  });

  it("applies a chat-only choice and reports it in options.chat", async () => {
    const harness = await connected();

    harness.link.push({ t: "settings", chat: "default", provider: "claude", model: "m2" });
    const sent = after(await waitForSent(harness.link, 4), 3);

    if (sent[0]?.t !== "options") throw new Error("expected options");
    expect(sent[0].active).toEqual({ provider: "claude", model: "m1", effort: "low" });
    expect(sent[0].chat).toEqual({ id: "default", provider: "claude", model: "m2" });
    expect(harness.settingsSaves.at(-1)?.perChat).toEqual({ default: { model: "m2" } });
  });

  it("runs the next ask with the chosen model and effort", async () => {
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

    harness.link.push({ t: "settings", provider: "claude", model: "m2", effort: "high" });
    await waitForSent(harness.link, 4);
    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitForSent(harness.link, 7);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ model: "m2", effort: "high", prompt: "hi" });
  });

  it("changes a chat provider when the chat-only choice names another provider", async () => {
    const harness = await connected({
      providers: new Map([
        ["claude", fakeProvider("claude", okRun("x"))],
        ["codex", fakeProvider("codex", okRun("x"), ["c1"], ["low"])],
      ]),
    });

    harness.link.push({ t: "settings", chat: "default", provider: "codex", model: "c1" });
    const sent = after(await waitForSent(harness.link, 5), 3);

    expect(sent.map((msg) => msg.t)).toEqual(["chats", "options"]);
    if (sent[0]?.t !== "chats") throw new Error("expected chats");
    expect(sent[0].list[0]?.provider).toBe("codex");
    if (sent[1]?.t !== "options") throw new Error("expected options");
    expect(sent[1].chat).toEqual({ id: "default", provider: "codex", model: "c1" });
  });

  it("refuses a provider change on a running chat with bad_settings, then options, and keeps settings", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = await connected({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async () => {
            await gate;
            return { ok: true, value: { sessionId: "s", text: "ok" } };
          }),
        ],
        ["codex", fakeProvider("codex", okRun("x"), ["c1"], ["low"])],
      ]),
    });

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitForSent(harness.link, 4);
    const before = harness.link.sent().length;
    harness.link.push({ t: "settings", chat: "default", provider: "codex", model: "c1" });
    const sent = after(await waitForSent(harness.link, before + 2), before);

    expect(sent.map((msg) => msg.t)).toEqual(["error", "options"]);
    expect(sent[0]).toMatchObject({ code: "bad_settings" });
    expect(harness.settingsSaves).toEqual([]);
    release();
    await waitForSent(harness.link, before + 4);
  });

  it("applies a chat-only model and effort change on a running chat without touching its provider", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = await connected({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async () => {
            await gate;
            return { ok: true, value: { sessionId: "s", text: "ok" } };
          }),
        ],
      ]),
    });

    harness.link.push({ t: "ask", id: "a1", chat: "default", text: "hi", mentions: [] });
    await waitForSent(harness.link, 4);
    const before = harness.link.sent().length;
    harness.link.push({
      t: "settings",
      chat: "default",
      provider: "claude",
      model: "m2",
      effort: "high",
    });
    const sent = after(await waitForSent(harness.link, before + 1), before);

    expect(sent.map((msg) => msg.t)).toEqual(["options"]);
    if (sent[0]?.t !== "options") throw new Error("expected options");
    expect(sent[0].chat).toEqual({
      id: "default",
      provider: "claude",
      model: "m2",
      effort: "high",
    });
    expect(harness.settingsSaves.at(-1)?.perChat).toEqual({
      default: { model: "m2", effort: "high" },
    });
    release();
    await waitForSent(harness.link, before + 3);
  });
});
