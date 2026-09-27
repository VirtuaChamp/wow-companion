import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveLuaInterpreter } from "./lib/lua-tool-paths.ts";
import { resolveSupportedPlatform } from "./lib/lua-toolchain-specs.ts";

const testDir = join(process.cwd(), "tests", "lua");

const findTestFiles = (): string[] => {
  if (!existsSync(testDir)) {
    return [];
  }
  return readdirSync(testDir)
    .filter((entry) => entry.endsWith("_test.lua"))
    .sort()
    .map((entry) => join(testDir, entry));
};

const runTestFile = (luaPath: string, filePath: string): boolean => {
  const fileName = filePath.slice(testDir.length + 1);
  const name = fileName.endsWith("_test.lua") ? fileName.slice(0, -"_test.lua".length) : fileName;
  const result = spawnSync(luaPath, [filePath], { encoding: "utf8", cwd: process.cwd() });
  const passed = result.status === 0;
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) {
    console.error(result.stderr || result.stdout);
  }
  return passed;
};

const main = (): void => {
  const platform = resolveSupportedPlatform();
  if (!platform) {
    console.error(
      `unsupported platform/arch: ${process.platform}-${process.arch}; only win32-x64 and linux-x64 are supported`,
    );
    process.exit(1);
  }
  const luaResolution = resolveLuaInterpreter(platform, join(process.cwd(), ".tools"));
  if (!luaResolution.ok) {
    console.error(`${luaResolution.error}; run pnpm run lua:setup first`);
    process.exit(1);
  }
  const testFiles = findTestFiles();
  if (testFiles.length === 0) {
    console.error("no tests/lua/*_test.lua files found");
    process.exit(1);
  }
  const results = testFiles.map((filePath) => runTestFile(luaResolution.command, filePath));
  process.exit(results.every(Boolean) ? 0 : 1);
};

main();
