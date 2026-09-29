import { describe, expect, test, vi } from "vitest";
import type { ModelInfo, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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
    expect(seenOptions?.tools).toEqual(["mcp__wowc__*", "WebSearch"]);
    expect(seenOptions?.disallowedTools).toEqual([
      "Bash",
      "Edit",
      "Write",
      "NotebookEdit",
      "WebFetch",
    ]);
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

  function countingQuery(supportedModels: () => Promise<ModelInfo[]>) {
    const state = { closes: 0 };
    const queryFn = () => ({
      [Symbol.asyncIterator]: (): AsyncIterator<SDKMessage> => ({
        next: () => Promise.resolve({ value: undefined, done: true }),
      }),
      supportedModels,
      close() {
        state.closes += 1;
      },
    });
    return { state, queryFn };
  }

  test("provider.claude.describe closes the query when the caller's signal fires while supportedModels hangs", async () => {
    const { state, queryFn } = countingQuery(() => new Promise<ModelInfo[]>(() => {}));
    const provider = createClaudeWith(queryFn)(baseConfig());
    const controller = new AbortController();

    const pending = provider.describe(controller.signal);
    controller.abort();
    const info = await pending;

    expect(info.enabled).toBe(false);
    expect(info.reason).toContain("cancelled");
    expect(state.closes).toBeGreaterThanOrEqual(1);
  });

  test("provider.claude.describe closes the query on success and on error", async () => {
    const ok = countingQuery(async () => [{ value: "m", displayName: "m", description: "m" }]);
    await createClaudeWith(ok.queryFn)(baseConfig()).describe();
    expect(ok.state.closes).toBe(1);

    const failing = countingQuery(() => Promise.reject(new Error("boom")));
    const info = await createClaudeWith(failing.queryFn)(baseConfig()).describe();
    expect(info.enabled).toBe(false);
    expect(failing.state.closes).toBe(1);
  });

  test("provider.claude.describe does not start work when the signal is already aborted", async () => {
    const { state, queryFn } = countingQuery(() => new Promise<ModelInfo[]>(() => {}));
    const controller = new AbortController();
    controller.abort();

    const info = await createClaudeWith(queryFn)(baseConfig()).describe(controller.signal);

    expect(info.enabled).toBe(false);
    expect(state.closes).toBeGreaterThanOrEqual(1);
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

  test("provider.claude.tools_none launches with no MCP server and no allowed tools, default unchanged", async () => {
    const seen: (Options | undefined)[] = [];
    const mcpCalls: string[] = [];
    const config: ProviderConfig = {
      ...baseConfig(),
      mcp: (runId: string) => {
        mcpCalls.push(runId);
        return { command: "node", args: ["stub.js"], env: { WOWC_RUN: runId } };
      },
    };
    const provider = createClaudeWith(fakeQuery([], { onCall: (options) => seen.push(options) }))(
      config,
    );
    const input = {
      runId: "run-t",
      prompt: "title please",
      system: "test",
      model: "claude-sonnet-5",
      signal: new AbortController().signal,
    };
    await provider.run({ ...input, tools: "none" }, () => {});
    await provider.run(input, () => {});
    expect(seen[0]?.mcpServers).toBeUndefined();
    expect(seen[0]?.tools).toEqual([]);
    expect(seen[0]?.allowedTools).toEqual([]);
    expect(seen[0]?.disallowedTools).toEqual(["Bash", "Edit", "Write", "NotebookEdit", "WebFetch"]);
    expect(seen[1]?.mcpServers).toBeDefined();
    expect(seen[1]?.tools).toEqual(["mcp__wowc__*", "WebSearch"]);
    expect(mcpCalls).toEqual(["run-t"]);
  });
  test("provider.claude.web WebFetch is absent and denied: no redirect can leave the three sites", async () => {
    let seenOptions: Options | undefined;
    const provider = createClaudeWith(
      fakeQuery([], { onCall: (options) => (seenOptions = options) }),
    )(baseConfig());
    await provider.run(
      {
        runId: "run-web",
        prompt: "p",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(seenOptions?.tools).not.toContain("WebFetch");
    expect(seenOptions?.allowedTools).not.toContain("WebFetch");
    expect(seenOptions?.disallowedTools).toContain("WebFetch");
    const decide = seenOptions?.canUseTool;
    if (decide === undefined) throw new Error("expected a permission callback");
    const context = {
      signal: new AbortController().signal,
      toolUseID: "tool-1",
      requestId: "request-1",
    };
    for (const url of [
      "https://www.wowhead.com/npc=1234/hogger",
      "https://warcraft.wiki.gg/wiki/Hogger",
      "https://www.icy-veins.com/wow/guide",
      "https://example.com/",
    ]) {
      expect(await decide("WebFetch", { url, prompt: "x" }, context), url).toMatchObject({
        behavior: "deny",
      });
    }
    expect(await decide("Bash", { command: "ls" }, context)).toMatchObject({ behavior: "deny" });
    expect(await decide("mcp__claude_ai_Gmail__search_threads", {}, context)).toMatchObject({
      behavior: "deny",
    });
  });

  test("provider.claude.mcp every Claude run loads only the wowc MCP server, never account connectors", async () => {
    const seen: (Options | undefined)[] = [];
    const provider = createClaudeWith(fakeQuery([], { onCall: (options) => seen.push(options) }))(
      baseConfig(),
    );
    const input = {
      runId: "run-mcp",
      prompt: "p",
      system: "test",
      model: "claude-sonnet-5",
      signal: new AbortController().signal,
    };
    await provider.run(input, () => {});
    await provider.run({ ...input, tools: "none" }, () => {});
    await provider.describe();
    expect(seen).toHaveLength(3);
    for (const options of seen) {
      expect(options?.strictMcpConfig).toBe(true);
      expect(options?.env?.["ENABLE_CLAUDEAI_MCP_SERVERS"]).toBe("false");
      expect(options?.settingSources).toEqual([]);
    }
    expect(Object.keys(seen[0]?.mcpServers ?? {})).toEqual(["wowc"]);
    expect(seen[1]?.mcpServers).toBeUndefined();
    expect(seen[2]?.mcpServers).toBeUndefined();
  });

  test("provider.claude.web pins every WebSearch to the three sites and drops blocked_domains", async () => {
    let seenOptions: Options | undefined;
    const provider = createClaudeWith(
      fakeQuery([], { onCall: (options) => (seenOptions = options) }),
    )(baseConfig());
    await provider.run(
      {
        runId: "run-search",
        prompt: "p",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      () => {},
    );
    const decide = seenOptions?.canUseTool;
    if (decide === undefined) throw new Error("expected a permission callback");
    const decision = await decide(
      "WebSearch",
      { query: "hogger", allowed_domains: ["example.com"], blocked_domains: ["x.example"] },
      { signal: new AbortController().signal, toolUseID: "tool-2", requestId: "request-2" },
    );
    expect(decision).toEqual({
      behavior: "allow",
      updatedInput: {
        query: "hogger",
        allowed_domains: ["wowhead.com", "warcraft.wiki.gg", "icy-veins.com"],
      },
    });
    expect(seenOptions?.allowedTools).toEqual(["mcp__wowc__*"]);
    expect(seenOptions?.permissionPrompts).toBe("host");
  });

  test("provider.claude.web the title run (tools none) has no tools and no permission callback", async () => {
    let seenOptions: Options | undefined;
    const provider = createClaudeWith(
      fakeQuery([], { onCall: (options) => (seenOptions = options) }),
    )(baseConfig());
    await provider.run(
      {
        runId: "run-title",
        prompt: "p",
        system: "test",
        model: "claude-sonnet-5",
        tools: "none",
        signal: new AbortController().signal,
      },
      () => {},
    );
    expect(seenOptions?.tools).toEqual([]);
    expect(seenOptions?.allowedTools).toEqual([]);
    expect(seenOptions?.canUseTool).toBeUndefined();
    expect(seenOptions?.permissionPrompts).toBe("none");
  });

  test("provider.claude.web a refused fetch is emitted as a tool event that carries the failure", async () => {
    const messages = loadJsonFixture<SDKMessage[]>(fixturePath("fixtures/claude/stream.json"));
    const context = {
      signal: new AbortController().signal,
      toolUseID: "tool-9",
      requestId: "request-9",
    };
    const queryFn = (params: { prompt: string; options?: Options }) => {
      const decide = params.options?.canUseTool;
      async function* generate(): AsyncGenerator<SDKMessage> {
        if (decide === undefined) throw new Error("expected a permission callback");
        await decide("WebFetch", { url: "https://www.reddit.com/r/wow", prompt: "x" }, context);
        for (const message of messages) yield message;
      }
      const iterator = generate();
      return {
        [Symbol.asyncIterator]: () => iterator,
        async supportedModels(): Promise<ModelInfo[]> {
          return [];
        },
        close() {},
      };
    };
    const events: ProviderEvent[] = [];
    const provider = createClaudeWith(queryFn)(baseConfig());
    await provider.run(
      {
        runId: "run-deny",
        prompt: "p",
        system: "test",
        model: "claude-sonnet-5",
        signal: new AbortController().signal,
      },
      (event) => events.push(event),
    );
    const webEvents = events.filter((event) => event.kind === "tool" && event.name === "WebFetch");
    expect(webEvents).toHaveLength(1);
    expect(webEvents[0]).toMatchObject({ kind: "tool", name: "WebFetch" });
    expect(webEvents[0] && "failure" in webEvents[0] ? webEvents[0].failure : undefined).toContain(
      "use WebSearch",
    );
  });
});
