import { describe, expect, it } from "vitest";
import { createProbes, runCommand } from "../../src/daemon/probe.ts";
import type { CommandRunner } from "../../src/daemon/probe.ts";

describe("daemon.probe", () => {
  it("reports not checked yet until the first refresh, then the probed result", async () => {
    const run: CommandRunner = async (command, args) => {
      if (args[0] === "--list-models") return { ok: true, stdout: "a\nb\n" };
      return command === "missing"
        ? { ok: false, stdout: "", reason: "missing not found" }
        : { ok: true, stdout: "1.0" };
    };
    const probes = createProbes({
      cwd: ".",
      timeoutMs: 100,
      run,
      commands: [
        { command: "present", listModels: (stdout) => stdout.split("\n").filter(Boolean) },
        { command: "missing" },
      ],
    });
    expect(probes.installed("present")).toEqual({ installed: false, reason: "not checked yet" });

    await probes.refresh();

    expect(probes.installed("present")).toEqual({ installed: true });
    expect(probes.installed("missing")).toEqual({ installed: false, reason: "missing not found" });
    expect(probes.models("present")).toEqual(["a", "b"]);
    expect(probes.models("missing")).toEqual([]);
  });

  it("runs a real command asynchronously and gives up on one that hangs", async () => {
    const ok = await runCommand(process.execPath, ["--version"], ".", 5000);
    expect(ok.ok).toBe(true);
    expect(ok.stdout).toMatch(/^v\d+/);

    const started = Date.now();
    const hung = await runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60000)"],
      ".",
      150,
    );
    expect(hung.ok).toBe(false);
    expect(hung.reason).toContain("did not answer");
    expect(Date.now() - started).toBeLessThan(5000);

    const missing = await runCommand("wowc-no-such-binary", ["--version"], ".", 2000);
    expect(missing.ok).toBe(false);
  });
});
