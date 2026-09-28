import { randomBytes } from "node:crypto";
import type { GameLink, Provider, ProviderId, Snapshot } from "@wow-companion/contracts";
import type { Config } from "../config.ts";
import { createChat } from "../core/chats.ts";
import type { ChatState, ChatsState } from "../core/chats.ts";
import type { Settings } from "../core/settings.ts";
import { createRunner } from "../runner.ts";
import type { LocalApiHandlers } from "../local-api-server.ts";
import type { Runner } from "../runner.ts";
import { createDescribeService } from "./describe.ts";
import type { DescribeService } from "./describe.ts";
import { createItemsBroker } from "./items.ts";
import type { ItemsBroker } from "./items.ts";
import { createCoalescedWriter, createPersister } from "./persist.ts";
import type { CoalescedWriter, Persister } from "./persist.ts";
import { createSender } from "./send.ts";
import type { Sender } from "./send.ts";

export const DEFAULT_CHAT_ID = "default";
export const DEFAULT_CHAT_NAME = "Default";
const DEFAULT_ITEM_TIMEOUT_MS = 10_000;
const DEFAULT_DESCRIBE_TIMEOUT_MS = 10_000;
const DEFAULT_GAME_WRITE_INTERVAL_MS = 1000;

export type Store<T> = { save(value: T): Promise<void> };

export type DaemonDeps = {
  link: GameLink;
  config: Config;
  providers: ReadonlyMap<ProviderId, Provider>;
  initialChats: ChatsState;
  initialSettings: Settings;
  initialGame: Partial<Snapshot>;
  chatsStore: Store<ChatsState>;
  settingsStore: Store<Settings>;
  gameStore: Store<Partial<Snapshot>>;
  version?: string;
  now?: () => number;
  newId?: () => string;
  mintRunId?: () => string;
  itemTimeoutMs?: number;
  timeoutGraceMs?: number;
  describeTimeoutMs?: number;
  gameWriteIntervalMs?: number;
  beforeDescribe?: () => Promise<void>;
  log?: (line: string) => void;
};

export type Daemon = {
  start(): void;
  stop(): Promise<void>;
  api: LocalApiHandlers;
};

type DaemonState = {
  chats: ChatsState;
  settings: Settings;
  game: Partial<Snapshot>;
  helloSeen: boolean;
};

export type DaemonContext = {
  readonly config: Config;
  readonly link: GameLink;
  readonly version: string | undefined;
  readonly now: () => number;
  readonly newId: () => string;
  readonly log: (line: string) => void;
  readonly runner: Runner;
  readonly describe: DescribeService;
  readonly items: ItemsBroker;
  readonly out: Sender;
  readonly persister: Persister;
  readonly gameWriter: CoalescedWriter<Partial<Snapshot>>;
  readonly state: DaemonState;
  persistChats(): void;
  persistSettings(): void;
  persistGame(): void;
  isConnected(): boolean;
};

export function activeChat(ctx: DaemonContext): ChatState | undefined {
  return ctx.state.chats.chats.find((chat) => chat.id === ctx.state.chats.activeId);
}

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function randomId(): string {
  return randomBytes(6).toString("hex");
}

export function createContext(deps: DaemonDeps): DaemonContext {
  const now = deps.now ?? epochSeconds;
  const log = deps.log ?? ((line: string) => console.log(`[wowc] ${line}`));
  const persister = createPersister(log);
  const state: DaemonState = {
    chats: deps.initialChats,
    settings: deps.initialSettings,
    game: deps.initialGame,
    helloSeen: false,
  };
  if (state.chats.chats.length === 0) {
    const seeded = createChat(
      state.chats,
      DEFAULT_CHAT_ID,
      DEFAULT_CHAT_NAME,
      state.settings.global.provider,
      now(),
    );
    if (seeded.ok) state.chats = seeded.value.state;
  }
  const gameWriter = createCoalescedWriter<Partial<Snapshot>>({
    persister,
    save: (game) => deps.gameStore.save(game),
    intervalMs: deps.gameWriteIntervalMs ?? DEFAULT_GAME_WRITE_INTERVAL_MS,
  });
  const isConnected = (): boolean => state.helloSeen && deps.link.status().connected;
  return {
    config: deps.config,
    link: deps.link,
    version: deps.version,
    now,
    newId: deps.newId ?? randomId,
    log,
    runner: createRunner({
      providers: deps.providers,
      timeoutMs: deps.config.timeoutMs,
      ...(deps.timeoutGraceMs === undefined ? {} : { timeoutGraceMs: deps.timeoutGraceMs }),
      ...(deps.mintRunId === undefined ? {} : { mintRunId: deps.mintRunId }),
    }),
    describe: createDescribeService({
      config: deps.config,
      providers: deps.providers,
      timeoutMs: deps.describeTimeoutMs ?? DEFAULT_DESCRIBE_TIMEOUT_MS,
      ...(deps.beforeDescribe === undefined ? {} : { before: deps.beforeDescribe }),
      log,
    }),
    items: createItemsBroker({
      link: deps.link,
      isConnected,
      timeoutMs: deps.itemTimeoutMs ?? DEFAULT_ITEM_TIMEOUT_MS,
    }),
    out: createSender(deps.link, log),
    persister,
    gameWriter,
    state,
    persistChats() {
      const chats = state.chats;
      persister.run(() => deps.chatsStore.save(chats));
    },
    persistSettings() {
      const settings = state.settings;
      persister.run(() => deps.settingsStore.save(settings));
    },
    persistGame() {
      gameWriter.schedule(state.game);
    },
    isConnected,
  };
}
