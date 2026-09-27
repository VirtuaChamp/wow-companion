import type { CompanionToGame, LinkError, Result } from "@wow-companion/contracts";
import { encodeLuaValue } from "./lua-literal.ts";

export const SLOT_COUNT = 200;
export const SLOT_BYTE_CAP = 64 * 1024;
export const SLOT_WARNING_THRESHOLD = 20;

export function slotAddonName(index: number): string {
  return `WoWCompanion_R${String(index + 1).padStart(3, "0")}`;
}

export function slotSignalFileName(index: number): string {
  return `${String(index + 1).padStart(3, "0")}.wav`;
}

export function encodeSlotContent(
  session: string,
  msgs: readonly CompanionToGame[],
): Result<string, "too_large"> {
  const sessionLiteral = encodeLuaValue(session);
  const literal = encodeLuaValue(msgs);
  const content = `WoWCompanion_Deliver(${sessionLiteral}, ${literal})`;
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > SLOT_BYTE_CAP) {
    return { ok: false, error: "too_large" };
  }
  return { ok: true, value: content };
}

export function messageByteSize(session: string, msg: CompanionToGame): number {
  const encoded = encodeSlotContent(session, [msg]);
  return encoded.ok ? Buffer.byteLength(encoded.value, "utf-8") : Number.POSITIVE_INFINITY;
}

export type SlotAllocator = {
  next(): Result<number, "slots_exhausted">;
  left(): number;
  reset(): void;
  setNext(index: number): void;
};

export function createSlotAllocator(slotCount: number = SLOT_COUNT): SlotAllocator {
  let used = 0;
  return {
    next(): Result<number, "slots_exhausted"> {
      if (used >= slotCount) {
        return { ok: false, error: "slots_exhausted" };
      }
      const index = used;
      used += 1;
      return { ok: true, value: index };
    },
    left(): number {
      return Math.max(0, slotCount - used);
    },
    reset(): void {
      used = 0;
    },
    setNext(index: number): void {
      used = Math.max(0, Math.min(index, slotCount));
    },
  };
}

export type SlotFs = {
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
};

export type SlotPaths = {
  addonDeliverFile(slotIndex: number): string;
  signalFile(slotIndex: number): string;
};

export async function writeSlot(
  fs: SlotFs,
  paths: SlotPaths,
  allocator: SlotAllocator,
  session: string,
  msgs: readonly CompanionToGame[],
  validWav: Uint8Array,
): Promise<Result<number, LinkError>> {
  const content = encodeSlotContent(session, msgs);
  if (!content.ok) {
    return content;
  }
  const slot = allocator.next();
  if (!slot.ok) {
    return slot;
  }
  await fs.writeFile(paths.addonDeliverFile(slot.value), content.value);
  await fs.writeFile(paths.signalFile(slot.value), validWav);
  return { ok: true, value: slot.value };
}

function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export function buildSilentWav(): Uint8Array {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  writeUint32LE(view, 4, 36 + dataSize);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  writeUint32LE(view, 16, 16);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  writeUint32LE(view, 24, sampleRate);
  writeUint32LE(view, 28, byteRate);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  writeUint32LE(view, 40, dataSize);
  return new Uint8Array(buffer);
}

export const SILENT_VALID_WAV: Uint8Array = buildSilentWav();
export const EMPTY_WAV: Uint8Array = new Uint8Array(0);
