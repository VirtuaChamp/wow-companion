import spawn from "cross-spawn";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";

export type SpawnLine = { stream: "stdout" | "stderr"; text: string };
export type RunOutcome =
  | { outcome: "exit"; code: number | null }
  | { outcome: "cancelled" }
  | { outcome: "kill_failed"; error: unknown };

export type KillFn = (child: ChildProcess) => { ok: boolean; error?: unknown };
export type KillResult = ReturnType<KillFn>;

function bestEffortSingleKill(child: ChildProcess): void {
  try {
    child.kill("SIGKILL");
  } catch {
    void 0;
  }
}

export function defaultKillTree(child: ChildProcess): KillResult {
  if (child.pid === undefined) return { ok: true };
  const pid = child.pid;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    if (!result.error && result.status === 0) return { ok: true };
    bestEffortSingleKill(child);
    return {
      ok: false,
      error: result.error ?? new Error(`taskkill exited with status ${String(result.status)}`),
    };
  }
  try {
    process.kill(-pid, "SIGKILL");
    return { ok: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return { ok: true };
    bestEffortSingleKill(child);
    return { ok: false, error };
  }
}

export function runProcessWith(kill: KillFn) {
  return function runProcess(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      signal: AbortSignal;
      onLine: (line: SpawnLine) => void;
    },
  ): Promise<RunOutcome> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      let settled = false;
      let cancelling = false;
      const finish = (result: RunOutcome) => {
        if (settled) return;
        settled = true;
        options.signal.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => {
        if (cancelling || settled) return;
        cancelling = true;
        const killResult = kill(child);
        if (!killResult.ok) {
          finish({ outcome: "kill_failed", error: killResult.error });
        }
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      if (child.stdout) {
        createInterface({ input: child.stdout }).on("line", (text) =>
          options.onLine({ stream: "stdout", text }),
        );
      }
      if (child.stderr) {
        createInterface({ input: child.stderr }).on("line", (text) =>
          options.onLine({ stream: "stderr", text }),
        );
      }
      child.on("error", () => {
        finish(cancelling ? { outcome: "cancelled" } : { outcome: "exit", code: null });
      });
      child.on("close", (code) => {
        finish(cancelling ? { outcome: "cancelled" } : { outcome: "exit", code });
      });
      if (options.signal.aborted) onAbort();
    });
  };
}

export const runProcess = runProcessWith(defaultKillTree);
