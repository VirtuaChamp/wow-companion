import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Cell, CellGrid } from "../../src/transport/grid.ts";
import { layoutRows, parseCellGridFile } from "../../src/transport/grid.ts";
import { crc16 } from "../../src/transport/codec.ts";
import type { FrameSource } from "../../src/transport/capture.ts";
import type { LineCapture } from "../../src/transport/line-reader.ts";
import { readFile } from "node:fs/promises";
import { paintedRowsFromFlat, renderLineCapture } from "./line-render.ts";
import type { RenderOptions } from "./line-render.ts";

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

export function captureOfGrid(grid: CellGrid): LineCapture {
  return renderLineCapture(paintedRowsFromFlat(grid));
}

export function switchableSource(current: () => string): FrameSource {
  return {
    async next(): Promise<LineCapture | undefined> {
      const parsed = parseCellGridFile(readFileSync(current(), "utf-8"));
      return parsed.ok ? captureOfGrid(parsed.value) : undefined;
    },
    close(): void {},
  };
}

export function createGridFileSource(path: string, options: RenderOptions = {}): FrameSource {
  return {
    async next(): Promise<LineCapture | undefined> {
      let text: string;
      try {
        text = await readFile(path, "utf-8");
      } catch {
        return undefined;
      }
      const parsed = parseCellGridFile(text);
      return parsed.ok ? renderLineCapture(paintedRowsFromFlat(parsed.value), options) : undefined;
    },
    close(): void {},
  };
}

function paintedChunk(
  version: number,
  body: Uint8Array,
  seq: number,
  total: number,
  index: number,
): CellGrid {
  const head = [
    0x57,
    0x43,
    version,
    (seq >> 8) & 0xff,
    seq & 0xff,
    total,
    index,
    (body.length >> 8) & 0xff,
    body.length & 0xff,
  ];
  const bytes = new Uint8Array([...head, ...body]);
  const crc = crc16(bytes);
  const framed = new Uint8Array([...bytes, (crc >> 8) & 0xff, crc & 0xff]);
  const bits = [...framed].flatMap((byte) =>
    Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1),
  );
  const cells: Cell[] = [];
  for (let i = 0; i < bits.length; i += 3) {
    cells.push((((bits[i] ?? 0) << 2) | ((bits[i + 1] ?? 0) << 1) | (bits[i + 2] ?? 0)) as Cell);
  }
  const rows = layoutRows(cells, 900);
  if (rows === undefined) throw new Error("fixture does not fit");
  return rows.flat();
}

export function paintedFrameWithVersion(version: number, json: string, seq = 1): CellGrid {
  return paintedChunk(version, new TextEncoder().encode(json), seq, 1, 0);
}

export function paintedMultiFrame(json: string, seq: number, parts: number): readonly CellGrid[] {
  const body = new TextEncoder().encode(json);
  const size = Math.ceil(body.length / parts);
  return Array.from({ length: parts }, (_, index) =>
    paintedChunk(2, body.slice(index * size, (index + 1) * size), seq, parts, index),
  );
}
