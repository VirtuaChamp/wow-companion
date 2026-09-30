import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bgrStride, parseCaptureHeader, stripsFromBuffer } from "../../src/transport/capture.ts";
import { LINE_ANCHOR, layoutRows, parseCellGridFile } from "../../src/transport/grid.ts";
import type { Cell, CellGrid } from "../../src/transport/grid.ts";
import { classifyCell, createLineReader } from "../../src/transport/line-reader.ts";
import type { LineCapture } from "../../src/transport/line-reader.ts";
import { cleanScratch, repoRoot, resolveLuaCommand, scratchDir } from "./link-harness.ts";
import {
  overlayCaptures,
  paintedRowsFromFlat,
  rasterizeRects,
  renderLegacyGridCapture,
  renderLineCapture,
} from "./line-render.ts";
import type { PaintedRect, RenderOptions } from "./line-render.ts";

afterEach(() => {
  cleanScratch();
});

function runLua(script: string, args: readonly string[]): string {
  const outDir = scratchDir("wowc-capture-");
  const result = spawnSync(
    resolveLuaCommand(),
    [join(repoRoot, "tests", "lua", "codec", script), outDir, ...args],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`${script} failed: ${result.stderr}`);
  }
  return outDir;
}

function payloadOf(size: number): number[] {
  return Array.from({ length: size }, (_, i) => i % 256);
}

function realFrames(size: number, seq: number): readonly CellGrid[] {
  const dir = runLua("encode_to_grid.lua", [String(size), String(seq)]);
  const count = Number(readFileSync(join(dir, "meta.txt"), "utf8"));
  return Array.from({ length: count }, (_, i) => {
    const parsed = parseCellGridFile(readFileSync(join(dir, `frame-${String(i)}.grid`), "utf8"));
    if (!parsed.ok) throw new Error("grid fixture");
    return parsed.value;
  });
}

function firstRealFrame(size: number, seq: number): CellGrid {
  const frame = realFrames(size, seq)[0];
  if (frame === undefined) throw new Error("no frame");
  return frame;
}

function decodeAll(captures: readonly LineCapture[]): number[] {
  return captures.flatMap((capture) => {
    const reading = createLineReader().feed(capture);
    if (reading.frame?.ok !== true) {
      throw new Error("frame did not decode");
    }
    return [...reading.frame.value.payload];
  });
}

function decodeReal(size: number, options: RenderOptions): number[] {
  return decodeAll(
    realFrames(size, 3).map((frame) => renderLineCapture(paintedRowsFromFlat(frame), options)),
  );
}

function paintedCaptures(
  size: number,
  width: number,
  height: number,
  eff: number,
  position: "top" | "bottom",
): LineCapture[] {
  const dir = runLua("paint_to_pixels.lua", [
    String(size),
    "7",
    String(width),
    String(height),
    String(eff),
    position,
  ]);
  const count = Number(readFileSync(join(dir, "meta.txt"), "utf8"));
  return Array.from({ length: count }, (_, i) => {
    const lines = readFileSync(join(dir, `frame-${String(i)}.rects`), "utf8")
      .trim()
      .split("\n");
    const rects: PaintedRect[] = lines.slice(1).map((line) => {
      const [x, y, w, h, cell] = line.split(" ").map(Number);
      return { x: x ?? 0, y: y ?? 0, width: w ?? 0, height: h ?? 0, cell: (cell ?? 0) as Cell };
    });
    return rasterizeRects(rects, position, { width });
  });
}

describe("capture.classify", () => {
  it("maps a colour to the nearest pure colour index, R as the high bit", () => {
    expect(classifyCell(0, 0, 0)).toBe(0);
    expect(classifyCell(0, 0, 255)).toBe(1);
    expect(classifyCell(0, 255, 0)).toBe(2);
    expect(classifyCell(255, 0, 0)).toBe(4);
    expect(classifyCell(255, 255, 255)).toBe(7);
    expect(classifyCell(200, 10, 200)).toBe(5);
  });
});

