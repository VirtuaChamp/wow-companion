import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc16, decodeGrid, decodeRows, reassemble } from "../src/transport/codec.ts";
import type { Frame, FrameBuffer } from "../src/transport/codec.ts";
import { layoutRows, parseCellGridFile, splitPaintedRows } from "../src/transport/grid.ts";
import { createLineReader } from "../src/transport/line-reader.ts";
import type { LineCapture } from "../src/transport/line-reader.ts";
import { paintedRowsFromFlat, renderLineCapture } from "./transport/line-render.ts";
import type { RenderOptions } from "./transport/line-render.ts";
import type { Cell, CellGrid } from "../src/transport/grid.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function expectedByte(index: number): number {
  return index % 256;
}

function reportsLua515(command: string): boolean {
  const probe = spawnSync(command, ["-v"], { encoding: "utf8" });
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  return probe.error === undefined && output.includes("Lua 5.1.5");
}

function resolveLuaCommand(): string {
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

function runLuaScript(scriptName: string, outDir: string, args: readonly string[]): void {
  const lua = resolveLuaCommand();
  const result = spawnSync(
    lua,
    [join(repoRoot, "tests", "lua", "codec", scriptName), outDir, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`lua encoder failed: ${result.stderr}`);
  }
}

function runLuaEncoder(outDir: string, payloadLen: number, seq: number): void {
  runLuaScript("encode_to_grid.lua", outDir, [String(payloadLen), String(seq)]);
}

function runLuaMessageEncoder(outDir: string, textLen: number, seq: number): void {
  runLuaScript("encode_message_to_grid.lua", outDir, [String(textLen), String(seq)]);
}

function runLuaStateEncoder(outDir: string, seq: number): void {
  runLuaScript("encode_state_to_grid.lua", outDir, [String(seq)]);
}

function readGrid(outDir: string, index: number): CellGrid {
  const text = readFileSync(join(outDir, `frame-${index}.grid`), "utf8");
  const parsed = parseCellGridFile(text);
  if (!parsed.ok) {
    throw new Error("failed to parse grid fixture");
  }
  return parsed.value;
}

function collectPayload(outDir: string, frameCount: number): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const decoded = decodeGrid(readGrid(outDir, index));
    if (!decoded.ok) throw new Error("unreachable");
    parts.push(decoded.value.payload);
  }
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "wow-codec-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function bytesToDataCells(bytes: Uint8Array): Cell[] {
  const bits: number[] = [];
  for (const byte of bytes) {
    for (let b = 7; b >= 0; b -= 1) {
      bits.push((byte >> b) & 1);
    }
  }
  const cells: Cell[] = [];
  for (let i = 0; i < bits.length; i += 3) {
    const b0 = bits[i] ?? 0;
    const b1 = bits[i + 1] ?? 0;
    const b2 = bits[i + 2] ?? 0;
    cells.push(((b0 << 2) | (b1 << 1) | b2) as Cell);
  }
  return cells;
}

function layoutGridCells(dataCells: readonly Cell[]): CellGrid {
  const rows = layoutRows(dataCells, 2000);
  if (rows === undefined) {
    throw new Error("fixture does not fit three rows");
  }
  return rows.flat();
}

function withCrc(headerAndPayload: Uint8Array, crcOverride?: number): Uint8Array {
  const crc = crcOverride ?? crc16(headerAndPayload);
  const full = new Uint8Array(headerAndPayload.length + 2);
  full.set(headerAndPayload, 0);
  full[headerAndPayload.length] = (crc >> 8) & 0xff;
  full[headerAndPayload.length + 1] = crc & 0xff;
  return full;
}

function buildFrameGrid(headerAndPayload: Uint8Array, crcOverride?: number): CellGrid {
  return layoutGridCells(bytesToDataCells(withCrc(headerAndPayload, crcOverride)));
}

