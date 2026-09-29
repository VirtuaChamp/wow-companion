import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { specsByPlatform, type SupportedPlatform } from "./lua-toolchain-specs.ts";

export type ResolvedTool = { ok: true; command: string } | { ok: false; error: string };

const isExecutable = (command: string): boolean => {
  const result = spawnSync(command, ["-v"], { encoding: "utf8" });
  return result.error === undefined;
};

const reportsLua515 = (command: string): boolean => {
  const result = spawnSync(command, ["-v"], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return output.includes("Lua 5.1.5");
};

const resolveVersionedLuaTool = (
  installedPath: string,
  pathCandidates: string[],
  toolLabel: string,
): ResolvedTool => {
  const candidates = existsSync(installedPath) ? [installedPath] : pathCandidates;
  for (const candidate of candidates) {
    if (!existsSync(installedPath) && !isExecutable(candidate)) {
      continue;
    }
    if (reportsLua515(candidate)) {
      return { ok: true, command: candidate };
    }
  }
  return {
    ok: false,
    error: `no ${toolLabel} reporting Lua 5.1.5 found in .tools/lua51 or on PATH`,
  };
};

export const resolveLuaInterpreter = (
  platform: SupportedPlatform,
  toolsDir: string,
): ResolvedTool => {
  const spec = specsByPlatform[platform];
  const installedPath = join(toolsDir, "lua51", spec.lua.linkName);
  return resolveVersionedLuaTool(installedPath, ["lua5.1", "lua"], "lua interpreter");
};

export const resolveLuac = (platform: SupportedPlatform, toolsDir: string): ResolvedTool => {
  const spec = specsByPlatform[platform];
  const installedPath = join(toolsDir, "lua51", spec.lua.luacFileName);
  return resolveVersionedLuaTool(installedPath, ["luac5.1", "luac"], "luac compiler");
};

export const resolveLuacheck = (platform: SupportedPlatform, toolsDir: string): ResolvedTool => {
  const spec = specsByPlatform[platform];
  const installedPath = join(toolsDir, "luacheck", spec.luacheck.fileName);
  if (existsSync(installedPath)) {
    return { ok: true, command: installedPath };
  }
  if (isExecutable("luacheck")) {
    return { ok: true, command: "luacheck" };
  }
  return { ok: false, error: "no luacheck found in .tools/luacheck or on PATH" };
};
