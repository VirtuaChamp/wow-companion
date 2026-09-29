import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { ProviderConfig, ProviderEvent } from "@wow-companion/contracts";
import {
  createCursorWith,
  cursorArgs,
  parseListModelsOutput,
  runDirFor,
  writeMcpConfig,
} from "../../src/adapters/providers/cursor.ts";
import { fakeCheckInstalled, fakeRun, fixturePath, loadJsonlFixture } from "./helpers.ts";

function baseConfig(models: string[] = ["auto"]): ProviderConfig {
  return {
    cwd: fixturePath(),
    timeoutMs: 5000,
    models,
    mcp: (runId: string) => ({ command: "node", args: ["stub.js"], env: { WOWC_RUN: runId } }),
  };
}

function noListModels(): string[] {
  return [];
}

describe("provider.cursor", () => {
  test("provider.cursor.mcp_config per run", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wowc-cursor-mcp-"));
    writeMcpConfig(runDir, { command: "node", args: ["stub.js"], env: { WOWC_RUN: "run-xyz" } });
    const written = JSON.parse(readFileSync(join(runDir, ".cursor", "mcp.json"), "utf8"));
    expect(written.mcpServers.wowc.env.WOWC_RUN).toBe("run-xyz");
    rmSync(runDir, { recursive: true, force: true });
  });

  test("provider.cursor.runDirFor rejects an unsafe runId", () => {
    expect(() => runDirFor(fixturePath(), "")).toThrow();
    expect(() => runDirFor(fixturePath(), "..")).toThrow();
    expect(() => runDirFor(fixturePath(), "../escape")).toThrow();
  });

  test("provider.cursor.argv hardens the D14 posture and never approves other MCP servers", () => {
    const args = cursorArgs({
      prompt: "reply with the single word pong",
      model: "auto",
      workspace: "workspace",
    });
    expect(args).toContain("--mode");
    expect(args[args.indexOf("--mode") + 1]).toBe("ask");
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("enabled");
    expect(args).toContain("--trust");
    expect(args).not.toContain("--approve-mcps");
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("-f");
  });

  test("provider.cursor.argv carries the workspace directory", async () => {
    let seenArgs: string[] = [];
    const capture: Parameters<typeof createCursorWith>[0] = async (_command, args, _options) => {
      seenArgs = args;
      return { outcome: "exit", code: 0 };
    };
    const provider = createCursorWith(
      capture,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    await provider.run(
      {
        runId: "run-argv",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    const workspaceIndex = seenArgs.indexOf("--workspace");
    expect(workspaceIndex).toBeGreaterThanOrEqual(0);
    expect(seenArgs[workspaceIndex + 1]).toBe(runDirFor(fixturePath(), "run-argv"));
  });

  test("provider.cursor.run passes a minimal env allow-list, never the full process env", async () => {
    let seenEnv: Record<string, string> = {};
    const capture: Parameters<typeof createCursorWith>[0] = async (_command, _args, options) => {
      seenEnv = options.env;
      return { outcome: "exit", code: 0 };
    };
    vi.stubEnv("WOWC_PROBE_SECRET", "should-not-reach-cursor");
    try {
      const provider = createCursorWith(
        capture,
        fakeCheckInstalled(true),
        noListModels,
        true,
      )(baseConfig());
      await provider.run(
        {
          runId: "run-env",
          prompt: "reply with the single word pong",
          system: "test",
          model: "auto",
          signal: new AbortController().signal,
        },
        () => {},
      );
    } finally {
      vi.unstubAllEnvs();
    }
    expect(seenEnv["WOWC_PROBE_SECRET"]).toBeUndefined();
    expect(seenEnv["WOWC_RUN"]).toBe("run-env");
  });

  test("provider.cursor.stream parses the recorded nested tool_call shape", async () => {
    const lines = [
      { type: "system", subtype: "init", session_id: "s3" },
      {
        type: "tool_call",
        subtype: "started",
        call_id: "call-1",
        tool_call: { getMcpToolsToolCall: { args: { pattern: "wowc" } } },
      },
      { type: "result", subtype: "success", is_error: false, result: "pong", session_id: "s3" },
    ];
    const provider = createCursorWith(
      fakeRun(lines),
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const events: ProviderEvent[] = [];
    const result = await provider.run(
      {
        runId: "run-tool-shape",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      (event) => events.push(event),
    );
    expect(result).toEqual({ ok: true, value: { sessionId: "s3", text: "pong" } });
    expect(events).toContainEqual({ kind: "tool", name: "getMcpToolsToolCall" });
  });

  test("provider.cursor.stream", async () => {
    const lines = loadJsonlFixture(fixturePath("fixtures/cursor/stream.jsonl"));
    const provider = createCursorWith(
      fakeRun(lines),
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const events: ProviderEvent[] = [];
    const result = await provider.run(
      {
        runId: "run-1",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      (event) => events.push(event),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).toBe("e1439752-7727-44f4-8e94-255a0acd50ad");
      expect(result.value.text.length).toBeGreaterThan(0);
    }
    expect(events.some((e) => e.kind === "session")).toBe(true);
    expect(events.some((e) => e.kind === "tool")).toBe(true);
    const textDeltas = events.filter(
      (e): e is { kind: "text"; delta: string } => e.kind === "text",
    );
    expect(textDeltas.length).toBeGreaterThan(0);
    if (result.ok) {
      expect(textDeltas.map((e) => e.delta).join("")).toBe(result.value.text);
    }
    expect(existsSync(runDirFor(fixturePath(), "run-1"))).toBe(false);
  });

  test("provider.cursor.stream keeps a successful result even if the process later exits non-zero", async () => {
    const lines = [
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "result", subtype: "success", is_error: false, result: "pong", session_id: "s1" },
    ];
    const flaky = async (
      _command: string,
      _args: string[],
      options: { onLine: (line: { stream: "stdout" | "stderr"; text: string }) => void },
    ) => {
      for (const line of lines) options.onLine({ stream: "stdout", text: JSON.stringify(line) });
      return { outcome: "exit" as const, code: 1 };
    };
    const provider = createCursorWith(
      flaky,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-flaky",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: true, value: { sessionId: "s1", text: "pong" } });
  });

  test("provider.cursor.run fails a clean exit 0 that never saw a result frame", async () => {
    const noResult = async (
      _command: string,
      _args: string[],
      options: { onLine: (line: { stream: "stdout" | "stderr"; text: string }) => void },
    ) => {
      options.onLine({
        stream: "stdout",
        text: JSON.stringify({ type: "system", subtype: "init", session_id: "s2" }),
      });
      return { outcome: "exit" as const, code: 0 };
    };
    const provider = createCursorWith(
      noResult,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-no-result",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_failed" });
  });

  test("provider.cursor.run refuses with provider_disabled when cursor-agent is not installed, without spawning", async () => {
    const spy = vi.fn();
    const provider = createCursorWith(
      spy,
      fakeCheckInstalled(false),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-not-installed",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_disabled" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("provider.cursor.run returns provider_failed instead of rejecting on an unexpected runner error", async () => {
    const throwingRun = async () => {
      throw new Error("unexpected launch failure");
    };
    const provider = createCursorWith(
      throwingRun,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-runner-throws",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_failed" });
  });

  test("provider.cursor.describe", async () => {
    const provider = createCursorWith(
      fakeRun([]),
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig(["auto"]));
    const info = await provider.describe();
    expect(info.installed).toBe(true);
    expect(info.models).toEqual(["auto"]);
  });

  test("provider.cursor.describe stays disabled in production (cursor headless MCP is broken)", async () => {
    const provider = createCursorWith(
      fakeRun([]),
      fakeCheckInstalled(true),
      noListModels,
      false,
    )(baseConfig(["auto"]));
    const info = await provider.describe();
    expect(info.enabled).toBe(false);
    expect(info.reason).toContain("cursor headless MCP does not work");
  });

  test("provider.cursor.describe missing binary", async () => {
    const provider = createCursorWith(
      fakeRun([]),
      fakeCheckInstalled(false, "not found"),
      noListModels,
      true,
    )(baseConfig());
    const info = await provider.describe();
    expect(info.installed).toBe(false);
    expect(info.reason).toBe("not found");
  });

  test("provider.cursor.run refuses with provider_disabled in production", async () => {
    const provider = createCursorWith(
      fakeRun([]),
      fakeCheckInstalled(true),
      noListModels,
      false,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-disabled",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_disabled" });
  });

  test("provider.cursor.run missing binary", async () => {
    const missing = async () => ({ outcome: "exit" as const, code: null });
    const provider = createCursorWith(
      missing,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-missing",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_missing" });
  });

  test("provider.cursor.run auth error text", async () => {
    const authFail = async (
      _command: string,
      _args: string[],
      options: { onLine: (line: { stream: "stdout" | "stderr"; text: string }) => void },
    ) => {
      options.onLine({ stream: "stderr", text: "please sign in to continue" });
      return { outcome: "exit" as const, code: 1 };
    };
    const provider = createCursorWith(
      authFail,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-auth",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_auth" });
  });

  test("provider.cursor.run rejects an unsafe runId before spawning or arming a timer", async () => {
    vi.useFakeTimers();
    try {
      let spawned = false;
      const spy: Parameters<typeof createCursorWith>[0] = async () => {
        spawned = true;
        return { outcome: "exit", code: 0 };
      };
      const provider = createCursorWith(
        spy,
        fakeCheckInstalled(true),
        noListModels,
        true,
      )(baseConfig());
      const result = await provider.run(
        {
          runId: "../escape",
          prompt: "reply with the single word pong",
          system: "test",
          model: "auto",
          signal: new AbortController().signal,
        },
        () => {},
      );
      expect(result).toEqual({ ok: false, error: "provider_failed" });
      expect(spawned).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("provider.cursor.run honours an already-aborted signal without spawning", async () => {
    let spawned = false;
    const spy: Parameters<typeof createCursorWith>[0] = async () => {
      spawned = true;
      return { outcome: "exit", code: 0 };
    };
    const provider = createCursorWith(
      spy,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const controller = new AbortController();
    controller.abort();
    const result = await provider.run(
      {
        runId: "run-pre-aborted",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: controller.signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "cancelled" });
    expect(spawned).toBe(false);
  });

  test("provider.cursor.run times out without an external abort", async () => {
    const hang = async (
      _command: string,
      _args: string[],
      options: { signal: AbortSignal },
    ): Promise<{ outcome: "cancelled" }> => {
      return new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve({ outcome: "cancelled" }));
      });
    };
    const config = baseConfig();
    config.timeoutMs = 1;
    const provider = createCursorWith(hang, fakeCheckInstalled(true), noListModels, true)(config);
    const result = await provider.run(
      {
        runId: "run-timeout",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  test("provider.cursor.cancel", async () => {
    const lines = loadJsonlFixture(fixturePath("fixtures/cursor/stream.jsonl"));
    const provider = createCursorWith(
      fakeRun(lines),
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const controller = new AbortController();
    const runPromise = provider.run(
      {
        runId: "run-2",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: controller.signal,
      },
      () => {},
    );
    controller.abort();
    const result = await runPromise;
    expect(result).toEqual({ ok: false, error: "cancelled" });
  });

  test("provider.cursor.run classifies a non-zero exit with empty stderr as provider_failed, not provider_missing", async () => {
    const ranButEmpty = async () => ({ outcome: "exit" as const, code: 1 });
    const provider = createCursorWith(
      ranButEmpty,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-nonzero-no-stderr",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_failed" });
  });

  test("provider.cursor.run still classifies a null exit code (spawn failure) as provider_missing", async () => {
    const missing = async () => ({ outcome: "exit" as const, code: null });
    const provider = createCursorWith(
      missing,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-null-exit",
        prompt: "reply with the single word pong",
        system: "test",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_missing" });
  });

  test("provider.cursor.parseListModelsOutput parses every model id out of a real --list-models capture", () => {
    const text = readFileSync(fixturePath("fixtures/cursor/list-models.txt"), "utf8");
    const models = parseListModelsOutput(text);
    expect(models.length).toBeGreaterThan(100);
    expect(models).toContain("auto");
    expect(models).toContain("gpt-5.1");
    expect(models).toContain("claude-sonnet-5-high");
    expect(models).not.toContain("Available");
    expect(models).not.toContain("Tip:");
  });

  test("provider.cursor.session_unknown: cursor never resumes, so a sessionId refuses at once", async () => {
    let spawned = false;
    const spy: Parameters<typeof createCursorWith>[0] = async () => {
      spawned = true;
      return { outcome: "exit", code: 0 };
    };
    const provider = createCursorWith(
      spy,
      fakeCheckInstalled(true),
      noListModels,
      true,
    )(baseConfig());
    const result = await provider.run(
      {
        runId: "run-3",
        prompt: "reply with the single word pong",
        system: "test",
        sessionId: "00000000-0000-4000-8000-000000000000",
        model: "auto",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "session_unknown" });
    expect(spawned).toBe(false);
  });
});
