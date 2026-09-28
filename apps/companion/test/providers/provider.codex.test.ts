import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import spawn from "cross-spawn";
import type { ProviderConfig, ProviderEvent } from "@wow-companion/contracts";
import {
  codexArgs,
  createCodexWith,
  defaultCheckInstalled,
  minimalEnv,
} from "../../src/adapters/providers/codex.ts";
import {
  fakeCheckInstalled,
  fakeRun,
  fakeRunLines,
  fixturePath,
  loadRawLinesFixture,
} from "./helpers.ts";

vi.mock("cross-spawn", () => ({ default: { sync: vi.fn() } }));

function baseConfig(models: string[] = ["gpt-5.1-codex"]): ProviderConfig {
  return {
    cwd: fixturePath(),
    timeoutMs: 5000,
    models,
    mcp: (runId: string) => ({ command: "node", args: ["stub.js"], env: { WOWC_RUN: runId } }),
  };
}

const DISABLED_FEATURES = [
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "apps",
  "plugins",
  "remote_plugin",
  "hooks",
  "shell_tool",
  "unified_exec",
  "unified_exec_tty",
  "multi_agent",
  "view_image",
  "image_generation",
  "memories",
  "goals",
];

describe("provider.codex", () => {
  test("provider.codex.argv puts options before the prompt positional", () => {
    const args = codexArgs({
      prompt: "call the wowc_ping tool once, then reply with the single word pong",
      model: "gpt-5.1-codex",
      mcpCommand: "node",
      mcpArgs: ["stub.js"],
      mcpEnv: { WOWC_RUN: "run-1" },
    });
    expect(args[0]).toBe("exec");
    expect(args[args.length - 1]).toBe(
      "call the wowc_ping tool once, then reply with the single word pong",
    );
    expect(args).toContain("--json");
    expect(args).toContain("-s");
    expect(args[args.indexOf("-s") + 1]).toBe("read-only");
  });

  test("provider.codex.argv carries every D14 isolation flag", () => {
    const args = codexArgs({
      prompt: "reply with the single word pong",
      model: "gpt-5.1-codex",
      mcpCommand: "node",
      mcpArgs: ["stub.js"],
      mcpEnv: {},
    });
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).not.toContain("code_mode_host");
    for (const feature of DISABLED_FEATURES) {
      const index = args.indexOf(feature);
      expect(index).toBeGreaterThan(0);
      expect(args[index - 1]).toBe("--disable");
    }
  });

  test("provider.codex.argv resume puts --json after the resume subcommand", () => {
    const args = codexArgs({
      prompt: "continue",
      sessionId: "resume-target",
      model: "gpt-5.1-codex",
      mcpCommand: "node",
      mcpArgs: ["stub.js"],
      mcpEnv: {},
    });
    const resumeIndex = args.indexOf("resume");
    expect(resumeIndex).toBeGreaterThan(0);
    expect(args[resumeIndex + 1]).toBe("--json");
    expect(args[resumeIndex + 2]).toBe("resume-target");
    expect(args[resumeIndex + 3]).toBe("continue");
  });

  test("provider.codex.argv sets the wowc server to auto-approve its own tools", () => {
    const args = codexArgs({
      prompt: "call the wowc_ping tool once, then reply with the single word pong",
      model: "gpt-5.1-codex",
      mcpCommand: "node",
      mcpArgs: ["stub.js"],
      mcpEnv: {},
    });
    expect(args).toContain('mcp_servers.wowc.default_tools_approval_mode="approve"');
  });

  test("provider.codex.argv passes effort as a config override", () => {
    const args = codexArgs({
      prompt: "reply with the single word pong",
      model: "gpt-5.1-codex",
      effort: "high",
      mcpCommand: "node",
      mcpArgs: ["stub.js"],
      mcpEnv: {},
    });
    expect(args).toContain('model_reasoning_effort="high"');
  });

  test("provider.codex.run always passes the caller's model, never a default", async () => {
    let seenArgs: string[] = [];
    const capture: Parameters<typeof createCodexWith>[0] = async (_command, args, _options) => {
      seenArgs = args;
      return { outcome: "exit", code: 0 };
    };
    const provider = createCodexWith(capture, fakeCheckInstalled(true))(baseConfig());
    await provider.run(
      {
        runId: "run-model",
        prompt: "reply with the single word pong",
        system: "test",
        model: "some-caller-chosen-model",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(seenArgs).toContain("--model");
    expect(seenArgs[seenArgs.indexOf("--model") + 1]).toBe("some-caller-chosen-model");
  });

  test("provider.codex.run carries the caller's system prompt into the positional prompt", async () => {
    let seenArgs: string[] = [];
    const capture: Parameters<typeof createCodexWith>[0] = async (_command, args, _options) => {
      seenArgs = args;
      return { outcome: "exit", code: 0 };
    };
    const provider = createCodexWith(capture, fakeCheckInstalled(true))(baseConfig());
    await provider.run(
      {
        runId: "run-system",
        prompt: "reply with the single word pong",
        system: "stay in character as a WoW guide",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(seenArgs[seenArgs.length - 1]).toContain("stay in character as a WoW guide");
    expect(seenArgs[seenArgs.length - 1]).toContain("reply with the single word pong");
  });

  test("provider.codex.stream", async () => {
    const lines = loadRawLinesFixture(fixturePath("fixtures/codex/stream.jsonl"));
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const events: ProviderEvent[] = [];
    const result = await provider.run(
      {
        runId: "run-1",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      (event) => events.push(event),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("pong");
      expect(result.value.sessionId).toBe("01a0e510-f2f7-7160-b738-a64f71baeb54");
    }
    expect(events.some((e) => e.kind === "session")).toBe(true);
    expect(events.some((e) => e.kind === "text" && e.delta === "pong")).toBe(true);
    const toolEvent = events.find((e) => e.kind === "tool" && e.name === "wowc_ping");
    expect(toolEvent).toBeDefined();
    if (toolEvent?.kind === "tool") {
      expect(toolEvent.failure).toBeUndefined();
    }
    expect(lines.some((line) => line.includes("pong-from-stub WOWC_RUN=record-codex-stream"))).toBe(
      true,
    );
  });

  test("provider.codex.stream surfaces a command_execution item as a shell tool event", async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"thread-shell"}',
      '{"type":"item.completed","item":{"type":"command_execution","command":"cat config.toml"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"pong"}}',
      '{"type":"turn.completed"}',
    ];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const events: ProviderEvent[] = [];
    await provider.run(
      {
        runId: "run-shell",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      (event) => events.push(event),
    );
    expect(events.some((e) => e.kind === "tool" && e.name === "shell")).toBe(true);
  });

  test("provider.codex.describe", async () => {
    const provider = createCodexWith(
      fakeRun([]),
      fakeCheckInstalled(true),
    )(baseConfig(["gpt-5.1-codex"]));
    const info = await provider.describe();
    expect(info.installed).toBe(true);
    expect(info.enabled).toBe(true);
    expect(info.models).toEqual(["gpt-5.1-codex"]);
  });

  test("provider.codex.describe missing binary", async () => {
    const provider = createCodexWith(
      fakeRun([]),
      fakeCheckInstalled(false, "not found"),
    )(baseConfig());
    const info = await provider.describe();
    expect(info.installed).toBe(false);
    expect(info.reason).toBe("not found");
  });

  test("provider.codex.run missing binary", async () => {
    const missing = async () => ({ outcome: "exit" as const, code: null });
    const provider = createCodexWith(missing, fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-missing",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_missing" });
  });

  test("provider.codex.run auth error text", async () => {
    const lines = ["stderr: Error: not logged in, run `codex login`", "exit: 1"];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-auth",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_auth" });
  });

  test("provider.codex.run rejects an unsafe runId before spawning or arming a timer", async () => {
    vi.useFakeTimers();
    try {
      let spawned = false;
      const spy: Parameters<typeof createCodexWith>[0] = async () => {
        spawned = true;
        return { outcome: "exit", code: 0 };
      };
      const provider = createCodexWith(spy, fakeCheckInstalled(true))(baseConfig());
      const result = await provider.run(
        {
          runId: "../escape",
          prompt: "reply with the single word pong",
          system: "test",
          model: "gpt-5.1-codex",
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

  test("provider.codex.run honours an already-aborted signal without spawning", async () => {
    let spawned = false;
    const spy: Parameters<typeof createCodexWith>[0] = async () => {
      spawned = true;
      return { outcome: "exit", code: 0 };
    };
    const provider = createCodexWith(spy, fakeCheckInstalled(true))(baseConfig());
    const controller = new AbortController();
    controller.abort();
    const result = await provider.run(
      {
        runId: "run-pre-aborted",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: controller.signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "cancelled" });
    expect(spawned).toBe(false);
  });

  test("provider.codex.run times out without an external abort", async () => {
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
    const provider = createCodexWith(hang, fakeCheckInstalled(true))(config);
    const result = await provider.run(
      {
        runId: "run-timeout",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  test("provider.codex.cancel", async () => {
    const lines = loadRawLinesFixture(fixturePath("fixtures/codex/stream.jsonl"));
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const controller = new AbortController();
    const runPromise = provider.run(
      {
        runId: "run-2",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: controller.signal,
      },
      () => {},
    );
    controller.abort();
    const result = await runPromise;
    expect(result).toEqual({ ok: false, error: "cancelled" });
  });

  test("provider.codex.session_unknown", async () => {
    const lines = loadRawLinesFixture(fixturePath("fixtures/codex/session_unknown.jsonl"));
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-3",
        prompt: "continue",
        system: "test",
        sessionId: "00000000-0000-4000-8000-000000000000",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "session_unknown" });
  });

  test("provider.codex.stream treats a type:error followed by turn.completed as non-fatal", async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"thread-recoverable"}',
      '{"type":"error","message":"stream retry notice"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"pong"}}',
      '{"type":"turn.completed"}',
      "exit: 0",
    ];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const events: ProviderEvent[] = [];
    const result = await provider.run(
      {
        runId: "run-error-recovered",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      (event) => events.push(event),
    );
    expect(result).toEqual({ ok: true, value: { sessionId: "thread-recoverable", text: "pong" } });
    expect(events.some((e) => e.kind === "tool" && e.name === "error")).toBe(true);
  });

  test("provider.codex.run fails when a type:error appears with no following turn.completed", async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"thread-fatal"}',
      '{"type":"error","message":"not logged in, run codex login"}',
      "exit: 0",
    ];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-error-fatal",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_auth" });
  });

  test("provider.codex.run fails when a type:error follows turn.completed, even with exit 0", async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"thread-late-error"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"pong"}}',
      '{"type":"turn.completed"}',
      '{"type":"error","message":"not logged in, run codex login"}',
      "exit: 0",
    ];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-error-after-completed",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_auth" });
  });

  test("provider.codex.run fails on a non-zero exit even after a turn.completed was seen", async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"thread-late-exit"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"pong"}}',
      '{"type":"turn.completed"}',
      "stderr: unexpected crash after completion",
      "exit: 1",
    ];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-exit-after-completed",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result.ok).toBe(false);
  });

  test("provider.codex.run classifies a non-zero exit with empty stderr as provider_failed, not provider_missing", async () => {
    const ranButEmpty = async () => ({ outcome: "exit" as const, code: 1 });
    const provider = createCodexWith(ranButEmpty, fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-nonzero-no-stderr",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_failed" });
  });

  test("provider.codex.run fails a clean exit 0 that never saw turn.completed", async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"thread-truncated"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"pong"}}',
      "exit: 0",
    ];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-no-turn-completed",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_failed" });
  });

  test("provider.codex.run refuses with provider_disabled when codex is not installed, without spawning", async () => {
    const spy = vi.fn();
    const provider = createCodexWith(spy, fakeCheckInstalled(false))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-not-installed",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_disabled" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("provider.codex.run refuses with provider_disabled when no models are configured, without spawning", async () => {
    const spy = vi.fn();
    const provider = createCodexWith(spy, fakeCheckInstalled(true))(baseConfig([]));
    const result = await provider.run(
      {
        runId: "run-no-models",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_disabled" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("provider.codex.run returns provider_failed instead of rejecting on an unexpected runner error", async () => {
    const throwingRun = async () => {
      throw new Error("unexpected launch failure");
    };
    const provider = createCodexWith(throwingRun, fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-runner-throws",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_failed" });
  });

  test("fakeRunLines replays a raw 'exit: null' marker as a null exit code", async () => {
    const lines = ['{"type":"thread.started","thread_id":"thread-null-exit"}', "exit: null"];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-null-exit",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_missing" });
  });

  test("fakeRunLines replays a raw 'exit: cancelled' marker as a cancelled outcome", async () => {
    const lines = ['{"type":"thread.started","thread_id":"thread-cancelled"}', "exit: cancelled"];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-cancelled-exit",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  test("provider.codex.run still classifies a null exit code (spawn failure) as provider_missing", async () => {
    const missing = async () => ({ outcome: "exit" as const, code: null });
    const provider = createCodexWith(missing, fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-null-exit",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-5.1-codex",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_missing" });
  });

  test("provider.codex.d14 write-attempt: the marker is unchanged and codex reports the sandbox rejection", () => {
    const result = JSON.parse(
      readFileSync(fixturePath("fixtures/codex/write-attempt-result.json"), "utf8"),
    ) as { markerUnchanged: boolean };
    expect(result.markerUnchanged).toBe(true);
    const stream = readFileSync(fixturePath("fixtures/codex/write-attempt.jsonl"), "utf8");
    expect(stream.includes("writing is blocked by read-only sandbox")).toBe(true);
  });

  test("provider.codex.minimalEnv always keeps the cross-platform allow-list", () => {
    const env = minimalEnv({ WOWC_RUN: "run-env" });
    expect(env["WOWC_RUN"]).toBe("run-env");
  });

  test("provider.codex.minimalEnv is an allow-list, not the full process env", () => {
    vi.stubEnv("WOWC_PROBE_SECRET", "should-not-reach-codex");
    try {
      const env = minimalEnv({});
      expect(env["WOWC_PROBE_SECRET"]).toBeUndefined();
      expect(env["PATH"]).toBe(process.env["PATH"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test.runIf(process.platform === "win32")(
    "provider.codex.minimalEnv adds win32 console variables when present",
    () => {
      const env = minimalEnv({});
      for (const key of ["SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "WINDIR"]) {
        if (process.env[key] !== undefined) {
          expect(env[key]).toBe(process.env[key]);
        }
      }
    },
  );

  test("provider.codex.defaultCheckInstalled reports installed on a clean spawn.sync exit", () => {
    vi.mocked(spawn.sync).mockReturnValueOnce({
      status: 0,
      stdout: Buffer.from("codex-cli 0.1.0"),
      stderr: Buffer.from(""),
    } as ReturnType<typeof spawn.sync>);
    const result = defaultCheckInstalled(fixturePath());
    expect(result).toEqual({ installed: true });
  });

  test("provider.codex.defaultCheckInstalled reports not installed when spawn.sync errors", () => {
    vi.mocked(spawn.sync).mockReturnValueOnce({
      error: new Error("spawn codex ENOENT"),
      status: null,
    } as ReturnType<typeof spawn.sync>);
    const result = defaultCheckInstalled(fixturePath());
    expect(result.installed).toBe(false);
    expect(result.reason).toBe("spawn codex ENOENT");
  });

  test("provider.codex.session_unknown patterns require a resume in flight", async () => {
    const lines = ["stderr: Error: model not found: gpt-bogus", "exit: 1"];
    const provider = createCodexWith(fakeRunLines(lines), fakeCheckInstalled(true))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-fresh",
        prompt: "reply with the single word pong",
        system: "test",
        model: "gpt-bogus",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_failed" });
  });
});
