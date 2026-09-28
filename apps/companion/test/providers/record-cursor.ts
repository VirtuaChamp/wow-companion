import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";
import { runProcess } from "../../src/adapters/providers/spawn.ts";
import { cursorArgs, runDirFor, writeMcpConfig } from "../../src/adapters/providers/cursor.ts";
import { redact, sanitizeLine } from "./redact.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures", "cursor");
const stubMcp = join(here, "stub-mcp", "server.ts");
const workspace = join(dirname(dirname(here)), "workspace");

function writeFixture(name: string, lines: string[]): void {
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(join(fixturesDir, name), `${lines.map(sanitizeLine).map(redact).join("\n")}\n`);
  console.log(`wrote ${lines.length} lines to test/providers/fixtures/cursor/${name}`);
}

async function recordVersionAndHelp(): Promise<void> {
  const version = spawn.sync("cursor-agent", ["--version"]);
  const help = spawn.sync("cursor-agent", ["--help"]);
  const listModels = spawn.sync("cursor-agent", ["--list-models"]);
  writeFixture("version.txt", [
    (version.stdout?.toString("utf8") ?? "") + (version.stderr?.toString("utf8") ?? ""),
  ]);
  writeFixture("help.txt", [
    (help.stdout?.toString("utf8") ?? "") + (help.stderr?.toString("utf8") ?? ""),
  ]);
  writeFixture("list-models.txt", [
    (listModels.stdout?.toString("utf8") ?? "") + (listModels.stderr?.toString("utf8") ?? ""),
  ]);
}

async function run(cwd: string, args: string[], env: Record<string, string>): Promise<string[]> {
  const lines: string[] = [];
  const outcome = await runProcess("cursor-agent", args, {
    cwd,
    env,
    signal: new AbortController().signal,
    onLine: (line) => lines.push(line.stream === "stderr" ? `stderr: ${line.text}` : line.text),
  });
  lines.push(`exit: ${outcome.outcome === "exit" ? outcome.code : "cancelled"}`);
  return lines;
}

async function main(): Promise<void> {
  mkdirSync(workspace, { recursive: true });
  await recordVersionAndHelp();

  const runDir = runDirFor(workspace, "record-cursor-stream");
  writeMcpConfig(runDir, {
    command: process.execPath,
    args: [stubMcp],
    env: { WOWC_RUN: "record-cursor-stream" },
  });
  const streamArgs = cursorArgs({
    prompt: "call the wowc_ping tool once, then reply with the single word pong",
    model: "auto",
    workspace: runDir,
  });
  console.log(`running: cursor-agent ${streamArgs.join(" ")}`);
  const streamLines = await run(runDir, streamArgs, {
    ...process.env,
    WOWC_RUN: "record-cursor-stream",
  } as Record<string, string>);
  writeFixture("stream.jsonl", streamLines);
  rmSync(runDir, { recursive: true, force: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
