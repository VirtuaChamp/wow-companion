import { readFileSync } from "node:fs";
import path from "node:path";
import { parseGameToCompanion } from "@wow-companion/contracts";
import type { Provider, ProviderId, Result, Snapshot } from "@wow-companion/contracts";
import { createClaude } from "../adapters/providers/claude.ts";
import { createCodexWith } from "../adapters/providers/codex.ts";
import { createCursorWith, parseListModelsOutput } from "../adapters/providers/cursor.ts";
import { runProcess } from "../adapters/providers/spawn.ts";
import { isRecord, readJsonFile, writeJsonAtomic } from "../adapters/json-file.ts";
import { readSettings, writeSettings } from "../adapters/settings-store.ts";
import { readChatsState, writeChatsState } from "../adapters/state-store.ts";
import { configErrorMessage, parseConfig } from "../config.ts";
import type { Config } from "../config.ts";
import { emptyChatsState } from "../core/chats.ts";
import type { ChatsState } from "../core/chats.ts";
import type { Settings } from "../core/settings.ts";
import { slotAddonName, slotSignalFileName } from "../transport/slots.ts";
import type { SlotPaths } from "../transport/slots.ts";
import type { Store } from "./context.ts";
import { createProbes } from "./probe.ts";
import type { Probes } from "./probe.ts";
import { settingsFromConfig } from "./settings.ts";

const PROBE_TIMEOUT_MS = 5000;

type StartupFiles = { chats: string; settings: string; game: string };

export type Startup = {
  config: Config;
  files: StartupFiles;
  workspace: string;
  initialChats: ChatsState;
  initialSettings: Settings;
  initialGame: Partial<Snapshot>;
  version: string | undefined;
};

export function slotPaths(wowPath: string): SlotPaths {
  const addons = path.join(wowPath, "Interface", "AddOns");
  return {
    addonDeliverFile: (index) => path.join(addons, slotAddonName(index), "r.lua"),
    signalFile: (index) =>
      path.join(addons, "WoWCompanion_Signals", "sig", slotSignalFileName(index)),
  };
}

function readVersion(packageJsonPath: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return isRecord(parsed) && typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function unwrapWrite(name: string, written: Result<void, string>): void {
  if (!written.ok) throw new Error(`${name}: ${written.error}`);
}

export function chatsStore(file: string): Store<ChatsState> {
  return { save: async (state) => unwrapWrite("chats.json", await writeChatsState(file, state)) };
}

export function settingsStore(file: string): Store<Settings> {
  return { save: async (value) => unwrapWrite("settings.json", await writeSettings(file, value)) };
}

export function gameStore(file: string): Store<Partial<Snapshot>> {
  return { save: async (game) => unwrapWrite("game.json", await writeJsonAtomic(file, game)) };
}

async function loadGame(file: string, log: (line: string) => void): Promise<Partial<Snapshot>> {
  const read = await readJsonFile(file);
  if (!read.ok) {
    if (read.error !== "read_missing")
      log(`game.json cannot be read (${read.error}): starting without last known context`);
    return {};
  }
  const parsed = parseGameToCompanion({ t: "state", seq: 0, delta: read.value });
  if (parsed.ok && parsed.value.t === "state") return parsed.value.delta;
  log("game.json does not hold a snapshot: starting without last known context");
  return {};
}

export async function loadStartup(
  root: string,
  log: (line: string) => void,
): Promise<Result<Startup, string>> {
  const read = await readJsonFile(path.join(root, "config.json"));
  if (!read.ok) {
    return {
      ok: false,
      error: "config.json is missing or not valid JSON: copy config.example.json and fill it in",
    };
  }
  const parsed = parseConfig(read.value);
  if (!parsed.ok) return { ok: false, error: configErrorMessage(parsed.error) };
  const config = parsed.value;
  const stateDir = path.join(root, "apps", "companion", "state");
  const files: StartupFiles = {
    chats: path.join(stateDir, "chats.json"),
    settings: path.join(stateDir, "settings.json"),
    game: path.join(stateDir, "game.json"),
  };

  const chatsRead = await readChatsState(files.chats);
  if (!chatsRead.ok && chatsRead.error !== "read_missing") {
    return { ok: false, error: `${files.chats} cannot be read: ${chatsRead.error}` };
  }
  const settingsRead = await readSettings(files.settings);
  if (!settingsRead.ok && settingsRead.error !== "read_missing") {
    return { ok: false, error: `${files.settings} cannot be read: ${settingsRead.error}` };
  }
  return {
    ok: true,
    value: {
      config,
      files,
      workspace: path.join(root, "apps", "companion", "workspace"),
      initialChats: chatsRead.ok ? chatsRead.value : emptyChatsState,
      initialSettings: settingsRead.ok ? settingsRead.value : settingsFromConfig(config),
      initialGame: await loadGame(files.game, log),
      version: readVersion(path.join(root, "package.json")),
    },
  };
}

export function createProviderProbes(workspace: string): Probes {
  return createProbes({
    cwd: workspace,
    commands: [
      { command: "codex" },
      { command: "cursor-agent", listModels: parseListModelsOutput },
    ],
    timeoutMs: PROBE_TIMEOUT_MS,
  });
}

export function buildProviders(input: {
  config: Config;
  root: string;
  workspace: string;
  probes: Probes;
}): Map<ProviderId, Provider> {
  const { config, root, workspace, probes } = input;
  const mcpServer = path.join(root, "apps", "mcp", "src", "server.ts");
  const dbPath = path.join(root, "data", "questie.sqlite");
  const providerConfig = (id: ProviderId) => ({
    cwd: workspace,
    timeoutMs: config.timeoutMs,
    models: config.providers[id].models,
    mcp: (runId: string) => ({
      command: process.execPath,
      args: [mcpServer],
      env: { WOWC_RUN: runId, WOWC_DB_PATH: dbPath, WOWC_PORT: String(config.companionPort) },
    }),
  });
  return new Map<ProviderId, Provider>([
    ["claude", createClaude(providerConfig("claude"))],
    [
      "codex",
      createCodexWith(runProcess, () => probes.installed("codex"))(providerConfig("codex")),
    ],
    [
      "cursor",
      createCursorWith(
        runProcess,
        () => probes.installed("cursor-agent"),
        () => probes.models("cursor-agent"),
        false,
      )(providerConfig("cursor")),
    ],
  ]);
}
