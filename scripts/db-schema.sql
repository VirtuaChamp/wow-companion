CREATE TABLE npc (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sub_name TEXT,
  min_level INTEGER,
  max_level INTEGER,
  faction_id INTEGER,
  friendly_to TEXT
);

CREATE TABLE npc_spawn (
  npc_id INTEGER NOT NULL,
  zone_id INTEGER NOT NULL,
  ui_map_id INTEGER,
  x REAL,
  y REAL
);

CREATE TABLE quest (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  required_level INTEGER,
  quest_level INTEGER,
  zone_or_sort INTEGER,
  objectives_text TEXT,
  next_in_chain INTEGER
);

CREATE TABLE quest_start (
  quest_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL
);

CREATE TABLE quest_end (
  quest_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL
);

CREATE TABLE object (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE object_spawn (
  object_id INTEGER NOT NULL,
  zone_id INTEGER NOT NULL,
  ui_map_id INTEGER,
  x REAL,
  y REAL
);

CREATE TABLE item (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  item_level INTEGER,
  required_level INTEGER,
  class INTEGER,
  sub_class INTEGER
);

CREATE TABLE item_source (
  item_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('npc_drop', 'object_drop', 'quest_reward', 'vendor')),
  entity_id INTEGER NOT NULL
);
