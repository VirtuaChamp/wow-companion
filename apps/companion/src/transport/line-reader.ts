import type { Result } from "@wow-companion/contracts";
import { decodeRows, hasMagic } from "./codec.ts";
import type { Frame } from "./codec.ts";
import type { Cell, CellGrid } from "./grid.ts";
import {
  LINE_ANCHOR,
  LINE_MAX_ROWS,
  LINE_PITCH_PX,
  LINE_ROW_HEIGHT_PX,
  LINE_ROW_OVERHEAD_CELLS,
  LINE_COUNT_CELLS,
  LINE_MAX_DATA_CELLS_PER_ROW,
  decodeCount,
} from "./grid.ts";

export type Strip = {
  edge: "top" | "bottom";
  width: number;
  rows: number;
  stride: number;
  pixels: Uint8Array;
};

export type LineCapture = { strips: readonly Strip[] };

type LineReading = {
  seen: boolean;
  legacyGrid?: true;
  frame?: Result<Frame, "bad_frame">;
};

type RowVotes = { votes: Uint16Array; first: Uint8Array };

type LineSample = {
  at: string;
  edge: Strip["edge"];
  perRow: number;
  rows: readonly RowVotes[];
};

const SAME_FRAME_MAX_MISMATCHED_CELLS = 2;
const CELL_CLASSES = 8;
const LEGACY_CELL_PX = 4;
const LEGACY_GRID_WIDTH_CELLS = 128;
const LEGACY_SYNC_CELLS = 126;
const LEGACY_MAX_DATA_ROWS = 63;

export function classifyCell(r: number, g: number, b: number): Cell {
  return ((r >= 128 ? 4 : 0) + (g >= 128 ? 2 : 0) + (b >= 128 ? 1 : 0)) as Cell;
}

function classifyRow(strip: Strip, y: number): Uint8Array {
  const screenY = strip.edge === "top" ? y : strip.rows - 1 - y;
  const classes = new Uint8Array(strip.width);
  const base = screenY * strip.stride;
  for (let x = 0; x < strip.width; x += 1) {
    const offset = base + x * 3;
    classes[x] = classifyCell(
      strip.pixels[offset + 2] ?? 0,
      strip.pixels[offset + 1] ?? 0,
      strip.pixels[offset] ?? 0,
    );
  }
  return classes;
}

function anchorAt(classes: Uint8Array, x0: number): boolean {
  return LINE_ANCHOR.every((cell, i) => classes[x0 + i * LINE_PITCH_PX] === cell);
}

function anchorPositions(classes: Uint8Array): readonly number[] {
  const last = (LINE_ANCHOR.length - 1) * LINE_PITCH_PX;
  const found: number[] = [];
  for (let x0 = 0; x0 + last < classes.length; x0 += 1) {
    if (classes[x0] === LINE_ANCHOR[0] && anchorAt(classes, x0)) {
      found.push(x0);
    }
  }
  return found;
}

function voteOf(values: readonly number[]): number {
  const counts = Array.from({ length: CELL_CLASSES }, () => 0);
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  let best = values[0] ?? 0;
  for (let v = 0; v < CELL_CLASSES; v += 1) {
    if ((counts[v] ?? 0) > (counts[best] ?? 0)) {
      best = v;
    }
  }
  return best;
}

