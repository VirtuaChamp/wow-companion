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

type WrittenEntry = { slot: number; msg: CompanionToGame };

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
const SESSION_LENGTH = 17;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAck(msg: CompanionToGame): msg is Extract<CompanionToGame, { t: "ack" }> {
  return msg.t === "ack";
}

function withoutSupersededProgress(msgs: readonly CompanionToGame[]): CompanionToGame[] {
  return msgs.filter(
    (msg, index) =>
      !isProgress(msg) ||
      !msgs.some(
        (later, laterIndex) => laterIndex > index && isProgress(later) && later.id === msg.id,
      ),
  );
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
  let held: CompanionToGame[] = [];
  let written: WrittenEntry[] = [];
  let awaitingPostAckFrame = false;
  let resyncing = false;
  let emptiedAfterFailure: { session: string; floor: number } | undefined;
  let exhaustedUntilResync = false;
  let flushing: Promise<void> | undefined;
  let closed = false;

  function sizingSession(): string {
    return session.length >= SESSION_LENGTH ? session : "x".repeat(SESSION_LENGTH);
  }

  async function resetSignalsFrom(startIndex: number): Promise<boolean> {
    let allEmptied = true;
    const writes: Promise<void>[] = [];
    for (let i = startIndex; i < slotCount; i += 1) {
      writes.push(
        config.fs.writeFile(config.paths.signalFile(i), config.emptyWav).catch((error) => {
          allEmptied = false;
          config.onCaptureError?.(error);
        }),
      );
    }
    await Promise.all(writes);
    return allEmptied;
  }

  async function resetSignalsUntilEmpty(
    startIndex: number,
  ): Promise<"clean" | "recovered" | "closed"> {
    let failed = false;
    while (!closed) {
      if (await resetSignalsFrom(startIndex)) {
        return failed ? "recovered" : "clean";
      }
      failed = true;
      await delay(slotReadMs);
    }
    return "closed";
  }

  async function firstFreeSlotFrom(startIndex: number): Promise<number | undefined> {
    let index = startIndex;
    while (index < slotCount) {
      let signal: Uint8Array | undefined;
      try {
        signal = await config.fs.readFile(config.paths.signalFile(index));
      } catch (error) {
        config.onCaptureError?.(error);
        return undefined;
      }
      if (signal === undefined || signal.length === 0) {
        return index;
      }
      index += 1;
    }
    return slotCount;
  }

  async function firstFreeSlotUntilKnown(startIndex: number): Promise<number | undefined> {
    while (!closed) {
      const index = await firstFreeSlotFrom(startIndex);
      if (index !== undefined) {
        return index;
      }
      await delay(slotReadMs);
    }
    return undefined;
  }

  function scheduleFlush(): void {
    if (
      flushing !== undefined ||
      pending.length === 0 ||
      closed ||
      !helloSeen ||
      resyncing ||
      exhaustedUntilResync
    ) {
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
      exhaustedUntilResync = true;
      config.onCaptureError?.(new Error(`slots.write: ${result.error}`));
      return;
    }
    for (const m of batch) {
      if (!isAck(m)) {
        written.push({ slot: result.value, msg: m });
      }
    }
  }

  function releaseHeld(): void {
    awaitingPostAckFrame = false;
    if (held.length > 0) {
      pending.push(...held);
      held = [];
    }
  }

  async function handleHello(
    msg: Extract<GameToCompanion, { t: "hello" }>,
    frameSeq: number,
  ): Promise<void> {
    const hadSession = session !== "";
    const isNewSession = msg.session !== session;
    const targetIndex = Math.max(0, msg.slot - 1);
    const needsResync =
      isNewSession || targetIndex > allocator.position() || emptiedAfterFailure !== undefined;
    const isAgain = msg.again === true;
    const emptied = emptiedAfterFailure;
    if (emptied !== undefined && msg.session === emptied.session && targetIndex < emptied.floor) {
      return;
    }
    const alreadyEmptied =
      emptied !== undefined && msg.session === emptied.session && targetIndex >= emptied.floor;

    if (!needsResync) {
      written = written.filter((entry) => entry.slot >= targetIndex);
      build = msg.build;
      helloSeen = true;
      if (!isAgain) {
        pending.unshift({ t: "ack", seq: frameSeq });
        scheduleFlush();
      }
      return;
    }

    resyncing = true;
    while (flushing !== undefined) {
      await flushing;
    }

    const requeued = isNewSession ? written.map((entry) => entry.msg) : [];
    written = isNewSession ? [] : written.filter((entry) => entry.slot >= targetIndex);
    const carriedAcks = isNewSession ? [] : pending.filter(isAck);
    const carriedOthers = pending.filter((m) => !isAck(m));
    pending.length = 0;
    pending.push(...carriedAcks);
    held = withoutSupersededProgress([...held, ...requeued, ...carriedOthers]);

    let nextIndex: number | undefined;
    if (alreadyEmptied) {
      nextIndex = targetIndex;
    } else if (hadSession) {
      emptiedAfterFailure = undefined;
      const outcome = await resetSignalsUntilEmpty(targetIndex);
      if (outcome === "closed") {
        return;
      }
      if (outcome === "recovered") {
        emptiedAfterFailure = { session: msg.session, floor: targetIndex };
        frameBuf = isAgain ? { seq: frameSeq, complete: true } : undefined;
        return;
      }
      nextIndex = targetIndex;
    } else {
      nextIndex = await firstFreeSlotUntilKnown(targetIndex);
    }
    if (nextIndex === undefined) {
      return;
    }
    emptiedAfterFailure = undefined;

    build = msg.build;
    session = msg.session;
    helloSeen = true;
    allocator.setNext(nextIndex);
    exhaustedUntilResync = false;
    if (isNewSession) {
      frameBuf = { seq: frameSeq, complete: true };
    }
    if (isAgain) {
      releaseHeld();
    } else {
      pending.push({ t: "ack", seq: frameSeq });
      awaitingPostAckFrame = true;
    }
    resyncing = false;
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
    const showsAckWasRead = awaitingPostAckFrame && !(msg.t === "hello" && msg.again !== true);
    if (msg.t === "hello") {
      await handleHello(msg, frameSeq);
    } else if (ACKED_TYPES.has(msg.t)) {
      pending.push({ t: "ack", seq: frameSeq });
      scheduleFlush();
    }
    if (showsAckWasRead) {
      releaseHeld();
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
      const size = messageByteSize(sizingSession(), msg);
      if (size > 64 * 1024) {
        return { ok: false, error: "too_large" };
      }
      if (allocator.left() === 0) {
        return { ok: false, error: "slots_exhausted" };
      }
      const target = resyncing || awaitingPostAckFrame ? held : pending;
      if (isProgress(msg)) {
        for (let i = target.length - 1; i >= 0; i -= 1) {
          const entry = target[i];
          if (entry !== undefined && isProgress(entry) && entry.id === msg.id) {
            target.splice(i, 1);
          }
        }
      }
      target.push(msg);
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
      while (
        flushing !== undefined ||
        (pending.length > 0 && helloSeen && !exhaustedUntilResync && !resyncing)
      ) {
        await flushing;
        await Promise.resolve();
      }
    },
    poll(): Promise<void> {
      return pollOnce();
    },
  };
}
