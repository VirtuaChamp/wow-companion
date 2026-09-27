import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ListedFile } from "./guard-core.ts";

const excludedDirs = new Set(["node_modules", ".git", ".tools", "dist", "coverage"]);

const toPosix = (p: string): string => p.replace(/\\/g, "/");

export const listTrackedFiles = (rootDir: string): ListedFile[] => {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => ({ relPath: toPosix(line), absPath: join(rootDir, line) }));
};

export const walkFiles = (rootDir: string): ListedFile[] => {
  const out: ListedFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (excludedDirs.has(entry)) {
        continue;
      }
      const absPath = join(dir, entry);
      const stats = statSync(absPath);
      if (stats.isDirectory()) {
        walk(absPath);
      } else {
        out.push({ relPath: toPosix(relative(rootDir, absPath)), absPath });
      }
    }
  };
  walk(rootDir);
  return out;
};
