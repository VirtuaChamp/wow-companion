import * as nodeChildProcess from "node:child_process";
import { describe, expect, test, vi } from "vitest";
import { defaultKillTree, runProcess, runProcessWith } from "../../src/adapters/providers/spawn.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeChildProcess>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("spawn.runProcess", () => {
  test("spawn.exit", async () => {
    const lines: string[] = [];
    const outcome = await runProcess(process.execPath, ["-e", "process.stdout.write('hello\\n')"], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      signal: new AbortController().signal,
      onLine: (line) => lines.push(line.text),
    });
    expect(outcome).toEqual({ outcome: "exit", code: 0 });
    expect(lines).toEqual(["hello"]);
  });

  test("spawn.cancel kills the process tree", async () => {
    const controller = new AbortController();
    const script =
      "const child_process = require('node:child_process');" +
      "const c = child_process.spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)']);" +
      "console.log(c.pid);" +
      "setTimeout(() => {}, 60000);";
    let grandchildPid = 0;
    const runPromise = runProcess(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      signal: controller.signal,
      onLine: (line) => {
        const parsed = Number.parseInt(line.text, 10);
        if (!Number.isNaN(parsed)) grandchildPid = parsed;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    const outcome = await runPromise;
    expect(outcome).toEqual({ outcome: "cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(grandchildPid).not.toBe(0);
    expect(pidAlive(grandchildPid)).toBe(false);
  });

  test("spawn.cancel settles cancelled only after the process actually exits", async () => {
    const controller = new AbortController();
    let killedAt = 0;
    let closedAt = 0;
    const slowKill = runProcessWith((child) => {
      killedAt = Date.now();
      setTimeout(() => child.kill("SIGKILL"), 100);
      return { ok: true };
    });
    const runPromise = slowKill(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      signal: controller.signal,
      onLine: () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    const outcome = await runPromise;
    closedAt = Date.now();
    expect(outcome).toEqual({ outcome: "cancelled" });
    expect(closedAt - killedAt).toBeGreaterThanOrEqual(90);
  });

  test("spawn.cancel reports kill_failed with the cause when the injected kill function fails", async () => {
    const controller = new AbortController();
    const failingCause = new Error("taskkill denied");
    const alwaysFails = runProcessWith(() => ({ ok: false, error: failingCause }));
    const runPromise = alwaysFails(process.execPath, ["-e", "setTimeout(() => {}, 500)"], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      signal: controller.signal,
      onLine: () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    const outcome = await runPromise;
    expect(outcome).toEqual({ outcome: "kill_failed", error: failingCause });
  });

  test.runIf(process.platform === "win32")(
    "defaultKillTree reports kill_failed, not success, when taskkill fails and the process is still alive",
    async () => {
      vi.mocked(nodeChildProcess.spawnSync).mockReturnValueOnce({
        status: 1,
        error: undefined,
      } as unknown as ReturnType<typeof nodeChildProcess.spawnSync>);
      const child = nodeChildProcess.spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
      await new Promise((resolve) => child.once("spawn", resolve));
      const result = defaultKillTree(child);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(pidAlive(child.pid ?? 0)).toBe(false);
    },
  );

  test.runIf(process.platform === "win32")(
    "defaultKillTree reports kill_failed when taskkill fails even though the root process is already dead",
    async () => {
      const child = nodeChildProcess.spawn(process.execPath, ["-e", "process.exit(0)"]);
      await new Promise((resolve) => child.once("close", resolve));
      expect(pidAlive(child.pid ?? 0)).toBe(false);
      vi.mocked(nodeChildProcess.spawnSync).mockReturnValueOnce({
        status: 128,
        error: undefined,
      } as unknown as ReturnType<typeof nodeChildProcess.spawnSync>);
      const result = defaultKillTree(child);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    },
  );

  test("runProcessWith reports kill_failed when the injected kill cannot establish tree termination", async () => {
    const controller = new AbortController();
    const cause = new Error("root exited but descendants unverified");
    const run = runProcessWith(() => ({ ok: false, error: cause }));
    const promise = run(process.execPath, ["-e", "setTimeout(() => {}, 500)"], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      signal: controller.signal,
      onLine: () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    expect(await promise).toEqual({ outcome: "kill_failed", error: cause });
  });
});
