import { describe, expect, test, vi } from "vitest";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderConfig, ProviderEvent } from "@wow-companion/contracts";
import { createClaudeWith } from "../../src/adapters/providers/claude.ts";
import {
  fakeQuery,
  fakeQueryHangs,
  fakeQueryThrows,
  fixturePath,
  loadJsonFixture,
} from "./helpers.ts";

function baseConfig(models: string[] = []): ProviderConfig {
  return {
    cwd: fixturePath(),
    timeoutMs: 5000,
    models,
    mcp: (runId: string) => ({ command: "node", args: ["stub.js"], env: { WOWC_RUN: runId } }),
  };
}

describe("provider.claude", () => {
  test("provider.claude.run passes the D14 read-only policy to query()", async () => {
    let seenOptions: Options | undefined;
    const messages = loadJsonFixture<SDKMessage[]>(fixturePath("fixtures/claude/stream.json"));
    const provider = createClaudeWith(
      fakeQuery(messages, { onCall: (options) => (seenOptions = options) }),
    )(baseConfig());
    await provider.run(
      {
        runId: "run-1",
        prompt: "reply with the single word pong",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(seenOptions?.tools).toEqual(["mcp__wowc__*", "WebSearch", "WebFetch"]);
    expect(seenOptions?.disallowedTools).toEqual(["Bash", "Edit", "Write", "NotebookEdit"]);
    expect(seenOptions?.settingSources).toEqual([]);
  });

  test("provider.claude.stream", async () => {
    const messages = loadJsonFixture<SDKMessage[]>(fixturePath("fixtures/claude/stream.json"));
    const provider = createClaudeWith(fakeQuery(messages))(baseConfig());
    const events: ProviderEvent[] = [];
    const result = await provider.run(
      {
        runId: "run-1",
        prompt: "reply with the single word pong",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      (event) => events.push(event),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe("pong");
      expect(result.value.sessionId).toBe("d9313260-f378-4858-b01d-486312c42be1");
    }
    expect(events.some((e) => e.kind === "session")).toBe(true);
    expect(events.some((e) => e.kind === "tool" && e.name === "mcp__wowc__wowc_ping")).toBe(true);
    expect(events.some((e) => e.kind === "text" && e.delta === "pong")).toBe(true);
  });

  test("provider.claude.run maps effort to the SDK, dropping the unsupported 'minimal' level", async () => {
    let seenEffort: string | undefined;
    const provider = createClaudeWith(
      fakeQuery([], { onCall: (options) => (seenEffort = options?.effort) }),
    )(baseConfig());
    await provider.run(
      {
        runId: "run-effort",
        prompt: "reply with the single word pong",
        system: "test",
        model: "claude-sonnet-5",
        effort: "high",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(seenEffort).toBe("high");

    let seenMinimalEffort: string | undefined = "unset";
    const providerMinimal = createClaudeWith(
      fakeQuery([], { onCall: (options) => (seenMinimalEffort = options?.effort) }),
    )(baseConfig());
    await providerMinimal.run(
      {
        runId: "run-effort-minimal",
        prompt: "reply with the single word pong",
        system: "test",
        model: "claude-sonnet-5",
        effort: "minimal",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(seenMinimalEffort).toBeUndefined();
  });

  test("provider.claude.describe", async () => {
    const provider = createClaudeWith(
      fakeQuery([], { supportedModels: ["claude-sonnet-5", "claude-opus-5-5"] }),
    )(baseConfig());
    const info = await provider.describe();
    expect(info.installed).toBe(true);
    expect(info.enabled).toBe(true);
    expect(info.models).toEqual(["claude-sonnet-5", "claude-opus-5-5"]);
    expect(info.efforts).toContain("medium");
    expect(info.efforts).not.toContain("minimal");
  });

  test("provider.claude.describe falls back to config.models", async () => {
    const provider = createClaudeWith(fakeQuery([], { supportedModels: [] }))(
      baseConfig(["configured-model"]),
    );
    const info = await provider.describe();
    expect(info.models).toEqual(["configured-model"]);
  });

  test("provider.claude.describe missing binary", async () => {
    const provider = createClaudeWith(fakeQueryThrows("spawn claude ENOENT"))(baseConfig());
    const info = await provider.describe();
    expect(info.installed).toBe(false);
  });

  test("provider.claude.describe reports an auth-shaped error as installed, not enabled", async () => {
    const provider = createClaudeWith(fakeQueryThrows("not logged in, please run /login"))(
      baseConfig(),
    );
    const info = await provider.describe();
    expect(info.installed).toBe(true);
    expect(info.enabled).toBe(false);
  });

  test("provider.claude.run missing binary", async () => {
    const provider = createClaudeWith(fakeQueryThrows("spawn claude ENOENT"))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-missing",
        prompt: "reply with the single word pong",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_missing" });
  });

  test("provider.claude.run auth error text", async () => {
    const provider = createClaudeWith(fakeQueryThrows("not logged in, please run /login"))(
      baseConfig(),
    );
    const result = await provider.run(
      {
        runId: "run-auth",
        prompt: "reply with the single word pong",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "provider_auth" });
  });

  test("provider.claude.run times out without an external abort", async () => {
    const config = baseConfig();
    config.timeoutMs = 1;
    const provider = createClaudeWith(fakeQueryHangs())(config);
    const result = await provider.run(
      {
        runId: "run-timeout",
        prompt: "reply with the single word pong",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  test("provider.claude.cancel", async () => {
    const messages = loadJsonFixture<SDKMessage[]>(fixturePath("fixtures/claude/stream.json"));
    const provider = createClaudeWith(fakeQuery(messages))(baseConfig());
    const controller = new AbortController();
    const runPromise = provider.run(
      {
        runId: "run-2",
        prompt: "reply with the single word pong",
        system: "test",
        model: "claude-sonnet-5",
        signal: controller.signal,
      },
      () => {},
    );
    controller.abort();
    const result = await runPromise;
    expect(result).toEqual({ ok: false, error: "cancelled" });
  });

  test("provider.claude.session_unknown", async () => {
    const messages = loadJsonFixture<SDKMessage[]>(
      fixturePath("fixtures/claude/session_unknown.json"),
    );
    const provider = createClaudeWith(fakeQuery(messages))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-3",
        prompt: "continue",
        system: "test",
        sessionId: "resume-target",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result).toEqual({ ok: false, error: "session_unknown" });
  });

  test("provider.claude.run returns provider_failed when config.mcp throws, without arming a timer", async () => {
    vi.useFakeTimers();
    try {
      const messages = loadJsonFixture<SDKMessage[]>(fixturePath("fixtures/claude/stream.json"));
      const config = baseConfig();
      config.mcp = () => {
        throw new Error("mcp launch failed");
      };
      const provider = createClaudeWith(fakeQuery(messages))(config);
      const result = await provider.run(
        {
          runId: "run-mcp-throws",
          prompt: "reply with the single word pong",
          system: "test",
          model: "claude-sonnet-5",
          signal: new AbortController().signal,
        },
        () => {},
      );
      expect(result).toEqual({ ok: false, error: "provider_failed" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("provider.claude.session_unknown patterns require a resume in flight", async () => {
    const messages = loadJsonFixture<SDKMessage[]>(
      fixturePath("fixtures/claude/session_unknown.json"),
    );
    const provider = createClaudeWith(fakeQuery(messages))(baseConfig());
    const result = await provider.run(
      {
        runId: "run-fresh",
        prompt: "continue",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe("session_unknown");
  });
});
