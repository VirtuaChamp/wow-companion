import type { Result } from "@wow-companion/contracts";

export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type CellGrid = readonly Cell[];

export const LINE_PITCH_PX = 2;
export const LINE_ROW_HEIGHT_PX = 2;
export const LINE_MAX_ROWS = 3;
export const LINE_COUNT_CELLS = 4;
export const LINE_ANCHOR: CellGrid = [7, 1, 6, 2, 5, 3, 7, 4, 6, 2, 5, 1];
export const LINE_ROW_OVERHEAD_CELLS = LINE_ANCHOR.length + LINE_COUNT_CELLS;
export const LINE_MAX_DATA_CELLS_PER_ROW = 8 ** LINE_COUNT_CELLS - 1;

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

function encodeCount(perRow: number): readonly Cell[] {
  const cells: Cell[] = [];
  let rest = perRow;
  for (let i = 0; i < LINE_COUNT_CELLS; i += 1) {
    cells.unshift((rest % 8) as Cell);
    rest = Math.floor(rest / 8);
  }
  return cells;
}

export function decodeCount(cells: readonly number[]): number {
  return cells.reduce((sum, cell) => sum * 8 + cell, 0);
}

function anchorMatches(cells: readonly number[]): boolean {
  return LINE_ANCHOR.every((cell, i) => cells[i] === cell);
}

export function layoutRows(dataCells: CellGrid, perRow: number): readonly CellGrid[] | undefined {
  if (perRow < 1 || perRow > LINE_MAX_DATA_CELLS_PER_ROW) {
    return undefined;
  }
  const rowCount = Math.max(1, Math.ceil(dataCells.length / perRow));
  if (rowCount > LINE_MAX_ROWS) {
    return undefined;
  }
  return Array.from({ length: rowCount }, (_, k) => {
    const data = Array.from({ length: perRow }, (_, i): Cell => dataCells[k * perRow + i] ?? 0);
    return [...LINE_ANCHOR, ...encodeCount(perRow), ...data];
  });
}

export function splitPaintedRows(painted: CellGrid): Result<readonly CellGrid[], "bad_frame"> {
  const rows: CellGrid[] = [];
  let offset = 0;
  let perRow: number | undefined;
  while (offset < painted.length) {
    if (rows.length === LINE_MAX_ROWS) {
      return { ok: false, error: "bad_frame" };
    }
    if (!anchorMatches(painted.slice(offset, offset + LINE_ANCHOR.length))) {
      return { ok: false, error: "bad_frame" };
    }
    const count = decodeCount(
      painted.slice(offset + LINE_ANCHOR.length, offset + LINE_ROW_OVERHEAD_CELLS),
    );
    if (count < 1 || (perRow !== undefined && count !== perRow)) {
      return { ok: false, error: "bad_frame" };
    }
    perRow = count;
    const rowEnd = offset + LINE_ROW_OVERHEAD_CELLS + count;
    if (rowEnd > painted.length) {
      return { ok: false, error: "bad_frame" };
    }
    rows.push(painted.slice(offset + LINE_ROW_OVERHEAD_CELLS, rowEnd));
    offset = rowEnd;
  }
  return rows.length === 0 ? { ok: false, error: "bad_frame" } : { ok: true, value: rows };
}
