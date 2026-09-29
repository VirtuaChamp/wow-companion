import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const fixturesRoot = join(repoRoot, "apps", "companion", "test", "providers", "fixtures");
const workspace = join(repoRoot, "apps", "companion", "workspace");
const providersDir = join(repoRoot, "apps", "companion", "test", "providers");

function runHelper(script: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("close", (code) => resolve(code));
    child.on("error", (error) => {
      console.log(`spawn-error: ${error.message}`);
      resolve(null);
    });
  });
}

export function helperFailed(code: number | null): boolean {
  return code !== 0;
}

async function main(): Promise<void> {
  console.log(`recorder writing under ${fixturesRoot}`);
  console.log(
    "each provider is recorded by its own apps/companion/test/providers/record-<provider>.ts helper,",
  );
  console.log(
    "run exactly the way its adapter spawns (cross-spawn, no shell) so the recording proves the adapter's argv.",
  );
  mkdirSync(workspace, { recursive: true });

  const claudeCode = await runHelper(join(providersDir, "record-claude.ts"));
  console.log(`claude recorder exited ${claudeCode}`);
  if (helperFailed(claudeCode)) process.exitCode = 1;

  const codexCode = await runHelper(join(providersDir, "record-codex.ts"));
  console.log(`codex recorder exited ${codexCode}`);
  if (helperFailed(codexCode)) process.exitCode = 1;

  const cursorCode = await runHelper(join(providersDir, "record-cursor.ts"));
  console.log(`cursor recorder exited ${cursorCode}`);
  if (helperFailed(cursorCode)) process.exitCode = 1;

  console.log("done. Review every fixture file for secrets before committing.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
