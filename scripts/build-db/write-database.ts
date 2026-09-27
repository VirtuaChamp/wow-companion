import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import Database from "better-sqlite3";
import { err, ok, type Result } from "../lib/result.ts";
import type { ExportedData } from "./rows.ts";

const tmpArtifacts = (tmpPath: string): string[] => [
  tmpPath,
  `${tmpPath}-journal`,
  `${tmpPath}-wal`,
  `${tmpPath}-shm`,
];

const removeTmpArtifacts = (tmpPath: string): void => {
  for (const path of tmpArtifacts(tmpPath)) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
};

export const writeDatabase = (
  dbPath: string,
  schemaPath: string,
  data: ExportedData,
): Result<void, string> => {
  const tmpPath = `${dbPath}.tmp`;
  removeTmpArtifacts(tmpPath);
  let db: Database.Database | undefined;
  try {
    db = new Database(tmpPath);
    db.exec(readFileSync(schemaPath, "utf8"));
    const insertNpc = db.prepare(
      "INSERT INTO npc (id, name, sub_name, min_level, max_level, faction_id, friendly_to) VALUES (@id, @name, @sub_name, @min_level, @max_level, @faction_id, @friendly_to)",
    );
    const insertNpcSpawn = db.prepare(
      "INSERT INTO npc_spawn (npc_id, zone_id, ui_map_id, x, y) VALUES (@npc_id, @zone_id, @ui_map_id, @x, @y)",
    );
    const insertQuest = db.prepare(
      "INSERT INTO quest (id, name, required_level, quest_level, zone_or_sort, objectives_text, next_in_chain) VALUES (@id, @name, @required_level, @quest_level, @zone_or_sort, @objectives_text, @next_in_chain)",
    );
    const insertQuestStart = db.prepare(
      "INSERT INTO quest_start (quest_id, kind, entity_id) VALUES (@quest_id, @kind, @entity_id)",
    );
    const insertQuestEnd = db.prepare(
      "INSERT INTO quest_end (quest_id, kind, entity_id) VALUES (@quest_id, @kind, @entity_id)",
    );
    const insertObject = db.prepare("INSERT INTO object (id, name) VALUES (@id, @name)");
    const insertObjectSpawn = db.prepare(
      "INSERT INTO object_spawn (object_id, zone_id, ui_map_id, x, y) VALUES (@object_id, @zone_id, @ui_map_id, @x, @y)",
    );
    const insertItem = db.prepare(
      "INSERT INTO item (id, name, item_level, required_level, class, sub_class) VALUES (@id, @name, @item_level, @required_level, @class, @sub_class)",
    );
    const insertItemSource = db.prepare(
      "INSERT INTO item_source (item_id, kind, entity_id) VALUES (@item_id, @kind, @entity_id)",
    );
    const writeAll = db.transaction((rows: ExportedData): void => {
      for (const row of rows.npc) {
        insertNpc.run(row);
      }
      for (const row of rows.npc_spawn) {
        insertNpcSpawn.run(row);
      }
      for (const row of rows.quest) {
        insertQuest.run(row);
      }
      for (const row of rows.quest_start) {
        insertQuestStart.run(row);
      }
      for (const row of rows.quest_end) {
        insertQuestEnd.run(row);
      }
      for (const row of rows.object) {
        insertObject.run(row);
      }
      for (const row of rows.object_spawn) {
        insertObjectSpawn.run(row);
      }
      for (const row of rows.item) {
        insertItem.run(row);
      }
      for (const row of rows.item_source) {
        insertItemSource.run(row);
      }
    });
    writeAll(data);
    db.close();
    db = undefined;
    renameSync(tmpPath, dbPath);
    return ok(undefined);
  } catch (error) {
    db?.close();
    removeTmpArtifacts(tmpPath);
    const message = error instanceof Error ? error.message : String(error);
    return err(`failed to write database at ${dbPath}: ${message}`);
  }
};
