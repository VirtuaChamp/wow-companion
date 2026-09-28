import DatabaseCtor from "better-sqlite3";
import type { GearCandidate } from "./gear.ts";
import {
  ARMOR_ITEM_CLASS,
  CLOTH_ARMOR_SUBCLASS,
  TYPED_ARMOR_SUBCLASSES,
  WEAPON_ITEM_CLASS,
  allowedArmorSubclass,
} from "./gear.ts";

export type Db = InstanceType<typeof DatabaseCtor>;

export function openDb(path: string): Db {
  return new DatabaseCtor(path, { readonly: true, fileMustExist: true });
}

export function closeDb(db: Db): void {
  db.close();
}

export type Spawn = {
  zoneId: number;
  uiMapId: number | undefined;
  x: number | undefined;
  y: number | undefined;
};

export type NpcResult = {
  id: number;
  name: string;
  subName: string | undefined;
  minLevel: number | undefined;
  maxLevel: number | undefined;
  factionId: number | undefined;
  friendlyTo: string | undefined;
  spawns: Spawn[];
};

export type QuestResult = {
  id: number;
  name: string;
  requiredLevel: number | undefined;
  questLevel: number | undefined;
  zoneOrSort: number | undefined;
  objectivesText: string | undefined;
  nextInChain: number | undefined;
  start: { kind: string; entityId: number }[];
  end: { kind: string; entityId: number }[];
};

export type ObjectResult = {
  id: number;
  name: string;
  spawns: Spawn[];
};

type NpcRow = {
  id: number;
  name: string;
  sub_name: string | null;
  min_level: number | null;
  max_level: number | null;
  faction_id: number | null;
  friendly_to: string | null;
};

type NpcSpawnRow = {
  zone_id: number;
  ui_map_id: number | null;
  x: number | null;
  y: number | null;
};

type QuestRow = {
  id: number;
  name: string;
  required_level: number | null;
  quest_level: number | null;
  zone_or_sort: number | null;
  objectives_text: string | null;
  next_in_chain: number | null;
};

type QuestEndpointRow = { kind: string; entity_id: number };

type ObjectRow = { id: number; name: string };

type ObjectSpawnRow = {
  zone_id: number;
  ui_map_id: number | null;
  x: number | null;
  y: number | null;
};

type ItemSourceRow = {
  item_id: number;
  kind: "npc_drop" | "object_drop" | "quest_reward" | "vendor";
  entity_id: number;
};

