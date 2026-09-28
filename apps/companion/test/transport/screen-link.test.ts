import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CompanionToGame, GameToCompanion } from "@wow-companion/contracts";
import { createGridFileSource } from "../../src/transport/capture.ts";
import { parseCellGridFile } from "../../src/transport/grid.ts";
import { createScreenLink } from "../../src/transport/screen-link.ts";
import type { ScreenLink } from "../../src/transport/screen-link.ts";
import { messageByteSize } from "../../src/transport/slots.ts";
import type { SlotFs, SlotPaths } from "../../src/transport/slots.ts";
import {
  cleanScratch,
  encodeHelloGridFile,
  latestSignal,
  parseSlotContent,
  repoRoot,
  resolveLuaCommand,
  switchableSource,
} from "./link-harness.ts";

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

function encodeHelloGrid(
  outDir: string,
  session: string,
  slot: number,
  seq: number,
  again = false,
): void {
  const lua = resolveLuaCommand();
  const args = [
    join(import.meta.dirname, "encode_hello_to_grid.lua"),
    outDir,
    session,
    String(slot),
    String(seq),
  ];
  if (again) {
    args.push("again");
  }
  const result = spawnSync(lua, args, { cwd: repoRoot, encoding: "utf8" });
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
    async readFile(path: string): Promise<Uint8Array | undefined> {
      return latestSignal(writes, path);
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

type Connected = {
  link: ScreenLink;
  writes: RecordedWrite[];
  feed: (gridPath: string) => Promise<void>;
  show: (gridPath: string) => void;
};

type ConnectedOptions = {
  session: string;
  slotCount?: number;
  slotReadMs?: number;
  delay?: (ms: number) => Promise<void>;
  fs?: SlotFs;
  onCaptureError?: (error: unknown) => void;
};

async function startConnected(options: ConnectedOptions): Promise<Connected> {
  const helloGrid = encodeHelloGridFile(options.session, 1, 1);
  const againGrid = encodeHelloGridFile(options.session, 2, 2, true);
  let current = helloGrid;
  const writes: RecordedWrite[] = [];
  const link = createScreenLink({
    frameSource: switchableSource(() => current),
    fs: options.fs ?? makeMemoryFs(writes),
    paths,
    validWav: new Uint8Array([1]),
    emptyWav: new Uint8Array(0),
    autopoll: false,
    slotCount: options.slotCount ?? 10,
    ...(options.slotReadMs === undefined ? {} : { slotReadMs: options.slotReadMs }),
    ...(options.delay === undefined ? {} : { delay: options.delay }),
    ...(options.onCaptureError === undefined ? {} : { onCaptureError: options.onCaptureError }),
  });
  activeLink = link;
  await link.poll();
  await link.idle();
  current = againGrid;
  await link.poll();
  await link.idle();
  return {
    link,
    writes,
    show: (gridPath: string) => {
      current = gridPath;
    },
    feed: async (gridPath: string) => {
      current = gridPath;
      await link.poll();
      await link.idle();
    },
  };
}

function reply(id: string): CompanionToGame {
  return {
    t: "reply",
    id,
    chat: "general",
    provider: "claude",
    summary: `summary ${id}`,
    full: `full ${id}`,
  };
}

let activeLink: ScreenLink | undefined;
const tmpDirs: string[] = [];

afterEach(() => {
  activeLink?.close();
  activeLink = undefined;
  cleanScratch();
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("link.hello", () => {
  it("a new-session hello captured twice yields exactly one hello and one ack", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-hello-twice-"));
    tmpDirs.push(outDir);
    encodeHelloGrid(outDir, "sess-twice", 2, 7);
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

    const received: GameToCompanion[] = [];
    void (async () => {
      for await (const msg of link.messages()) {
        received.push(msg);
      }
    })();

    await link.poll();
    await link.poll();
    await link.poll();
    await link.idle();

    expect(received.filter((m) => m.t === "hello")).toHaveLength(1);
    const deliverWrites = writes.filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites).toHaveLength(1);
  });

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

  it("a companion that holds no session adopts the hello's session, empties no signal, and starts at the first slot at or after hello.slot whose signal is not ready", async () => {
    const gridPath = encodeHelloGridFile("sess-a", 5, 10);

    const writes: RecordedWrite[] = [
      { path: "sig/4.wav", data: new Uint8Array([1]) },
      { path: "sig/5.wav", data: new Uint8Array([1]) },
      { path: "sig/6.wav", data: new Uint8Array(0) },
    ];
    const seeded = writes.length;
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
    expect(link.status().slotsLeft).toBe(3);

    const fresh = writes.slice(seeded);
    expect(
      fresh.filter((w) => w.path.startsWith("sig/") && (w.data as Uint8Array).length === 0),
    ).toEqual([]);
    const deliverWrites = fresh.filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites).toHaveLength(1);
    expect(deliverWrites[0]?.path).toBe("addons/WoWCompanion_R6/r.lua");
    expect(parseSlotContent(deliverWrites[0]?.data as string)).toEqual({
      session: "sess-a",
      msgs: [{ t: "ack", seq: 10 }],
    });
  });

  it("a slot whose r.lua was written but whose signal is empty counts as free for a companion adopting a session", async () => {
    const gridPath = encodeHelloGridFile("sess-a", 2, 3);
    const writes: RecordedWrite[] = [
      { path: "addons/WoWCompanion_R1/r.lua", data: "stale content" },
      { path: "sig/1.wav", data: new Uint8Array(0) },
    ];
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

    expect(link.status().slotsLeft).toBe(8);
    expect(writes.filter((w) => w.path.includes("r.lua")).pop()?.path).toBe(
      "addons/WoWCompanion_R1/r.lua",
    );
  });

  it("a re-sync whose signal reset fails in any slot writes and releases nothing until every required signal is empty", async () => {
    const landed: RecordedWrite[] = [];
    let failReset = false;
    const errors: unknown[] = [];
    const fs: SlotFs = {
      async readFile(path: string): Promise<Uint8Array | undefined> {
        return latestSignal(landed, path);
      },
      async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        if (failReset && path === "sig/6.wav" && (data as Uint8Array).length === 0) {
          failReset = false;
          throw new Error("EBUSY");
        }
        landed.push({ path, data });
      },
    };
    const { link, feed } = await startConnected({
      session: "sess-reset-a",
      delay: instantDelay,
      fs,
      onCaptureError: (error) => errors.push(error),
    });
    link.send(reply("held-across-failed-reset"));
    await link.idle();
    const before = landed.length;

    failReset = true;
    await feed(encodeHelloGridFile("sess-reset-b", 1, 3));
    await feed(encodeHelloGridFile("sess-reset-b", 2, 4, true));

    expect(errors.length).toBeGreaterThan(0);
    const after = landed.slice(before);
    const firstDeliver = after.findIndex((w) => w.path.includes("r.lua"));
    expect(firstDeliver).toBeGreaterThan(0);
    for (let index = 0; index < 10; index += 1) {
      const emptiedBefore = after
        .slice(0, firstDeliver)
        .some((w) => w.path === `sig/${index}.wav` && (w.data as Uint8Array).length === 0);
      expect(emptiedBefore).toBe(true);
    }
    const delivered = after
      .filter((w) => w.path.includes("r.lua"))
      .map((w) => ({ path: w.path, ...parseSlotContent(w.data as string) }));
    expect(delivered).toEqual([
      {
        path: "addons/WoWCompanion_R0/r.lua",
        session: "sess-reset-b",
        msgs: [{ t: "ack", seq: 3 }],
      },
      {
        path: "addons/WoWCompanion_R1/r.lua",
        session: "sess-reset-b",
        msgs: [reply("held-across-failed-reset")],
      },
    ]);
  });

  it("a reload during which the addon passed stale slots still converges to the new hello.slot", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "wowc-link-reload-"));
    tmpDirs.push(outDir);
    encodeHelloGrid(outDir, "sess-a", 1, 1);
    const firstGridPath = join(outDir, "frame-0.grid");

    const outDir2 = mkdtempSync(join(tmpdir(), "wowc-link-reload2-"));
    tmpDirs.push(outDir2);
    encodeHelloGrid(outDir2, "sess-b", 8, 500);
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
    expect(parseSlotContent(last?.data as string)).toEqual({
      session: "sess-b",
      msgs: [{ t: "ack", seq: 500 }],
    });
  });

  it("a restarted companion (fresh link, no session) that only ever sees again hellos re-syncs, delivers what was sent before the hello, and never acks the again hello", async () => {
    const againGrid = encodeHelloGridFile("sess-restart", 6, 1, true);

    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: createGridFileSource(againGrid),
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
    const reply = {
      t: "reply",
      id: "r-early",
      chat: "general",
      provider: "claude",
      summary: "sum",
      full: "sent-before-hello",
    } as const;
    expect(link.send(reply).ok).toBe(true);

    await link.poll();
    await link.idle();

    expect(link.status().connected).toBe(true);
    const deliverWrites = writes.filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites.map((w) => w.path)).toEqual(["addons/WoWCompanion_R5/r.lua"]);
    expect(parseSlotContent(deliverWrites[0]?.data as string)).toEqual({
      session: "sess-restart",
      msgs: [reply],
    });
  });

  it("the slot written for a re-sync holds only the ack, even for messages sent while it was in flight, and everything else follows after a later frame", async () => {
    const helloGrid = encodeHelloGridFile("sess-ackonly", 1, 4);
    const againGrid = encodeHelloGridFile("sess-ackonly", 1, 5, true);
    let current = helloGrid;
    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: switchableSource(() => current),
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      slotCount: 10,
      delay: instantDelay,
    });
    activeLink = link;

    const early = {
      t: "reply",
      id: "r1",
      chat: "general",
      provider: "claude",
      summary: "sum",
      full: "early",
    } as const;
    link.send(early);
    await link.poll();
    const during = { ...early, id: "r2", full: "during" } as const;
    link.send(during);
    await link.idle();

    const afterAck = writes.filter((w) => w.path.includes("r.lua"));
    expect(afterAck).toHaveLength(1);
    expect(parseSlotContent(afterAck[0]?.data as string).msgs).toEqual([{ t: "ack", seq: 4 }]);

    current = againGrid;
    await link.poll();
    await link.idle();

    const all = writes.filter((w) => w.path.includes("r.lua"));
    expect(all.map((w) => w.path)).toEqual([
      "addons/WoWCompanion_R0/r.lua",
      "addons/WoWCompanion_R1/r.lua",
    ]);
    expect(parseSlotContent(all[1]?.data as string).msgs).toEqual([early, during]);
  });

  it("a rebuilt non-again hello does not release held messages: it shows the ack was not read", async () => {
    const helloGrid = encodeHelloGridFile("sess-norelease", 1, 4);
    const rebuiltGrid = encodeHelloGridFile("sess-norelease", 1, 6);
    let current = helloGrid;
    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: switchableSource(() => current),
      fs: makeMemoryFs(writes),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
      slotCount: 10,
      delay: instantDelay,
    });
    activeLink = link;

    link.send({
      t: "reply",
      id: "r1",
      chat: "general",
      provider: "claude",
      summary: "sum",
      full: "held-until-read",
    });
    await link.poll();
    await link.idle();
    current = rebuiltGrid;
    await link.poll();
    await link.idle();

    const delivered = writes
      .filter((w) => w.path.includes("r.lua"))
      .map((w) => parseSlotContent(w.data as string).msgs);
    expect(delivered).toEqual([[{ t: "ack", seq: 4 }], [{ t: "ack", seq: 6 }]]);
  });

  it("re-queues only what no same-session hello has yet shown as read: a message a hello of its own session passed is left alone", async () => {
    const helloA = encodeHelloGridFile("sess-req-a", 1, 1);
    const againA = encodeHelloGridFile("sess-req-a", 2, 9, true);
    const helloBAhead = encodeHelloGridFile("sess-req-b", 3, 2);
    const againB = encodeHelloGridFile("sess-req-b", 3, 3, true);
    let current = helloA;
    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: switchableSource(() => current),
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
    current = againA;
    await link.poll();
    await link.idle();
    const make = (id: string) =>
      ({
        t: "reply",
        id,
        chat: "general",
        provider: "claude",
        summary: "sum",
        full: id,
      }) as const;
    link.send(make("passed"));
    await link.idle();
    link.send(make("unread"));
    await link.idle();
    const slotsBeforeReload = writes.filter((w) => w.path.includes("r.lua")).map((w) => w.path);
    expect(slotsBeforeReload).toEqual([
      "addons/WoWCompanion_R0/r.lua",
      "addons/WoWCompanion_R1/r.lua",
      "addons/WoWCompanion_R2/r.lua",
    ]);

    current = encodeHelloGridFile("sess-req-a", 3, 10, true);
    await link.poll();
    await link.idle();
    current = helloBAhead;
    await link.poll();
    await link.idle();
    current = againB;
    await link.poll();
    await link.idle();

    const afterReload = writes
      .filter((w) => w.path.includes("r.lua"))
      .slice(3)
      .map((w) => ({ path: w.path, ...parseSlotContent(w.data as string) }));
    expect(afterReload).toEqual([
      { path: "addons/WoWCompanion_R2/r.lua", session: "sess-req-b", msgs: [{ t: "ack", seq: 2 }] },
      { path: "addons/WoWCompanion_R3/r.lua", session: "sess-req-b", msgs: [make("unread")] },
    ]);
  });

  it("re-queues every unread message on a new session, even one in a slot below the new hello.slot, when no hello of its own session showed it read", async () => {
    const helloA = encodeHelloGridFile("sess-req-a", 1, 1);
    const againA = encodeHelloGridFile("sess-req-a", 2, 9, true);
    const helloBAhead = encodeHelloGridFile("sess-req-b", 3, 2);
    const againB = encodeHelloGridFile("sess-req-b", 3, 3, true);
    let current = helloA;
    const writes: RecordedWrite[] = [];
    const link = createScreenLink({
      frameSource: switchableSource(() => current),
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
    current = againA;
    await link.poll();
    await link.idle();
    const make = (id: string) =>
      ({
        t: "reply",
        id,
        chat: "general",
        provider: "claude",
        summary: "sum",
        full: id,
      }) as const;
    link.send(make("passed"));
    await link.idle();
    link.send(make("unread"));
    await link.idle();
    const slotsBeforeReload = writes.filter((w) => w.path.includes("r.lua")).map((w) => w.path);
    expect(slotsBeforeReload).toEqual([
      "addons/WoWCompanion_R0/r.lua",
      "addons/WoWCompanion_R1/r.lua",
      "addons/WoWCompanion_R2/r.lua",
    ]);

    current = helloBAhead;
    await link.poll();
    await link.idle();
    current = againB;
    await link.poll();
    await link.idle();

    const afterReload = writes
      .filter((w) => w.path.includes("r.lua"))
      .slice(3)
      .map((w) => ({ path: w.path, ...parseSlotContent(w.data as string) }));
    expect(afterReload).toEqual([
      { path: "addons/WoWCompanion_R2/r.lua", session: "sess-req-b", msgs: [{ t: "ack", seq: 2 }] },
      {
        path: "addons/WoWCompanion_R3/r.lua",
        session: "sess-req-b",
        msgs: [make("passed"), make("unread")],
      },
    ]);
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
    const { link, writes } = await startConnected({ session: "sess-a", delay: instantDelay });
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
    expect(parseSlotContent(deliverWrites[0]?.data as string).msgs).toEqual([
      { t: "progress", id: "p1", status: "tool", detail: "fresh" },
      {
        t: "reply",
        id: "p1",
        chat: "general",
        provider: "claude",
        summary: "sum",
        full: "full-text",
      },
    ]);
  });

  it("holds messages sent after an await across the slot-read window in the same batch", async () => {
    const { link, writes } = await startConnected({ session: "sess-a", slotReadMs: 150 });

    link.send({ t: "progress", id: "warm", status: "thinking", detail: "opens the window" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const writesBeforeSends = writes.length;

    link.send({ t: "progress", id: "p1", status: "thinking", detail: "first" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    link.send({ t: "progress", id: "p1", status: "tool", detail: "second" });

    await new Promise((resolve) => setTimeout(resolve, 250));
    await link.idle();

    const deliverWrites = writes.slice(writesBeforeSends).filter((w) => w.path.includes("r.lua"));
    expect(deliverWrites).toHaveLength(1);
    expect(parseSlotContent(deliverWrites[0]?.data as string).msgs).toEqual([
      { t: "progress", id: "p1", status: "tool", detail: "second" },
    ]);
  });
});

describe("link.sizing", () => {
  const shell = { t: "reply", id: "r", chat: "c", provider: "claude", summary: "s" } as const;
  const shellBytes = messageByteSize("", { ...shell, full: "" });
  const realSession = "0000002a-0000002b";

  it("rejects before the first hello a message that only fits without the 17-character session, and accepts one that fits with it", () => {
    const tooBig = { ...shell, full: "a".repeat(64 * 1024 - shellBytes) } as const;
    expect(messageByteSize("", tooBig)).toBe(64 * 1024);
    expect(messageByteSize(realSession, tooBig)).toBeGreaterThan(64 * 1024);
    const fits = { ...shell, full: "a".repeat(64 * 1024 - shellBytes - 17) } as const;
    expect(messageByteSize(realSession, fits)).toBe(64 * 1024);

    const link = createScreenLink({
      frameSource: noFrames(),
      fs: makeMemoryFs([]),
      paths,
      validWav: new Uint8Array([1]),
      emptyWav: new Uint8Array(0),
      autopoll: false,
    });
    activeLink = link;

    expect(link.send(tooBig)).toEqual({ ok: false, error: "too_large" });
    expect(link.send(fits).ok).toBe(true);
  });

  it("delivers a message sized to the limit with a real 17-character session in one slot instead of dropping it", async () => {
    const errors: unknown[] = [];
    const { link, writes } = await startConnected({
      session: realSession,
      delay: instantDelay,
      onCaptureError: (error) => errors.push(error),
    });
    const fits = { ...shell, full: "a".repeat(64 * 1024 - shellBytes - 17) } as const;
    const writesBefore = writes.length;

    expect(link.send(fits).ok).toBe(true);
    await link.idle();

    const delivered = writes.slice(writesBefore).filter((w) => w.path.includes("r.lua"));
    expect(delivered).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(parseSlotContent(delivered[0]?.data as string)).toEqual({
      session: realSession,
      msgs: [fits],
    });
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
    const ackSlots = deliverWrites
      .map((w) => parseSlotContent(w.data as string))
      .filter((slot) => JSON.stringify(slot.msgs).includes('"seq":42'));
    expect(ackSlots).toEqual([{ session: "sess-ask", msgs: [{ t: "ack", seq: 42 }] }]);
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
  it("retries a failed write into the same slot, leaves no hole, and ends with a valid signal there", async () => {
    const writes: RecordedWrite[] = [];
    const failedAttempts: RecordedWrite[] = [];
    let failNext: "none" | "r.lua" | "sig" = "none";
    const errors: unknown[] = [];
    const fs: SlotFs = {
      async readFile(path: string): Promise<Uint8Array | undefined> {
        return latestSignal(writes, path);
      },
      async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        if (failNext === "r.lua" && path.includes("r.lua")) {
          failNext = "none";
          failedAttempts.push({ path, data });
          throw new Error("EBUSY");
        }
        if (failNext === "sig" && path.startsWith("sig/") && (data as Uint8Array).length > 0) {
          failNext = "none";
          failedAttempts.push({ path, data });
          throw new Error("EPERM");
        }
        writes.push({ path, data });
      },
    };
    const { link } = await startConnected({
      session: "sess-a",
      delay: instantDelay,
      fs,
      onCaptureError: (error) => errors.push(error),
    });
    const reply = {
      t: "reply",
      id: "p1",
      chat: "general",
      provider: "claude",
      summary: "sum",
      full: "attempt-one",
    } as const;

    for (const failing of ["r.lua", "sig"] as const) {
      const before = writes.length;
      const slotsBefore = link.status().slotsLeft;
      failNext = failing;
      expect(link.send(reply).ok).toBe(true);
      await link.idle();

      const failedPath = failedAttempts[failedAttempts.length - 1]?.path ?? "";
      const failedIndex = Number(failedPath.match(/(\d+)/)?.[1]);
      expect(slotsBefore - link.status().slotsLeft).toBe(1);
      const after = writes.slice(before);
      const deliver = after.filter((w) => w.path.includes("r.lua"));
      expect([...new Set(deliver.map((w) => w.path))]).toEqual([
        `addons/WoWCompanion_R${failedIndex}/r.lua`,
      ]);
      expect(parseSlotContent(deliver[deliver.length - 1]?.data as string).msgs).toEqual([reply]);
      const signalWrites = after.filter((w) => w.path === `sig/${failedIndex}.wav`);
      const lastSignal = signalWrites[signalWrites.length - 1]?.data as Uint8Array;
      expect(lastSignal.length).toBeGreaterThan(0);
      expect(after.some((w) => w.path === `sig/${failedIndex + 1}.wav`)).toBe(false);
      expect(after.some((w) => w.path.includes(`_R${failedIndex + 1}/`))).toBe(false);
    }
    expect(failedAttempts).toHaveLength(2);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("link.reannounce", () => {
  it("N idle re-announces (again hellos, same session, not ahead) use zero slots", async () => {
    const helloDir = mkdtempSync(join(tmpdir(), "wowc-link-idle-hello-"));
    tmpDirs.push(helloDir);
    encodeHelloGrid(helloDir, "sess-idle", 1, 1);
    const helloGridPath = join(helloDir, "frame-0.grid");

    const againDir = mkdtempSync(join(tmpdir(), "wowc-link-idle-again-"));
    tmpDirs.push(againDir);
    encodeHelloGrid(againDir, "sess-idle", 1, 2, true);
    const againGridPath = join(againDir, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    let useAgain = false;
    const source = {
      async next() {
        const text = readFileSync(useAgain ? againGridPath : helloGridPath, "utf-8");
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
    const slotsLeftAfterHello = link.status().slotsLeft;
    const writesAfterHello = writes.length;

    useAgain = true;
    for (let i = 0; i < 5; i += 1) {
      await link.poll();
      await link.idle();
    }

    expect(link.status().slotsLeft).toBe(slotsLeftAfterHello);
    expect(writes.length).toBe(writesAfterHello);
  });
});

describe("link.atLeastOnce", () => {
  const reply = {
    t: "reply",
    id: "r1",
    chat: "general",
    provider: "claude",
    summary: "sum",
    full: "at-least-once-payload",
  } as const;

  it("re-queues what it wrote since the previous hello when a new session arrives, holds it behind an ack-only slot, and delivers it once a later frame confirms the ack was read", async () => {
    const { link, writes, feed } = await startConnected({
      session: "sess-alo-a",
      delay: instantDelay,
    });
    expect(link.send(reply).ok).toBe(true);
    await link.idle();
    const beforeResync = writes.filter((w) => w.path.includes("r.lua")).length;
    expect(
      parseSlotContent(writes.filter((w) => w.path.includes("r.lua")).pop()?.data as string),
    ).toEqual({
      session: "sess-alo-a",
      msgs: [reply],
    });

    await feed(encodeHelloGridFile("sess-alo-b", 1, 3));

    const afterAck = writes.filter((w) => w.path.includes("r.lua")).slice(beforeResync);
    expect(afterAck.map((w) => w.path)).toEqual(["addons/WoWCompanion_R0/r.lua"]);
    expect(parseSlotContent(afterAck[0]?.data as string)).toEqual({
      session: "sess-alo-b",
      msgs: [{ t: "ack", seq: 3 }],
    });

    await feed(encodeHelloGridFile("sess-alo-b", 2, 4, true));

    const redelivered = writes.filter((w) => w.path.includes("r.lua")).slice(beforeResync + 1);
    expect(redelivered.map((w) => w.path)).toEqual(["addons/WoWCompanion_R1/r.lua"]);
    expect(parseSlotContent(redelivered[0]?.data as string)).toEqual({
      session: "sess-alo-b",
      msgs: [reply],
    });
  });

  it("does not repeat a message across an again hello of the same session: nothing is re-queued without a re-sync", async () => {
    const { writes, link, feed } = await startConnected({
      session: "sess-alo-c",
      delay: instantDelay,
    });
    link.send(reply);
    await link.idle();
    const before = writes.filter((w) => w.path.includes("r.lua")).length;

    await feed(encodeHelloGridFile("sess-alo-c", 3, 5, true));
    await feed(encodeHelloGridFile("sess-alo-c", 3, 6, true));

    expect(writes.filter((w) => w.path.includes("r.lua")).length).toBe(before);
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("link.resync-race", () => {
  const reply = {
    t: "reply",
    id: "r-race",
    chat: "general",
    provider: "claude",
    summary: "sum",
    full: "race-payload",
  } as const;

  it("waits for a flush already in flight before it moves the allocator, so the re-synced slot is never skipped", async () => {
    const gate = deferred();
    let holdReplyWrite = false;
    const landed: RecordedWrite[] = [];
    const fs: SlotFs = {
      async readFile(path: string): Promise<Uint8Array | undefined> {
        return latestSignal(landed, path);
      },
      async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        if (holdReplyWrite && path.includes("r.lua")) {
          holdReplyWrite = false;
          await gate.promise;
        }
        landed.push({ path, data });
      },
    };
    const { link, feed } = await startConnected({
      session: "sess-race-a",
      delay: instantDelay,
      fs,
    });
    const before = landed.length;

    holdReplyWrite = true;
    expect(link.send(reply).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));

    let helloDone = false;
    const hello = feed(encodeHelloGridFile("sess-race-b", 1, 3)).then(() => {
      helloDone = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(helloDone).toBe(false);
    expect(landed.slice(before)).toEqual([]);

    gate.resolve();
    await hello;
    await feed(encodeHelloGridFile("sess-race-b", 2, 4, true));

    const deliveries = landed
      .slice(before)
      .filter((w) => w.path.includes("r.lua"))
      .map((w) => ({ path: w.path, ...parseSlotContent(w.data as string) }));
    expect(deliveries).toEqual([
      { path: "addons/WoWCompanion_R1/r.lua", session: "sess-race-a", msgs: [reply] },
      {
        path: "addons/WoWCompanion_R0/r.lua",
        session: "sess-race-b",
        msgs: [{ t: "ack", seq: 3 }],
      },
      { path: "addons/WoWCompanion_R1/r.lua", session: "sess-race-b", msgs: [reply] },
    ]);
    const lastSignal = (index: number): Uint8Array | undefined =>
      landed.filter((w) => w.path === `sig/${index}.wav`).pop()?.data as Uint8Array | undefined;
    expect((lastSignal(0) as Uint8Array).length).toBeGreaterThan(0);
    expect((lastSignal(1) as Uint8Array).length).toBeGreaterThan(0);
    expect((lastSignal(2) as Uint8Array).length).toBe(0);
  });

  it("starts no flush for an ack carried across a same-session re-sync until the signal reset has finished", async () => {
    const replyGate = deferred();
    const resetGate = deferred();
    let holdReplyWrite = false;
    let holdReset = false;
    const landed: RecordedWrite[] = [];
    const fs: SlotFs = {
      async readFile(path: string): Promise<Uint8Array | undefined> {
        return latestSignal(landed, path);
      },
      async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        if (holdReplyWrite && path.includes("r.lua")) {
          holdReplyWrite = false;
          await replyGate.promise;
        }
        if (holdReset && path.startsWith("sig/") && (data as Uint8Array).length === 0) {
          await resetGate.promise;
        }
        landed.push({ path, data });
      },
    };
    const { link, show } = await startConnected({
      session: "sess-race-e",
      delay: instantDelay,
      fs,
    });
    const askDir = mkdtempSync(join(tmpdir(), "wowc-link-race-ask-"));
    tmpDirs.push(askDir);
    encodeAskGrid(askDir, 50);

    holdReplyWrite = true;
    link.send(reply);
    await new Promise((resolve) => setTimeout(resolve, 5));
    show(join(askDir, "frame-0.grid"));
    await link.poll();

    holdReset = true;
    show(encodeHelloGridFile("sess-race-e", 6, 3, true));
    const resync = link.poll();
    await new Promise((resolve) => setTimeout(resolve, 10));
    replyGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = landed.length;
    link.send({ ...reply, id: "r-during" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(landed.slice(before).filter((w) => w.path.includes("r.lua"))).toEqual([]);

    holdReset = false;
    resetGate.resolve();
    await resync;
    await link.idle();

    const ackSlots = landed
      .filter((w) => w.path.includes("r.lua"))
      .filter((w) => JSON.stringify(parseSlotContent(w.data as string).msgs).includes('"seq":50'));
    expect(ackSlots.map((w) => w.path)).toEqual(["addons/WoWCompanion_R5/r.lua"]);
  });

  it("writes nothing while a re-sync's signal reset is still in flight: a send made meanwhile is held and lands after the ack-only slot", async () => {
    const gate = deferred();
    let holdReset = false;
    const landed: RecordedWrite[] = [];
    const fs: SlotFs = {
      async readFile(path: string): Promise<Uint8Array | undefined> {
        return latestSignal(landed, path);
      },
      async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        if (holdReset && path.startsWith("sig/") && (data as Uint8Array).length === 0) {
          await gate.promise;
        }
        landed.push({ path, data });
      },
    };
    const { link, feed } = await startConnected({
      session: "sess-race-c",
      delay: instantDelay,
      fs,
    });
    const before = landed.length;

    holdReset = true;
    const hello = feed(encodeHelloGridFile("sess-race-d", 2, 3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(link.send(reply).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(landed.slice(before).filter((w) => w.path.includes("r.lua"))).toEqual([]);

    holdReset = false;
    gate.resolve();
    await hello;
    await feed(encodeHelloGridFile("sess-race-d", 3, 4, true));

    const deliveries = landed
      .slice(before)
      .filter((w) => w.path.includes("r.lua"))
      .map((w) => ({ path: w.path, ...parseSlotContent(w.data as string) }));
    expect(deliveries).toEqual([
      {
        path: "addons/WoWCompanion_R1/r.lua",
        session: "sess-race-d",
        msgs: [{ t: "ack", seq: 3 }],
      },
      { path: "addons/WoWCompanion_R2/r.lua", session: "sess-race-d", msgs: [reply] },
    ]);
  });
});

describe("link.exhausted", () => {
  it("stops the flush chain on slots_exhausted until the next re-sync, and drops pending acks on a session change", async () => {
    const helloDir = mkdtempSync(join(tmpdir(), "wowc-link-exhausted-hello-"));
    tmpDirs.push(helloDir);
    encodeHelloGrid(helloDir, "sess-x", 1, 1);
    const helloGrid = join(helloDir, "frame-0.grid");

    const askDir = mkdtempSync(join(tmpdir(), "wowc-link-exhausted-ask-"));
    tmpDirs.push(askDir);
    encodeAskGrid(askDir, 50);
    const askGrid = join(askDir, "frame-0.grid");

    const helloBDir = mkdtempSync(join(tmpdir(), "wowc-link-exhausted-hellob-"));
    tmpDirs.push(helloBDir);
    encodeHelloGrid(helloBDir, "sess-y", 1, 2);
    const helloBGrid = join(helloBDir, "frame-0.grid");

    const writes: RecordedWrite[] = [];
    const errors: unknown[] = [];
    let stage: "helloA" | "ask" | "helloB" = "helloA";
    const source = {
      async next() {
        const path = stage === "helloA" ? helloGrid : stage === "ask" ? askGrid : helloBGrid;
        const text = readFileSync(path, "utf-8");
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
      slotCount: 1,
      delay: () => new Promise((resolve) => setTimeout(resolve, 1)),
      onCaptureError: (error) => errors.push(error),
    });
    activeLink = link;

    await link.poll();
    await link.idle();
    expect(link.status().slotsLeft).toBe(0);

    stage = "ask";
    await link.poll();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const errorsAfterExhaustion = errors.length;
    expect(errorsAfterExhaustion).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(errors.length).toBe(errorsAfterExhaustion);

    stage = "helloB";
    await link.poll();
    await link.idle();

    expect(link.status().slotsLeft).toBe(0);
    const deliverWrites = writes.filter((w) => w.path.includes("r.lua"));
    const last = deliverWrites[deliverWrites.length - 1];
    expect(parseSlotContent(last?.data as string)).toEqual({
      session: "sess-y",
      msgs: [{ t: "ack", seq: 2 }],
    });
  });
});
