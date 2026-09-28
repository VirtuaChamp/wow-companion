import { randomBytes } from "node:crypto";
import type {
  Effort,
  Provider,
  ProviderError,
  ProviderEvent,
  ProviderId,
  Result,
  Waypoint,
} from "@wow-companion/contracts";

export type RunRequest = {
  askId: string;
  provider: ProviderId;
  model: string;
  effort?: Effort;
  prompt: string;
  system: string;
  sessionId?: string;
};

export type RunOutcome = {
  result: Result<{ sessionId: string; text: string }, ProviderError>;
  waypoint?: Waypoint;
};

export type Runner = {
  run(request: RunRequest, onEvent: (event: ProviderEvent) => void): Promise<RunOutcome>;
  cancel(askId: string): boolean;
  cancelAll(): void;
  attachWaypoint(runId: string, waypoint: Waypoint): Result<void, "no_active_ask">;
};

export type RunnerDeps = {
  providers: ReadonlyMap<ProviderId, Provider>;
  timeoutMs: number;
  timeoutGraceMs?: number;
  mintRunId?: () => string;
};

type ActiveRun = {
  askId: string;
  controller: AbortController;
  timedOut: boolean;
  waypoint?: Waypoint;
};

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_TIMEOUT_GRACE_MS = 5000;

function defaultMintRunId(): string {
  return `run-${randomBytes(9).toString("hex")}`;
}

export function createRunner(deps: RunnerDeps): Runner {
  const graceMs = deps.timeoutGraceMs ?? DEFAULT_TIMEOUT_GRACE_MS;
  const mintRunId = deps.mintRunId ?? defaultMintRunId;
  const activeByRun = new Map<string, ActiveRun>();
  const runByAsk = new Map<string, string>();

  async function run(
    request: RunRequest,
    onEvent: (event: ProviderEvent) => void,
  ): Promise<RunOutcome> {
    const provider = deps.providers.get(request.provider);
    if (provider === undefined) return { result: { ok: false, error: "provider_missing" } };
    const runId = mintRunId();
    if (!RUN_ID_PATTERN.test(runId)) return { result: { ok: false, error: "provider_failed" } };
    const active: ActiveRun = {
      askId: request.askId,
      controller: new AbortController(),
      timedOut: false,
    };
    activeByRun.set(runId, active);
    runByAsk.set(request.askId, runId);
    const timer = setTimeout(() => {
      active.timedOut = true;
      active.controller.abort();
    }, deps.timeoutMs + graceMs);
    try {
      const result = await provider.run(
        {
          runId,
          prompt: request.prompt,
          system: request.system,
          model: request.model,
          signal: active.controller.signal,
          ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
          ...(request.effort === undefined ? {} : { effort: request.effort }),
        },
        onEvent,
      );
      const settled: RunOutcome["result"] =
        !result.ok && result.error === "cancelled" && active.timedOut
          ? { ok: false, error: "timeout" }
          : result;
      return active.waypoint === undefined
        ? { result: settled }
        : { result: settled, waypoint: active.waypoint };
    } catch {
      return { result: { ok: false, error: "provider_failed" } };
    } finally {
      clearTimeout(timer);
      activeByRun.delete(runId);
      if (runByAsk.get(request.askId) === runId) runByAsk.delete(request.askId);
    }
  }

  return {
    run,
    cancel(askId) {
      const runId = runByAsk.get(askId);
      const active = runId === undefined ? undefined : activeByRun.get(runId);
      if (active === undefined) return false;
      active.controller.abort();
      return true;
    },
    cancelAll() {
      for (const active of activeByRun.values()) active.controller.abort();
    },
    attachWaypoint(runId, waypoint) {
      const active = activeByRun.get(runId);
      if (active === undefined) return { ok: false, error: "no_active_ask" };
      active.waypoint = waypoint;
      return { ok: true, value: undefined };
    },
  };
}
