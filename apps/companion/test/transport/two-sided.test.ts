import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import type { CompanionToGame } from "@wow-companion/contracts";
import { createGridFileSource } from "../../src/transport/capture.ts";
import { createScreenLink } from "../../src/transport/screen-link.ts";
import type { ScreenLink } from "../../src/transport/screen-link.ts";
import type { SlotFs, SlotPaths } from "../../src/transport/slots.ts";
import { cleanScratch, repoRoot, resolveLuaCommand, scratchDir } from "./link-harness.ts";

const SLOT_COUNT = 10;

type AddonInfo = {
  session: string;
  slot: number;
  paintCount: number;
  painted: { t: string; again?: boolean; slot?: number } | null;
  received: { t: string; id?: string }[];
};

type Sim = {
  command(line: string): Promise<string>;
  info(): Promise<AddonInfo>;
  kill(): void;
};

function startSim(dir: string): Sim {
  const child: ChildProcessWithoutNullStreams = spawn(
    resolveLuaCommand(),
    [join(import.meta.dirname, "two_sided_addon.lua"), dir],
    { cwd: repoRoot },
  );
  const lines = createInterface({ input: child.stdout });
  const waiting: ((line: string) => void)[] = [];
  lines.on("line", (line) => {
    waiting.shift()?.(line);
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf-8");
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      for (const resolve of waiting.splice(0)) {
        resolve(`err lua exited ${code}: ${stderr}`);
      }
    }
  });

  async function command(line: string): Promise<string> {
    const reply = new Promise<string>((resolve) => waiting.push(resolve));
    child.stdin.write(`${line}\n`);
    const answer = await reply;
    if (answer.startsWith("err")) {
      throw new Error(`addon simulation: ${line} -> ${answer}`);
    }
    return answer;
  }

  return {
    command,
    async info(): Promise<AddonInfo> {
      return JSON.parse(await command("info")) as AddonInfo;
    },
    kill(): void {
      lines.close();
      child.kill();
    },
  };
}

const pad = (index: number): string => String(index + 1).padStart(3, "0");

type World = {
  dir: string;
  sim: Sim;
  fsWrites: { path: string; data: string | Uint8Array }[];
  failNext: { value: "none" | "r.lua" | "sig" };
  startLink(): ScreenLink;
  captureInto(link: ScreenLink): Promise<void>;
  addonPolls(count: number): Promise<void>;
  addonTick(name: "repaint" | "poll" | "hello", count?: number): Promise<void>;
};

let sims: Sim[] = [];
let links: ScreenLink[] = [];

afterEach(() => {
  for (const link of links) {
    link.close();
  }
  links = [];
  for (const sim of sims) {
    sim.kill();
  }
  sims = [];
  cleanScratch();
});

function createWorld(): World {
  const dir = scratchDir("wowc-two-sided-");
  mkdirSync(join(dir, "sig"), { recursive: true });
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    mkdirSync(join(dir, "addons", `WoWCompanion_R${pad(i)}`), { recursive: true });
  }
  const sim = startSim(dir);
  sims.push(sim);
  const fsWrites: { path: string; data: string | Uint8Array }[] = [];
  const failNext: { value: "none" | "r.lua" | "sig" } = { value: "none" };
  const paths: SlotPaths = {
    addonDeliverFile: (i) => join(dir, "addons", `WoWCompanion_R${pad(i)}`, "r.lua"),
    signalFile: (i) => join(dir, "sig", `${pad(i)}.wav`),
  };
  const fs: SlotFs = {
    async readFile(path: string): Promise<Uint8Array | undefined> {
      try {
        return await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    },
    async writeFile(path: string, data: string | Uint8Array): Promise<void> {
      if (failNext.value === "r.lua" && path.endsWith("r.lua")) {
        failNext.value = "none";
        throw new Error("EBUSY");
      }
      if (failNext.value === "sig" && path.endsWith(".wav") && data.length > 0) {
        failNext.value = "none";
        throw new Error("EPERM");
      }
      await writeFile(path, data);
      fsWrites.push({ path, data });
    },
  };
  const gridPath = join(dir, "grid.txt");

  return {
    dir,
    sim,
    fsWrites,
    failNext,
    startLink(): ScreenLink {
      const link = createScreenLink({
        frameSource: createGridFileSource(gridPath),
        fs,
        paths,
        validWav: new Uint8Array([1, 2, 3]),
        emptyWav: new Uint8Array(0),
        autopoll: false,
        slotCount: SLOT_COUNT,
        delay: () => Promise.resolve(),
      });
      links.push(link);
      return link;
    },
    async captureInto(link: ScreenLink): Promise<void> {
      await sim.command("grid");
      await link.poll();
      await link.idle();
    },
    async addonPolls(count: number): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        await sim.command("tick poll");
      }
    },
    async addonTick(name, count = 1): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        await sim.command(`tick ${name}`);
      }
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

