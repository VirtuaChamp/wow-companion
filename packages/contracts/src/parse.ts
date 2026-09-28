import { isBoolean, isNumber, isOneOf, isRecord, isString } from "./guards.ts";
import type {
  Choice,
  CompanionToGame,
  Effort,
  ErrorCode,
  GameToCompanion,
  ItemDetail,
  Mention,
  ProviderId,
  Result,
  Snapshot,
  Waypoint,
} from "./types.ts";

type CmdName = Extract<GameToCompanion, { t: "cmd" }>["name"];
type ProgressStatus = Extract<CompanionToGame, { t: "progress" }>["status"];
type Faction = Snapshot["character"]["faction"];

function literalsOf<T extends string>(record: Record<T, true>): readonly T[] {
  return Object.keys(record) as T[];
}

const providerIds = literalsOf<ProviderId>({ claude: true, codex: true, cursor: true });
const efforts = literalsOf<Effort>({
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
});
const cmdNames = literalsOf<CmdName>({
  new: true,
  open: true,
  rename: true,
  delete: true,
  reset: true,
  cancel: true,
});
const progressStatuses = literalsOf<ProgressStatus>({ queued: true, thinking: true, tool: true });
const factions = literalsOf<Faction>({ Alliance: true, Horde: true });
const errorCodes = literalsOf<ErrorCode>({
  provider_missing: true,
  provider_auth: true,
  provider_disabled: true,
  session_unknown: true,
  timeout: true,
  cancelled: true,
  too_large: true,
  slots_exhausted: true,
  not_connected: true,
  item_timeout: true,
  no_active_ask: true,
  no_waypoint_map: true,
  busy: true,
  bad_frame: true,
});

function ok<T>(value: T): Result<T, "bad_frame"> {
  return { ok: true, value };
}

function badFrame<T>(): Result<T, "bad_frame"> {
  return { ok: false, error: "bad_frame" };
}

function fromParsed<T>(value: T | undefined): Result<T, "bad_frame"> {
  return value === undefined ? badFrame() : ok(value);
}

function isEffort(value: unknown): value is Effort {
  return isOneOf(value, efforts);
}

function fromGuard<T>(guard: (value: unknown) => value is T): (value: unknown) => T | undefined {
  return (value) => (guard(value) ? value : undefined);
}

function parseArrayField<T>(
  value: unknown,
  itemParser: (item: unknown) => T | undefined,
): T[] | undefined {
  if (Array.isArray(value)) {
    const result: T[] = [];
    for (const item of value) {
      const parsed = itemParser(item);
      if (parsed === undefined) return undefined;
      result.push(parsed);
    }
    return result;
  }
  if (isRecord(value) && Object.keys(value).length === 0) return [];
  return undefined;
}

function parseNumberRecordField(value: unknown): Record<string, number> | undefined {
  if (Array.isArray(value)) return value.length === 0 ? {} : undefined;
  if (!isRecord(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isNumber(item)) return undefined;
    result[key] = item;
  }
  return result;
}

function parseMention(value: unknown): Mention | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "quest") {
    if (!isNumber(value.questId)) return undefined;
    return { kind: "quest", questId: value.questId };
  }
  if (value.kind === "item") {
    if (!isNumber(value.itemId)) return undefined;
    const mention: Extract<Mention, { kind: "item" }> = { kind: "item", itemId: value.itemId };
    if (value.bag !== undefined) {
      if (!isNumber(value.bag)) return undefined;
      mention.bag = value.bag;
    }
    if (value.slot !== undefined) {
      if (!isNumber(value.slot)) return undefined;
      mention.slot = value.slot;
    }
    if (value.equipSlot !== undefined) {
      if (!isNumber(value.equipSlot)) return undefined;
      mention.equipSlot = value.equipSlot;
    }
    return mention;
  }
  return undefined;
}

function parseWaypoint(value: unknown): Waypoint | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNumber(value.uiMapId) ||
    !isNumber(value.x) ||
    !isNumber(value.y) ||
    !isString(value.label)
  )
    return undefined;
  return { uiMapId: value.uiMapId, x: value.x, y: value.y, label: value.label };
}

