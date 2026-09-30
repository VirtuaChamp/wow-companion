import type { Result } from "@wow-companion/contracts";

type HandledIdsWriteError = "write_failed";

export type HandledIds = {
  has(key: string): boolean;
  remember(key: string): Promise<Result<void, HandledIdsWriteError>>;
};

export type PersistIds = (ids: readonly string[]) => Promise<Result<void, HandledIdsWriteError>>;

export const HANDLED_IDS_MAX = 500;

export function createHandledIds(
  initial: readonly string[],
  max: number = HANDLED_IDS_MAX,
  persist?: PersistIds,
): HandledIds {
  const ids = new Set<string>(initial.slice(-max));
  let writing: Promise<unknown> = Promise.resolve();
  return {
    has: (key) => ids.has(key),
    async remember(key) {
      if (ids.has(key)) {
        return { ok: true, value: undefined };
      }
      ids.add(key);
      while (ids.size > max) {
        const oldest = ids.values().next();
        if (oldest.done === true) break;
        ids.delete(oldest.value);
      }
      if (persist === undefined) {
        return { ok: true, value: undefined };
      }
      const written = writing.then(() => persist([...ids]));
      writing = written.catch(() => undefined);
      const result = await written;
      if (!result.ok) {
        ids.delete(key);
      }
      return result;
    },
  };
}
