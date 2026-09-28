export type ProviderId = "claude" | "codex" | "cursor";
export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export type ProviderError =
  | "provider_missing"
  | "provider_auth"
  | "provider_disabled"
  | "provider_failed"
  | "session_unknown"
  | "timeout"
  | "cancelled";
export type LinkError = "too_large" | "slots_exhausted";
export type ToolError =
  | "not_connected"
  | "item_timeout"
  | "no_active_ask"
  | "no_waypoint_map"
  | "too_large"
  | "forbidden"
  | "unsupported_media_type"
  | "bad_request"
  | "daemon_error";
export type ErrorCode =
  | ProviderError
  | LinkError
  | ToolError
  | "busy"
  | "bad_frame"
  | "bad_settings";

export type Mention =
  | { kind: "quest"; questId: number }
  | { kind: "item"; itemId: number; bag?: number; slot?: number; equipSlot?: number };
export type Waypoint = { uiMapId: number; x: number; y: number; label: string };
export type Snapshot = {
  character: {
    name: string;
    level: number;
    classId: number;
    raceId: number;
    faction: "Alliance" | "Horde";
    xp: number;
    xpMax: number;
  };
  position: { uiMapId: number; zone: string; subzone: string; x: number; y: number };
  money: number;
  quests: {
    questId: number;
    title: string;
    level: number;
    complete: boolean;
    objectives: { text: string; done: boolean; have: number; need: number }[];
  }[];
  equipped: { slot: number; itemId: number; itemLevel: number }[];
  bags: { bag: number; slot: number; itemId: number; count: number }[];
  professions: { name: string; rank: number; max: number }[];
  talents: { tab: string; points: number }[];
};
export type ItemDetail = {
  itemId: number;
  name: string;
  quality: number;
  itemLevel: number;
  requiredLevel: number;
  equipLoc: string;
  classId: number;
  subClassId: number;
  stats: Record<string, number>;
};
export type Upgrade = {
  slot: number;
  current?: ItemDetail;
  candidate: ItemDetail;
  source: { kind: "npc_drop" | "object_drop" | "quest_reward" | "vendor"; entityId: number };
  delta: Record<string, number>;
};
export type McpLaunch = { command: string; args: string[]; env: Record<string, string> };
export type Choice = { provider: ProviderId; model: string; effort?: Effort };

export type GameToCompanion =
  | { t: "hello"; v: 1; build: string; iface: number; session: string; slot: number; again?: true }
  | { t: "state"; seq: number; delta: Partial<Snapshot> }
  | { t: "ask"; id: string; chat: string; text: string; mentions: Mention[] }
  | { t: "items"; req: string; items: ItemDetail[] }
  | {
      t: "cmd";
      chat: string;
      name: "new" | "open" | "rename" | "delete" | "reset" | "cancel";
      arg?: string;
    }
  | { t: "settings"; chat?: string; provider: ProviderId; model: string; effort?: Effort };

export type CompanionToGame =
  | {
      t: "chats";
      active: string;
      list: {
        id: string;
        name: string;
        provider: ProviderId;
        lastAt: number;
        running: boolean;
        unread: number;
      }[];
    }
  | { t: "history"; chat: string; lines: { who: "you" | ProviderId; text: string; at: number }[] }
  | {
      t: "options";
      providers: {
        id: ProviderId;
        installed: boolean;
        enabled: boolean;
        reason?: string;
        models: string[];
        efforts: Effort[];
        current: { model: string; effort?: Effort };
      }[];
      active: Choice;
      chat?: { id: string } & Choice;
      companionVersion?: string;
    }
  | { t: "progress"; id: string; status: "queued" | "thinking" | "tool"; detail?: string }
  | {
      t: "reply";
      id: string;
      chat: string;
      provider: ProviderId;
      summary: string;
      full: string;
      waypoint?: Waypoint;
    }
  | { t: "itemreq"; req: string; ids: number[] }
  | { t: "ack"; seq: number }
  | { t: "error"; id?: string; code: ErrorCode; message: string };

export interface GameLink {
  messages(): AsyncIterable<GameToCompanion>;
  send(msg: CompanionToGame): Result<void, LinkError>;
  status(): { connected: boolean; build?: string; slotsLeft: number; badFrames: number };
}

export type ProviderConfig = {
  cwd: string;
  mcp: (runId: string) => McpLaunch;
  timeoutMs: number;
  models: readonly string[];
};
export interface Provider {
  id: ProviderId;
  describe(signal?: AbortSignal): Promise<{
    installed: boolean;
    enabled: boolean;
    reason?: string;
    models: string[];
    efforts: Effort[];
  }>;
  run(
    input: {
      runId: string;
      prompt: string;
      system: string;
      sessionId?: string;
      model: string;
      effort?: Effort;
      signal: AbortSignal;
    },
    onEvent: (e: ProviderEvent) => void,
  ): Promise<Result<{ sessionId: string; text: string }, ProviderError>>;
}
export type CreateProvider = (config: ProviderConfig) => Provider;
export type ProviderEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool"; name: string; failure?: string }
  | { kind: "session"; id: string };
