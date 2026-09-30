import type { Cell, CellGrid } from "../../src/transport/grid.ts";
import {
  LINE_ANCHOR,
  LINE_COUNT_CELLS,
  LINE_PITCH_PX,
  LINE_ROW_HEIGHT_PX,
  LINE_ROW_OVERHEAD_CELLS,
  decodeCount,
} from "../../src/transport/grid.ts";
import type { LineCapture, Strip } from "../../src/transport/line-reader.ts";

type Draw = -1 | 0 | 1;

type CellNoise = { row: number; cell: number; sample: number; value: Cell };

export type RenderOptions = {
  width?: number;
  stripRows?: number;
  edge?: Strip["edge"];
  offsetX?: number;
  widen?: (row: number, cell: number) => Draw;
  noise?: readonly CellNoise[];
};

const DEFAULT_WIDTH_PX = 1920;
const DEFAULT_STRIP_ROWS = 8;

export function paintedRowsFromFlat(painted: CellGrid): readonly CellGrid[] {
  const rows: CellGrid[] = [];
  let offset = 0;
  while (offset < painted.length) {
    const count = decodeCount(
      painted.slice(offset + LINE_ANCHOR.length, offset + LINE_ANCHOR.length + LINE_COUNT_CELLS),
    );
    const end = Math.min(painted.length, offset + LINE_ROW_OVERHEAD_CELLS + count);
    rows.push(painted.slice(offset, end));
    offset = end;
  }
  return rows;
}

function newStrip(edge: Strip["edge"], width: number, rows: number): Strip {
  const stride = Math.ceil((width * 3) / 4) * 4;
  return { edge, width, rows, stride, pixels: new Uint8Array(stride * rows) };
}

function put(strip: Strip, x: number, y: number, cell: Cell): void {
  if (x < 0 || x >= strip.width || y < 0 || y >= strip.rows) {
    return;
  }
  const offset = y * strip.stride + x * 3;
  strip.pixels[offset] = (cell & 1) !== 0 ? 255 : 0;
  strip.pixels[offset + 1] = (cell & 2) !== 0 ? 255 : 0;
  strip.pixels[offset + 2] = (cell & 4) !== 0 ? 255 : 0;
}

function renderStrip(rows: readonly CellGrid[], options: RenderOptions = {}): Strip {
  const edge = options.edge ?? "top";
  const stripRows = options.stripRows ?? DEFAULT_STRIP_ROWS;
  const strip = newStrip(edge, options.width ?? DEFAULT_WIDTH_PX, stripRows);
  const offsetX = options.offsetX ?? 0;
  const pitch = LINE_PITCH_PX;
  const rowHeight = LINE_ROW_HEIGHT_PX;
  rows.forEach((row, k) => {
    for (let s = 0; s < rowHeight; s += 1) {
      const y = edge === "top" ? k * rowHeight + s : stripRows - 1 - (k * rowHeight + s);
      row.forEach((cell, i) => {
        const noisy = options.noise?.find(
          (n) => n.row === k && n.cell === i - LINE_ROW_OVERHEAD_CELLS && n.sample === s,
        );
        const shown = noisy?.value ?? cell;
        const x = offsetX + i * pitch;
        put(strip, x, y, shown);
        const draw = options.widen?.(k, i) ?? 0;
        if (draw !== 0) {
          put(strip, x + draw, y, shown);
        }
      });
    }
  });
  return strip;
}

export function renderLineCapture(
  rows: readonly CellGrid[],
  options: RenderOptions = {},
): LineCapture {
  const drawn = renderStrip(rows, options);
  const otherEdge: Strip["edge"] = drawn.edge === "top" ? "bottom" : "top";
  const blank = newStrip(otherEdge, drawn.width, drawn.rows);
  return { strips: drawn.edge === "top" ? [drawn, blank] : [blank, drawn] };
}

export type PaintedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  cell: Cell;
};

export function rasterizeRects(
  rects: readonly PaintedRect[],
  edge: Strip["edge"],
  options: { width: number; stripRows?: number } = { width: DEFAULT_WIDTH_PX },
): LineCapture {
  const stripRows = options.stripRows ?? DEFAULT_STRIP_ROWS;
  const drawn = newStrip(edge, options.width, stripRows);
  for (const rect of rects) {
    const x0 = Math.round(rect.x);
    const x1 = Math.round(rect.x + rect.width);
    const y0 = Math.round(rect.y);
    const y1 = Math.round(rect.y + rect.height);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        put(drawn, x, edge === "top" ? y : stripRows - 1 - y, rect.cell);
      }
    }
  }
  const otherEdge: Strip["edge"] = edge === "top" ? "bottom" : "top";
  const blank = newStrip(otherEdge, options.width, stripRows);
  return { strips: edge === "top" ? [drawn, blank] : [blank, drawn] };
}

function overlayStrips(a: Strip, b: Strip): Strip {
  const merged = newStrip(a.edge, a.width, a.rows);
  for (let i = 0; i < merged.pixels.length; i += 1) {
    merged.pixels[i] = Math.max(a.pixels[i] ?? 0, b.pixels[i] ?? 0);
  }
  return merged;
}

export function overlayCaptures(...captures: readonly LineCapture[]): LineCapture {
  const [first, ...rest] = captures;
  if (first === undefined) {
    return { strips: [] };
  }
  return {
    strips: first.strips.map((strip) =>
      rest.reduce((acc, capture) => {
        const same = capture.strips.find((other) => other.edge === strip.edge);
        return same === undefined ? acc : overlayStrips(acc, same);
      }, strip),
    ),
  };
}

const LEGACY_GRID_WIDTH_CELLS = 128;
const LEGACY_SYNC_CELLS = 126;
const LEGACY_CELL_PX = 4;

export function renderLegacyGridCapture(
  dataCells: CellGrid,
  options: { width?: number; cellsDrawn?: number } = {},
): LineCapture {
  const width = options.width ?? DEFAULT_WIDTH_PX;
  const dataRows = Math.max(1, Math.ceil(dataCells.length / LEGACY_GRID_WIDTH_CELLS));
  const grid: Cell[] = [
    ...Array.from({ length: LEGACY_SYNC_CELLS }, (_, i) => (i % 8) as Cell),
    Math.floor(dataRows / 8) as Cell,
    (dataRows % 8) as Cell,
    ...Array.from(
      { length: dataRows * LEGACY_GRID_WIDTH_CELLS },
      (_, i): Cell => dataCells[i] ?? 0,
    ),
  ];
  const strip = newStrip("top", width, DEFAULT_STRIP_ROWS);
  grid.slice(0, options.cellsDrawn ?? grid.length).forEach((cell, i) => {
    const col = i % LEGACY_GRID_WIDTH_CELLS;
    const row = Math.floor(i / LEGACY_GRID_WIDTH_CELLS);
    for (let dy = 0; dy < LEGACY_CELL_PX; dy += 1) {
      for (let dx = 0; dx < LEGACY_CELL_PX; dx += 1) {
        put(strip, col * LEGACY_CELL_PX + dx, row * LEGACY_CELL_PX + dy, cell);
      }
    }
  });
  return { strips: [strip, newStrip("bottom", width, DEFAULT_STRIP_ROWS)] };
}