describe("capture.strips", () => {
  it("cuts a top strip and a bottom strip out of the stream the capture process writes", () => {
    const width = 10;
    const rows = 2;
    const stride = bgrStride(width);
    expect(stride).toBe(32);
    const buffer = new Uint8Array(stride * rows * 2);
    buffer[0] = 11;
    buffer[stride * rows] = 22;
    const capture = stripsFromBuffer(width, rows, buffer);
    expect(capture?.strips.map((strip) => strip.edge)).toEqual(["top", "bottom"]);
    expect(capture?.strips[0]?.pixels[0]).toBe(11);
    expect(capture?.strips[1]?.pixels[0]).toBe(22);
    expect(capture?.strips[0]?.stride).toBe(stride);
  });

  it("returns nothing for a window that reports no width or a short stream", () => {
    expect(stripsFromBuffer(0, 8, new Uint8Array(100))).toBeUndefined();
    expect(stripsFromBuffer(10, 8, new Uint8Array(10))).toBeUndefined();
  });
});

describe("capture.header", () => {
  const MAGIC = [0x57, 0x43, 0x4c, 0x31];

  function header(magic: readonly number[], width: number): Uint8Array {
    const bytes = new Uint8Array(8);
    bytes.set(magic, 0);
    new DataView(bytes.buffer).setInt32(4, width, true);
    return bytes;
  }

  it("accepts a width in range, including zero for a window that is not there", () => {
    expect(parseCaptureHeader(header(MAGIC, 2560))).toEqual({ kind: "width", widthPx: 2560 });
    expect(parseCaptureHeader(header(MAGIC, 0))).toEqual({ kind: "width", widthPx: 0 });
  });

  it("reports desync for a wrong magic", () => {
    expect(parseCaptureHeader(header([1, 2, 3, 4], 2560))).toEqual({ kind: "desync" });
  });

  it("reports desync for a negative or absurd width instead of waiting for that many bytes", () => {
    expect(parseCaptureHeader(header(MAGIC, -5))).toEqual({ kind: "desync" });
    expect(parseCaptureHeader(header(MAGIC, 2_000_000_000))).toEqual({ kind: "desync" });
  });

  it("reports desync for a short header", () => {
    expect(parseCaptureHeader(new Uint8Array(4))).toEqual({ kind: "desync" });
  });
});

describe("capture.line reads real encoder output", () => {
  it("decodes a full three-row 1024-byte frame at any position the row still fits in the capture", () => {
    for (const offsetX of [0, 1, 13, 32]) {
      expect(decodeReal(1024, { offsetX })).toEqual(payloadOf(1024));
    }
  });

  it("tolerates cells drawn two pixels wide over the gap", () => {
    const widen: RenderOptions["widen"] = (row, cell) => ((row * 3 + cell) % 2 === 0 ? 1 : -1);
    expect(decodeReal(500, { offsetX: 9, widen })).toEqual(payloadOf(500));
  });

  it("reads a line at the bottom edge and at the top edge without any setting", () => {
    expect(decodeReal(1024, { edge: "bottom", offsetX: 30 })).toEqual(payloadOf(1024));
    expect(decodeReal(1024, { edge: "top", offsetX: 30 })).toEqual(payloadOf(1024));
  });

  it("follows the line when the player switches it from the top to the bottom at runtime", () => {
    const rows = paintedRowsFromFlat(firstRealFrame(1024, 3));
    const reader = createLineReader();
    const readings = (["top", "bottom", "top"] as const).map((edge) =>
      reader.feed(renderLineCapture(rows, { edge })),
    );
    expect(readings.map((reading) => reading.frame?.ok)).toEqual([true, true, true]);
  });

  it("does not see a line in an empty capture, and does not decode one cut off by a narrow capture", () => {
    expect(createLineReader().feed(renderLineCapture([], {})).seen).toBe(false);
    const rows = paintedRowsFromFlat(firstRealFrame(500, 3));
    const narrow = createLineReader().feed(renderLineCapture(rows, { width: 600 }));
    expect(narrow.frame?.ok).not.toBe(true);
  });
});

