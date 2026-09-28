import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GameToCompanion } from "@wow-companion/contracts";
import { decodeGrid, reassemble } from "../../src/transport/codec.ts";
import type { FrameBuffer } from "../../src/transport/codec.ts";
import { parseCellGridFile } from "../../src/transport/grid.ts";
import { repoRoot, resolveLuaCommand } from "../transport/link-harness.ts";
import { hello, startDaemon, waitFor } from "./helpers.ts";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function encodeInLua(mode: string): GameToCompanion[] {
  const dir = mkdtempSync(join(tmpdir(), "wowc-state-"));
  scratch.push(dir);
  const run = spawnSync(
    resolveLuaCommand(),
    [join(import.meta.dirname, "state_sender_encode.lua"), dir, mode],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`lua failed: ${run.stderr}${run.stdout}`);
  const count = Number(readFileSync(join(dir, "count.txt"), "utf8"));
  const files = readdirSync(dir).filter((name) => name.endsWith(".grid"));
  const messages: GameToCompanion[] = [];
  for (let index = 1; index <= count; index += 1) {
    const frameFiles = files
      .filter((name) => name.startsWith(`msg-${String(index)}-`))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let buffer: FrameBuffer;
    for (const name of frameFiles) {
      const grid = parseCellGridFile(readFileSync(join(dir, name), "utf8"));
      if (!grid.ok) throw new Error("bad grid file");
      const frame = decodeGrid(grid.value);
      if (!frame.ok) throw new Error("bad frame");
      const step = reassemble(buffer, frame.value);
      buffer = step.buf;
      if (step.message !== undefined) {
        if (!step.message.ok) throw new Error(`bad message: ${step.message.error}`);
        messages.push(step.message.value);
      }
    }
  }
  return messages;
}

describe("daemon.state-integration", () => {
  it("carries the real State.snapshot through the Lua encoder, the TS decoder and onState into GET /state", async () => {
    const messages = encodeInLua("full");

    expect(messages).toHaveLength(1);
    const first = messages[0];
    if (first?.t !== "state") throw new Error("expected a state message");
    expect(Object.keys(first.delta).sort()).toEqual(
      [
        "bags",
        "character",
        "equipped",
        "money",
        "position",
        "professions",
        "quests",
        "talents",
      ].sort(),
    );

    const harness = startDaemon();
    try {
      harness.link.push(hello());
      harness.link.push(first);
      await waitFor(() => harness.daemon.api.getState().ok);
      const state = harness.daemon.api.getState();
      if (!state.ok) throw new Error("expected ok");
      expect(state.value.money).toBe(12345);
      expect(state.value.equipped).toHaveLength(19);
      expect(state.value.bags[0]).toMatchObject({ itemId: 2001, count: 3 });
    } finally {
      await harness.stop();
    }
  });

  it("sends nothing while the real snapshot lacks a character, so a partial first state never reaches the daemon", () => {
    expect(encodeInLua("nofaction")).toEqual([]);
  });
});
