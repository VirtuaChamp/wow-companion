type ExportedNpc = {
  id: number;
  name: string;
  sub_name: string | null;
  min_level: number | null;
  max_level: number | null;
  faction_id: number | null;
  friendly_to: string | null;
};

type ExportedSpawn = {
  zone_id: number;
  ui_map_id: number | null;
  x: number;
  y: number;
};

type ExportedNpcSpawn = ExportedSpawn & { npc_id: number };

type ExportedQuest = {
  id: number;
  name: string;
  required_level: number | null;
  quest_level: number | null;
  zone_or_sort: number | null;
  objectives_text: string | null;
  next_in_chain: number | null;
};

type ExportedQuestLink = {
  quest_id: number;
  kind: string;
  entity_id: number;
};

type ExportedObject = {
  id: number;
  name: string;
};

type ExportedObjectSpawn = ExportedSpawn & { object_id: number };

type ExportedItem = {
  id: number;
  name: string;
  item_level: number | null;
  required_level: number | null;
  class: number | null;
  sub_class: number | null;
};

type ExportedItemSource = {
  item_id: number;
  kind: string;
  entity_id: number;
};

export type ExportedData = {
  npc: ExportedNpc[];
  npc_spawn: ExportedNpcSpawn[];
  quest: ExportedQuest[];
  quest_start: ExportedQuestLink[];
  quest_end: ExportedQuestLink[];
  object: ExportedObject[];
  object_spawn: ExportedObjectSpawn[];
  item: ExportedItem[];
  item_source: ExportedItemSource[];
};