function parseItemDetail(value: unknown): ItemDetail | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNumber(value.itemId) ||
    !isString(value.name) ||
    !isNumber(value.quality) ||
    !isNumber(value.itemLevel) ||
    !isNumber(value.requiredLevel) ||
    !isString(value.equipLoc) ||
    !isNumber(value.classId) ||
    !isNumber(value.subClassId)
  )
    return undefined;
  const stats = parseNumberRecordField(value.stats);
  if (stats === undefined) return undefined;
  return {
    itemId: value.itemId,
    name: value.name,
    quality: value.quality,
    itemLevel: value.itemLevel,
    requiredLevel: value.requiredLevel,
    equipLoc: value.equipLoc,
    classId: value.classId,
    subClassId: value.subClassId,
    stats,
  };
}

function parseCharacter(value: unknown): Snapshot["character"] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isString(value.name) ||
    !isNumber(value.level) ||
    !isNumber(value.classId) ||
    !isNumber(value.raceId) ||
    !isOneOf(value.faction, factions) ||
    !isNumber(value.xp) ||
    !isNumber(value.xpMax)
  )
    return undefined;
  return {
    name: value.name,
    level: value.level,
    classId: value.classId,
    raceId: value.raceId,
    faction: value.faction,
    xp: value.xp,
    xpMax: value.xpMax,
  };
}

function parsePosition(value: unknown): Snapshot["position"] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNumber(value.uiMapId) ||
    !isString(value.zone) ||
    !isString(value.subzone) ||
    !isNumber(value.x) ||
    !isNumber(value.y)
  )
    return undefined;
  return {
    uiMapId: value.uiMapId,
    zone: value.zone,
    subzone: value.subzone,
    x: value.x,
    y: value.y,
  };
}

function parseQuestObjective(
  value: unknown,
): Snapshot["quests"][number]["objectives"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isString(value.text) ||
    !isBoolean(value.done) ||
    !isNumber(value.have) ||
    !isNumber(value.need)
  )
    return undefined;
  return { text: value.text, done: value.done, have: value.have, need: value.need };
}

function parseQuest(value: unknown): Snapshot["quests"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNumber(value.questId) ||
    !isString(value.title) ||
    !isNumber(value.level) ||
    !isBoolean(value.complete)
  )
    return undefined;
  const objectives = parseArrayField(value.objectives, parseQuestObjective);
  if (objectives === undefined) return undefined;
  return {
    questId: value.questId,
    title: value.title,
    level: value.level,
    complete: value.complete,
    objectives,
  };
}

function parseEquippedItem(value: unknown): Snapshot["equipped"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNumber(value.slot) || !isNumber(value.itemId) || !isNumber(value.itemLevel))
    return undefined;
  return { slot: value.slot, itemId: value.itemId, itemLevel: value.itemLevel };
}

function parseBagItem(value: unknown): Snapshot["bags"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNumber(value.bag) ||
    !isNumber(value.slot) ||
    !isNumber(value.itemId) ||
    !isNumber(value.count)
  )
    return undefined;
  return { bag: value.bag, slot: value.slot, itemId: value.itemId, count: value.count };
}

function parseProfession(value: unknown): Snapshot["professions"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (!isString(value.name) || !isNumber(value.rank) || !isNumber(value.max)) return undefined;
  return { name: value.name, rank: value.rank, max: value.max };
}

function parseTalent(value: unknown): Snapshot["talents"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (!isString(value.tab) || !isNumber(value.points)) return undefined;
  return { tab: value.tab, points: value.points };
}

