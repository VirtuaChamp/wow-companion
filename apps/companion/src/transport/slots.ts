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
  position(): number;
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
    position(): number {
      return used;
    },
  };
}

export type SlotFs = {
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
};

export type SlotPaths = {
  addonDeliverFile(slotIndex: number): string;
  signalFile(slotIndex: number): string;
};

const CONTROL_GONE_FILE_NAME = "ctl-gone.wav";

function tempDeliverFile(target: string): string {
  return `${target}.tmp`;
}

export function controlGoneFile(paths: SlotPaths): string {
  return paths.signalFile(0).replace(/[^/\\]+$/, CONTROL_GONE_FILE_NAME);
}

export async function writeSlot(
  fs: SlotFs,
  paths: SlotPaths,
  allocator: SlotAllocator,
  session: string,
  msgs: readonly CompanionToGame[],
): Promise<Result<number, LinkError>> {
  const content = encodeSlotContent(session, msgs);
  if (!content.ok) {
    return content;
  }
  if (allocator.left() === 0) {
    return { ok: false, error: "slots_exhausted" };
  }
  const slotIndex = allocator.position();
  const target = paths.addonDeliverFile(slotIndex);
  const temp = tempDeliverFile(target);
  await fs.writeFile(temp, content.value);
  await fs.rename(temp, target);
  await fs.remove(paths.signalFile(slotIndex));
  allocator.next();
  return { ok: true, value: slotIndex };
}

export const EMPTY_WAV: Uint8Array = new Uint8Array(0);
