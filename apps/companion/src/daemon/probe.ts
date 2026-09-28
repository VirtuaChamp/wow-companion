import spawn from "cross-spawn";

type CommandOutcome = { ok: boolean; stdout: string; reason?: string };
export type CommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) => Promise<CommandOutcome>;

type Installed = { installed: boolean; reason?: string };

export type Probes = {
  installed(command: string): Installed;
  models(command: string): string[];
  refresh(): Promise<void>;
};

export const runCommand: CommandRunner = (command, args, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let settled = false;
    function settle(outcome: CommandOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    }
    const timer = setTimeout(() => {
      child.kill();
      settle({ ok: false, stdout: "", reason: `${command} did not answer in time` });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => settle({ ok: false, stdout: "", reason: error.message }));
    child.on("close", (code) =>
      code === 0
        ? settle({ ok: true, stdout: Buffer.concat(chunks).toString("utf8") })
        : settle({ ok: false, stdout: "", reason: `${command} --version failed` }),
    );
  });

export function createProbes(input: {
  cwd: string;
  commands: readonly { command: string; listModels?: (stdout: string) => string[] }[];
  timeoutMs: number;
  run?: CommandRunner;
}): Probes {
  const run = input.run ?? runCommand;
  const installed = new Map<string, Installed>();
  const models = new Map<string, string[]>();

  async function probeOne(entry: {
    command: string;
    listModels?: (stdout: string) => string[];
  }): Promise<void> {
    const version = await run(entry.command, ["--version"], input.cwd, input.timeoutMs);
    installed.set(
      entry.command,
      version.ok
        ? { installed: true }
        : { installed: false, ...(version.reason === undefined ? {} : { reason: version.reason }) },
    );
    if (!version.ok || entry.listModels === undefined) return;
    const listed = await run(entry.command, ["--list-models"], input.cwd, input.timeoutMs);
    models.set(entry.command, listed.ok ? entry.listModels(listed.stdout) : []);
  }

  return {
    installed: (command) =>
      installed.get(command) ?? { installed: false, reason: "not checked yet" },
    models: (command) => models.get(command) ?? [],
    async refresh() {
      await Promise.all(input.commands.map(probeOne));
    },
  };
}
