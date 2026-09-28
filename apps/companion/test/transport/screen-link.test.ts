import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GameToCompanion } from "@wow-companion/contracts";
import { createGridFileSource } from "../../src/transport/capture.ts";
import { parseCellGridFile } from "../../src/transport/grid.ts";
import { createScreenLink } from "../../src/transport/screen-link.ts";
import type { ScreenLink } from "../../src/transport/screen-link.ts";
import type { SlotFs, SlotPaths } from "../../src/transport/slots.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

function reportsLua515(command: string): boolean {
  const probe = spawnSync(command, ["-v"], { encoding: "utf8" });
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  return probe.error === undefined && output.includes("Lua 5.1.5");
}

function resolveLuaCommand(): string {
  const isWin = process.platform === "win32" && process.arch === "x64";
  const isLinux = process.platform === "linux" && process.arch === "x64";
  if (!isWin && !isLinux) {
    throw new Error(`unsupported platform/arch: ${process.platform}-${process.arch}`);
  }
  const linkName = isWin ? "lua.exe" : "lua";
  const installedPath = join(repoRoot, ".tools", "lua51", linkName);
  const candidates = existsSync(installedPath) ? [installedPath] : ["lua5.1", "lua"];
  for (const candidate of candidates) {
    if (reportsLua515(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "no lua interpreter reporting Lua 5.1.5 found in .tools/lua51 or on PATH; run pnpm run lua:setup first",
  );
}

function encodeAskGrid(outDir: string, seq: number): void {
  const lua = resolveLuaCommand();
  const result = spawnSync(
    lua,
    [
      join(repoRoot, "tests", "lua", "codec", "encode_message_to_grid.lua"),
      outDir,
      "5",
      String(seq),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`lua encoder failed: ${result.stderr}`);
  }
}

function encodeHelloGrid(outDir: string, session: string, slot: number, seq: number): void {
  const lua = resolveLuaCommand();
  const result = spawnSync(
    lua,
    [
      join(import.meta.dirname, "encode_hello_to_grid.lua"),
      outDir,
      session,
      String(slot),
      String(seq),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`lua hello encoder failed: ${result.stderr}`);
  }
}

function encodeStateGrid(outDir: string, seq: number): void {
  const lua = resolveLuaCommand();
  const result = spawnSync(
    lua,
    [join(import.meta.dirname, "encode_state_to_grid.lua"), outDir, String(seq)],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`lua state encoder failed: ${result.stderr}`);
  }
}

type RecordedWrite = { path: string; data: string | Uint8Array };

function makeMemoryFs(writes: RecordedWrite[]): SlotFs {
  return {
    async writeFile(path: string, data: string | Uint8Array): Promise<void> {
      writes.push({ path, data });
    },
  };
}

const paths: SlotPaths = {
  addonDeliverFile: (i) => `addons/WoWCompanion_R${i}/r.lua`,
  signalFile: (i) => `sig/${i}.wav`,
};

function noFrames() {
  return {
    async next() {
      return undefined;
    },
    close(): void {},
  };
}

const instantDelay = (): Promise<void> => Promise.resolve();

let activeLink: ScreenLink | undefined;
const tmpDirs: string[] = [];

afterEach(() => {
  activeLink?.close();
  activeLink = undefined;
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("link.hello", () => {
  it("writes no slot before the first decoded hello; a send while disconnected still returns ok and waits queued", async () => {
    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: noFrames(),
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      delay: instantDelay,
    });
    activeLink = link;

    const result = link.send({
      t: "reply",
      id: "p1",
      chat: "general",
      provider: "claude",
      summary: "sum",
      full: "full-text",
    });
    expect(result.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(writes).toHaveLength(0);
    expect(link.status().connected).toBe(false);
  });

  it("sets the allocator to hello.slot and empties the signals from there once hello is decoded", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-hello-"));
    tmpDirs.push(outDir);
    encodeHelloGrid(outDir, "sess-a", 5, 10);
    const gridPath = join(outDir, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: createGridFileSource(gridPath),
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      slotCount: 10,
      delay: instantDelay,
    });
    activeLink = link;

    await link.poll();
    await link.idle();

    expect(link.status().connected).toBe(true);
    expect(link.status().slotsLeft).toBe(5);

    const deliverIndex = writes.findIndex((w) => w.path.includes("r.lua"));
    const resetPaths = writes
      .slice(0, deliverIndex)
      .filter((w) => w.path.startsWith("sig/"))
      .map((w) => w.path)
      .sort();
    expect(resetPaths).toEqual([
      "sig/4.wav",
      "sig/5.wav",
      "sig/6.wav",
      "sig/7.wav",
      "sig/8.wav",
      "sig/9.wav",
    ]);

    const deliverWrites = writes.filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites).toHaveLength(1);
    expect(deliverWrites[0]?.path).toBe("addons/WoWCompanion_R4/r.lua");
    const content = deliverWrites[0]?.data as string;
    expect(content.startsWith('WoWCompanion_Deliver("sess-a"')).toBe(true);
    expect(content.includes('"ack"')).toBe(true);
    expect(content.includes("10")).toBe(true);
  });

  it("a reload during which the addon passed stale slots still converges to the new hello.slot", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-reload-"));
    tmpDirs.push(outDir);
    encodeHelloGrid(outDir, "sess-a", 1, 1);
    const firstGridPath = join(outDir, "frame-0.grid");

    const outDir2 = mkdtempSync(join(tmpdir(), "wowc-link-reload2-"));
    tmpDirs.push(outDir2);
    encodeHelloGrid(outDir2, "sess-b", 8, 1);
    const secondGridPath = join(outDir2, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    let useSecond = false;
    const swappableSource = {
      async next() {
        const text = readFileSync(useSecond ? secondGridPath : firstGridPath, "utf-8");
        const parsed = parseCellGridFile(text);
        return parsed.ok ? parsed.value : undefined;
      },
      close(): void {},
    };

    const link = createScreenLink({
      frameSource: swappableSource,
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      slotCount: 10,
      delay: instantDelay,
    });
    activeLink = link;

    await link.poll();
    await link.idle();
    expect(link.status().slotsLeft).toBe(9);

    useSecond = true;
    await link.poll();
    await link.idle();

    expect(link.status().slotsLeft).toBe(2);
    const deliverWrites = writes.filter((w) => w.path.includes("r.lua"));
    const last = deliverWrites[deliverWrites.length - 1];
    expect(last).toBeDefined();
    expect(last?.path).toBe("addons/WoWCompanion_R7/r.lua");
    const lastContent = last?.data as string;
    expect(lastContent.startsWith('WoWCompanion_Deliver("sess-b"')).toBe(true);
  });

  it("a restarted companion (fresh link, no session) learns the position from the next hello re-announce and delivers", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-restart-"));
    tmpDirs.push(outDir);
    encodeHelloGrid(outDir, "sess-restart", 6, 1);
    const gridPath = join(outDir, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: createGridFileSource(gridPath),
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      slotCount: 10,
      delay: instantDelay,
    });
    activeLink = link;

    expect(link.status().connected).toBe(false);

    await link.poll();
    await link.idle();

    expect(link.status().connected).toBe(true);
    const deliverWrites = writes.filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites).toHaveLength(1);
    expect(deliverWrites[0]?.path).toBe("addons/WoWCompanion_R5/r.lua");
  });

  it("a same-session hello with slot behind the allocator does not move it or empty signals", async () => {
    const dir1 = mkdtempSync(join(tmpdir(), "wowc-link-behind-1-"));
    tmpDirs.push(dir1);
    encodeHelloGrid(dir1, "sess-a", 5, 1);
    const firstGridPath = join(dir1, "frame-0.grid");

    const dir2 = mkdtempSync(join(tmpdir(), "wowc-link-behind-2-"));
    tmpDirs.push(dir2);
    encodeHelloGrid(dir2, "sess-a", 3, 2);
    const secondGridPath = join(dir2, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    let useSecond = false;
    const source = {
      async next() {
        const text = readFileSync(useSecond ? secondGridPath : firstGridPath, "utf-8");
        const parsed = parseCellGridFile(text);
        return parsed.ok ? parsed.value : undefined;
      },
      close(): void {},
    };
    const link = createScreenLink({
      frameSource: source,
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      slotCount: 10,
      delay: instantDelay,
    });
    activeLink = link;

    await link.poll();
    await link.idle();
    expect(link.status().slotsLeft).toBe(5);

    useSecond = true;
    const writesBeforeSecond = writes.length;
    await link.poll();
    await link.idle();

    expect(link.status().slotsLeft).toBe(4);
    const newWrites = writes.slice(writesBeforeSecond);
    const deliverIndex = newWrites.findIndex((w) => w.path.includes("r.lua"));
    expect(newWrites.slice(0, deliverIndex).some((w) => w.path.startsWith("sig/"))).toBe(false);
    expect(newWrites).toHaveLength(2);
    const ackWrite = newWrites[deliverIndex];
    expect(ackWrite?.path).toBe("addons/WoWCompanion_R5/r.lua");
  });

  it("a same-session hello with slot ahead of the allocator re-syncs", async () => {
    const dir1 = mkdtempSync(join(tmpdir(), "wowc-link-ahead-1-"));
    tmpDirs.push(dir1);
    encodeHelloGrid(dir1, "sess-a", 1, 1);
    const firstGridPath = join(dir1, "frame-0.grid");

    const dir2 = mkdtempSync(join(tmpdir(), "wowc-link-ahead-2-"));
    tmpDirs.push(dir2);
    encodeHelloGrid(dir2, "sess-a", 8, 2);
    const secondGridPath = join(dir2, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    let useSecond = false;
    const source = {
      async next() {
        const text = readFileSync(useSecond ? secondGridPath : firstGridPath, "utf-8");
        const parsed = parseCellGridFile(text);
        return parsed.ok ? parsed.value : undefined;
      },
      close(): void {},
    };
    const link = createScreenLink({
      frameSource: source,
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      slotCount: 10,
      delay: instantDelay,
    });
    activeLink = link;

    await link.poll();
    await link.idle();
    expect(link.status().slotsLeft).toBe(9);

    useSecond = true;
    const writesBeforeSecond = writes.length;
    await link.poll();
    await link.idle();

    expect(link.status().slotsLeft).toBe(2);
    const resetPaths = writes
      .slice(writesBeforeSecond)
      .filter((w) => w.path.startsWith("sig/"))
      .map((w) => w.path);
    expect(resetPaths).toContain("sig/9.wav");
    const ackWrite = writes.slice(writesBeforeSecond).find((w) => w.path.includes("r.lua"));
    expect(ackWrite?.path).toBe("addons/WoWCompanion_R7/r.lua");
  });
});

