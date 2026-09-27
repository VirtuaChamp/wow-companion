import type { Result } from "@wow-companion/contracts";

export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type CellGrid = readonly Cell[];

export const GRID_WIDTH = 128;
export const GRID_SYNC_PATTERN_CELLS = 126;
export const GRID_ROW_COUNT_CELLS = 2;
export const GRID_MAX_DATA_ROWS = 63;

const CELL_LINE_PATTERN = /^[0-7]$/;

function isCell(value: number): value is Cell {
  return Number.isInteger(value) && value >= 0 && value <= 7;
}

export function parseCellGridFile(text: string): Result<CellGrid, "bad_frame"> {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const cells: Cell[] = [];
  for (const line of lines) {
    if (!CELL_LINE_PATTERN.test(line)) {
      return { ok: false, error: "bad_frame" };
    }
    const parsed = Number(line);
    if (!isCell(parsed)) {
      return { ok: false, error: "bad_frame" };
    }
    cells.push(parsed);
  }
  return { ok: true, value: cells };
}

export function syncRowCell(index: number): Cell {
  return (index % 8) as Cell;
}

export function encodeRowCount(rowCount: number): readonly [Cell, Cell] {
  return [Math.floor(rowCount / 8) as Cell, (rowCount % 8) as Cell];
}

export function decodeRowCount(high: number, low: number): number {
  return high * 8 + low;
}
