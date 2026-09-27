import type { ExportedData } from "./rows.ts";

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

type FieldCheck<Row> = { field: keyof Row & string; check: (value: unknown) => boolean };

const validateRows = <Row extends Record<string, unknown>>(
  table: string,
  rows: Row[],
  fields: FieldCheck<Row>[],
): string | null => {
  for (const [index, row] of rows.entries()) {
    if (typeof row !== "object" || row === null) {
      return `${table}: row ${index} is not an object`;
    }
    for (const { field, check } of fields) {
      if (!check(row[field])) {
        return `${table}: row ${index} field ${field} is invalid`;
      }
    }
  }
  return null;
};

export const validateExportedData = (data: ExportedData): string | null =>
  validateRows("npc", data.npc, [
    { field: "id", check: isFiniteInt },
    { field: "name", check: isNonEmptyString },
    { field: "sub_name", check: isNullableString },
    { field: "min_level", check: isNullableInt },
    { field: "max_level", check: isNullableInt },
    { field: "faction_id", check: isNullableInt },
    { field: "friendly_to", check: isNullableString },
  ]) ??
  validateRows("npc_spawn", data.npc_spawn, [
    { field: "npc_id", check: isFiniteInt },
    { field: "zone_id", check: isFiniteInt },
    { field: "ui_map_id", check: isNullableInt },
    { field: "x", check: isFiniteNumber },
    { field: "y", check: isFiniteNumber },
  ]) ??
  validateRows("quest", data.quest, [
    { field: "id", check: isFiniteInt },
    { field: "name", check: isNonEmptyString },
    { field: "required_level", check: isNullableInt },
    { field: "quest_level", check: isNullableInt },
    { field: "zone_or_sort", check: isNullableInt },
    { field: "objectives_text", check: isNullableString },
    { field: "next_in_chain", check: isNullableInt },
  ]) ??
  validateRows("quest_start", data.quest_start, [
    { field: "quest_id", check: isFiniteInt },
    { field: "kind", check: isNonEmptyString },
    { field: "entity_id", check: isFiniteInt },
  ]) ??
  validateRows("quest_end", data.quest_end, [
    { field: "quest_id", check: isFiniteInt },
    { field: "kind", check: isNonEmptyString },
    { field: "entity_id", check: isFiniteInt },
  ]) ??
  validateRows("object", data.object, [
    { field: "id", check: isFiniteInt },
    { field: "name", check: isNonEmptyString },
  ]) ??
  validateRows("object_spawn", data.object_spawn, [
    { field: "object_id", check: isFiniteInt },
    { field: "zone_id", check: isFiniteInt },
    { field: "ui_map_id", check: isNullableInt },
    { field: "x", check: isFiniteNumber },
    { field: "y", check: isFiniteNumber },
  ]) ??
  validateRows("item", data.item, [
    { field: "id", check: isFiniteInt },
    { field: "name", check: isNonEmptyString },
    { field: "item_level", check: isNullableInt },
    { field: "required_level", check: isNullableInt },
    { field: "class", check: isNullableInt },
    { field: "sub_class", check: isNullableInt },
  ]) ??
  validateRows("item_source", data.item_source, [
    { field: "item_id", check: isFiniteInt },
    { field: "kind", check: isItemSourceKind },
    { field: "entity_id", check: isFiniteInt },
  ]);
