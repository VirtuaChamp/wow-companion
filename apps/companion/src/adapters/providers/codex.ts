import { mkdirSync } from "node:fs";
import type {
  CreateProvider,
  Effort,
  McpLaunch,
  Provider,
  ProviderError,
  Result,
} from "@wow-companion/contracts";
import { type RunOutcome, type SpawnLine } from "./spawn.ts";
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

const ENV_ALLOW_LIST = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CODEX_HOME"];
const WIN32_ENV_ALLOW_LIST = ["SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "WINDIR"];

export function minimalEnv(launchEnv: Record<string, string>): Record<string, string> {
  const allowList =
    process.platform === "win32" ? [...ENV_ALLOW_LIST, ...WIN32_ENV_ALLOW_LIST] : ENV_ALLOW_LIST;
  const base: Record<string, string> = {};
  for (const key of allowList) {
    const value = process.env[key];
    if (value !== undefined) base[key] = value;
  }
  return { ...base, ...launchEnv };
}

function classifyFailure(text: string, resumed: boolean): ProviderError {
  const lower = text.toLowerCase();
  if (/enoent|command not found|not installed|no such file/.test(lower)) return "provider_missing";
  if (
    resumed &&
    /no rollout found|thread\/resume failed|no session found|unknown session|no thread/.test(lower)
  )
    return "session_unknown";
  if (/not logged in|unauthorized|invalid api key|authentication/.test(lower))
    return "provider_auth";
  return "provider_failed";
}

export function codexArgs(input: {
  prompt: string;
  sessionId?: string;
  model: string;
  effort?: Effort;
  mcpCommand: string;
  mcpArgs: string[];
  mcpEnv: Record<string, string>;
  noMcp?: boolean;
}): string[] {
  const mcpOverrides =
    input.noMcp === true
      ? []
      : [
          "-c",
          `mcp_servers.wowc.command=${JSON.stringify(input.mcpCommand)}`,
          "-c",
          `mcp_servers.wowc.args=${JSON.stringify(input.mcpArgs)}`,
          "-c",
          `mcp_servers.wowc.default_tools_approval_mode=${JSON.stringify("approve")}`,
          ...Object.entries(input.mcpEnv).flatMap(([key, value]) => [
            "-c",
            `mcp_servers.wowc.env.${key}=${JSON.stringify(value)}`,
          ]),
        ];
  const isolation = [
    "--ignore-user-config",
    "--skip-git-repo-check",
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  ];
  const effortOverride = input.effort
    ? ["-c", `model_reasoning_effort=${JSON.stringify(input.effort)}`]
    : [];
  const noWeb = ["-c", `web_search=${JSON.stringify("disabled")}`];
  const execOptions = [
    "-s",
    "read-only",
    ...isolation,
    ...noWeb,
    "--model",
    input.model,
    ...effortOverride,
    ...mcpOverrides,
  ];
  const prompt = input.prompt;
  if (input.sessionId) {
    return ["exec", ...execOptions, "resume", "--json", input.sessionId, prompt];
  }
  return ["exec", "--json", ...execOptions, prompt];
}

export function createCodexWith(run: RunFn, checkInstalled: CheckInstalledFn): CreateProvider {
  return (config) => {
    const provider: Provider = {
      id: "codex",
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
        if (config.models.length === 0) {
          return {
            installed: true,
            enabled: false,
            reason:
              "no live codex model listing verified yet; config.json providers.codex.models is empty",
            models: [],
            efforts: [],
          };
        }
        return {
          installed: true,
          enabled: true,
          models: [...config.models],
          efforts: ["minimal", "low", "medium", "high"],
        };
      },
      async run(input, onEvent) {
        if (input.signal.aborted) {
          return { ok: false, error: "cancelled" };
        }
        const check = checkInstalled(config.cwd);
        if (!check.installed || config.models.length === 0) {
          return { ok: false, error: "provider_disabled" };
        }
        let workDir: string;
        const noTools = input.tools === "none";
        let launch: McpLaunch;
        try {
          workDir = safeRunDir(config.cwd, "codex-runs", input.runId);
          launch = noTools ? { command: "", args: [], env: {} } : config.mcp(input.runId);
        } catch {
          return { ok: false, error: "provider_failed" };
        }
        const combined = new AbortController();
        const onAbort = () => combined.abort();
        input.signal.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => combined.abort(), config.timeoutMs);
        let sessionId = input.sessionId ?? "";
        let text = "";
        let failure: ProviderError | undefined;
        let pendingErrorText: string | undefined;
        let stderrText = "";
        let sawTurnCompleted = false;
        try {
          mkdirSync(workDir, { recursive: true });
          const prompt = input.system ? `${input.system}\n\n${input.prompt}` : input.prompt;
          const args = codexArgs({
            prompt,
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            model: input.model,
            ...(input.effort !== undefined ? { effort: input.effort } : {}),
            mcpCommand: launch.command,
            mcpArgs: launch.args,
            mcpEnv: launch.env,
            ...(noTools ? { noMcp: true } : {}),
          });
          const resumed = input.sessionId !== undefined;
          const outcome = await run("codex", args, {
            cwd: workDir,
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
              if (record["type"] === "thread.started" && typeof record["thread_id"] === "string") {
                sessionId = record["thread_id"];
                onEvent({ kind: "session", id: sessionId });
              }
              if (
                record["type"] === "item.completed" &&
                typeof record["item"] === "object" &&
                record["item"]
              ) {
                const item = record["item"] as Record<string, unknown>;
                if (item["type"] === "agent_message" && typeof item["text"] === "string") {
                  text += item["text"];
                  onEvent({ kind: "text", delta: item["text"] });
                } else if (item["type"] === "mcp_tool_call" && typeof item["tool"] === "string") {
                  const toolError =
                    item["status"] === "failed" &&
                    typeof item["error"] === "object" &&
                    item["error"] !== null &&
                    typeof (item["error"] as Record<string, unknown>)["message"] === "string"
                      ? ((item["error"] as Record<string, unknown>)["message"] as string)
                      : undefined;
                  onEvent({
                    kind: "tool",
                    name: item["tool"],
                    ...(toolError !== undefined ? { failure: toolError } : {}),
                  });
                } else if (
                  item["type"] === "command_execution" &&
                  typeof item["command"] === "string"
                ) {
                  onEvent({ kind: "tool", name: "shell" });
                }
              }
              if (record["type"] === "turn.failed") {
                const message =
                  typeof record["message"] === "string" ? record["message"] : line.text;
                failure = classifyFailure(message, resumed);
              }
              if (record["type"] === "error") {
                const message =
                  typeof record["message"] === "string" ? record["message"] : line.text;
                pendingErrorText = message;
                onEvent({ kind: "tool", name: "error", failure: message });
              }
              if (record["type"] === "turn.completed") {
                pendingErrorText = undefined;
                sawTurnCompleted = true;
              }
            },
          });
          if (outcome.outcome === "kill_failed") {
            console.error(`codex: failed to kill the process tree: ${String(outcome.error)}`);
            return { ok: false, error: "provider_failed" };
          }
          if (outcome.outcome === "cancelled") {
            return { ok: false, error: input.signal.aborted ? "cancelled" : "timeout" };
          }
          if (failure) return { ok: false, error: failure };
          if (pendingErrorText !== undefined) {
            return { ok: false, error: classifyFailure(pendingErrorText, resumed) };
          }
          if (outcome.code !== 0) {
            if (outcome.code === null) {
              return {
                ok: false,
                error: stderrText ? classifyFailure(stderrText, resumed) : "provider_missing",
              };
            }
            return {
              ok: false,
              error: stderrText ? classifyFailure(stderrText, resumed) : "provider_failed",
            };
          }
          if (!sawTurnCompleted) {
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
          cleanupRunDir(workDir);
        }
      },
    };
    return provider;
  };
}