function frameHeader(
  magic1: number,
  magic2: number,
  seq: number,
  total: number,
  index: number,
  length: number,
): number[] {
  return [
    magic1,
    magic2,
    2,
    (seq >> 8) & 0xff,
    seq & 0xff,
    total,
    index,
    (length >> 8) & 0xff,
    length & 0xff,
  ];
}

describe("codec.roundtrip", () => {
  const sizes = [0, 1, 500, 5000, 16384];

  for (const size of sizes) {
    it(`round-trips a ${size}-byte payload through the real Lua encoder`, () => {
      withTempDir((dir) => {
        runLuaEncoder(dir, size, 3);
        const frameCount = Number(readFileSync(join(dir, "meta.txt"), "utf8"));
        for (let index = 0; index < frameCount; index += 1) {
          expect(readGrid(dir, index).length).toBeLessThanOrEqual(3 * (16 + 928));
        }
        const payload = collectPayload(dir, frameCount);
        expect(payload.length).toBe(size);
        for (let i = 0; i < size; i += 1) {
          expect(payload[i]).toBe(expectedByte(i));
        }
      });
    });
  }

  it("splits a 5000-byte payload into multiple frames", () => {
    withTempDir((dir) => {
      runLuaEncoder(dir, 5000, 9);
      const frameCount = Number(readFileSync(join(dir, "meta.txt"), "utf8"));
      expect(frameCount).toBe(5);
      for (let index = 0; index < frameCount; index += 1) {
        const decoded = decodeGrid(readGrid(dir, index));
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) throw new Error("unreachable");
        expect(decoded.value.total).toBe(5);
        expect(decoded.value.index).toBe(index);
      }
    });
  });

  it("lays a full 1024-byte frame across exactly three rows at 1920 wide", () => {
    withTempDir((dir) => {
      runLuaEncoder(dir, 1024, 4);
      const cells = readGrid(dir, 0);
      expect(cells.length).toBe(3 * (16 + 928));
      const result = decodeGrid(cells);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.payload.length).toBe(1024);
      }
    });
  });

  it("reassembles a real multi-frame message end to end via reassemble()", () => {
    withTempDir((dir) => {
      runLuaMessageEncoder(dir, 3000, 11);
      const frameCount = Number(readFileSync(join(dir, "meta.txt"), "utf8"));
      expect(frameCount).toBeGreaterThan(1);
      let buf: FrameBuffer;
      let lastMessage: ReturnType<typeof reassemble>["message"];
      for (let index = 0; index < frameCount; index += 1) {
        const decoded = decodeGrid(readGrid(dir, index));
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) throw new Error("unreachable");
        const step = reassemble(buf, decoded.value);
        buf = step.buf;
        if (step.message !== undefined) {
          lastMessage = step.message;
        }
      }
      expect(lastMessage?.ok).toBe(true);
      if (lastMessage?.ok === true && lastMessage.value.t === "ask") {
        expect(lastMessage.value.text.length).toBe(3000);
        expect(lastMessage.value.id).toBe("r1");
      } else {
        throw new Error("expected an ask message");
      }
    });
  });

  it("accepts a real state message with an empty delta encoded as [] by the Lua encoder", () => {
    withTempDir((dir) => {
      runLuaStateEncoder(dir, 12);
      const frameCount = Number(readFileSync(join(dir, "meta.txt"), "utf8"));
      expect(frameCount).toBe(1);
      const decoded = decodeGrid(readGrid(dir, 0));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) throw new Error("unreachable");
      const step = reassemble(undefined, decoded.value);
      expect(step.message?.ok).toBe(true);
      if (step.message?.ok === true && step.message.value.t === "state") {
        expect(step.message.value.seq).toBe(12);
        expect(step.message.value.delta).toEqual({});
      } else {
        throw new Error("expected a state message");
      }
    });
  });
});

type Feed = ReturnType<ReturnType<typeof createLineReader>["feed"]>;

