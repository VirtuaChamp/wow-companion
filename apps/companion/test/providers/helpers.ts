import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ModelInfo, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunOutcome, SpawnLine } from "../../src/adapters/providers/spawn.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

export function fixturePath(...parts: string[]): string {
  return `${here}${parts.join("/")}`;
}

export function loadJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadJsonlFixture(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

export function loadRawLinesFixture(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fakeRun(fixtureLines: unknown[]) {
  return async (
    _command: string,
    _args: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      signal: AbortSignal;
      onLine: (line: SpawnLine) => void;
    },
  ): Promise<RunOutcome> => {
    for (const entry of fixtureLines) {
      if (options.signal.aborted) return { outcome: "cancelled" };
      await delay(1);
      if (options.signal.aborted) return { outcome: "cancelled" };
      options.onLine({ stream: "stdout", text: JSON.stringify(entry) });
    }
    return { outcome: "exit", code: 0 };
  };
}

export function fakeRunLines(rawLines: string[]) {
  return async (
    _command: string,
    _args: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      signal: AbortSignal;
      onLine: (line: SpawnLine) => void;
    },
  ): Promise<RunOutcome> => {
    const exitLine = rawLines.find((line) => /^exit: (-?\d+|null|cancelled)$/.test(line));
    const exitValue = exitLine ? exitLine.slice("exit: ".length) : "0";
    for (const line of rawLines) {
      if (line === exitLine) continue;
      if (options.signal.aborted) return { outcome: "cancelled" };
      await delay(1);
      if (options.signal.aborted) return { outcome: "cancelled" };
      if (line.startsWith("stderr: ")) {
        options.onLine({ stream: "stderr", text: line.slice("stderr: ".length) });
      } else {
        options.onLine({ stream: "stdout", text: line });
      }
    }
    if (exitValue === "cancelled") return { outcome: "cancelled" };
    if (exitValue === "null") return { outcome: "exit", code: null };
    return { outcome: "exit", code: Number.parseInt(exitValue, 10) };
  };
}

export function fakeCheckInstalled(installed: boolean, reason?: string) {
  return (_cwd: string) =>
    installed || reason === undefined ? { installed } : { installed: false, reason };
}

export function fakeQuery(
  fixtureMessages: SDKMessage[],
  options?: { supportedModels?: string[]; onCall?: (options: Options | undefined) => void },
) {
  return (params: { prompt: string; options?: Options }) => {
    options?.onCall?.(params.options);
    const abortController = params.options?.abortController;
    async function* generate(): AsyncGenerator<SDKMessage> {
      for (const message of fixtureMessages) {
        if (abortController?.signal.aborted) return;
        await delay(1);
        if (abortController?.signal.aborted) return;
        yield message;
      }
    }
    const iterator = generate();
    return {
      [Symbol.asyncIterator]: () => iterator,
      async supportedModels(): Promise<ModelInfo[]> {
        return (options?.supportedModels ?? ["claude-sonnet-5", "claude-opus-5-5"]).map(
          (value) => ({
            value,
            displayName: value,
            description: value,
          }),
        );
      },
      close() {},
    };
  };
}

export function fakeQueryThrows(message: string) {
  return (_params: { prompt: string; options?: Options }) => {
    const iterator: AsyncIterator<SDKMessage> = {
      next(): Promise<IteratorResult<SDKMessage>> {
        return Promise.reject(new Error(message));
      },
    };
    return {
      [Symbol.asyncIterator]: () => iterator,
      async supportedModels(): Promise<ModelInfo[]> {
        throw new Error(message);
      },
      close() {},
    };
  };
}

export function fakeQueryHangs() {
  return (params: { prompt: string; options?: Options }) => {
    const abortController = params.options?.abortController;
    const iterator: AsyncIterator<SDKMessage> = {
      next(): Promise<IteratorResult<SDKMessage>> {
        return new Promise((resolve) => {
          abortController?.signal.addEventListener("abort", () =>
            resolve({ value: undefined, done: true }),
          );
        });
      },
    };
    return {
      [Symbol.asyncIterator]: () => iterator,
      async supportedModels(): Promise<ModelInfo[]> {
        return [];
      },
      close() {},
    };
  };
}
