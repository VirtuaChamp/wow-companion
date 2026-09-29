import { describe, expect, it } from "vitest";
import { createRunner } from "../../src/runner.ts";
import type { RunRequest } from "../../src/runner.ts";
import { fakeProvider } from "./helpers.ts";
import type { RunInput } from "./helpers.ts";

const request = (askId: string): RunRequest => ({
  askId,
  provider: "claude",
  model: "m1",
  prompt: "hello",
  system: "sys",
});

describe("daemon.runner", () => {
  it("mints its own run id, never the ask id, and maps it to the ask", async () => {
    const seen: RunInput[] = [];
    const runner = createRunner({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            seen.push(input);
            return { ok: true, value: { sessionId: "s", text: "t" } };
          }),
        ],
      ]),
      timeoutMs: 1000,
    });
    await runner.run(request("ask 1/with*odd chars"), () => {});
    await runner.run(request("ask-2"), () => {});
    expect(seen).toHaveLength(2);
    for (const input of seen) {
      expect(input.runId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
    expect(seen[0]?.runId).not.toBe(seen[1]?.runId);
    expect(seen[0]?.runId).not.toBe("ask 1/with*odd chars");
  });

  it("attaches a waypoint posted under a run id and returns it with that run's outcome", async () => {
    let runner!: ReturnType<typeof createRunner>;
    runner = createRunner({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            const attached = runner.attachWaypoint(input.runId, {
              uiMapId: 85,
              x: 1,
              y: 2,
              label: "L",
            });
            expect(attached).toEqual({ ok: true, value: undefined });
            return { ok: true, value: { sessionId: "s", text: "t" } };
          }),
        ],
      ]),
      timeoutMs: 1000,
    });
    const outcome = await runner.run(request("a1"), () => {});
    expect(outcome.waypoint).toEqual({ uiMapId: 85, x: 1, y: 2, label: "L" });
    expect(runner.attachWaypoint("gone", { uiMapId: 1, x: 1, y: 1, label: "" })).toEqual({
      ok: false,
      error: "no_active_ask",
    });
  });

  it("forgets a run once it finished", async () => {
    let captured = "";
    const runner = createRunner({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            captured = input.runId;
            return { ok: true, value: { sessionId: "s", text: "t" } };
          }),
        ],
      ]),
      timeoutMs: 1000,
    });
    await runner.run(request("a1"), () => {});
    expect(runner.attachWaypoint(captured, { uiMapId: 1, x: 1, y: 1, label: "" })).toEqual({
      ok: false,
      error: "no_active_ask",
    });
  });

  it("answers timeout when the run outlives the time limit", async () => {
    const runner = createRunner({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", (input) => {
            return new Promise((resolve) => {
              input.signal.addEventListener("abort", () =>
                resolve({ ok: false, error: "cancelled" }),
              );
            });
          }),
        ],
      ]),
      timeoutMs: 20,
      timeoutGraceMs: 0,
    });
    const outcome = await runner.run(request("a1"), () => {});
    expect(outcome.result).toEqual({ ok: false, error: "timeout" });
  });

  it("cancels a run by ask id", async () => {
    const runner = createRunner({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", (input) => {
            return new Promise((resolve) => {
              input.signal.addEventListener("abort", () =>
                resolve({ ok: false, error: "cancelled" }),
              );
            });
          }),
        ],
      ]),
      timeoutMs: 5000,
    });
    const pending = runner.run(request("a1"), () => {});
    expect(runner.cancel("a1")).toBe(true);
    expect((await pending).result).toEqual({ ok: false, error: "cancelled" });
    expect(runner.cancel("a1")).toBe(false);
  });

  it("answers provider_missing for a provider it does not hold and provider_failed when a run throws", async () => {
    const runner = createRunner({
      providers: new Map([
        [
          "codex",
          fakeProvider("codex", async () => {
            throw new Error("boom");
          }),
        ],
      ]),
      timeoutMs: 1000,
    });
    expect((await runner.run(request("a1"), () => {})).result).toEqual({
      ok: false,
      error: "provider_missing",
    });
    expect((await runner.run({ ...request("a2"), provider: "codex" }, () => {})).result).toEqual({
      ok: false,
      error: "provider_failed",
    });
  });

  it("passes model, effort, session and prompt through", async () => {
    const seen: RunInput[] = [];
    const runner = createRunner({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            seen.push(input);
            return { ok: true, value: { sessionId: "s", text: "t" } };
          }),
        ],
      ]),
      timeoutMs: 1000,
    });
    await runner.run({ ...request("a1"), effort: "high", sessionId: "sess" }, () => {});
    await runner.run(request("a2"), () => {});
    expect(seen[0]).toMatchObject({
      model: "m1",
      effort: "high",
      sessionId: "sess",
      prompt: "hello",
    });
    expect(seen[1] && "effort" in seen[1]).toBe(false);
    expect(seen[1] && "sessionId" in seen[1]).toBe(false);
  });

  it("passes tools none through to the provider and omits it by default", async () => {
    const seen: RunInput[] = [];
    const runner = createRunner({
      providers: new Map([
        [
          "claude",
          fakeProvider("claude", async (input) => {
            seen.push(input);
            return { ok: true, value: { sessionId: "s", text: "t" } };
          }),
        ],
      ]),
      timeoutMs: 1000,
    });
    await runner.run({ ...request("a1"), tools: "none" }, () => {});
    await runner.run(request("a2"), () => {});
    expect(seen[0]?.tools).toBe("none");
    expect(seen[1] && "tools" in seen[1]).toBe(false);
  });
});
