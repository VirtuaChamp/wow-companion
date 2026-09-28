import { parseGameToCompanion } from "@wow-companion/contracts";
import type { GameToCompanion, Result } from "@wow-companion/contracts";
import type { CellGrid } from "./grid.ts";
import {
  GRID_ROW_COUNT_CELLS,
  GRID_SYNC_PATTERN_CELLS,
  GRID_WIDTH,
  decodeRowCount,
  syncRowCell,
} from "./grid.ts";

const CODEC_VERSION = 1;
const CODEC_MAGIC = [0x57, 0x43] as const;
const HEADER_LEN = 9;
const CRC_LEN = 2;
const FRAME_PAYLOAD_MAX = 1024;
const TOTAL_PAYLOAD_MAX = 16384;
const HEADER_CELLS = Math.ceil((HEADER_LEN * 8) / 3);

export type Frame = {
  version: number;
  seq: number;
  total: number;
  index: number;
  payload: Uint8Array;
};

export type FrameBuffer =
  | { seq: number; total: number; parts: readonly (Uint8Array | undefined)[]; complete: false }
  | { seq: number; complete: true }
  | undefined;

function bad(): Result<Frame, "bad_frame"> {
  return { ok: false, error: "bad_frame" };
}

export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc = (crc ^ (b << 8)) & 0xffff;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function cellsToBits(cells: CellGrid): number[] {
  const bits: number[] = [];
  for (const cell of cells) {
    bits.push((cell >> 2) & 1, (cell >> 1) & 1, cell & 1);
  }
  return bits;
}

function bitsToBytes(bits: readonly number[]): Uint8Array {
  const byteCount = Math.floor(bits.length / 8);
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i += 1) {
    let value = 0;
    for (let b = 0; b < 8; b += 1) {
      value = (value << 1) | (bits[i * 8 + b] ?? 0);
    }
    bytes[i] = value;
  }
  return bytes;
}

export function decodeGrid(grid: CellGrid): Result<Frame, "bad_frame"> {
  if (grid.length < GRID_WIDTH) {
    return bad();
  }
  for (let i = 0; i < GRID_SYNC_PATTERN_CELLS; i += 1) {
    if (grid[i] !== syncRowCell(i)) {
      return bad();
    }
  }
  const rowCount = decodeRowCount(
    grid[GRID_SYNC_PATTERN_CELLS] ?? 0,
    grid[GRID_SYNC_PATTERN_CELLS + GRID_ROW_COUNT_CELLS - 1] ?? 0,
  );
  const dataCells = grid.slice(GRID_WIDTH, GRID_WIDTH + rowCount * GRID_WIDTH);
  if (dataCells.length < rowCount * GRID_WIDTH) {
    return bad();
  }
  const headerBits = cellsToBits(dataCells.slice(0, HEADER_CELLS)).slice(0, HEADER_LEN * 8);
  const headerBytes = bitsToBytes(headerBits);
  if (headerBytes[0] !== CODEC_MAGIC[0] || headerBytes[1] !== CODEC_MAGIC[1]) {
    return bad();
  }
  const version = headerBytes[2] ?? 0;
  const seq = ((headerBytes[3] ?? 0) << 8) | (headerBytes[4] ?? 0);
  const total = headerBytes[5] ?? 0;
  const index = headerBytes[6] ?? 0;
  const length = ((headerBytes[7] ?? 0) << 8) | (headerBytes[8] ?? 0);
  if (total === 0 || index >= total || length > FRAME_PAYLOAD_MAX) {
    return bad();
  }
  const frameByteLen = HEADER_LEN + length + CRC_LEN;
  const requiredBits = frameByteLen * 8;
  const requiredCells = Math.ceil(requiredBits / 3);
  if (Math.ceil(requiredCells / GRID_WIDTH) !== rowCount) {
    return bad();
  }
  const allBits = cellsToBits(dataCells);
  const trailing = allBits.slice(requiredBits);
  if (trailing.some((bit) => bit !== 0)) {
    return bad();
  }
  const frameBytes = bitsToBytes(allBits.slice(0, requiredBits));
  const payload = frameBytes.slice(HEADER_LEN, HEADER_LEN + length);
  const crcBytes = frameBytes.slice(HEADER_LEN + length, HEADER_LEN + length + CRC_LEN);
  const crcExpected = ((crcBytes[0] ?? 0) << 8) | (crcBytes[1] ?? 0);
  const crcActual = crc16(frameBytes.slice(0, HEADER_LEN + length));
  if (crcExpected !== crcActual) {
    return bad();
  }
  return { ok: true, value: { version, seq, total, index, payload } };
}

function decodePayload(payload: Uint8Array): Result<GameToCompanion, "bad_frame" | "too_large"> {
  if (payload.length > TOTAL_PAYLOAD_MAX) {
    return { ok: false, error: "too_large" };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch {
    return { ok: false, error: "bad_frame" };
  }
  return parseGameToCompanion(json);
}

export function reassemble(
  buf: FrameBuffer,
  f: Frame,
): { buf: FrameBuffer; message?: Result<GameToCompanion, "bad_frame" | "too_large"> } {
  if (f.version !== CODEC_VERSION || f.total === 0 || f.index >= f.total) {
    return { buf: undefined, message: { ok: false, error: "bad_frame" } };
  }
  if (buf !== undefined && buf.seq === f.seq) {
    if (buf.complete) {
      return { buf };
    }
    if (buf.total !== f.total) {
      return { buf: undefined, message: { ok: false, error: "bad_frame" } };
    }
  }
  if (f.total === 1) {
    return { buf: { seq: f.seq, complete: true }, message: decodePayload(f.payload) };
  }
  const active =
    buf !== undefined && buf.seq === f.seq && !buf.complete
      ? buf
      : {
          seq: f.seq,
          total: f.total,
          parts: Array.from<Uint8Array | undefined>({ length: f.total }),
          complete: false as const,
        };
  if (active.parts[f.index] !== undefined) {
    return { buf: active };
  }
  const parts = active.parts.slice();
  parts[f.index] = f.payload;
  let knownLength = 0;
  for (const part of parts) {
    if (part !== undefined) {
      knownLength += part.length;
    }
  }
  if (knownLength > TOTAL_PAYLOAD_MAX) {
    return { buf: undefined, message: { ok: false, error: "too_large" } };
  }
  if (parts.some((part) => part === undefined)) {
    return { buf: { seq: f.seq, total: f.total, parts, complete: false } };
  }
  const combined = new Uint8Array(knownLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part as Uint8Array, offset);
    offset += (part as Uint8Array).length;
  }
  return { buf: { seq: f.seq, complete: true }, message: decodePayload(combined) };
}
