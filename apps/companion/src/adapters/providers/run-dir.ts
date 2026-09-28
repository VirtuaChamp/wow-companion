import { rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function safeRunDir(baseDir: string, subfolder: string, runId: string): string {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error(`unsafe runId: ${JSON.stringify(runId)}`);
  }
  const root = resolve(baseDir, subfolder);
  const dir = resolve(root, runId);
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new Error(`runId escapes ${subfolder}: ${JSON.stringify(runId)}`);
  }
  return join(root, runId);
}

function reportLeakedRunDir(dir: string, error: unknown): void {
  console.error(`failed to remove run directory ${dir}: ${String(error)}`);
}

export function cleanupRunDir(
  dir: string,
  report: (dir: string, error: unknown) => void = reportLeakedRunDir,
): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    report(dir, error);
  }
}
