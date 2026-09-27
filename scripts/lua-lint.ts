import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveLuac, resolveLuacheck } from "./lib/lua-tool-paths.ts";
import { resolveSupportedPlatform } from "./lib/lua-toolchain-specs.ts";

const addonDir = join(process.cwd(), "addon");

const findLuaFiles = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...findLuaFiles(entryPath));
    } else if (entry.endsWith(".lua")) {
      files.push(entryPath);
    }
  }
  return files;
};

const runLuacheck = (luacheckPath: string): number => {
  const result = spawnSync(luacheckPath, ["--std", "lua51", addonDir], {
    encoding: "utf8",
    stdio: "inherit",
  });
  return result.status ?? 1;
};

const runSyntaxBan = (luacPath: string): number => {
  const files = findLuaFiles(addonDir);
  let failed = false;
  for (const file of files) {
    const result = spawnSync(luacPath, ["-p", file], { encoding: "utf8" });
    if (result.status !== 0) {
      failed = true;
      console.error(`5.2+ syntax rejected by lua5.1 parser in ${file}:\n${result.stderr}`);
    }
  }
  return failed ? 1 : 0;
};

const main = (): void => {
  const platform = resolveSupportedPlatform();
  if (!platform) {
    console.error(
      `unsupported platform/arch: ${process.platform}-${process.arch}; only win32-x64 and linux-x64 are supported`,
    );
    process.exit(1);
  }
  const toolsDir = join(process.cwd(), ".tools");
  const luacheckResolution = resolveLuacheck(platform, toolsDir);
  if (!luacheckResolution.ok) {
    console.error(`${luacheckResolution.error}; run pnpm run lua:setup first`);
    process.exit(1);
  }
  const luacResolution = resolveLuac(platform, toolsDir);
  if (!luacResolution.ok) {
    console.error(`${luacResolution.error}; run pnpm run lua:setup first`);
    process.exit(1);
  }
  const luacheckExit = runLuacheck(luacheckResolution.command);
  const syntaxExit = runSyntaxBan(luacResolution.command);
  process.exit(luacheckExit !== 0 ? luacheckExit : syntaxExit);
};

main();
