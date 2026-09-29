import { createMemoryLink } from "@wow-companion/contracts";
import type {
  CompanionToGame,
  Effort,
  GameToCompanion,
  Provider,
  ProviderError,
  ProviderId,
  Result,
  Snapshot,
} from "@wow-companion/contracts";
import { vi } from "vitest";
import type { ChatsState } from "../../src/core/chats.ts";
import { createChat, emptyChatsState } from "../../src/core/chats.ts";
import type { Settings } from "../../src/core/settings.ts";
import type { Config } from "../../src/config.ts";
import { createDaemon, settingsFromConfig } from "../../src/main.ts";
import type { Daemon, DaemonDeps } from "../../src/main.ts";
import { createLocalApiServer } from "../../src/local-api-server.ts";
import type { LocalApiServer } from "../../src/local-api-server.ts";

export function makeSnapshot(): Snapshot {
  return {
    character: {
      name: "Testalot",
      level: 10,
      classId: 8,
      raceId: 1,
      faction: "Alliance",
      xp: 100,
      xpMax: 1000,
    },
    position: { uiMapId: 85, zone: "Elwynn Forest", subzone: "", x: 40, y: 60 },
    money: 500,
    quests: [],
    equipped: [{ slot: 5, itemId: 200, itemLevel: 10 }],
    bags: [],
    professions: [],
    talents: [],
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    wowPath: "wow-path-placeholder",
    provider: "claude",
    providers: {
      claude: { enabled: true, model: "m1", effort: "low", models: ["m1", "m2"] },
      codex: { enabled: true, model: "c1", models: ["c1"] },
      cursor: { enabled: false, model: "u1", models: [] },
    },
    companionPort: 47831,
    slotCount: 200,
    timeoutMs: 600000,
    ...overrides,
  };
}

export type RunInput = Parameters<Provider["run"]>[0];
export type RunFn = (
  input: RunInput,
  onEvent: Parameters<Provider["run"]>[1],
) => Promise<Result<{ sessionId: string; text: string }, ProviderError>>;

export function fakeProvider(
  id: ProviderId,
  run: RunFn,
  models: string[] = ["m1", "m2"],
  efforts: Effort[] = ["low", "high"],
): Provider {
  return {
    id,
    async describe() {
      return { installed: true, enabled: true, models, efforts };
    },
    run,
  };
}

export function okRun(text: string): RunFn {
  return async () => ({ ok: true, value: { sessionId: "s-1", text } });
}

function chatsWithUserTitledDefault(): ChatsState {
  const seeded = createChat(emptyChatsState, "default", "Default", "claude", 1000, "user");
  if (!seeded.ok) throw new Error("seed failed");
  return seeded.value.state;
}

export type Harness = {
  daemon: Daemon;
  link: ReturnType<typeof createMemoryLink>;
  saves: ChatsState[];
  settingsSaves: Settings[];
  gameSaves: Partial<Snapshot>[];
  stop: () => Promise<void>;
};

export function startDaemon(
  overrides: Partial<Omit<DaemonDeps, "link">> & { providers?: DaemonDeps["providers"] } = {},
): Harness {
  const link = createMemoryLink();
  const saves: ChatsState[] = [];
  const gameSaves: Partial<Snapshot>[] = [];
  const settingsSaves: Settings[] = [];
  let counter = 0;
  const config = overrides.config ?? makeConfig();
  const daemon = createDaemon({
    link,
    config,
    providers: new Map([["claude", fakeProvider("claude", okRun("pong"))]]),
    initialChats: chatsWithUserTitledDefault(),
    initialSettings: settingsFromConfig(config),
    initialGame: {},
    settingsStore: {
      async save(settings) {
        settingsSaves.push(settings);
      },
    },
    chatsStore: {
      async save(state) {
        saves.push(state);
      },
    },
    gameStore: {
      async save(snapshot) {
        gameSaves.push(snapshot);
      },
    },
    now: () => 1000,
    newId: () => {
      counter += 1;
      return `id${String(counter)}`;
    },
    log: () => {},
    gameWriteIntervalMs: 20,
    ...overrides,
  });
  link.setConnected(true);
  daemon.start();
  return { daemon, link, saves, settingsSaves, gameSaves, stop: () => daemon.stop() };
}

export function hello(again = false): GameToCompanion {
  return {
    t: "hello",
    v: 1,
    build: "70009",
    iface: 16001,
    session: "sess-1",
    slot: 0,
    ...(again ? { again: true as const } : {}),
  };
}

export async function waitForSent(
  link: ReturnType<typeof createMemoryLink>,
  count: number,
): Promise<CompanionToGame[]> {
  await vi.waitFor(() => {
    if (link.sent().length < count) throw new Error(`waiting for ${String(count)} messages`);
  });
  return link.sent();
}

export async function waitFor(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    if (!predicate()) throw new Error("condition not met yet");
  });
}

export async function serve(daemon: Daemon): Promise<{ server: LocalApiServer; base: string }> {
  const server = createLocalApiServer(daemon.api);
  const port = await server.start(0);
  return { server, base: `http://127.0.0.1:${String(port)}` };
}