function sampleRow(
  sampleRows: readonly Uint8Array[],
  x0: number,
  width: number,
  perRow: number | undefined,
): { perRow: number; row: RowVotes } | undefined {
  const countCells = Array.from({ length: LINE_COUNT_CELLS }, (_, j) =>
    voteOf(sampleRows.map((cls) => cls[x0 + (LINE_ANCHOR.length + j) * LINE_PITCH_PX] ?? 0)),
  );
  const count = decodeCount(countCells);
  if (count < 1 || count > LINE_MAX_DATA_CELLS_PER_ROW) {
    return undefined;
  }
  if (perRow !== undefined && count !== perRow) {
    return undefined;
  }
  if (x0 + (LINE_ROW_OVERHEAD_CELLS + count - 1) * LINE_PITCH_PX >= width) {
    return undefined;
  }
  const votes = new Uint16Array(count * CELL_CLASSES);
  const first = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const x = x0 + (LINE_ROW_OVERHEAD_CELLS + i) * LINE_PITCH_PX;
    sampleRows.forEach((cls, s) => {
      const value = cls[x] ?? 0;
      votes[i * CELL_CLASSES + value] = (votes[i * CELL_CLASSES + value] ?? 0) + 1;
      if (s === 0) {
        first[i] = value;
      }
    });
  }
  return { perRow: count, row: { votes, first } };
}

function sampleAt(
  strip: Strip,
  classes: readonly Uint8Array[],
  y0: number,
  x0: number,
): LineSample {
  const rows: RowVotes[] = [];
  let perRow: number | undefined;
  for (let k = 0; k < LINE_MAX_ROWS; k += 1) {
    const top = y0 + k * LINE_ROW_HEIGHT_PX;
    if (top + LINE_ROW_HEIGHT_PX > strip.rows) {
      break;
    }
    const sampleRows = classes.slice(top, top + LINE_ROW_HEIGHT_PX);
    if (!anchorAt(sampleRows[0] as Uint8Array, x0)) {
      break;
    }
    const sampled = sampleRow(sampleRows, x0, strip.width, perRow);
    if (sampled === undefined) {
      break;
    }
    perRow = sampled.perRow;
    rows.push(sampled.row);
  }
  return {
    at: `${strip.edge}:${String(y0)}:${String(x0)}`,
    edge: strip.edge,
    perRow: perRow ?? 0,
    rows,
  };
}

function candidatesOf(strip: Strip): readonly LineSample[] {
  const classes = Array.from({ length: strip.rows }, (_, y) => classifyRow(strip, y));
  const positions = classes.map(anchorPositions);
  return positions.flatMap((xs, y0) =>
    xs
      .filter((x0) => positions[y0 - 1]?.includes(x0) !== true)
      .map((x0) => sampleAt(strip, classes, y0, x0)),
  );
}

function rankOf(sample: LineSample): number {
  if (sample.rows.length === 0) {
    return 0;
  }
  const firstRow = majority(sample.rows[0] as RowVotes);
  return hasMagic(firstRow) ? 2 : 1;
}

function locate(
  capture: LineCapture,
  lockedEdge: Strip["edge"] | undefined,
): readonly LineSample[] {
  const ordered = [...capture.strips].sort(
    (a, b) => Number(b.edge === lockedEdge) - Number(a.edge === lockedEdge),
  );
  return ordered.flatMap(candidatesOf);
}

function looksLikeLegacyGrid(capture: LineCapture): boolean {
  const top = capture.strips.find((strip) => strip.edge === "top");
  if (top === undefined || top.rows < LEGACY_CELL_PX) {
    return false;
  }
  if (top.width < LEGACY_GRID_WIDTH_CELLS * LEGACY_CELL_PX) {
    return false;
  }
  const classes = Array.from({ length: LEGACY_CELL_PX }, (_, y) => classifyRow(top, y));
  const blocks = Array.from({ length: LEGACY_GRID_WIDTH_CELLS }, (_, i) => {
    const value = classes[0]?.[i * LEGACY_CELL_PX] ?? 0;
    const solid = classes.every((row) =>
      Array.from({ length: LEGACY_CELL_PX }, (_, dx) => row[i * LEGACY_CELL_PX + dx]).every(
        (cell) => cell === value,
      ),
    );
    return solid ? value : undefined;
  });
  const syncMatches = blocks
    .slice(0, LEGACY_SYNC_CELLS)
    .every((value, i) => value === i % CELL_CLASSES);
  const high = blocks[LEGACY_SYNC_CELLS];
  const low = blocks[LEGACY_SYNC_CELLS + 1];
  if (!syncMatches || high === undefined || low === undefined) {
    return false;
  }
  const dataRows = high * CELL_CLASSES + low;
  return dataRows >= 1 && dataRows <= LEGACY_MAX_DATA_ROWS;
}