function parseSnapshotDelta(value: unknown): Partial<Snapshot> | undefined {
  if (Array.isArray(value)) return value.length === 0 ? {} : undefined;
  if (!isRecord(value)) return undefined;
  const delta: Partial<Snapshot> = {};
  if (value.character !== undefined) {
    const character = parseCharacter(value.character);
    if (character === undefined) return undefined;
    delta.character = character;
  }
  if (value.position !== undefined) {
    const position = parsePosition(value.position);
    if (position === undefined) return undefined;
    delta.position = position;
  }
  if (value.money !== undefined) {
    if (!isNumber(value.money)) return undefined;
    delta.money = value.money;
  }
  if (value.quests !== undefined) {
    const quests = parseArrayField(value.quests, parseQuest);
    if (quests === undefined) return undefined;
    delta.quests = quests;
  }
  if (value.equipped !== undefined) {
    const equipped = parseArrayField(value.equipped, parseEquippedItem);
    if (equipped === undefined) return undefined;
    delta.equipped = equipped;
  }
  if (value.bags !== undefined) {
    const bags = parseArrayField(value.bags, parseBagItem);
    if (bags === undefined) return undefined;
    delta.bags = bags;
  }
  if (value.professions !== undefined) {
    const professions = parseArrayField(value.professions, parseProfession);
    if (professions === undefined) return undefined;
    delta.professions = professions;
  }
  if (value.talents !== undefined) {
    const talents = parseArrayField(value.talents, parseTalent);
    if (talents === undefined) return undefined;
    delta.talents = talents;
  }
  return delta;
}

export function parseSnapshot(value: unknown): Snapshot | undefined {
  if (!isRecord(value)) return undefined;
  const character = parseCharacter(value.character);
  if (character === undefined) return undefined;
  const position = parsePosition(value.position);
  if (position === undefined) return undefined;
  if (!isNumber(value.money)) return undefined;
  const quests = parseArrayField(value.quests, parseQuest);
  if (quests === undefined) return undefined;
  const equipped = parseArrayField(value.equipped, parseEquippedItem);
  if (equipped === undefined) return undefined;
  const bags = parseArrayField(value.bags, parseBagItem);
  if (bags === undefined) return undefined;
  const professions = parseArrayField(value.professions, parseProfession);
  if (professions === undefined) return undefined;
  const talents = parseArrayField(value.talents, parseTalent);
  if (talents === undefined) return undefined;
  return { character, position, money: value.money, quests, equipped, bags, professions, talents };
}

export function parseItemDetailArray(value: unknown): ItemDetail[] | undefined {
  return parseArrayField(value, parseItemDetail);
}

function parseHello(
  value: Record<string, unknown>,
): Extract<GameToCompanion, { t: "hello" }> | undefined {
  if (value.v !== 1 || !isString(value.build) || !isNumber(value.iface)) return undefined;
  return { t: "hello", v: 1, build: value.build, iface: value.iface };
}

function parseStateMessage(
  value: Record<string, unknown>,
): Extract<GameToCompanion, { t: "state" }> | undefined {
  if (!isNumber(value.seq)) return undefined;
  const delta = parseSnapshotDelta(value.delta);
  if (delta === undefined) return undefined;
  return { t: "state", seq: value.seq, delta };
}

function parseAskMessage(
  value: Record<string, unknown>,
): Extract<GameToCompanion, { t: "ask" }> | undefined {
  if (!isString(value.id) || !isString(value.chat) || !isString(value.text)) return undefined;
  const mentions = parseArrayField(value.mentions, parseMention);
  if (mentions === undefined) return undefined;
  return { t: "ask", id: value.id, chat: value.chat, text: value.text, mentions };
}

function parseItemsMessage(
  value: Record<string, unknown>,
): Extract<GameToCompanion, { t: "items" }> | undefined {
  if (!isString(value.req)) return undefined;
  const items = parseArrayField(value.items, parseItemDetail);
  if (items === undefined) return undefined;
  return { t: "items", req: value.req, items };
}

function parseCmdMessage(
  value: Record<string, unknown>,
): Extract<GameToCompanion, { t: "cmd" }> | undefined {
  if (!isString(value.chat) || !isOneOf(value.name, cmdNames)) return undefined;
  const msg: Extract<GameToCompanion, { t: "cmd" }> = {
    t: "cmd",
    chat: value.chat,
    name: value.name,
  };
  if (value.arg !== undefined) {
    if (!isString(value.arg)) return undefined;
    msg.arg = value.arg;
  }
  return msg;
}

function parseSettingsMessage(
  value: Record<string, unknown>,
): Extract<GameToCompanion, { t: "settings" }> | undefined {
  if (!isOneOf(value.provider, providerIds) || !isString(value.model)) return undefined;
  const msg: Extract<GameToCompanion, { t: "settings" }> = {
    t: "settings",
    provider: value.provider,
    model: value.model,
  };
  if (value.chat !== undefined) {
    if (!isString(value.chat)) return undefined;
    msg.chat = value.chat;
  }
  if (value.effort !== undefined) {
    if (!isEffort(value.effort)) return undefined;
    msg.effort = value.effort;
  }
  return msg;
}