describe("link.batch", () => {
  it("batches messages queued since the last delivered slot into one slot, dropping a superseded progress", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-batch-hello-"));
    tmpDirs.push(outDir);
    encodeHelloGrid(outDir, "sess-a", 1, 1);
    const gridPath = join(outDir, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: createGridFileSource(gridPath),
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      delay: instantDelay,
    });
    activeLink = link;

    await link.poll();
    await link.idle();
    const writesBeforeSends = writes.length;

    const first = link.send({ t: "progress", id: "p1", status: "thinking", detail: "stale" });
    const second = link.send({ t: "progress", id: "p1", status: "tool", detail: "fresh" });
    const reply = link.send({
      t: "reply",
      id: "p1",
      chat: "general",
      provider: "claude",
      summary: "sum",
      full: "full-text",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(reply.ok).toBe(true);

    await link.idle();

    const deliverWrites = writes.slice(writesBeforeSends).filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites).toHaveLength(1);
    const content = deliverWrites[0]?.data as string;
    expect(content.includes("stale")).toBe(false);
    expect(content.includes("fresh")).toBe(true);
    expect(content.includes("full-text")).toBe(true);
  });

  it("holds messages sent after an await across the slot-read window in the same batch", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-batch-window-"));
    tmpDirs.push(outDir);
    encodeHelloGrid(outDir, "sess-a", 1, 1);
    const gridPath = join(outDir, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: createGridFileSource(gridPath),
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      slotReadMs: 150,
    });
    activeLink = link;

    await link.poll();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const writesBeforeSends = writes.length;

    link.send({ t: "progress", id: "p1", status: "thinking", detail: "first" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    link.send({ t: "progress", id: "p1", status: "tool", detail: "second" });

    await new Promise((resolve) => setTimeout(resolve, 250));
    await link.idle();

    const deliverWrites = writes.slice(writesBeforeSends).filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites).toHaveLength(1);
    const content = deliverWrites[0]?.data as string;
    expect(content.includes("first")).toBe(false);
    expect(content.includes("second")).toBe(true);
  });
});

