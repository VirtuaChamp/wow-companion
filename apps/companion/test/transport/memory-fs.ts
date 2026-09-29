import type { SlotFs } from "../../src/transport/slots.ts";

export type RecordedWrite = { path: string; data: string | Uint8Array };

export type FsHooks = {
  beforeWrite?(path: string, data: string | Uint8Array): Promise<void> | void;
  beforeRename?(from: string, to: string): Promise<void> | void;
  beforeRemove?(path: string): Promise<void> | void;
};

export type MemoryFsOptions = {
  signalCount?: number;
  absentSignals?: readonly number[];
  extraFiles?: readonly RecordedWrite[];
  hooks?: FsHooks;
};

export type MemoryFs = SlotFs & {
  files: Map<string, string | Uint8Array>;
  ops: string[];
  removed: string[];
};

const DEFAULT_SIGNAL_COUNT = 200;

export function makeMemoryFs(writes: RecordedWrite[], options: MemoryFsOptions = {}): MemoryFs {
  const files = new Map<string, string | Uint8Array>();
  const absent = new Set(options.absentSignals ?? []);
  for (let i = 0; i < (options.signalCount ?? DEFAULT_SIGNAL_COUNT); i += 1) {
    if (!absent.has(i)) {
      files.set(`sig/${String(i)}.wav`, new Uint8Array(0));
    }
  }
  files.set("sig/ctl-present.wav", new Uint8Array(0));
  files.set("sig/ctl-gone.wav", new Uint8Array(0));
  for (const extra of options.extraFiles ?? []) {
    files.set(extra.path, extra.data);
  }
  const ops: string[] = [];
  const removed: string[] = [];
  const hooks = options.hooks ?? {};

  return {
    files,
    ops,
    removed,
    async writeFile(path: string, data: string | Uint8Array): Promise<void> {
      await hooks.beforeWrite?.(path, data);
      files.set(path, data);
      ops.push(`write ${path}`);
      if (!path.endsWith(".tmp")) {
        writes.push({ path, data });
      }
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async remove(path: string): Promise<void> {
      await hooks.beforeRemove?.(path);
      files.delete(path);
      ops.push(`remove ${path}`);
      removed.push(path);
    },
    async rename(from: string, to: string): Promise<void> {
      await hooks.beforeRename?.(from, to);
      const data = files.get(from);
      if (data === undefined) {
        throw new Error(`ENOENT: ${from}`);
      }
      files.delete(from);
      files.set(to, data);
      ops.push(`rename ${from} ${to}`);
      writes.push({ path: to, data });
    },
  };
}
