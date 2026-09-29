import type { ExportedData } from "./rows.ts";

export type TableName = keyof ExportedData;

const ITEM_SOURCE_KINDS = ["npc_drop", "object_drop", "quest_reward", "vendor"] as const;

const isFiniteInt = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);

const isFiniteNumber = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value);

const isNonEmptyString = (value: unknown): boolean => typeof value === "string" && value.length > 0;

const isNullableInt = (value: unknown): boolean => value === null || isFiniteInt(value);

const isNullableString = (value: unknown): boolean => value === null || typeof value === "string";

const isItemSourceKind = (value: unknown): boolean =>
  typeof value === "string" && (ITEM_SOURCE_KINDS as readonly string[]).includes(value);

type FieldCheck = { field: string; check: (value: unknown) => boolean };

const FIELD_CHECKS: Record<TableName, FieldCheck[]> = {
  npc: [
    { field: "id", check: isFiniteInt },
    { field: "name", check: isNonEmptyString },
    { field: "sub_name", check: isNullableString },
    { field: "min_level", check: isNullableInt },
    { field: "max_level", check: isNullableInt },
    { field: "faction_id", check: isNullableInt },
    { field: "friendly_to", check: isNullableString },
  ],
  npc_spawn: [
    { field: "npc_id", check: isFiniteInt },
    { field: "zone_id", check: isFiniteInt },
    { field: "ui_map_id", check: isNullableInt },
    { field: "x", check: isFiniteNumber },
    { field: "y", check: isFiniteNumber },
  ],
  quest: [
    { field: "id", check: isFiniteInt },
    { field: "name", check: isNonEmptyString },
    { field: "required_level", check: isNullableInt },
    { field: "quest_level", check: isNullableInt },
    { field: "zone_or_sort", check: isNullableInt },
    { field: "objectives_text", check: isNullableString },
    { field: "next_in_chain", check: isNullableInt },
  ],
  quest_start: [
    { field: "quest_id", check: isFiniteInt },
    { field: "kind", check: isNonEmptyString },
    { field: "entity_id", check: isFiniteInt },
  ],
  quest_end: [
    { field: "quest_id", check: isFiniteInt },
    { field: "kind", check: isNonEmptyString },
    { field: "entity_id", check: isFiniteInt },
  ],
  object: [
    { field: "id", check: isFiniteInt },
    { field: "name", check: isNonEmptyString },
  ],
  object_spawn: [
    { field: "object_id", check: isFiniteInt },
    { field: "zone_id", check: isFiniteInt },
    { field: "ui_map_id", check: isNullableInt },
    { field: "x", check: isFiniteNumber },
    { field: "y", check: isFiniteNumber },
  ],
  item: [
    { field: "id", check: isFiniteInt },
    { field: "name", check: isNonEmptyString },
    { field: "item_level", check: isNullableInt },
    { field: "required_level", check: isNullableInt },
    { field: "class", check: isNullableInt },
    { field: "sub_class", check: isNullableInt },
  ],
  item_source: [
    { field: "item_id", check: isFiniteInt },
    { field: "kind", check: isItemSourceKind },
    { field: "entity_id", check: isFiniteInt },
  ],
};

export const isValidRow = (table: TableName, row: unknown): boolean => {
  if (typeof row !== "object" || row === null) {
    return false;
  }
  const record = row as Record<string, unknown>;
  return FIELD_CHECKS[table].every(({ field, check }) => check(record[field]));
};