describe("capture.line reads what the real addon paints", () => {
  const screens: readonly (readonly [number, number, number])[] = [
    [1920, 1080, 0.711],
    [2560, 1440, 1],
    [1680, 1050, 0.64],
    [1920, 1200, 0.8],
    [1366, 768, 1],
  ];

  for (const [width, height, eff] of screens) {
    for (const position of ["top", "bottom"] as const) {
      it(`decodes every frame of a 3000-byte message at ${String(width)}x${String(height)}, UI scale ${String(eff)}, ${position}`, () => {
        expect(decodeAll(paintedCaptures(3000, width, height, eff, position))).toEqual(
          payloadOf(3000),
        );
      });
    }
  }
});

describe("capture.vote", () => {
  const bad = (cell: number): RenderOptions => ({
    noise: [
      { row: 0, cell, sample: 0, value: 5 },
      { row: 0, cell, sample: 1, value: 5 },
    ],
  });

  it("does not resurrect the previous frame when a short new frame arrives with one bad cell", () => {
    const first = paintedRowsFromFlat(firstRealFrame(20, 3));
    const second = paintedRowsFromFlat(firstRealFrame(20, 4));
    const reader = createLineReader();
    const rebuilt = [5, 6, 7].map((cell) => reader.feed(renderLineCapture(first, bad(cell))));
    expect(rebuilt.map((reading) => reading.frame?.ok)).toEqual([false, false, true]);
    const noisy = reader.feed(renderLineCapture(second, bad(9)));
    expect(noisy.seen).toBe(true);
    expect(noisy.frame?.ok).toBe(false);
    const clean = reader.feed(renderLineCapture(second));
    expect(clean.frame?.ok).toBe(true);
    if (clean.frame?.ok === true) {
      expect(clean.frame.value.seq).toBe(4);
    }
  });
});

