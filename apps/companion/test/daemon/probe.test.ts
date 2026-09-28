import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseListModelsOutput } from "../../src/adapters/providers/cursor.ts";
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

  it("reports installed on a clean exit and not installed, with the reason, when the command fails", async () => {
    const runs: string[][] = [];
    const run: CommandRunner = async (command, args) => {
      runs.push([command, ...args]);
      return command === "broken"
        ? { ok: false, stdout: "", reason: "broken --version failed" }
        : { ok: true, stdout: "cursor-agent 1.0.0" };
    };
    const probes = createProbes({
      cwd: ".",
      timeoutMs: 100,
      run,
      commands: [{ command: "fine" }, { command: "broken" }],
    });

    await probes.refresh();

    expect(probes.installed("fine")).toEqual({ installed: true });
    expect(probes.installed("broken")).toEqual({
      installed: false,
      reason: "broken --version failed",
    });
    expect(runs).toContainEqual(["fine", "--version"]);
    expect(runs.some((entry) => entry.includes("--list-models"))).toBe(false);
  });

  it("reports a missing binary as not installed through the real runner", async () => {
    const probes = createProbes({
      cwd: ".",
      timeoutMs: 2000,
      commands: [{ command: "wowc-no-such-binary" }],
    });

    await probes.refresh();

    expect(probes.installed("wowc-no-such-binary").installed).toBe(false);
    expect(probes.installed("wowc-no-such-binary").reason).toContain("wowc-no-such-binary");
  });

  it("parses the model list of the cursor fixture and gives an empty list when listing fails", async () => {
    const text = readFileSync(
      new URL("../providers/fixtures/cursor/list-models.txt", import.meta.url),
      "utf8",
    );
    const good = createProbes({
      cwd: ".",
      timeoutMs: 100,
      run: async () => ({ ok: true, stdout: text }),
      commands: [{ command: "cursor-agent", listModels: parseListModelsOutput }],
    });
    await good.refresh();
    expect(good.models("cursor-agent")).toContain("gpt-5.1");
    expect(good.models("cursor-agent")).not.toContain("Available");

    const failing = createProbes({
      cwd: ".",
      timeoutMs: 100,
      run: async (_command, args) =>
        args[0] === "--list-models"
          ? { ok: false, stdout: "", reason: "list failed" }
          : { ok: true, stdout: "1.0" },
      commands: [{ command: "cursor-agent", listModels: parseListModelsOutput }],
    });
    await failing.refresh();
    expect(failing.installed("cursor-agent")).toEqual({ installed: true });
    expect(failing.models("cursor-agent")).toEqual([]);
  });
});