export function parseGameToCompanion(json: unknown): Result<GameToCompanion, "bad_frame"> {
  if (!isRecord(json)) return badFrame();
  if (json.t === "hello") return fromParsed(parseHello(json));
  if (json.t === "state") return fromParsed(parseStateMessage(json));
  if (json.t === "ask") return fromParsed(parseAskMessage(json));
  if (json.t === "items") return fromParsed(parseItemsMessage(json));
  if (json.t === "cmd") return fromParsed(parseCmdMessage(json));
  if (json.t === "settings") return fromParsed(parseSettingsMessage(json));
  return badFrame();
}

function parseChatListItem(
  value: unknown,
): Extract<CompanionToGame, { t: "chats" }>["list"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isString(value.id) ||
    !isString(value.name) ||
    !isOneOf(value.provider, providerIds) ||
    !isNumber(value.lastAt) ||
    !isBoolean(value.running) ||
    !isNumber(value.unread)
  )
    return undefined;
  return {
    id: value.id,
    name: value.name,
    provider: value.provider,
    lastAt: value.lastAt,
    running: value.running,
    unread: value.unread,
  };
}

function parseHistoryLine(
  value: unknown,
): { who: "you" | ProviderId; text: string; at: number } | undefined {
  if (!isRecord(value)) return undefined;
  const who = value.who;
  if (who !== "you" && !isOneOf(who, providerIds)) return undefined;
  if (!isString(value.text) || !isNumber(value.at)) return undefined;
  return { who: who as "you" | ProviderId, text: value.text, at: value.at };
}

function parseOptionsProviderEntry(
  value: unknown,
): Extract<CompanionToGame, { t: "options" }>["providers"][number] | undefined {
  if (!isRecord(value)) return undefined;
  if (!isOneOf(value.id, providerIds) || !isBoolean(value.installed) || !isBoolean(value.enabled))
    return undefined;
  const models = parseArrayField(value.models, fromGuard(isString));
  if (models === undefined) return undefined;
  const providerEfforts = parseArrayField(value.efforts, fromGuard(isEffort));
  if (providerEfforts === undefined) return undefined;
  if (!isRecord(value.current) || !isString(value.current.model)) return undefined;
  const current: { model: string; effort?: Effort } = { model: value.current.model };
  if (value.current.effort !== undefined) {
    if (!isEffort(value.current.effort)) return undefined;
    current.effort = value.current.effort;
  }
  const entry: Extract<CompanionToGame, { t: "options" }>["providers"][number] = {
    id: value.id,
    installed: value.installed,
    enabled: value.enabled,
    models,
    efforts: providerEfforts,
    current,
  };
  if (value.reason !== undefined) {
    if (!isString(value.reason)) return undefined;
    entry.reason = value.reason;
  }
  return entry;
}

function parseChoice(value: unknown): Choice | undefined {
  if (!isRecord(value)) return undefined;
  if (!isOneOf(value.provider, providerIds) || !isString(value.model)) return undefined;
  const choice: Choice = { provider: value.provider, model: value.model };
  if (value.effort !== undefined) {
    if (!isEffort(value.effort)) return undefined;
    choice.effort = value.effort;
  }
  return choice;
}

function parseChatChoice(value: unknown): ({ id: string } & Choice) | undefined {
  if (!isRecord(value) || !isString(value.id)) return undefined;
  const choice = parseChoice(value);
  if (choice === undefined) return undefined;
  return { id: value.id, ...choice };
}

function parseChatsMessage(
  value: Record<string, unknown>,
): Extract<CompanionToGame, { t: "chats" }> | undefined {
  if (!isString(value.active)) return undefined;
  const list = parseArrayField(value.list, parseChatListItem);
  if (list === undefined) return undefined;
  return { t: "chats", active: value.active, list };
}

