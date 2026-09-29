import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const SLOT_COUNT = 200;
const EMPTY_WAV = new Uint8Array(0);
const SLOT_PLACEHOLDER = "WoWCompanion_Deliver(nil, nil)";
const CONTROL_SIGNAL_FILES = ["ctl-present.wav", "ctl-gone.wav"];

function slotAddonName(index: number): string {
  return `WoWCompanion_R${String(index + 1).padStart(3, "0")}`;
}

function slotSignalFileName(index: number): string {
  return `${String(index + 1).padStart(3, "0")}.wav`;
}

export type SetupOptions = {
  wowPath: string;
  repoAddonDir: string;
  slotCount?: number;
};

export type SetupResult = {
  addonsRoot: string;
  addonDir: string;
  signalsRoot: string;
  slotsCreated: number;
};

function copyAddonFiles(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (entry.endsWith(".lua") || entry.endsWith(".toc")) {
      copyFileSync(join(srcDir, entry), join(destDir, entry));
    }
  }
}

function slotToc(): string {
  return "## Interface: 16001\n## LoadOnDemand: 1\nr.lua\n";
}

function writeSlotAddon(addonsRoot: string, index: number): void {
  const name = slotAddonName(index);
  const dir = join(addonsRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.toc`), slotToc());
  writeFileSync(join(dir, "r.lua"), SLOT_PLACEHOLDER);
}

export function runSetup(options: SetupOptions): SetupResult {
  const addonsRoot = join(options.wowPath, "Interface", "AddOns");
  const addonDir = join(addonsRoot, "WoWCompanion");
  copyAddonFiles(options.repoAddonDir, addonDir);

  const signalsRoot = join(addonsRoot, "WoWCompanion_Signals");
  const sigDir = join(signalsRoot, "sig");
  mkdirSync(sigDir, { recursive: true });

  const slotCount = options.slotCount ?? SLOT_COUNT;
  for (let i = 0; i < slotCount; i += 1) {
    writeSlotAddon(addonsRoot, i);
    writeFileSync(join(sigDir, slotSignalFileName(i)), EMPTY_WAV);
  }

  for (const name of CONTROL_SIGNAL_FILES) {
    writeFileSync(join(sigDir, name), EMPTY_WAV);
  }

  return { addonsRoot, addonDir, signalsRoot, slotsCreated: slotCount };
}

function main(): void {
  const configPath = join(process.cwd(), "config.json");
  if (!existsSync(configPath)) {
    console.error(`config.json not found at ${configPath}; create it with a wowPath field`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as { wowPath?: unknown };
  if (typeof config.wowPath !== "string" || config.wowPath.length === 0) {
    console.error("config.json is missing wowPath; set it to the flavour folder holding WowB.exe");
    process.exit(1);
  }
  const result = runSetup({
    wowPath: config.wowPath,
    repoAddonDir: join(process.cwd(), "addon", "WoWCompanion"),
  });
  console.log(`installed WoWCompanion into ${result.addonDir}`);
  console.log(`generated ${result.slotsCreated} reply slots under ${result.addonsRoot}`);
  console.log(`signal files under ${result.signalsRoot}`);
  console.log(
    "restart the game client now: it only sees signal files that existed when it launched",
  );
}

if (import.meta.main) {
  main();
}
