import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CellGrid } from "../../src/transport/grid.ts";
import { parseCellGridFile } from "../../src/transport/grid.ts";
import type { FrameSource } from "../../src/transport/capture.ts";

export const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

function reportsLua515(command: string): boolean {
  const probe = spawnSync(command, ["-v"], { encoding: "utf8" });
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  return probe.error === undefined && output.includes("Lua 5.1.5");
}

export function resolveLuaCommand(): string {
  const isWin = process.platform === "win32" && process.arch === "x64";
  const isLinux = process.platform === "linux" && process.arch === "x64";
  if (!isWin && !isLinux) {
    throw new Error(`unsupported platform/arch: ${process.platform}-${process.arch}`);
  }
  const linkName = isWin ? "lua.exe" : "lua";
  const installedPath = join(repoRoot, ".tools", "lua51", linkName);
  const candidates = existsSync(installedPath) ? [installedPath] : ["lua5.1", "lua"];
  for (const candidate of candidates) {
    if (reportsLua515(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "no lua interpreter reporting Lua 5.1.5 found in .tools/lua51 or on PATH; run pnpm run lua:setup first",
  );
}

export type ParsedSlot = { session: unknown; msgs: unknown };

export function parseSlotContent(content: string): ParsedSlot {
  const dir = mkdtempSync(join(tmpdir(), "wowc-slot-parse-"));
  try {
    const contentPath = join(dir, "deliver.lua");
    writeFileSync(contentPath, content, "utf-8");
    const result = spawnSync(
      resolveLuaCommand(),
      [join(import.meta.dirname, "run_deliver_chunk.lua"), contentPath],
      { cwd: repoRoot, encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`lua deliver harness failed: ${result.stderr}`);
    }
    return JSON.parse(result.stdout) as ParsedSlot;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const scratchDirs: string[] = [];

export function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

export function cleanScratch(): void {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function encodeHelloGridFile(
  session: string,
  slot: number,
  seq: number,
  again = false,
): string {
  const outDir = scratchDir("wowc-hello-grid-");
  const args = [
    join(import.meta.dirname, "encode_hello_to_grid.lua"),
    outDir,
    session,
    String(slot),
    String(seq),
  ];
  if (again) {
    args.push("again");
  }
  const result = spawnSync(resolveLuaCommand(), args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`lua hello encoder failed: ${result.stderr}`);
  }
  return join(outDir, "frame-0.grid");
}

export function switchableSource(current: () => string): FrameSource {
  return {
    async next(): Promise<CellGrid | undefined> {
      const parsed = parseCellGridFile(readFileSync(current(), "utf-8"));
      return parsed.ok ? parsed.value : undefined;
    },
    close(): void {},
  };
}