function toSpawn(row: {
  zone_id: number;
  ui_map_id: number | null;
  x: number | null;
  y: number | null;
}): Spawn {
  return {
    zoneId: row.zone_id,
    uiMapId: row.ui_map_id ?? undefined,
    x: row.x ?? undefined,
    y: row.y ?? undefined,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function containsPattern(name: string): string {
  return `%${escapeLikePattern(name)}%`;
}

function npcSpawns(db: Db, npcId: number): Spawn[] {
  const rows = db
    .prepare<[number], NpcSpawnRow>(
      "SELECT zone_id, ui_map_id, x, y FROM npc_spawn WHERE npc_id = ?",
    )
    .all(npcId);
  return rows.map(toSpawn);
}

function objectSpawns(db: Db, objectId: number): Spawn[] {
  const rows = db
    .prepare<[number], ObjectSpawnRow>(
      "SELECT zone_id, ui_map_id, x, y FROM object_spawn WHERE object_id = ?",
    )
    .all(objectId);
  return rows.map(toSpawn);
}

function toNpcResult(db: Db, row: NpcRow): NpcResult {
  return {
    id: row.id,
    name: row.name,
    subName: row.sub_name ?? undefined,
    minLevel: row.min_level ?? undefined,
    maxLevel: row.max_level ?? undefined,
    factionId: row.faction_id ?? undefined,
    friendlyTo: row.friendly_to ?? undefined,
    spawns: npcSpawns(db, row.id),
  };
}

export function findNpcByName(db: Db, name: string): NpcResult[] {
  if (name.trim() === "") return [];
  const rows = db
    .prepare<[string], NpcRow>(
      "SELECT id, name, sub_name, min_level, max_level, faction_id, friendly_to FROM npc WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 20",
    )
    .all(containsPattern(name));
  return rows.map((row) => toNpcResult(db, row));
}

export function findNpcById(db: Db, id: number): NpcResult | undefined {
  const row = db
    .prepare<[number], NpcRow>(
      "SELECT id, name, sub_name, min_level, max_level, faction_id, friendly_to FROM npc WHERE id = ?",
    )
    .get(id);
  return row === undefined ? undefined : toNpcResult(db, row);
}

function toQuestResult(db: Db, row: QuestRow): QuestResult {
  const start = db
    .prepare<[number], QuestEndpointRow>(
      "SELECT kind, entity_id FROM quest_start WHERE quest_id = ?",
    )
    .all(row.id)
    .map((endpoint) => ({ kind: endpoint.kind, entityId: endpoint.entity_id }));
  const end = db
    .prepare<[number], QuestEndpointRow>("SELECT kind, entity_id FROM quest_end WHERE quest_id = ?")
    .all(row.id)
    .map((endpoint) => ({ kind: endpoint.kind, entityId: endpoint.entity_id }));
  return {
    id: row.id,
    name: row.name,
    requiredLevel: row.required_level ?? undefined,
    questLevel: row.quest_level ?? undefined,
    zoneOrSort: row.zone_or_sort ?? undefined,
    objectivesText: row.objectives_text ?? undefined,
    nextInChain: row.next_in_chain ?? undefined,
    start,
    end,
  };
}

export function findQuestByName(db: Db, name: string): QuestResult[] {
  if (name.trim() === "") return [];
  const rows = db
    .prepare<[string], QuestRow>(
      "SELECT id, name, required_level, quest_level, zone_or_sort, objectives_text, next_in_chain FROM quest WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 20",
    )
    .all(containsPattern(name));
  return rows.map((row) => toQuestResult(db, row));
}

export function findQuestById(db: Db, id: number): QuestResult | undefined {
  const row = db
    .prepare<[number], QuestRow>(
      "SELECT id, name, required_level, quest_level, zone_or_sort, objectives_text, next_in_chain FROM quest WHERE id = ?",
    )
    .get(id);
  return row === undefined ? undefined : toQuestResult(db, row);
}

function toObjectResult(db: Db, row: ObjectRow): ObjectResult {
  return { id: row.id, name: row.name, spawns: objectSpawns(db, row.id) };
}

export function findObjectByName(db: Db, name: string): ObjectResult[] {
  if (name.trim() === "") return [];
  const rows = db
    .prepare<[string], ObjectRow>(
      "SELECT id, name FROM object WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 20",
    )
    .all(containsPattern(name));
  return rows.map((row) => toObjectResult(db, row));
}

const LEVEL_CLAUSE = "(item.required_level IS NULL OR item.required_level <= ?)";

function groupIds(
  db: Db,
  whereClause: string,
  whereParams: readonly unknown[],
  characterLevel: number,
  limit: number,
): number[] {
  const rows = db
    .prepare<unknown[], { id: number }>(
      `SELECT id FROM (SELECT DISTINCT item.id AS id FROM item JOIN item_source ON item_source.item_id = item.id WHERE ${whereClause} AND ${LEVEL_CLAUSE} ORDER BY item.item_level DESC LIMIT ?)`,
    )
    .all(...whereParams, characterLevel, limit);
  return rows.map((row) => row.id);
}

export function gearCandidateIds(
  db: Db,
  opts: { readonly characterLevel: number; readonly classId: number; readonly limit: number },
): number[] {
  const allowedSubclass = allowedArmorSubclass(opts.classId, opts.characterLevel);
  const typedSubclasses =
    allowedSubclass === undefined ? TYPED_ARMOR_SUBCLASSES : [allowedSubclass];
  const typedPlaceholders = typedSubclasses.map(() => "?").join(", ");
  const typedArmorIds = groupIds(
    db,
    `item.class = ? AND item.sub_class IN (${typedPlaceholders})`,
    [ARMOR_ITEM_CLASS, ...typedSubclasses],
    opts.characterLevel,
    opts.limit,
  );
  const genericArmorPlaceholders = TYPED_ARMOR_SUBCLASSES.map(() => "?").join(", ");
  const genericArmorIds = groupIds(
    db,
    `item.class = ? AND (item.sub_class IS NULL OR item.sub_class NOT IN (${genericArmorPlaceholders}))`,
    [ARMOR_ITEM_CLASS, ...TYPED_ARMOR_SUBCLASSES],
    opts.characterLevel,
    opts.limit,
  );
  const clothArmorIds = groupIds(
    db,
    "item.class = ? AND item.sub_class = ?",
    [ARMOR_ITEM_CLASS, CLOTH_ARMOR_SUBCLASS],
    opts.characterLevel,
    opts.limit,
  );
  const weaponIds = groupIds(
    db,
    "item.class = ?",
    [WEAPON_ITEM_CLASS],
    opts.characterLevel,
    opts.limit,
  );
  return Array.from(
    new Set([...typedArmorIds, ...genericArmorIds, ...clothArmorIds, ...weaponIds]),
  );
}

export function itemSources(db: Db, itemId: number): GearCandidate["source"][] {
  const rows = db
    .prepare<[number], ItemSourceRow>(
      "SELECT item_id, kind, entity_id FROM item_source WHERE item_id = ? ORDER BY kind, entity_id",
    )
    .all(itemId);
  return rows.map((row) => ({ kind: row.kind, entityId: row.entity_id }));
}
