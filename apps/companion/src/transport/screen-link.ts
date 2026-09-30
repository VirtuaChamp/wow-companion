import type {
  CompanionToGame,
  GameLink,
  GameToCompanion,
  LinkError,
  Result,
} from "@wow-companion/contracts";
import type { FrameBuffer } from "./codec.ts";
import { CODEC_VERSION, reassemble } from "./codec.ts";
import type { FrameSource } from "./capture.ts";
import { createHandledIds } from "./handled-ids.ts";
import type { HandledIds } from "./handled-ids.ts";
import { createLineReader } from "./line-reader.ts";
import {
  SLOT_COUNT,
  controlGoneFile,
  createSlotAllocator,
  messageByteSize,
  writeSlot,
} from "./slots.ts";
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
  emptyWav: Uint8Array;
  slotCount?: number;
  pollIntervalMs?: number;
  autopoll?: boolean;
  onCaptureError?: (error: unknown) => void;
  log?: (line: string) => void;
  handledIds?: HandledIds;
  slotReadMs?: number;
  connectedTimeoutMs?: number;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type ScreenLink = GameLink & {
  committed(msg: GameToCompanion): Promise<boolean>;
  release(msg: GameToCompanion): void;
  close(): void;
  idle(): Promise<void>;
  poll(): Promise<void>;
};

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_SLOT_READ_MS = 250;
const DEFAULT_CONNECTED_TIMEOUT_MS = 25_000;
const UNDECODABLE_LOG_INTERVAL_MS = 30_000;
const SESSION_LENGTH = 17;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handledKeyOf(msg: GameToCompanion): string | undefined {
  return msg.t === "ask" || msg.t === "cmd" ? `${msg.t}:${msg.id}` : undefined;
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
  const lineReader = createLineReader();
  let lastUndecodableLogAt: number | undefined;
  let versionMismatchLogged = false;
  const handledIds = config.handledIds ?? createHandledIds([]);
  const awaitingCommit = new Map<string, { session: string; seqs: number[] }>();
  let singleBuf: FrameBuffer;
  let multiBuf: FrameBuffer;
  let helloSeen = false;
  let build: string | undefined;
  let session = "";
  let badFrames = 0;
  let lastFrameAt: number | undefined;
  const allocator: SlotAllocator = createSlotAllocator(slotCount);
  const pending: CompanionToGame[] = [];
  const ackSessions = new WeakMap<CompanionToGame, string>();

  function ack(seq: number, atSession: string = session): CompanionToGame {
    const made: CompanionToGame = { t: "ack", seq };
    ackSessions.set(made, atSession);
    return made;
  }
  let held: CompanionToGame[] = [];
  let written: WrittenEntry[] = [];
  let awaitingPostAckFrame = false;
  let resyncing = false;
  let emptiedAfterFailure: { session: string; floor: number } | undefined;
  let exhaustedUntilResync = false;
  let flushing: Promise<void> | undefined;
  let closed = false;
  let controlCleared = false;

  function logVersionMismatch(): void {
    if (!versionMismatchLogged) {
      versionMismatchLogged = true;
      config.log?.("addon and companion versions differ, run setup and restart the game");
    }
  }

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
      let present: boolean;
      try {
        present = await config.fs.exists(config.paths.signalFile(index));
      } catch (error) {
        config.onCaptureError?.(error);
        return undefined;
      }
      if (present) {
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
      !controlCleared ||
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
      if (isAck(next) && ackSessions.get(next) !== session) {
        pending.shift();
        continue;
      }
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
      result = await writeSlot(config.fs, config.paths, allocator, session, batch);
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
        pending.unshift(ack(frameSeq));
        scheduleFlush();
      }
      return;
    }

    resyncing = true;
    if (isNewSession) {
      awaitingCommit.clear();
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (isAck(pending[i] as CompanionToGame)) {
          pending.splice(i, 1);
        }
      }
    }
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
        singleBuf = isAgain ? { seq: frameSeq, complete: true } : undefined;
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
    if (isNewSession) {
      awaitingCommit.clear();
    }
    helloSeen = true;
    allocator.setNext(nextIndex);
    exhaustedUntilResync = false;
    if (isNewSession) {
      singleBuf = { seq: frameSeq, complete: true };
      multiBuf = undefined;
    }
    if (isAgain) {
      releaseHeld();
    } else {
      pending.push(ack(frameSeq));
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
    const reading = lineReader.feed(grid);
    if (reading.legacyGrid === true) {
      badFrames += 1;
      logVersionMismatch();
      return;
    }
    if (!reading.seen || reading.frame === undefined) {
      return;
    }
    const frame = reading.frame;
    if (!frame.ok) {
      badFrames += 1;
      const at = now();
      if (
        lastUndecodableLogAt === undefined ||
        at - lastUndecodableLogAt >= UNDECODABLE_LOG_INTERVAL_MS
      ) {
        lastUndecodableLogAt = at;
        config.log?.("the signal line is visible but no frame decodes; check the video settings");
      }
      return;
    }
    if (frame.value.version !== CODEC_VERSION) {
      badFrames += 1;
      logVersionMismatch();
      return;
    }
    lastFrameAt = now();
    const frameSeq = frame.value.seq;
    const isSingleFrame = frame.value.total === 1;
    if (!isSingleFrame && singleBuf?.complete === true) {
      singleBuf = undefined;
    }
    const { buf, message } = reassemble(isSingleFrame ? singleBuf : multiBuf, frame.value);
    const keepBuffer = (): void => {
      if (isSingleFrame) {
        singleBuf = buf;
      } else {
        multiBuf = buf;
      }
    };
    if (message === undefined) {
      keepBuffer();
      return;
    }
    if (!message.ok) {
      keepBuffer();
      badFrames += 1;
      return;
    }
    const msg = message.value;
    if (isSingleFrame && !(msg.t === "hello" && msg.again === true)) {
      multiBuf = undefined;
    }
    keepBuffer();
    const key = handledKeyOf(msg);
    const showsAckWasRead = awaitingPostAckFrame && !(msg.t === "hello" && msg.again !== true);
    let deliver = true;
    if (msg.t === "hello") {
      await handleHello(msg, frameSeq);
    } else if (key !== undefined) {
      const found = awaitingCommit.get(key);
      const waiting = found?.session === session ? found : undefined;
      if (handledIds.has(key)) {
        pending.push(ack(frameSeq));
        scheduleFlush();
        deliver = false;
      } else if (waiting !== undefined) {
        waiting.seqs.push(frameSeq);
        deliver = false;
      } else {
        awaitingCommit.set(key, { session, seqs: [frameSeq] });
      }
    } else if (ACKED_TYPES.has(msg.t)) {
      pending.push(ack(frameSeq));
      scheduleFlush();
    }
    if (showsAckWasRead) {
      releaseHeld();
      scheduleFlush();
    }
    if (deliver) {
      queue.push(msg);
    }
  }

  async function clearControlGone(): Promise<void> {
    const file = controlGoneFile(config.paths);
    while (!closed) {
      try {
        await config.fs.remove(file);
        controlCleared = true;
        return;
      } catch (error) {
        config.onCaptureError?.(error);
        await delay(slotReadMs);
      }
    }
  }

  const startup = clearControlGone().then(() => scheduleFlush());

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
    async committed(msg: GameToCompanion): Promise<boolean> {
      const key = handledKeyOf(msg);
      if (key === undefined) {
        return true;
      }
      const entry = awaitingCommit.get(key);
      const recorded = await handledIds.remember(key);
      if (!recorded.ok) {
        config.log?.("could not record the id of a handled message, retrying");
        return false;
      }
      if (entry === undefined || awaitingCommit.get(key) !== entry || entry.session !== session) {
        return true;
      }
      for (const seq of entry.seqs) {
        pending.push(ack(seq, entry.session));
      }
      awaitingCommit.delete(key);
      scheduleFlush();
      return true;
    },
    release(msg: GameToCompanion): void {
      const key = handledKeyOf(msg);
      const entry = key === undefined ? undefined : awaitingCommit.get(key);
      if (key === undefined || entry === undefined) {
        return;
      }
      awaitingCommit.delete(key);
      if (singleBuf !== undefined && entry.seqs.includes(singleBuf.seq)) {
        singleBuf = undefined;
      }
      if (multiBuf !== undefined && entry.seqs.includes(multiBuf.seq)) {
        multiBuf = undefined;
      }
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
      await startup;
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
