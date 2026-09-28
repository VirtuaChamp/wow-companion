import { query } from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel, ModelInfo, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  CreateProvider,
  McpLaunch,
  Provider,
  ProviderError,
  Result,
} from "@wow-companion/contracts";

const READ_ONLY_TOOLS = ["mcp__wowc__*", "WebSearch", "WebFetch"];
const DISALLOWED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit"];
export const READ_ONLY_QUERY_OPTIONS: Options = {
  settingSources: [],
  tools: READ_ONLY_TOOLS,
  disallowedTools: DISALLOWED_TOOLS,
  allowedTools: READ_ONLY_TOOLS,
  permissionPrompts: "none",
};
const DESCRIBE_OPTIONS: Options = READ_ONLY_QUERY_OPTIONS;

type MinimalQuery = AsyncIterable<SDKMessage> & {
  supportedModels(): Promise<ModelInfo[]>;
  close(): void;
};
type QueryFn = (params: { prompt: string; options?: Options }) => MinimalQuery;

function classifyFailure(text: string, resumed: boolean): ProviderError {
  const lower = text.toLowerCase();
  if (/enoent|command not found|not installed|no such file/.test(lower)) return "provider_missing";
  if (
    resumed &&
    /no conversation found|no such session|session not found|invalid session/.test(lower)
  ) {
    return "session_unknown";
  }
  if (/not logged in|please run \/login|invalid api key|authentication/.test(lower)) {
    return "provider_auth";
  }
  return "provider_failed";
}

function toEffortLevel(effort: string | undefined): EffortLevel | undefined {
  if (effort === undefined || effort === "minimal") return undefined;
  return effort as EffortLevel;
}

export function createClaudeWith(queryFn: QueryFn): CreateProvider {
  return (config) => {
    const provider: Provider = {
      id: "claude",
      async describe() {
        let q: MinimalQuery | undefined;
        try {
          q = queryFn({
            prompt: "",
            options: { ...DESCRIBE_OPTIONS, cwd: config.cwd },
          });
          const models = await q.supportedModels();
          const listed = models.map((m) => m.value);
          const finalModels = listed.length > 0 ? listed : [...config.models];
          if (finalModels.length === 0) {
            return {
              installed: true,
              enabled: false,
              reason: "no models available from claude or config.json",
              models: [],
              efforts: [],
            };
          }
          return {
            installed: true,
            enabled: true,
            models: finalModels,
            efforts: ["low", "medium", "high", "xhigh", "max"],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failure = classifyFailure(message, false);
          return {
            installed: failure !== "provider_missing",
            enabled: false,
            reason: message,
            models: [...config.models],
            efforts: [],
          };
        } finally {
          q?.close();
        }
      },
      async run(input, onEvent) {
        if (input.signal.aborted) {
          return { ok: false, error: "cancelled" };
        }
        let launch: McpLaunch;
        try {
          launch = config.mcp(input.runId);
        } catch {
          return { ok: false, error: "provider_failed" };
        }
        const abortController = new AbortController();
        const onAbort = () => abortController.abort();
        input.signal.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => abortController.abort(), config.timeoutMs);
        const resumed = input.sessionId !== undefined;
        const effort = toEffortLevel(input.effort);
        let sessionId = input.sessionId ?? "";
        let text = "";
        let sessionEmitted = false;
        const finish = (result: Result<{ sessionId: string; text: string }, ProviderError>) => {
          clearTimeout(timer);
          input.signal.removeEventListener("abort", onAbort);
          return result;
        };
        try {
          const q = queryFn({
            prompt: input.prompt,
            options: {
              cwd: config.cwd,
              systemPrompt: input.system,
              ...(input.sessionId !== undefined ? { resume: input.sessionId } : {}),
              model: input.model,
              ...(effort !== undefined ? { effort } : {}),
              ...DESCRIBE_OPTIONS,
              abortController,
              mcpServers: {
                wowc: {
                  type: "stdio",
                  command: launch.command,
                  args: launch.args,
                  env: launch.env,
                },
              },
            },
          });
          for await (const message of q) {
            const messageSessionId = "session_id" in message ? message.session_id : undefined;
            if (!sessionEmitted && messageSessionId) {
              sessionId = messageSessionId;
              onEvent({ kind: "session", id: sessionId });
              sessionEmitted = true;
            }
            if (message.type === "assistant") {
              for (const block of message.message.content) {
                if (block.type === "text") {
                  text += block.text;
                  onEvent({ kind: "text", delta: block.text });
                } else if (block.type === "tool_use") {
                  onEvent({ kind: "tool", name: block.name });
                }
              }
            }
            if (message.type === "result") {
              if (abortController.signal.aborted) {
                return finish({ ok: false, error: input.signal.aborted ? "cancelled" : "timeout" });
              }
              if (message.subtype === "success" && !message.is_error) {
                return finish({ ok: true, value: { sessionId, text: message.result } });
              }
              const detail =
                message.subtype === "success" ? message.result : message.errors.join(" ");
              return finish({ ok: false, error: classifyFailure(detail, resumed) });
            }
          }
          if (abortController.signal.aborted) {
            return finish({ ok: false, error: input.signal.aborted ? "cancelled" : "timeout" });
          }
          return finish({ ok: false, error: "provider_failed" });
        } catch (error) {
          if (abortController.signal.aborted) {
            return finish({ ok: false, error: input.signal.aborted ? "cancelled" : "timeout" });
          }
          const message = error instanceof Error ? error.message : String(error);
          return finish({ ok: false, error: classifyFailure(message, resumed) });
        }
      },
    };
    return provider;
  };
}

export const createClaude: CreateProvider = createClaudeWith(query);