describe("capture.decoys", () => {
  const junk = (length: number): CellGrid =>
    Array.from({ length }, (_, i) => ((i * 5 + 3) % 8) as Cell);
  const decoyRows = (): readonly CellGrid[] => {
    const rows = layoutRows(junk(60), 30);
    if (rows === undefined) throw new Error("decoy");
    return rows;
  };
  const realRows = (): readonly CellGrid[] => paintedRowsFromFlat(firstRealFrame(300, 5));
  const payloadHead = (
    reading: ReturnType<ReturnType<typeof createLineReader>["feed"]>,
  ): number[] =>
    reading.frame?.ok === true ? Array.from(reading.frame.value.payload.slice(0, 8)) : [];

  it("finds the real line to the right of game pixels that match the anchor and hold a valid count", () => {
    const capture = overlayCaptures(
      renderLineCapture(decoyRows(), { offsetX: 0, width: 2560 }),
      renderLineCapture(realRows(), { offsetX: 400, width: 2560 }),
    );
    const reading = createLineReader().feed(capture);
    expect(reading.frame?.ok).toBe(true);
    expect(payloadHead(reading)).toEqual(payloadOf(8));
  });

  it("finds the real line on the bottom edge when the top edge shows a matching decoy", () => {
    const capture = overlayCaptures(
      renderLineCapture(decoyRows(), { edge: "top" }),
      renderLineCapture(realRows(), { edge: "bottom", offsetX: 12 }),
    );
    const reading = createLineReader().feed(capture);
    expect(payloadHead(reading)).toEqual(payloadOf(8));
  });

  it("skips an anchor whose count cells are invalid and reads the real line after it", () => {
    const invalid: CellGrid = [...LINE_ANCHOR, 0, 0, 0, 0, 1, 2, 3, 4];
    const capture = overlayCaptures(
      renderLineCapture([invalid], { offsetX: 0, width: 2560 }),
      renderLineCapture(realRows(), { offsetX: 300, width: 2560 }),
    );
    expect(payloadHead(createLineReader().feed(capture))).toEqual(payloadOf(8));
  });

  it("still votes across noisy captures of the real line while a decoy stays on screen", () => {
    const decoy = renderLineCapture(decoyRows(), { offsetX: 0, width: 2560 });
    const reader = createLineReader();
    const readings = [20, 30, 40].map((cell) =>
      reader.feed(
        overlayCaptures(
          decoy,
          renderLineCapture(realRows(), {
            offsetX: 400,
            width: 2560,
            noise: [
              { row: 0, cell, sample: 0, value: 5 },
              { row: 0, cell, sample: 1, value: 5 },
            ],
          }),
        ),
      ),
    );
    expect(readings.map((reading) => reading.frame?.ok)).toEqual([false, false, true]);
  });

  it("collects votes for the real line even after the decoy alone was the only thing on screen", () => {
    const decoy = renderLineCapture(decoyRows(), { offsetX: 0, width: 2560 });
    const reader = createLineReader();
    reader.feed(decoy);
    reader.feed(decoy);
    const readings = [20, 30, 40].map((cell) =>
      reader.feed(
        overlayCaptures(
          decoy,
          renderLineCapture(realRows(), {
            offsetX: 400,
            width: 2560,
            noise: [
              { row: 0, cell, sample: 0, value: 5 },
              { row: 0, cell, sample: 1, value: 5 },
            ],
          }),
        ),
      ),
    );
    expect(readings.map((reading) => reading.frame?.ok)).toEqual([false, false, true]);
  });

  it("never lets a decoy whose first row looks like the codec header starve the real frame", () => {
    const header = [0x57, 0x43, 0x02, 0x00, 0x09, 0x01, 0x00, 0x00, 0x04, 1, 2, 3, 4, 9, 9];
    const bits = header.flatMap((byte) =>
      Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1),
    );
    const cells: Cell[] = [];
    for (let i = 0; i < bits.length; i += 3) {
      cells.push((((bits[i] ?? 0) << 2) | ((bits[i + 1] ?? 0) << 1) | (bits[i + 2] ?? 0)) as Cell);
    }
    const looksLikeFrame = layoutRows([...cells, ...junk(20)], 30);
    if (looksLikeFrame === undefined) throw new Error("decoy");
    const decoy = renderLineCapture(looksLikeFrame, { offsetX: 0, width: 2560 });
    const reader = createLineReader();
    reader.feed(decoy);
    reader.feed(decoy);
    const readings = [20, 30, 40].map((cell) =>
      reader.feed(
        overlayCaptures(
          decoy,
          renderLineCapture(realRows(), {
            offsetX: 400,
            width: 2560,
            noise: [
              { row: 0, cell, sample: 0, value: 5 },
              { row: 0, cell, sample: 1, value: 5 },
            ],
          }),
        ),
      ),
    );
    expect(readings.map((reading) => reading.frame?.ok)).toEqual([false, false, true]);
  });

  it("reports the decoy alone as a visible line that does not decode", () => {
    const reading = createLineReader().feed(renderLineCapture(decoyRows(), {}));
    expect(reading.seen).toBe(true);
    expect(reading.frame?.ok).toBe(false);
  });
});