describe("codec.roundtrip through a rendered line image", () => {
  const variants: readonly { name: string; options: RenderOptions }[] = [
    { name: "clean line at the top-left", options: {} },
    {
      name: "cells drawn 2 px wide over the gap, line offset along the top edge",
      options: {
        offsetX: 20,
        widen: (row, cell) => ((row + cell) % 3 === 0 ? 1 : cell % 5 === 0 ? -1 : 0),
      },
    },
    { name: "line at the bottom edge", options: { edge: "bottom", offsetX: 5 } },
    { name: "2560 px wide capture", options: { width: 2560, offsetX: 600 } },
  ];

  const noiseOnOneSample = [{ row: 0, cell: 20, sample: 0, value: 5 }] as const;

  function decodeThroughImage(dir: string, frameCount: number, options: RenderOptions): Uint8Array {
    const parts: Uint8Array[] = [];
    for (let index = 0; index < frameCount; index += 1) {
      const rows = paintedRowsFromFlat(readGrid(dir, index));
      const reader = createLineReader();
      const clean = renderLineCapture(rows, options);
      const noisy = renderLineCapture(rows, { ...options, noise: noiseOnOneSample });
      let reading: Feed | undefined;
      for (const capture of [noisy, clean, clean]) {
        reading = reader.feed(capture);
      }
      const frame = reading?.frame;
      if (frame?.ok !== true) {
        throw new Error(`frame ${String(index)} did not decode`);
      }
      parts.push(frame.value.payload);
    }
    return Uint8Array.from(parts.flatMap((part) => [...part]));
  }

  for (const variant of variants) {
    for (const size of [0, 1, 500, 5000]) {
      it(`${variant.name}: ${String(size)}-byte payload decodes to identical bytes`, () => {
        withTempDir((dir) => {
          runLuaEncoder(dir, size, 3);
          const frameCount = Number(readFileSync(join(dir, "meta.txt"), "utf8"));
          const payload = decodeThroughImage(dir, frameCount, variant.options);
          expect(payload.length).toBe(size);
          for (let i = 0; i < size; i += 1) {
            expect(payload[i]).toBe(expectedByte(i));
          }
        });
      });
    }
  }

  it("a frame with one noisy sample on one cell decodes once later captures outvote it", () => {
    withTempDir((dir) => {
      runLuaEncoder(dir, 500, 3);
      const rows = paintedRowsFromFlat(readGrid(dir, 0));
      const reader = createLineReader();
      const noisy = renderLineCapture(rows, {
        noise: [
          { row: 0, cell: 20, sample: 0, value: 5 },
          { row: 0, cell: 20, sample: 1, value: 5 },
        ],
      });
      const first = reader.feed(noisy);
      expect(first.seen).toBe(true);
      expect(first.frame?.ok).toBe(false);
      const clean = renderLineCapture(rows);
      const later = [reader.feed(clean), reader.feed(clean), reader.feed(clean)];
      expect(later.some((reading) => reading.frame?.ok === true)).toBe(true);
    });
  });

  it("takes the most frequent value per cell across captures when every capture has a bad cell", () => {
    withTempDir((dir) => {
      runLuaEncoder(dir, 500, 3);
      const rows = paintedRowsFromFlat(readGrid(dir, 0));
      const reader = createLineReader();
      const badCell = (cell: number): RenderOptions => ({
        noise: [
          { row: 0, cell, sample: 0, value: 5 },
          { row: 0, cell, sample: 1, value: 5 },
        ],
      });
      const readings = [20, 30, 40].map((cell) =>
        reader.feed(renderLineCapture(rows, badCell(cell))),
      );
      expect(readings.map((reading) => reading.frame?.ok)).toEqual([false, false, true]);
    });
  });

  it("reports the line as unseen when there is no anchor", () => {
    const reader = createLineReader();
    const blank: LineCapture = renderLineCapture([], {});
    expect(reader.feed(blank)).toEqual({ seen: false });
  });
});

