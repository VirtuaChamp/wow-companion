import spawn from "cross-spawn";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CreateProvider,
  McpLaunch,
  Provider,
  ProviderError,
  Result,
} from "@wow-companion/contracts";
import { minimalEnv } from "./codex.ts";
import { runProcess, type RunOutcome, type SpawnLine } from "./spawn.ts";
import { cleanupRunDir, safeRunDir } from "./run-dir.ts";

type RunFn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    signal: AbortSignal;
    onLine: (line: SpawnLine) => void;
  },
) => Promise<RunOutcome>;

type CheckInstalledFn = (cwd: string) => { installed: boolean; reason?: string };
type ListModelsFn = (cwd: string) => string[];

const DISABLED_REASON =
  "cursor headless MCP does not work on this machine: confirmed by three real recorder runs (2026-09-27) with --workspace <run dir>, --mode ask, --sandbox enabled and --trust set, and the wowc MCP server still not visible to the model. See docs/client-facts.md.";

function classifyFailure(text: string, resumed: boolean): ProviderError {
  const lower = text.toLowerCase();
  if (/enoent|command not found|not installed|no such file/.test(lower)) return "provider_missing";
  if (resumed && /no chat found|unknown chat|session not found/.test(lower))
    return "session_unknown";
  if (/not logged in|unauthorized|authentication|please sign in/.test(lower))
    return "provider_auth";
  return "provider_failed";
}

export function runDirFor(cwd: string, runId: string): string {
  return safeRunDir(cwd, "runs", runId);
}

export function cursorArgs(input: { prompt: string; model: string; workspace: string }): string[] {
  return [
    "-p",
    input.prompt,
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--mode",
    "ask",
    "--sandbox",
    "enabled",
    "--trust",
    "--workspace",
    input.workspace,
    "--model",
    input.model,
  ];
}

export function writeMcpConfig(
  runDir: string,
  launch: { command: string; args: string[]; env: Record<string, string> },
): void {
  mkdirSync(join(runDir, ".cursor"), { recursive: true });
  const config = {
    mcpServers: {
      wowc: { command: launch.command, args: launch.args, env: launch.env },
    },
  };
  writeFileSync(join(runDir, ".cursor", "mcp.json"), JSON.stringify(config, null, 2));
}

export function parseListModelsOutput(stdout: string): string[] {
  const idLine = /^(\S+) - /;
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .map((line) => idLine.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1] as string);
}

export function defaultCheckInstalled(cwd: string): { installed: boolean; reason?: string } {
  const check = spawn.sync("cursor-agent", ["--version"], { cwd });
  if (check.error || check.status !== 0) {
    return {
      installed: false,
      reason: check.error ? check.error.message : "cursor-agent --version failed",
    };
  }
  return { installed: true };
}

export function defaultListModels(cwd: string): string[] {
  const check = spawn.sync("cursor-agent", ["--list-models"], { cwd });
  if (check.error || check.status !== 0 || !check.stdout) return [];
  return parseListModelsOutput(check.stdout.toString("utf8"));
}