describe("capture.accept", () => {
  const stuck = (cell: number): RenderOptions => ({
    noise: [
      { row: 0, cell, sample: 0, value: 5 },
      { row: 0, cell, sample: 1, value: 5 },
    ],
  });

  it("accepts a capture that passes the CRC as it is, even when earlier captures agree on a bad cell", () => {
    const rows = paintedRowsFromFlat(firstRealFrame(200, 6));
    const reader = createLineReader();
    const early = [1, 2, 3].map(() => reader.feed(renderLineCapture(rows, stuck(20))));
    expect(early.map((reading) => reading.frame?.ok)).toEqual([false, false, false]);
    const clean = reader.feed(renderLineCapture(rows));
    expect(clean.frame?.ok).toBe(true);
    if (clean.frame?.ok === true) {
      expect(clean.frame.value.seq).toBe(6);
      expect([...clean.frame.value.payload]).toEqual(payloadOf(200));
    }
  });

  it("returns a clean frame of a new message at once, without waiting for later captures to outvote the old one", () => {
    const first = paintedRowsFromFlat(firstRealFrame(200, 6));
    const second = paintedRowsFromFlat(firstRealFrame(200, 7));
    const reader = createLineReader();
    reader.feed(renderLineCapture(first, stuck(20)));
    const reading = reader.feed(renderLineCapture(second));
    expect(reading.frame?.ok).toBe(true);
    if (reading.frame?.ok === true) {
      expect(reading.frame.value.seq).toBe(7);
    }
  });

  it("falls back to the per-cell vote only when no single capture decodes", () => {
    const rows = paintedRowsFromFlat(firstRealFrame(200, 6));
    const reader = createLineReader();
    const readings = [20, 30, 40].map((cell) => reader.feed(renderLineCapture(rows, stuck(cell))));
    expect(readings.map((reading) => reading.frame?.ok)).toEqual([false, false, true]);
    const voted = readings[2];
    if (voted?.frame?.ok === true) {
      expect([...voted.frame.value.payload]).toEqual(payloadOf(200));
    }
  });
});

describe("capture.legacy", () => {
  it("recognises the version 1 grid (4 px cells, sync row 0..7 at the top-left) and does not read it as a line", () => {
    const capture = renderLegacyGridCapture(firstRealFrame(200, 3));
    expect(createLineReader().feed(capture)).toEqual({ seen: false, legacyGrid: true });
  });

  it("does not report a top-edge pattern that only matches a prefix of the sync row", () => {
    const data = firstRealFrame(200, 3);
    expect(createLineReader().feed(renderLegacyGridCapture(data, { cellsDrawn: 24 }))).toEqual({
      seen: false,
    });
    expect(createLineReader().feed(renderLegacyGridCapture(data, { cellsDrawn: 126 }))).toEqual({
      seen: false,
    });
    expect(createLineReader().feed(renderLegacyGridCapture(data, { cellsDrawn: 128 }))).toEqual({
      seen: false,
      legacyGrid: true,
    });
  });

  it("does not report a top-edge pattern whose sync row breaks after the first 24 cells", () => {
    const capture = renderLegacyGridCapture(firstRealFrame(200, 3));
    const top = capture.strips[0];
    if (top === undefined) throw new Error("strip");
    for (let y = 0; y < 4; y += 1) {
      const offset = y * top.stride + 4 * 60 * 3;
      top.pixels.fill(0, offset, offset + 4 * 3);
    }
    expect(createLineReader().feed(capture)).toEqual({ seen: false });
  });

  it("does not report a sync row whose cells are not solid 4 px blocks", () => {
    const capture = renderLegacyGridCapture(firstRealFrame(200, 3));
    const top = capture.strips[0];
    if (top === undefined) throw new Error("strip");
    const offset = 3 * top.stride + (4 * 5 + 1) * 3;
    top.pixels.fill(0, offset, offset + 3);
    expect(createLineReader().feed(capture)).toEqual({ seen: false });
  });

  it("does not mistake the current line, an empty capture or a blank strip for the version 1 grid", () => {
    const rows = paintedRowsFromFlat(firstRealFrame(200, 3));
    expect(createLineReader().feed(renderLineCapture(rows, {})).legacyGrid).toBeUndefined();
    expect(createLineReader().feed(renderLineCapture([], {}))).toEqual({ seen: false });
  });
});