describe("codec.rejects", () => {
  function fixtureCells(): CellGrid {
    return withTempDir((dir) => {
      runLuaEncoder(dir, 10, 5);
      return readGrid(dir, 0);
    });
  }

  it("rejects a flipped payload bit as bad_frame via crc mismatch", () => {
    const cells = fixtureCells();
    const mutable = cells.slice() as number[];
    const payloadCellIndex = 16 + 34;
    mutable[payloadCellIndex] = (mutable[payloadCellIndex] as number) ^ 1;
    const result = decodeGrid(mutable as CellGrid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad_frame");
  });

  it("rejects a wrong magic as bad_frame even with a crc that matches it", () => {
    const header = frameHeader(0x00, 0x00, 5, 1, 0, 4);
    const payload = [1, 2, 3, 4];
    const headerAndPayload = new Uint8Array([...header, ...payload]);
    const grid = buildFrameGrid(headerAndPayload);
    const result = decodeGrid(grid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad_frame");
  });

  it("rejects a truncated grid as bad_frame before ever computing a crc", () => {
    const cells = fixtureCells();
    const truncated = cells.slice(0, cells.length - 1);
    const result = decodeGrid(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad_frame");
  });

  it("rejects a wrong crc as bad_frame", () => {
    const cells = fixtureCells();
    const mutable = cells.slice() as number[];
    const crcCellIndex = 16 + 55;
    mutable[crcCellIndex] = ((mutable[crcCellIndex] as number) + 3) % 8;
    const result = decodeGrid(mutable as CellGrid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad_frame");
  });

  it("rejects a frame length over the 1 KB wire chunk cap as bad_frame", () => {
    const header = frameHeader(0x57, 0x43, 1, 1, 0, 2000);
    const headerAndPayload = new Uint8Array([
      ...header,
      ...Array.from<number>({ length: 2000 }).fill(1),
    ]);
    const grid = buildFrameGrid(headerAndPayload);
    const result = decodeGrid(grid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad_frame");
  });

  it("rejects a reassembled payload over 16 KB as too_large before the last frame arrives", () => {
    const makeFrame = (index: number, total: number, length: number): Frame => ({
      version: 2,
      seq: 21,
      total,
      index,
      payload: new Uint8Array(length).fill(1),
    });
    let buf: FrameBuffer;
    const first = reassemble(buf, makeFrame(0, 3, 8200));
    buf = first.buf;
    expect(first.message).toBeUndefined();
    const second = reassemble(buf, makeFrame(1, 3, 8200));
    expect(second.buf).toBeUndefined();
    expect(second.message?.ok).toBe(false);
    if (second.message?.ok === false) {
      expect(second.message.error).toBe("too_large");
    }
  });

  it("treats a repeated frame as a no-op that keeps the buffer", () => {
    const makeFrame = (index: number, total: number): Frame => ({
      version: 2,
      seq: 30,
      total,
      index,
      payload: new Uint8Array([index]),
    });
    let buf: FrameBuffer;
    for (let i = 0; i < 5; i += 1) {
      const step = reassemble(buf, makeFrame(0, 3));
      buf = step.buf;
      expect(step.message).toBeUndefined();
    }
    if (buf === undefined || buf.complete) {
      throw new Error("expected an in-progress buffer");
    }
    expect(buf.parts[0]).toBeDefined();
    expect(buf.parts[1]).toBeUndefined();
  });

  it("keeps the first payload when a repeated index arrives with a different payload", () => {
    const makeFrame = (index: number, payload: number): Frame => ({
      version: 2,
      seq: 33,
      total: 3,
      index,
      payload: new Uint8Array([payload]),
    });
    let buf: FrameBuffer;
    const first = reassemble(buf, makeFrame(0, 111));
    buf = first.buf;
    const repeat = reassemble(buf, makeFrame(0, 222));
    buf = repeat.buf;
    if (buf === undefined || buf.complete) {
      throw new Error("expected an in-progress buffer");
    }
    expect(buf.parts[0]).toEqual(new Uint8Array([111]));
    const withIndex1 = reassemble(buf, makeFrame(1, 1));
    buf = withIndex1.buf;
    const final = reassemble(buf, makeFrame(2, 1));
    expect(final.message?.ok).toBe(false);
    if (final.message?.ok === false) {
      expect(final.message.error).toBe("bad_frame");
    }
  });

  it("delivers a single-frame message only once despite repeated captures", () => {
    const json = '{"t":"hello","v":1,"build":"x","iface":1,"session":"s1","slot":1}';
    const frame: Frame = {
      version: 2,
      seq: 50,
      total: 1,
      index: 0,
      payload: new TextEncoder().encode(json),
    };
    let buf: FrameBuffer;
    const first = reassemble(buf, frame);
    buf = first.buf;
    expect(first.message?.ok).toBe(true);
    for (let i = 0; i < 4; i += 1) {
      const repeat = reassemble(buf, frame);
      buf = repeat.buf;
      expect(repeat.message).toBeUndefined();
    }
  });

  it("delivers a multi-frame message only once despite a repainted frame after completion", () => {
    const json = '{"t":"hello","v":1,"build":"x","iface":1,"session":"s1","slot":1}';
    const bytes = new TextEncoder().encode(json);
    const chunkSize = Math.ceil(bytes.length / 3);
    const chunks = [
      bytes.slice(0, chunkSize),
      bytes.slice(chunkSize, chunkSize * 2),
      bytes.slice(chunkSize * 2),
    ];
    const makeFrame = (index: number): Frame => ({
      version: 2,
      seq: 51,
      total: 3,
      index,
      payload: chunks[index] as Uint8Array,
    });
    let buf: FrameBuffer;
    for (let index = 0; index < 3; index += 1) {
      const step = reassemble(buf, makeFrame(index));
      buf = step.buf;
    }
    for (let i = 0; i < 4; i += 1) {
      const repaint = reassemble(buf, makeFrame(1));
      buf = repaint.buf;
      expect(repaint.message).toBeUndefined();
    }
  });

  it("rejects a single-frame capture whose seq matches a pending multi-frame buffer as bad_frame", () => {
    const partial: Frame = {
      version: 2,
      seq: 60,
      total: 3,
      index: 0,
      payload: new Uint8Array([1]),
    };
    const conflictingSingle: Frame = {
      version: 2,
      seq: 60,
      total: 1,
      index: 0,
      payload: new Uint8Array([1]),
    };
    const step1 = reassemble(undefined, partial);
    expect(step1.message).toBeUndefined();
    const step2 = reassemble(step1.buf, conflictingSingle);
    expect(step2.buf).toBeUndefined();
    expect(step2.message?.ok).toBe(false);
    if (step2.message?.ok === false) {
      expect(step2.message.error).toBe("bad_frame");
    }
  });

  it("rejects an index at or above total as bad_frame", () => {
    const header = frameHeader(0x57, 0x43, 1, 1, 1, 2);
    const headerAndPayload = new Uint8Array([...header, 1, 2]);
    const grid = buildFrameGrid(headerAndPayload);
    const result = decodeGrid(grid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad_frame");
  });

  it("rejects invalid UTF-8 that would otherwise decode into valid JSON as bad_frame", () => {
    const prefix = new TextEncoder().encode('{"t":"hello","v":1,"build":"x');
    const suffix = new TextEncoder().encode('","iface":1}');
    const payload = new Uint8Array(prefix.length + 1 + suffix.length);
    payload.set(prefix, 0);
    payload[prefix.length] = 0xff;
    payload.set(suffix, prefix.length + 1);
    const frame: Frame = {
      version: 2,
      seq: 71,
      total: 1,
      index: 0,
      payload,
    };
    const result = reassemble(undefined, frame);
    expect(result.message?.ok).toBe(false);
    if (result.message?.ok === false) {
      expect(result.message.error).toBe("bad_frame");
    }
  });

  it("rejects invalid UTF-8 in an otherwise CRC-valid payload as bad_frame", () => {
    const frame: Frame = {
      version: 2,
      seq: 70,
      total: 1,
      index: 0,
      payload: new Uint8Array([0xff, 0xfe]),
    };
    const result = reassemble(undefined, frame);
    expect(result.message?.ok).toBe(false);
    if (result.message?.ok === false) {
      expect(result.message.error).toBe("bad_frame");
    }
  });

  it("accepts a reassembled payload at exactly 16 KB and rejects one byte over", () => {
    const makeFrame = (index: number, total: number, length: number): Frame => ({
      version: 2,
      seq: 22,
      total,
      index,
      payload: new Uint8Array(length).fill(1),
    });
    let okBuf: FrameBuffer;
    const okFirst = reassemble(okBuf, makeFrame(0, 2, 8192));
    okBuf = okFirst.buf;
    const okSecond = reassemble(okBuf, makeFrame(1, 2, 8192));
    expect(okSecond.message).toBeDefined();
    expect(okSecond.message?.ok).toBe(false);
    if (okSecond.message?.ok === false) {
      expect(okSecond.message.error).toBe("bad_frame");
    }

    let overBuf: FrameBuffer;
    const overFirst = reassemble(overBuf, makeFrame(0, 2, 8192));
    overBuf = overFirst.buf;
    const overSecond = reassemble(overBuf, makeFrame(1, 2, 8193));
    expect(overSecond.message?.ok).toBe(false);
    if (overSecond.message?.ok === false) {
      expect(overSecond.message.error).toBe("too_large");
    }
  });

  it("assembles a 3-frame message from repeated and interleaved frames", () => {
    const json = '{"t":"hello","v":1,"build":"x","iface":1,"session":"s1","slot":1}';
    const bytes = new TextEncoder().encode(json);
    const chunkSize = Math.ceil(bytes.length / 3);
    const chunks = [
      bytes.slice(0, chunkSize),
      bytes.slice(chunkSize, chunkSize * 2),
      bytes.slice(chunkSize * 2),
    ];
    const makeFrame = (index: number): Frame => ({
      version: 2,
      seq: 31,
      total: 3,
      index,
      payload: chunks[index] as Uint8Array,
    });
    let buf: FrameBuffer;
    const order = [0, 1, 1, 0, 2];
    let lastMessage: ReturnType<typeof reassemble>["message"];
    for (const index of order) {
      const step = reassemble(buf, makeFrame(index));
      buf = step.buf;
      if (step.message !== undefined) {
        lastMessage = step.message;
      }
    }
    expect(lastMessage?.ok).toBe(true);
    if (lastMessage?.ok === true) {
      expect(lastMessage.value).toEqual({
        t: "hello",
        v: 1,
        build: "x",
        iface: 1,
        session: "s1",
        slot: 1,
      });
    }
  });

  it("rejects a corrupted anchor cell as bad_frame", () => {
    const cells = fixtureCells();
    const mutable = cells.slice() as number[];
    mutable[5] = (mutable[5] as number) ^ 1;
    const result = decodeGrid(mutable as CellGrid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bad_frame");
  });

  function twoRowStream(): { flat: number[]; rowLength: number } {
    const header = frameHeader(0x57, 0x43, 8, 1, 0, 400);
    const bytes = new Uint8Array([...header, ...Array.from<number>({ length: 400 }).fill(9)]);
    const rows = layoutRows(bytesToDataCells(withCrc(bytes)), 600);
    if (rows === undefined || rows.length !== 2) throw new Error("fixture must be two rows");
    return { flat: rows.flat(), rowLength: 16 + 600 };
  }

  function countDigits(count: number): number[] {
    return [3, 2, 1, 0].map((place) => Math.floor(count / 8 ** place) % 8);
  }

  it("rejects a row whose cell count is zero (count guard, nothing else to trip)", () => {
    const anchorAndZeroCount = [...fixtureCells().slice(0, 12), 0, 0, 0, 0] as CellGrid;
    const split = splitPaintedRows(anchorAndZeroCount);
    expect(split.ok).toBe(false);
  });

  it("rejects a row that claims more cells than were drawn (row end guard)", () => {
    const cells = fixtureCells();
    const split = splitPaintedRows(cells.slice(0, cells.length - 1));
    expect(split.ok).toBe(false);
    expect(splitPaintedRows(cells).ok).toBe(true);
  });

  it("rejects a second row whose own cell count differs from the first (count agreement guard)", () => {
    const { flat, rowLength } = twoRowStream();
    expect(splitPaintedRows(flat as CellGrid).ok).toBe(true);
    const shorter = [
      ...flat.slice(0, rowLength + 12),
      ...countDigits(599),
      ...flat.slice(rowLength + 16, flat.length - 1),
    ];
    expect(shorter.length).toBe(rowLength + 16 + 599);
    expect(splitPaintedRows(shorter as CellGrid).ok).toBe(false);
  });

  it("rejects a second row that lacks the anchor (anchor guard, counts intact)", () => {
    const { flat, rowLength } = twoRowStream();
    const broken = flat.slice();
    broken[rowLength + 3] = (broken[rowLength + 3] as number) ^ 1;
    expect(splitPaintedRows(broken as CellGrid).ok).toBe(false);
  });

  it("rejects rows of unequal length handed straight to the frame decoder", () => {
    const rows = layoutRows([1, 2, 3, 4], 2);
    if (rows === undefined) throw new Error("fixture");
    const uneven = [rows[0] as CellGrid, (rows[0] as CellGrid).slice(0, 10)];
    const data = uneven.map((row) => row.slice(16));
    expect(decodeRows(data).ok).toBe(false);
    expect(decodeRows([]).ok).toBe(false);
  });

  it("rejects a fourth row as bad_frame", () => {
    const rows = layoutRows([1, 2, 3], 1);
    if (rows === undefined) throw new Error("fixture");
    const four = [...rows, ...rows, ...rows, ...rows].flat();
    expect(decodeGrid(four).ok).toBe(false);
  });

  it("rejects the previous codec version as bad_frame even for a valid message", () => {
    const body = new TextEncoder().encode('{"t":"state","seq":1,"delta":{}}');
    const header = frameHeader(0x57, 0x43, 5, 1, 0, body.length);
    header[2] = 1;
    const grid = buildFrameGrid(new Uint8Array([...header, ...body]));
    const decoded = decodeGrid(grid);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("unreachable");
    expect(decoded.value.version).toBe(1);
    const step = reassemble(undefined, decoded.value);
    expect(step.message?.ok).toBe(false);
    if (step.message?.ok === false) expect(step.message.error).toBe("bad_frame");
    header[2] = 2;
    const current = decodeGrid(buildFrameGrid(new Uint8Array([...header, ...body])));
    if (!current.ok) throw new Error("unreachable");
    expect(reassemble(undefined, current.value).message?.ok).toBe(true);
  });

  it("rejects a frame whose seq matches the buffer but whose total does not", () => {
    const first: Frame = { version: 2, seq: 40, total: 3, index: 0, payload: new Uint8Array([1]) };
    const conflicting: Frame = {
      version: 2,
      seq: 40,
      total: 5,
      index: 0,
      payload: new Uint8Array([1]),
    };
    const step1 = reassemble(undefined, first);
    expect(step1.message).toBeUndefined();
    const step2 = reassemble(step1.buf, conflicting);
    expect(step2.buf).toBeUndefined();
    expect(step2.message?.ok).toBe(false);
    if (step2.message?.ok === false) {
      expect(step2.message.error).toBe("bad_frame");
    }
  });
});

describe("grid.parseCellGridFile", () => {
  it("rejects hexadecimal and exponential forms that Number() would accept", () => {
    const hex = parseCellGridFile("0x5\n");
    expect(hex.ok).toBe(false);
    const exponential = parseCellGridFile("5e0\n");
    expect(exponential.ok).toBe(false);
  });

  it("accepts a plain decimal digit per line", () => {
    const result = parseCellGridFile("0\n7\n3\n");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([0, 7, 3]);
  });
});