async function converge(world: World, link: ScreenLink): Promise<void> {
  await world.captureInto(link);
  await world.addonPolls(1);
  await world.addonTick("hello");
  await world.captureInto(link);
}

const receivedIds = (info: AddonInfo): (string | undefined)[] => info.received.map((m) => m.id);

describe("two-sided simulation: the real Inbox.lua against the real screen-link", () => {
  it("boots, converges on the ack, stops re-painting the hello, then receives a reply in a later slot", async () => {
    const world = createWorld();
    await world.sim.command("load");
    const link = world.startLink();

    await world.captureInto(link);
    expect(link.status().connected).toBe(true);

    await world.addonPolls(1);
    let info = await world.sim.info();
    expect(info.slot).toBe(2);
    const painted = info.paintCount;
    await world.addonTick("repaint", 5);
    expect((await world.sim.info()).paintCount).toBe(painted);

    expect(link.send(reply("first")).ok).toBe(true);
    await link.idle();
    await world.addonPolls(1);
    expect(receivedIds(await world.sim.info())).toEqual([]);

    await world.addonTick("hello");
    await world.captureInto(link);
    await world.addonPolls(1);

    info = await world.sim.info();
    expect(receivedIds(info)).toEqual(["first"]);
    expect(info.slot).toBe(3);
    expect(link.status().slotsLeft).toBe(SLOT_COUNT - (info.slot - 1));
  });

  it("a /reload after slots were written and read converges on the new session and nothing is lost that was still unread", async () => {
    const world = createWorld();
    await world.sim.command("load");
    const link = world.startLink();
    await converge(world, link);
    await world.addonPolls(1);

    expect(link.send(reply("read-before-reload")).ok).toBe(true);
    await link.idle();
    await world.addonPolls(1);
    expect(receivedIds(await world.sim.info())).toEqual(["read-before-reload"]);
    expect(link.send(reply("unread-at-reload")).ok).toBe(true);
    await link.idle();

    await world.sim.command("load");
    const reloaded = await world.sim.info();
    expect(reloaded.slot).toBe(1);
    expect(receivedIds(reloaded)).toEqual([]);

    await world.captureInto(link);
    await world.addonPolls(1);
    await world.addonTick("hello");
    await world.captureInto(link);
    await world.addonPolls(1);

    const after = await world.sim.info();
    expect(receivedIds(after)).toContain("unread-at-reload");
    expect(after.slot).toBe(3);
    expect(link.status().slotsLeft).toBe(SLOT_COUNT - (after.slot - 1));
  });

  it("a /reload whose stale-slot walk beats the hello capture still delivers the unread old-session reply once in the new session", async () => {
    const world = createWorld();
    await world.sim.command("load");
    const link = world.startLink();
    await converge(world, link);
    await world.addonPolls(1);
    for (const id of ["stale-1", "stale-2"]) {
      expect(link.send(reply(id)).ok).toBe(true);
      await link.idle();
      await world.addonPolls(1);
    }
    expect(receivedIds(await world.sim.info())).toEqual(["stale-1", "stale-2"]);
    await world.addonTick("repaint", 2);
    await world.addonTick("hello");
    await world.captureInto(link);
    expect(link.send(reply("unread-old")).ok).toBe(true);
    await link.idle();

    await world.sim.command("load");
    await world.addonPolls(6);
    const walked = await world.sim.info();
    expect(walked.slot).toBe(5);
    expect(receivedIds(walked)).toEqual([]);
    await world.addonTick("repaint");
    expect((await world.sim.info()).painted).toMatchObject({ t: "hello", slot: 5 });

    await world.captureInto(link);
    await world.addonPolls(1);
    await world.addonTick("hello");
    await world.captureInto(link);
    await world.addonPolls(1);
    expect(link.send(reply("after-reload")).ok).toBe(true);
    await link.idle();
    await world.addonPolls(1);

    const converged = await world.sim.info();
    expect(receivedIds(converged)).toEqual(["unread-old", "after-reload"]);
    expect(link.status().slotsLeft).toBe(SLOT_COUNT - (converged.slot - 1));
  });

  it("a restarted companion that only sees again hellos re-syncs to the addon's position and delivers what was queued before it saw a hello", async () => {
    const world = createWorld();
    await world.sim.command("load");
    const first = world.startLink();
    await converge(world, first);
    await world.addonPolls(1);
    expect(first.send(reply("before-restart")).ok).toBe(true);
    await first.idle();
    await world.addonPolls(1);
    first.close();
    const before = await world.sim.info();
    expect(receivedIds(before)).toEqual(["before-restart"]);

    const restarted = world.startLink();
    expect(restarted.send(reply("queued-while-down")).ok).toBe(true);
    await world.addonTick("repaint", 2);
    await world.addonTick("hello");
    await world.captureInto(restarted);
    await world.addonPolls(1);

    const after = await world.sim.info();
    expect(receivedIds(after)).toEqual(["before-restart", "queued-while-down"]);
    expect(restarted.status().slotsLeft).toBe(SLOT_COUNT - (after.slot - 1));
  });

  it("a restarted companion delivers the unread slots the previous process wrote, in order, and then its new messages", async () => {
    const world = createWorld();
    await world.sim.command("load");
    const first = world.startLink();
    await converge(world, first);
    await world.addonPolls(1);
    for (const id of ["unread-1", "unread-2"]) {
      expect(first.send(reply(id)).ok).toBe(true);
      await first.idle();
    }
    first.close();
    expect(receivedIds(await world.sim.info())).toEqual([]);

    const restarted = world.startLink();
    expect(restarted.send(reply("new-after-restart")).ok).toBe(true);
    await world.addonTick("repaint", 2);
    await world.addonTick("hello");
    await world.captureInto(restarted);
    await world.addonPolls(4);

    const after = await world.sim.info();
    expect(receivedIds(after)).toEqual(["unread-1", "unread-2", "new-after-restart"]);
    expect(restarted.status().slotsLeft).toBe(SLOT_COUNT - (after.slot - 1));
  });

  it("a restarted companion that captures a stale again hello (behind the addon's real position) loses nothing and writes nothing behind the addon", async () => {
    const world = createWorld();
    await world.sim.command("load");
    const first = world.startLink();
    await converge(world, first);
    await world.addonPolls(1);
    expect(first.send(reply("read-1")).ok).toBe(true);
    await first.idle();
    await world.addonPolls(1);
    first.close();
    expect((await world.sim.info()).painted).toMatchObject({ t: "hello", again: true, slot: 2 });

    const restarted = world.startLink();
    expect(restarted.send(reply("after-stale-hello")).ok).toBe(true);
    await world.captureInto(restarted);
    await world.addonPolls(1);

    const after = await world.sim.info();
    expect(receivedIds(after)).toEqual(["read-1", "after-stale-hello"]);
    expect(after.slot).toBe(4);
    expect(restarted.status().slotsLeft).toBe(SLOT_COUNT - (after.slot - 1));
  });

  it("a slot write that fails once is retried into the same slot: no hole, the addon reads it exactly once", async () => {
    const world = createWorld();
    await world.sim.command("load");
    const link = world.startLink();
    await converge(world, link);
    await world.addonPolls(1);

    for (const failing of ["r.lua", "sig"] as const) {
      const id = `after-${failing}-failure`;
      world.failNext.value = failing;
      expect(link.send(reply(id)).ok).toBe(true);
      await link.idle();
      await world.addonPolls(1);
    }

    const info = await world.sim.info();
    expect(receivedIds(info)).toEqual(["after-r.lua-failure", "after-sig-failure"]);
    expect(info.slot).toBe(4);
    expect(link.status().slotsLeft).toBe(SLOT_COUNT - (info.slot - 1));
  });

  it("N idle re-announces use no slot on either side", async () => {
    const world = createWorld();
    await world.sim.command("load");
    const link = world.startLink();
    await converge(world, link);
    await world.addonPolls(1);
    const slotsLeft = link.status().slotsLeft;
    const slotWrites = world.fsWrites.length;
    const addonSlot = (await world.sim.info()).slot;

    for (let i = 0; i < 6; i += 1) {
      await world.addonTick("hello");
      await world.captureInto(link);
      await world.addonTick("repaint", 2);
      await world.addonPolls(1);
    }

    expect(link.status().slotsLeft).toBe(slotsLeft);
    expect(world.fsWrites.length).toBe(slotWrites);
    expect((await world.sim.info()).slot).toBe(addonSlot);
  });
});
