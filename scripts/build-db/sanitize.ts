import { err, ok, type Result } from "../lib/result.ts";
import type { ExportedData } from "./rows.ts";
import { isValidRow, type TableName } from "./validate.ts";

const MAX_SKIPPED_PERCENT = 2;
const NEXT_IN_CHAIN_FIELD = "quest.next_in_chain";
const SKIPPED_ID_SAMPLE_SIZE = 5;

type TableSkips = { total: number; skipped: number; firstIds: string[] };

export type SkipReport = Record<TableName, TableSkips>;

export type NulledReference = { field: string; count: number; firstIds: string[] };

export type SanitizedExport = {
  data: ExportedData;
  skips: SkipReport;
  nulledReferences: NulledReference[];
};

type Partitioned<Row> = { kept: Row[]; skips: TableSkips };

type EntityKind = "npc" | "object" | "item" | "quest";

const ITEM_SOURCE_ENTITY: Record<string, EntityKind> = {
  npc_drop: "npc",
  object_drop: "object",
  quest_reward: "quest",
  vendor: "npc",
};

const QUEST_LINK_ENTITY: Record<string, EntityKind> = {
  npc: "npc",
  object: "object",
  item: "item",
};

const describeId = (row: unknown, key: string): string => {
  if (typeof row !== "object" || row === null) {
    return "?";
  }
  const value = (row as Record<string, unknown>)[key];
  return value === undefined ? "?" : String(value);
};

const partition = <Row>(
  table: TableName,
  rows: readonly Row[],
  idKey: string,
  isKept: (row: Row) => boolean,
): Partitioned<Row> => {
  const kept: Row[] = [];
  const firstIds: string[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (isValidRow(table, row) && isKept(row)) {
      kept.push(row);
      continue;
    }
    skipped += 1;
    if (firstIds.length < SKIPPED_ID_SAMPLE_SIZE) {
      firstIds.push(describeId(row, idKey));
    }
  }
  return { kept, skips: { total: rows.length, skipped, firstIds } };
};

const idsWhere = (rows: readonly { id: number }[], table: TableName): Set<number> =>
  new Set(rows.filter((row) => isValidRow(table, row)).map((row) => row.id));

const capViolation = (
  table: TableName,
  skips: TableSkips,
  maxSkippedPercent: number,
): string | null => {
  const ids = skips.firstIds.length > 0 ? ` (first source ids: ${skips.firstIds.join(", ")})` : "";
  if (skips.total === 0) {
    return `${table}: no rows in the source`;
  }
  if (skips.skipped * 100 > skips.total * maxSkippedPercent) {
    return `${table}: ${skips.skipped} of ${skips.total} rows skipped, above the ${maxSkippedPercent}% limit${ids}`;
  }
  return null;
};

const nullDanglingChain = (
  quests: readonly ExportedData["quest"][number][],
  keptQuestIds: ReadonlySet<number>,
): { quests: ExportedData["quest"]; nulled: NulledReference } => {
  const firstIds: string[] = [];
  let count = 0;
  const out = quests.map((row) => {
    if (row.next_in_chain === null || keptQuestIds.has(row.next_in_chain)) {
      return row;
    }
    count += 1;
    if (firstIds.length < SKIPPED_ID_SAMPLE_SIZE) {
      firstIds.push(String(row.id));
    }
    return { ...row, next_in_chain: null };
  });
  return { quests: out, nulled: { field: NEXT_IN_CHAIN_FIELD, count, firstIds } };
};

export const sanitizeExportedData = (
  raw: ExportedData,
  maxSkippedPercent: number = MAX_SKIPPED_PERCENT,
): Result<SanitizedExport, string> => {
  if (!Number.isFinite(maxSkippedPercent) || maxSkippedPercent < 0) {
    return err(`invalid skip limit: ${maxSkippedPercent}`);
  }
  const keptByKind: Record<EntityKind, Set<number>> = {
    npc: idsWhere(raw.npc, "npc"),
    object: idsWhere(raw.object, "object"),
    item: idsWhere(raw.item, "item"),
    quest: idsWhere(raw.quest, "quest"),
  };
  const targetKept = (entityKind: EntityKind | undefined, entityId: number): boolean =>
    entityKind !== undefined && keptByKind[entityKind].has(entityId);

  const npc = partition("npc", raw.npc, "id", () => true);
  const object = partition("object", raw.object, "id", () => true);
  const item = partition("item", raw.item, "id", () => true);
  const quest = partition("quest", raw.quest, "id", () => true);
  const npcSpawn = partition("npc_spawn", raw.npc_spawn, "npc_id", (row) =>
    keptByKind.npc.has(row.npc_id),
  );
  const objectSpawn = partition("object_spawn", raw.object_spawn, "object_id", (row) =>
    keptByKind.object.has(row.object_id),
  );
  const questLinkKept = (row: { quest_id: number; kind: string; entity_id: number }): boolean =>
    keptByKind.quest.has(row.quest_id) && targetKept(QUEST_LINK_ENTITY[row.kind], row.entity_id);
  const questStart = partition("quest_start", raw.quest_start, "quest_id", questLinkKept);
  const questEnd = partition("quest_end", raw.quest_end, "quest_id", questLinkKept);
  const itemSource = partition(
    "item_source",
    raw.item_source,
    "item_id",
    (row) =>
      keptByKind.item.has(row.item_id) && targetKept(ITEM_SOURCE_ENTITY[row.kind], row.entity_id),
  );
  const chain = nullDanglingChain(quest.kept, keptByKind.quest);

  const skips: SkipReport = {
    npc: npc.skips,
    npc_spawn: npcSpawn.skips,
    quest: quest.skips,
    quest_start: questStart.skips,
    quest_end: questEnd.skips,
    object: object.skips,
    object_spawn: objectSpawn.skips,
    item: item.skips,
    item_source: itemSource.skips,
  };
  const violation = (Object.keys(skips) as TableName[])
    .map((table) => capViolation(table, skips[table], maxSkippedPercent))
    .filter((message): message is string => message !== null)[0];
  if (violation !== undefined) {
    return err(violation);
  }
  return ok({
    data: {
      npc: npc.kept,
      npc_spawn: npcSpawn.kept,
      quest: chain.quests,
      quest_start: questStart.kept,
      quest_end: questEnd.kept,
      object: object.kept,
      object_spawn: objectSpawn.kept,
      item: item.kept,
      item_source: itemSource.kept,
    },
    skips,
    nulledReferences: [chain.nulled],
  });
};
