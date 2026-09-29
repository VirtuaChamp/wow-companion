import type { CompanionToGame, GameLink, GameToCompanion, LinkError, Result } from "./types.ts";

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
          if (ended) return Promise.resolve({ value: undefined, done: true });
          const next = buffered.shift();
          if (next !== undefined) return Promise.resolve({ value: next, done: false });
          return new Promise((resolve) => {
            pendingWaiter = resolve;
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<GameToCompanion>> {
          ended = true;
          if (pendingWaiter !== undefined) {
            const index = waiters.indexOf(pendingWaiter);
            if (index !== -1) waiters.splice(index, 1);
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

const MEMORY_LINK_SLOTS = 200;

export function createMemoryLink(): GameLink & {
  push(m: GameToCompanion): void;
  sent(): CompanionToGame[];
  setConnected(c: boolean): void;
} {
  const queue = createAsyncQueue();
  const sentMessages: CompanionToGame[] = [];
  let connected = false;
  let build: string | undefined;

  return {
    messages(): AsyncIterable<GameToCompanion> {
      return queue.iterable;
    },
    send(msg: CompanionToGame): Result<void, LinkError> {
      sentMessages.push(msg);
      return { ok: true, value: undefined };
    },
    status(): { connected: boolean; build?: string; slotsLeft: number; badFrames: number } {
      return build === undefined
        ? { connected, slotsLeft: MEMORY_LINK_SLOTS, badFrames: 0 }
        : { connected, build, slotsLeft: MEMORY_LINK_SLOTS, badFrames: 0 };
    },
    push(m: GameToCompanion): void {
      if (m.t === "hello") build = m.build;
      queue.push(m);
    },
    sent(): CompanionToGame[] {
      return [...sentMessages];
    },
    setConnected(c: boolean): void {
      connected = c;
    },
  };
}
