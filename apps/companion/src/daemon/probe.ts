import { runProcess } from "../adapters/providers/spawn.ts";

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

function stringEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

export const runCommand: CommandRunner = async (command, args, cwd, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const lines: string[] = [];
  try {
    const outcome = await runProcess(command, [...args], {
      cwd,
      env: stringEnv(),
      signal: controller.signal,
      onLine: (line) => {
        if (line.stream === "stdout") lines.push(line.text);
      },
    });
    switch (outcome.outcome) {
      case "exit":
        return outcome.code === 0
          ? { ok: true, stdout: lines.join(String.fromCharCode(10)) }
          : { ok: false, stdout: "", reason: `${command} ${args.join(" ")} failed` };
      case "cancelled":
        return { ok: false, stdout: "", reason: `${command} did not answer in time` };
      case "kill_failed":
        return {
          ok: false,
          stdout: "",
          reason: `${command} did not answer in time and could not be stopped`,
        };
    }
  } finally {
    clearTimeout(timer);
  }
};

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
