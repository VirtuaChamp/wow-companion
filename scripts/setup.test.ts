import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSetup } from "./setup.ts";

const dirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scripts/setup.ts", () => {
  it("installs the addon, generates 200 slot addons and sig/ files under a temp AddOns dir", () => {
    const wowPath = makeTempDir("wowc-wowpath-");
    const repoAddonDir = join(import.meta.dirname, "..", "addon", "WoWCompanion");

    const result = runSetup({ wowPath, repoAddonDir, slotCount: 200 });

    expect(existsSync(join(result.addonDir, "WoWCompanion.toc"))).toBe(true);
    expect(existsSync(join(result.addonDir, "Inbox.lua"))).toBe(true);
    expect(existsSync(join(result.addonDir, "Codec.lua"))).toBe(true);

    expect(result.slotsCreated).toBe(200);
    const slotDir1 = join(result.addonsRoot, "WoWCompanion_R001");
    expect(existsSync(join(slotDir1, "WoWCompanion_R001.toc"))).toBe(true);
    expect(existsSync(join(slotDir1, "r.lua"))).toBe(true);
    const slotDir200 = join(result.addonsRoot, "WoWCompanion_R200");
    expect(existsSync(join(slotDir200, "r.lua"))).toBe(true);
    expect(existsSync(join(result.addonsRoot, "WoWCompanion_R201"))).toBe(false);

    const sigFiles = readdirSync(join(result.signalsRoot, "sig"));
    expect(sigFiles).toHaveLength(202);
    expect(sigFiles).toContain("001.wav");
    expect(sigFiles).toContain("200.wav");
    expect(sigFiles).toContain("ctl-present.wav");
    expect(sigFiles).toContain("ctl-gone.wav");
    for (let index = 1; index <= 200; index += 1) {
      expect(sigFiles).toContain(`${String(index).padStart(3, "0")}.wav`);
    }
    const sig001 = readFileSync(join(result.signalsRoot, "sig", "001.wav"));
    expect(sig001.length).toBe(0);

    expect(existsSync(join(result.signalsRoot, "alive"))).toBe(false);
  });

  it("writes every r.lua placeholder as a deliver call with a nil session, never an empty file", () => {
    const wowPath = makeTempDir("wowc-wowpath-placeholder-");
    const repoAddonDir = join(import.meta.dirname, "..", "addon", "WoWCompanion");

    const result = runSetup({ wowPath, repoAddonDir, slotCount: 3 });

    for (const name of ["WoWCompanion_R001", "WoWCompanion_R002", "WoWCompanion_R003"]) {
      expect(readFileSync(join(result.addonsRoot, name, "r.lua"), "utf-8")).toBe(
        "WoWCompanion_Deliver(nil, nil)",
      );
    }
  });

  it("creates the two self-test signal files, empty, next to the slot signals", () => {
    const wowPath = makeTempDir("wowc-wowpath-ctl-");
    const repoAddonDir = join(import.meta.dirname, "..", "addon", "WoWCompanion");

    const result = runSetup({ wowPath, repoAddonDir, slotCount: 2 });

    const sigDir = join(result.signalsRoot, "sig");
    expect(readdirSync(sigDir).sort()).toEqual([
      "001.wav",
      "002.wav",
      "ctl-gone.wav",
      "ctl-present.wav",
    ]);
    expect(readFileSync(join(sigDir, "ctl-present.wav")).length).toBe(0);
    expect(readFileSync(join(sigDir, "ctl-gone.wav")).length).toBe(0);
  });

  it("writes only under the given wowPath, never a real game install", () => {
    const wowPath = makeTempDir("wowc-wowpath-isolated-");
    const repoAddonDir = join(import.meta.dirname, "..", "addon", "WoWCompanion");

    const result = runSetup({ wowPath, repoAddonDir, slotCount: 5 });

    expect(result.addonsRoot.startsWith(wowPath)).toBe(true);
    expect(result.slotsCreated).toBe(5);
    expect(existsSync(join(result.addonsRoot, "WoWCompanion_R006"))).toBe(false);
  });
});
