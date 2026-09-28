import type {
  CompanionToGame,
  GameLink,
  GameToCompanion,
  LinkError,
  Result,
} from "@wow-companion/contracts";
import type { FrameBuffer } from "./codec.ts";
import { decodeGrid, reassemble } from "./codec.ts";
import type { FrameSource } from "./capture.ts";
import { GRID_SYNC_PATTERN_CELLS, syncRowCell } from "./grid.ts";
import { SLOT_COUNT, createSlotAllocator, messageByteSize, writeSlot } from "./slots.ts";
import type { SlotAllocator, SlotFs, SlotPaths } from "./slots.ts";

type Waiter = (result: IteratorResult<GameToCompanion>) => void;

function createAsyncQueue(): {
  push: (value: GameToCompanion) => void;
  iterable: AsyncIterable<GameToCompanion>;
} {
  const buffered: GameToCompanion[] = [];
  const waiters: Waiter[] = [];

  function push(value: GameToCompanion): void {
    const waiter = waiters.shift();
    if (waiter !== undefined) {
      waiter({ value, done: false });
      return;
    }
    buffered.push(value);
  }

  const iterable: AsyncIterable<GameToCompanion> = {
    [Symbol.asyncIterator](): AsyncIterator<GameToCompanion> {
      let pendingWaiter: Waiter | undefined;
      let ended = false;

      return {
        next(): Promise<IteratorResult<GameToCompanion>> {
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          const next = buffered.shift();
          if (next !== undefined) {
            return Promise.resolve({ value: next, done: false });
          }
          return new Promise((resolve) => {
            pendingWaiter = resolve;
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<GameToCompanion>> {
          ended = true;
          if (pendingWaiter !== undefined) {
            const index = waiters.indexOf(pendingWaiter);
            if (index !== -1) {
              waiters.splice(index, 1);
            }
            pendingWaiter({ value: undefined, done: true });
            pendingWaiter = undefined;
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return { push, iterable };
}

const ACKED_TYPES = new Set(["ask", "items", "cmd", "hello"]);

function isProgress(msg: CompanionToGame): msg is Extract<CompanionToGame, { t: "progress" }> {
  return msg.t === "progress";
}

export type ScreenLinkConfig = {
  frameSource: FrameSource;
  fs: SlotFs;
  paths: SlotPaths;
  validWav: Uint8Array;
  emptyWav: Uint8Array;
  slotCount?: number;
  pollIntervalMs?: number;
  autopoll?: boolean;
  onCaptureError?: (error: unknown) => void;
  slotReadMs?: number;
  connectedTimeoutMs?: number;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type ScreenLink = GameLink & {
  close(): void;
  idle(): Promise<void>;
  poll(): Promise<void>;
};

const DEFAULT_POLL_INTERVAL_MS = 150;
const DEFAULT_SLOT_READ_MS = 250;
const DEFAULT_CONNECTED_TIMEOUT_MS = 5000;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createScreenLink(config: ScreenLinkConfig): ScreenLink {
  const slotCount = config.slotCount ?? SLOT_COUNT;
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const slotReadMs = config.slotReadMs ?? DEFAULT_SLOT_READ_MS;
  const connectedTimeoutMs = config.connectedTimeoutMs ?? DEFAULT_CONNECTED_TIMEOUT_MS;
  const delay = config.delay ?? defaultDelay;
  const now = config.now ?? (() => Date.now());

  const queue = createAsyncQueue();
  let frameBuf: FrameBuffer;
  let helloSeen = false;
  let build: string | undefined;
  let session = "";
  let badFrames = 0;
  let lastFrameAt: number | undefined;
  const allocator: SlotAllocator = createSlotAllocator(slotCount);
  const pending: CompanionToGame[] = [];
  let flushing: Promise<void> | undefined;
  let closed = false;

  async function resetSignalsFrom(startIndex: number): Promise<void> {
    const writes: Promise<void>[] = [];
    for (let i = startIndex; i < slotCount; i += 1) {
      writes.push(
        config.fs.writeFile(config.paths.signalFile(i), config.emptyWav).catch((error) => {
          config.onCaptureError?.(error);
        }),
      );
    }
    await Promise.all(writes);
  }

  function scheduleFlush(): void {
    if (flushing !== undefined || pending.length === 0 || closed || !helloSeen) {
      return;
    }
    flushing = Promise.resolve()
      .then(() => flushOnce())
      .then(() => (closed ? undefined : delay(slotReadMs)))
      .finally(() => {
        flushing = undefined;
        if (pending.length > 0) {
          scheduleFlush();
        }
      });
  }

  async function flushOnce(): Promise<void> {
    const batch: CompanionToGame[] = [];
    let batchBytes = 0;
    while (pending.length > 0) {
      const next = pending[0] as CompanionToGame;
      const size = messageByteSize(session, next);
      if (batch.length > 0 && batchBytes + size > 64 * 1024) {
        break;
      }
      batch.push(next);
      batchBytes += size;
      pending.shift();
    }
    if (batch.length === 0) {
      return;
    }
    let result;
    try {
      result = await writeSlot(config.fs, config.paths, allocator, session, batch, config.validWav);
    } catch (error) {
      pending.unshift(...batch);
      config.onCaptureError?.(error);
      return;
    }
    if (!result.ok) {
      if (result.error === "too_large") {
        config.onCaptureError?.(new Error("slots.write: message dropped, exceeds 64 KB"));
        return;
      }
      pending.unshift(...batch);
      config.onCaptureError?.(new Error(`slots.write: ${result.error}`));
      return;
    }
  }

  async function handleHello(
    msg: Extract<GameToCompanion, { t: "hello" }>,
    frameSeq: number,
  ): Promise<void> {
    build = msg.build;
    const isNewSession = msg.session !== session;
    if (isNewSession) {
      frameBuf = undefined;
    }
    session = msg.session;
    helloSeen = true;
    const targetIndex = Math.max(0, msg.slot - 1);
    const isAheadOfAllocator = targetIndex > allocator.position();
    if (isNewSession || isAheadOfAllocator) {
      allocator.setNext(targetIndex);
      await resetSignalsFrom(targetIndex);
    }
    pending.unshift({ t: "ack", seq: frameSeq });
    scheduleFlush();
  }

  async function pollOnce(): Promise<void> {
    let grid;
    try {
      grid = await config.frameSource.next();
    } catch (error) {
      config.onCaptureError?.(error);
      return;
    }
    if (grid === undefined) {
      return;
    }
    let sync = true;
    for (let i = 0; i < GRID_SYNC_PATTERN_CELLS; i += 1) {
      if (grid[i] !== syncRowCell(i)) {
        sync = false;
        break;
      }
    }
    if (!sync) {
      return;
    }
    const frame = decodeGrid(grid);
    if (!frame.ok) {
      badFrames += 1;
      return;
    }
    lastFrameAt = now();
    const frameSeq = frame.value.seq;
    const { buf, message } = reassemble(frameBuf, frame.value);
    frameBuf = buf;
    if (message === undefined) {
      return;
    }
    if (!message.ok) {
      badFrames += 1;
      return;
    }
    const msg = message.value;
    if (msg.t === "hello") {
      await handleHello(msg, frameSeq);
    } else if (ACKED_TYPES.has(msg.t)) {
      pending.push({ t: "ack", seq: frameSeq });
      scheduleFlush();
    }
    queue.push(msg);
  }

  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleNextPoll(): void {
    if (closed) {
      return;
    }
    pollTimer = setTimeout(() => {
      void pollOnce().finally(scheduleNextPoll);
    }, pollIntervalMs);
  }
  if (config.autopoll ?? true) {
    scheduleNextPoll();
  }

  return {
    messages(): AsyncIterable<GameToCompanion> {
      return queue.iterable;
    },
    send(msg: CompanionToGame): Result<void, LinkError> {
      const size = messageByteSize(session, msg);
      if (size > 64 * 1024) {
        return { ok: false, error: "too_large" };
      }
      if (allocator.left() === 0) {
        return { ok: false, error: "slots_exhausted" };
      }
      if (isProgress(msg)) {
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          const entry = pending[i];
          if (entry !== undefined && isProgress(entry) && entry.id === msg.id) {
            pending.splice(i, 1);
          }
        }
      }
      pending.push(msg);
      scheduleFlush();
      return { ok: true, value: undefined };
    },
    status(): { connected: boolean; build?: string; slotsLeft: number; badFrames: number } {
      const connected =
        helloSeen && lastFrameAt !== undefined && now() - lastFrameAt <= connectedTimeoutMs;
      return build === undefined
        ? { connected, slotsLeft: allocator.left(), badFrames }
        : { connected, build, slotsLeft: allocator.left(), badFrames };
    },
    close(): void {
      closed = true;
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer);
      }
      config.frameSource.close();
    },
    async idle(): Promise<void> {
      while (flushing !== undefined || (pending.length > 0 && helloSeen)) {
        await flushing;
        await Promise.resolve();
      }
    },
    poll(): Promise<void> {
      return pollOnce();
    },
  };
}