function parseHistoryMessage(
  value: Record<string, unknown>,
): Extract<CompanionToGame, { t: "history" }> | undefined {
  if (!isString(value.chat)) return undefined;
  const lines = parseArrayField(value.lines, parseHistoryLine);
  if (lines === undefined) return undefined;
  return { t: "history", chat: value.chat, lines };
}

function parseOptionsMessage(
  value: Record<string, unknown>,
): Extract<CompanionToGame, { t: "options" }> | undefined {
  const providers = parseArrayField(value.providers, parseOptionsProviderEntry);
  if (providers === undefined) return undefined;
  const active = parseChoice(value.active);
  if (active === undefined) return undefined;
  const message: Extract<CompanionToGame, { t: "options" }> = {
    t: "options",
    providers,
    active,
  };
  if (value.chat !== undefined) {
    const chat = parseChatChoice(value.chat);
    if (chat === undefined) return undefined;
    message.chat = chat;
  }
  if (value.companionVersion !== undefined) {
    if (!isString(value.companionVersion)) return undefined;
    message.companionVersion = value.companionVersion;
  }
  return message;
}

function parseProgressMessage(
  value: Record<string, unknown>,
): Extract<CompanionToGame, { t: "progress" }> | undefined {
  if (!isString(value.id) || !isOneOf(value.status, progressStatuses)) return undefined;
  const msg: Extract<CompanionToGame, { t: "progress" }> = {
    t: "progress",
    id: value.id,
    status: value.status,
  };
  if (value.detail !== undefined) {
    if (!isString(value.detail)) return undefined;
    msg.detail = value.detail;
  }
  return msg;
}

function parseReplyMessage(
  value: Record<string, unknown>,
): Extract<CompanionToGame, { t: "reply" }> | undefined {
  if (!isString(value.id) || !isString(value.chat) || !isOneOf(value.provider, providerIds))
    return undefined;
  if (!isString(value.summary) || !isString(value.full)) return undefined;
  const msg: Extract<CompanionToGame, { t: "reply" }> = {
    t: "reply",
    id: value.id,
    chat: value.chat,
    provider: value.provider,
    summary: value.summary,
    full: value.full,
  };
  if (value.waypoint !== undefined) {
    const waypoint = parseWaypoint(value.waypoint);
    if (waypoint === undefined) return undefined;
    msg.waypoint = waypoint;
  }
  return msg;
}

function parseItemReqMessage(
  value: Record<string, unknown>,
): Extract<CompanionToGame, { t: "itemreq" }> | undefined {
  if (!isString(value.req)) return undefined;
  const ids = parseArrayField(value.ids, fromGuard(isNumber));
  if (ids === undefined) return undefined;
  return { t: "itemreq", req: value.req, ids };
}

function parseAckMessage(
  value: Record<string, unknown>,
): Extract<CompanionToGame, { t: "ack" }> | undefined {
  if (!isNumber(value.seq)) return undefined;
  return { t: "ack", seq: value.seq };
}

function parseErrorMessage(
  value: Record<string, unknown>,
): Extract<CompanionToGame, { t: "error" }> | undefined {
  if (!isOneOf(value.code, errorCodes) || !isString(value.message)) return undefined;
  const msg: Extract<CompanionToGame, { t: "error" }> = {
    t: "error",
    code: value.code,
    message: value.message,
  };
  if (value.id !== undefined) {
    if (!isString(value.id)) return undefined;
    msg.id = value.id;
  }
  return msg;
}

export function parseCompanionToGame(json: unknown): Result<CompanionToGame, "bad_frame"> {
  if (!isRecord(json)) return badFrame();
  if (json.t === "chats") return fromParsed(parseChatsMessage(json));
  if (json.t === "history") return fromParsed(parseHistoryMessage(json));
  if (json.t === "options") return fromParsed(parseOptionsMessage(json));
  if (json.t === "progress") return fromParsed(parseProgressMessage(json));
  if (json.t === "reply") return fromParsed(parseReplyMessage(json));
  if (json.t === "itemreq") return fromParsed(parseItemReqMessage(json));
  if (json.t === "ack") return fromParsed(parseAckMessage(json));
  if (json.t === "error") return fromParsed(parseErrorMessage(json));
  return badFrame();
}