export function createCursorWith(
  run: RunFn,
  checkInstalled: CheckInstalledFn,
  listModels: ListModelsFn,
  enabled: boolean,
): CreateProvider {
  return (config) => {
    const provider: Provider = {
      id: "cursor",
      async describe() {
        const check = checkInstalled(config.cwd);
        if (!check.installed) {
          return {
            installed: false,
            enabled: false,
            ...(check.reason !== undefined ? { reason: check.reason } : {}),
            models: [...config.models],
            efforts: [],
          };
        }
        const live = listModels(config.cwd);
        const finalModels = live.length > 0 ? live : [...config.models];
        if (!enabled) {
          return {
            installed: true,
            enabled: false,
            reason: DISABLED_REASON,
            models: finalModels,
            efforts: [],
          };
        }
        return {
          installed: true,
          enabled: true,
          models: finalModels,
          efforts: [],
        };
      },
      async run(input, onEvent) {
        if (!enabled) {
          return { ok: false, error: "provider_disabled" };
        }
        const check = checkInstalled(config.cwd);
        if (!check.installed) {
          return { ok: false, error: "provider_disabled" };
        }
        if (input.sessionId !== undefined) {
          return { ok: false, error: "session_unknown" };
        }
        if (input.signal.aborted) {
          return { ok: false, error: "cancelled" };
        }
        let runDir: string;
        let launch: McpLaunch;
        try {
          runDir = runDirFor(config.cwd, input.runId);
          launch = config.mcp(input.runId);
        } catch {
          return { ok: false, error: "provider_failed" };
        }
        const combined = new AbortController();
        const onAbort = () => combined.abort();
        input.signal.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => combined.abort(), config.timeoutMs);
        let sessionId = "";
        let text = "";
        let sawResult = false;
        let failure: ProviderError | undefined;
        let stderrText = "";
        try {
          writeMcpConfig(runDir, launch);
          const prompt = input.system ? `${input.system}\n\n${input.prompt}` : input.prompt;
          const args = cursorArgs({ prompt, model: input.model, workspace: runDir });
          const outcome = await run("cursor-agent", args, {
            cwd: runDir,
            env: minimalEnv(launch.env),
            signal: combined.signal,
            onLine: (line) => {
              if (line.stream === "stderr") {
                stderrText += `${line.text}\n`;
                return;
              }
              let event: unknown;
              try {
                event = JSON.parse(line.text);
              } catch {
                return;
              }
              if (typeof event !== "object" || event === null || !("type" in event)) return;
              const record = event as Record<string, unknown>;
              if (typeof record["session_id"] === "string" && !sessionId) {
                sessionId = record["session_id"];
                onEvent({ kind: "session", id: sessionId });
              }
              if (
                record["type"] === "assistant" &&
                typeof record["timestamp_ms"] === "number" &&
                typeof record["message"] === "object" &&
                record["message"]
              ) {
                const content = (record["message"] as Record<string, unknown>)["content"];
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (
                      typeof block === "object" &&
                      block &&
                      (block as Record<string, unknown>)["type"] === "text"
                    ) {
                      const delta = (block as Record<string, unknown>)["text"];
                      if (typeof delta === "string") {
                        text += delta;
                        onEvent({ kind: "text", delta });
                      }
                    }
                  }
                }
              }
              if (
                record["type"] === "tool_call" &&
                record["subtype"] === "started" &&
                typeof record["tool_call"] === "object" &&
                record["tool_call"] !== null
              ) {
                const toolName = Object.keys(record["tool_call"] as Record<string, unknown>)[0];
                if (toolName !== undefined) {
                  onEvent({ kind: "tool", name: toolName });
                }
              }
              if (record["type"] === "result") {
                sawResult = true;
                if (typeof record["result"] === "string") text = record["result"];
                if (record["is_error"] === true) {
                  failure = classifyFailure(
                    typeof record["result"] === "string" ? record["result"] : line.text,
                    false,
                  );
                }
              }
            },
          });
          if (outcome.outcome === "kill_failed") {
            console.error(`cursor: failed to kill the process tree: ${String(outcome.error)}`);
            return { ok: false, error: "provider_failed" };
          }
          if (outcome.outcome === "cancelled") {
            return { ok: false, error: input.signal.aborted ? "cancelled" : "timeout" };
          }
          if (failure) return { ok: false, error: failure };
          if (outcome.code !== 0 && !sawResult) {
            if (outcome.code === null) {
              return {
                ok: false,
                error: stderrText ? classifyFailure(stderrText, false) : "provider_missing",
              };
            }
            return {
              ok: false,
              error: stderrText ? classifyFailure(stderrText, false) : "provider_failed",
            };
          }
          if (!sawResult) {
            return { ok: false, error: "provider_failed" };
          }
          const result: Result<{ sessionId: string; text: string }, ProviderError> = {
            ok: true,
            value: { sessionId, text },
          };
          return result;
        } catch {
          return { ok: false, error: "provider_failed" };
        } finally {
          clearTimeout(timer);
          input.signal.removeEventListener("abort", onAbort);
          cleanupRunDir(runDir);
        }
      },
    };
    return provider;
  };
}

export const createCursor: CreateProvider = createCursorWith(
  runProcess,
  defaultCheckInstalled,
  defaultListModels,
  false,
);