describe("link.ack", () => {
  it("delivers an ask frame once across repeated captures and acks it in a slot stamped with the session", async () => {
    const helloDir = mkdtempSync(join(tmpdir(), "wowc-link-ack-hello-"));
    tmpDirs.push(helloDir);
    encodeHelloGrid(helloDir, "sess-ask", 1, 1);
    const helloGridPath = join(helloDir, "frame-0.grid");

    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-ack-"));
    tmpDirs.push(outDir);
    encodeAskGrid(outDir, 42);
    const gridPath = join(outDir, "frame-0.grid");
    expect(readFileSync(gridPath, "utf-8").length).toBeGreaterThan(0);

    const writes: RecordedWrite[] = [];
    let useAsk = false;
    const source = {
      async next() {
        const text = readFileSync(useAsk ? gridPath : helloGridPath, "utf-8");
        const parsed = parseCellGridFile(text);
        return parsed.ok ? parsed.value : undefined;
      },
      close(): void {},
    };
    const link = createScreenLink({
      frameSource: source,
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      delay: instantDelay,
    });
    activeLink = link;

    const received: GameToCompanion[] = [];
    void (async () => {
      for await (const msg of link.messages()) {
        received.push(msg);
      }
    })();

    await link.poll();
    await link.idle();
    useAsk = true;

    await link.poll();
    await link.poll();
    await link.poll();
    await link.idle();

    expect(received.filter((m) => m.t === "ask")).toHaveLength(1);

    const deliverWrites = writes.filter((w) => w.path.includes("r.lua"));
    const ackWrite = deliverWrites.find(
      (w) => (w.data as string).includes('"ack"') && (w.data as string).includes("42"),
    );
    expect(ackWrite).toBeDefined();
    const ackContent = ackWrite?.data as string;
    expect(ackContent.startsWith('WoWCompanion_Deliver("sess-ask"')).toBe(true);
  });

  it("does not write an ack slot for a state frame", async () => {
    const helloDir = mkdtempSync(join(tmpdir(), "wowc-link-state-hello-"));
    tmpDirs.push(helloDir);
    encodeHelloGrid(helloDir, "sess-state", 1, 1);
    const helloGridPath = join(helloDir, "frame-0.grid");

    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-state-"));
    tmpDirs.push(outDir);
    encodeStateGrid(outDir, 7);
    const stateGridPath = join(outDir, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    let useState = false;
    const source = {
      async next() {
        const text = readFileSync(useState ? stateGridPath : helloGridPath, "utf-8");
        const parsed = parseCellGridFile(text);
        return parsed.ok ? parsed.value : undefined;
      },
      close(): void {},
    };
    const link = createScreenLink({
      frameSource: source,
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      delay: instantDelay,
    });
    activeLink = link;

    await link.poll();
    await link.idle();
    const writesBeforeState = writes.length;
    useState = true;

    await link.poll();
    await link.idle();

    const deliverWrites = writes.slice(writesBeforeState).filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites).toHaveLength(0);
  });
});

describe("link.errors", () => {
  it("requeues a batch instead of dropping it when the write fails", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-error-hello-"));
    tmpDirs.push(outDir);
    encodeHelloGrid(outDir, "sess-a", 1, 1);
    const gridPath = join(outDir, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    let failNext = false;
    const errors: unknown[] = [];
    const fs: SlotFs = {
      async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        if (failNext && path.includes("r.lua")) {
          failNext = false;
          throw new Error("disk full");
        }
        writes.push({ path, data });
      },
    };

    const link = createScreenLink({
      frameSource: createGridFileSource(gridPath),
      fs,
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      delay: instantDelay,
      onCaptureError: (error) => errors.push(error),
    });
    activeLink = link;

    await link.poll();
    await link.idle();
    const writesBeforeSend = writes.length;

    failNext = true;
    const result = link.send({
      t: "reply",
      id: "p1",
      chat: "general",
      provider: "claude",
      summary: "sum",
      full: "attempt-one",
    });
    expect(result.ok).toBe(true);
    await link.idle();

    expect(errors.length).toBeGreaterThan(0);
    const deliverWrites = writes.slice(writesBeforeSend).filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites.some((w) => (w.data as string).includes("attempt-one"))).toBe(true);
  });
});