function majority(row: RowVotes): CellGrid {
  const cells: Cell[] = [];
  for (let i = 0; i < row.first.length; i += 1) {
    let best = row.first[i] ?? 0;
    for (let v = 0; v < CELL_CLASSES; v += 1) {
      if ((row.votes[i * CELL_CLASSES + v] ?? 0) > (row.votes[i * CELL_CLASSES + best] ?? 0)) {
        best = v;
      }
    }
    cells.push(best as Cell);
  }
  return cells;
}

function decodeSample(sample: LineSample): Result<Frame, "bad_frame"> {
  return decodeRows(sample.rows.map(majority));
}

function lastContentCell(cells: readonly number[]): number {
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    if (cells[i] !== 0) {
      return i;
    }
  }
  return -1;
}

function sameFrame(acc: LineSample, next: LineSample): boolean {
  if (
    acc.edge !== next.edge ||
    acc.perRow !== next.perRow ||
    acc.rows.length !== next.rows.length
  ) {
    return false;
  }
  const settled = acc.rows.flatMap((row) => [...majority(row)]);
  const latest = next.rows.flatMap((row) => [...row.first]);
  const contentEnd = Math.max(lastContentCell(settled), lastContentCell(latest));
  let mismatched = 0;
  for (let i = 0; i <= contentEnd; i += 1) {
    if (settled[i] !== latest[i]) {
      mismatched += 1;
    }
  }
  return mismatched <= SAME_FRAME_MAX_MISMATCHED_CELLS;
}

function mergeSamples(acc: LineSample, next: LineSample): LineSample {
  const rows = acc.rows.map((row, k) => {
    const incoming = next.rows[k] as RowVotes;
    const votes = new Uint16Array(row.votes.length);
    for (let i = 0; i < votes.length; i += 1) {
      votes[i] = (row.votes[i] ?? 0) + (incoming.votes[i] ?? 0);
    }
    return { votes, first: incoming.first };
  });
  return { ...acc, rows };
}

export type LineReader = { feed(capture: LineCapture): LineReading };

function decodeBest(tracks: readonly LineSample[]): Result<Frame, "bad_frame"> {
  const ranked = [...tracks].sort((a, b) => rankOf(b) - rankOf(a));
  const decoded = ranked.map(decodeSample);
  return decoded.find((frame) => frame.ok) ?? decoded[0] ?? { ok: false, error: "bad_frame" };
}

export function createLineReader(): LineReader {
  let tracks: readonly LineSample[] = [];
  let lockedEdge: Strip["edge"] | undefined;
  return {
    feed(capture: LineCapture): LineReading {
      const candidates = locate(capture, lockedEdge);
      if (candidates.length === 0) {
        tracks = [];
        return looksLikeLegacyGrid(capture) ? { seen: false, legacyGrid: true } : { seen: false };
      }
      const clean = candidates
        .map((sample) => ({ sample, frame: decodeSample(sample) }))
        .find((decoded) => decoded.frame.ok);
      if (clean !== undefined) {
        lockedEdge = clean.sample.edge;
        tracks = [clean.sample];
        return { seen: true, frame: clean.frame };
      }
      tracks = candidates.map((candidate) => {
        const earlier = tracks.find((track) => track.at === candidate.at);
        return earlier !== undefined && sameFrame(earlier, candidate)
          ? mergeSamples(earlier, candidate)
          : candidate;
      });
      const frame = decodeBest(tracks);
      if (frame.ok) {
        const winner = tracks.find((track) => decodeSample(track).ok);
        lockedEdge = winner?.edge ?? lockedEdge;
        tracks = winner === undefined ? tracks : [winner];
      }
      return { seen: true, frame };
    },
  };
}
