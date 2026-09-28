import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import DatabaseCtor from "better-sqlite3";
import type { Db } from "../../src/db.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const SCHEMA_PATH = join(REPO_ROOT, "scripts", "db-schema.sql");

const createdDirs: string[] = [];

function uniqueDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "wowc-mcp-"));
  createdDirs.push(dir);
  return join(dir, "mini.sqlite");
}

export function cleanupMiniDbTempDirs(): void {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

function seed(db: InstanceType<typeof DatabaseCtor>): void {
  db.prepare(
    "INSERT INTO npc (id, name, sub_name, min_level, max_level, faction_id, friendly_to) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(1, "Hogger", null, 6, 8, 2, "Horde");
  db.prepare(
    "INSERT INTO npc (id, name, sub_name, min_level, max_level, faction_id, friendly_to) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(2, "Kurtis Bladewood", null, 5, 5, 1, "Alliance");
  db.prepare("INSERT INTO npc_spawn (npc_id, zone_id, ui_map_id, x, y) VALUES (?, ?, ?, ?, ?)").run(
    1,
    40,
    85,
    45.2,
    63.8,
  );

  db.prepare(
    "INSERT INTO quest (id, name, required_level, quest_level, zone_or_sort, objectives_text, next_in_chain) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(100, "Wanted: Hogger", 6, 8, 40, "Slay Hogger", null);
  db.prepare("INSERT INTO quest_start (quest_id, kind, entity_id) VALUES (?, ?, ?)").run(
    100,
    "npc",
    2,
  );
  db.prepare("INSERT INTO quest_end (quest_id, kind, entity_id) VALUES (?, ?, ?)").run(
    100,
    "npc",
    2,
  );

  db.prepare("INSERT INTO object (id, name) VALUES (?, ?)").run(10, "Mailbox");
  db.prepare(
    "INSERT INTO object_spawn (object_id, zone_id, ui_map_id, x, y) VALUES (?, ?, ?, ?, ?)",
  ).run(10, 40, 85, 50, 50);

  const items: [number, string, number, number, number, number][] = [
    [200, "Cloth Robe of the Whale", 10, 5, 4, 1],
    [201, "Leather Vest", 12, 5, 4, 2],
    [202, "Mail Hauberk", 14, 5, 4, 3],
    [203, "Plate Chestguard", 16, 5, 4, 4],
    [204, "Worn Shortsword", 8, 3, 2, 7],
    [205, "Battered Ring", 9, 1, 4, 0],
  ];
  const insertItem = db.prepare(
    "INSERT INTO item (id, name, item_level, required_level, class, sub_class) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const row of items) insertItem.run(...row);

  const sources: [number, string, number][] = [
    [200, "npc_drop", 1],
    [201, "quest_reward", 100],
    [202, "vendor", 5],
    [203, "object_drop", 10],
    [204, "npc_drop", 1],
    [205, "vendor", 5],
  ];
  const insertSource = db.prepare(
    "INSERT INTO item_source (item_id, kind, entity_id) VALUES (?, ?, ?)",
  );
  for (const row of sources) insertSource.run(...row);
}

export function buildMiniDb(path: string = uniqueDbPath()): Db {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const writable = new DatabaseCtor(path);
  writable.exec(schema);
  seed(writable);
  writable.close();
  return new DatabaseCtor(path, { readonly: true, fileMustExist: true });
}

export function buildCustomDb(
  seedFn: (db: InstanceType<typeof DatabaseCtor>) => void,
  path: string = uniqueDbPath(),
): Db {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const writable = new DatabaseCtor(path);
  writable.exec(schema);
  seedFn(writable);
  writable.close();
  return new DatabaseCtor(path, { readonly: true, fileMustExist: true });
}
