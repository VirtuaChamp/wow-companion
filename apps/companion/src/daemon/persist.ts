export type Persister = {
  run(task: () => Promise<void>): void;
  settled(): Promise<void>;
};

export type CoalescedWriter<T> = {
  schedule(value: T): void;
  flush(): Promise<void>;
};

export function createPersister(log: (line: string) => void): Persister {
  let chain: Promise<void> = Promise.resolve();
  return {
    run(task) {
      chain = chain.then(task).catch((error: unknown) => {
        log(`state write failed: ${String(error)}`);
      });
    },
    settled() {
      return chain;
    },
  };
}

export function createCoalescedWriter<T>(input: {
  persister: Persister;
  save: (value: T) => Promise<void>;
  intervalMs: number;
}): CoalescedWriter<T> {
  let pending: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function writePending(): void {
    timer = undefined;
    const next = pending;
    pending = undefined;
    if (next !== undefined) input.persister.run(() => input.save(next.value));
  }

  return {
    schedule(value) {
      pending = { value };
      timer ??= setTimeout(writePending, input.intervalMs);
    },
    async flush() {
      if (timer !== undefined) clearTimeout(timer);
      writePending();
      await input.persister.settled();
    },
  };
}
