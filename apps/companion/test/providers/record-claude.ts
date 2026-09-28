import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { READ_ONLY_QUERY_OPTIONS } from "../../src/adapters/providers/claude.ts";
import { redact, sanitizeEnvEcho } from "./redact.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures", "claude");
const stubMcp = join(here, "stub-mcp", "server.ts");
const workspace = join(dirname(dirname(here)), "workspace");

function sanitizeMessageLine(line: string): string {
  return JSON.stringify(sanitizeEnvEcho(JSON.parse(line)));
}

function writeFixture(name: string, messageLines: string[]): void {
  mkdirSync(fixturesDir, { recursive: true });
  const body = redact(`[\n${messageLines.map(sanitizeMessageLine).join(",\n")}\n]\n`);
  writeFileSync(join(fixturesDir, name), body);
  console.log(`wrote ${messageLines.length} messages to test/providers/fixtures/claude/${name}`);
}

export function streamQueryOptions(cwd: string): Options {
  return {
    cwd,
    ...READ_ONLY_QUERY_OPTIONS,
    mcpServers: {
      wowc: {
        type: "stdio",
        command: process.execPath,
        args: [stubMcp],
        env: { WOWC_RUN: "record-claude-stream" },
      },
    },
  };
}

export function sessionUnknownQueryOptions(cwd: string): Options {
  return {
    cwd,
    ...READ_ONLY_QUERY_OPTIONS,
    resume: "00000000-0000-4000-8000-000000000000",
  };
}

async function recordStream(): Promise<void> {
  const lines: string[] = [];
  mkdirSync(workspace, { recursive: true });
  const q = query({
    prompt: "call the mcp__wowc__wowc_ping tool once, then reply with the single word pong",
    options: streamQueryOptions(workspace),
  });
  for await (const message of q) {
    lines.push(JSON.stringify(message));
  }
  writeFixture("stream.json", lines);
}

async function recordSessionUnknown(): Promise<void> {
  const lines: string[] = [];
  try {
    const q = query({
      prompt: "continue",
      options: sessionUnknownQueryOptions(workspace),
    });
    for await (const message of q) {
      lines.push(JSON.stringify(message));
    }
  } catch (error) {
    lines.push(JSON.stringify({ type: "caught-error", message: String(error) }));
  }
  writeFixture("session_unknown.json", lines);
}

async function main(): Promise<void> {
  console.log("running claude in-process query() headless prompts");
  await recordStream();
  await recordSessionUnknown();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
