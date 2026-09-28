import { describe, expect, it } from "vitest";
import type { Db } from "../src/db.ts";
import { gearCandidateIds, itemSources } from "../src/db.ts";
import { buildCustomDb, cleanupMiniDbTempDirs } from "./fixtures/build-mini-db.ts";

const SHAMAN_CLASS_ID = 7;
const FLOOD_ITEM_COUNT = 30;
const FLOOD_ID_BASE = 9000;
const MAIL_ITEM_ID = 9100;
const RING_ITEM_ID = 9101;
const WEAPON_ITEM_ID = 9102;

function seedGroupSeparation(db: Db): void {
  const insertItem = db.prepare(
    "INSERT INTO item (id, name, item_level, required_level, class, sub_class) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertSource = db.prepare(
    "INSERT INTO item_source (item_id, kind, entity_id) VALUES (?, ?, ?)",
  );
  for (let i = 0; i < FLOOD_ITEM_COUNT; i += 1) {
    const id = FLOOD_ID_BASE + i;
    insertItem.run(id, `Flood Plate ${String(i)}`, 100 + i, 1, 4, 4);
    insertSource.run(id, "vendor", 5);
  }
  insertItem.run(MAIL_ITEM_ID, "Reliable Mail Hauberk", 5, 1, 4, 3);
  insertSource.run(MAIL_ITEM_ID, "vendor", 5);
  insertItem.run(RING_ITEM_ID, "Battered Signet", 5, 1, 4, 0);
  insertSource.run(RING_ITEM_ID, "vendor", 5);
  insertItem.run(WEAPON_ITEM_ID, "Reliable Mace", 5, 1, 2, 3);
  insertSource.run(WEAPON_ITEM_ID, "vendor", 5);
}

describe("db.gearCandidateIds", () => {
  it("filters each group by armour subclass before the LIMIT, so a flood of the wrong subclass neither appears nor starves the other groups (aca-r2-8)", () => {
    const db: Db = buildCustomDb(seedGroupSeparation);
    const ids = gearCandidateIds(db, { characterLevel: 60, classId: SHAMAN_CLASS_ID, limit: 25 });
    expect(ids).toContain(MAIL_ITEM_ID);
    expect(ids).toContain(RING_ITEM_ID);
    expect(ids).toContain(WEAPON_ITEM_ID);
    for (let i = 0; i < FLOOD_ITEM_COUNT; i += 1) {
      expect(ids).not.toContain(FLOOD_ID_BASE + i);
    }
    db.close();
    cleanupMiniDbTempDirs();
  });
});

describe("db.itemSources", () => {
  it("orders sources deterministically instead of relying on insertion order (aca-r2-9)", () => {
    const db: Db = buildCustomDb((writable) => {
      const insertItem = writable.prepare(
        "INSERT INTO item (id, name, item_level, required_level, class, sub_class) VALUES (?, ?, ?, ?, ?, ?)",
      );
      insertItem.run(9200, "Multi-source Trinket", 5, 1, 4, 0);
      const insertSource = writable.prepare(
        "INSERT INTO item_source (item_id, kind, entity_id) VALUES (?, ?, ?)",
      );
      insertSource.run(9200, "vendor", 9);
      insertSource.run(9200, "npc_drop", 1);
    });
    const sources = itemSources(db, 9200);
    expect(sources).toEqual([
      { kind: "npc_drop", entityId: 1 },
      { kind: "vendor", entityId: 9 },
    ]);
    db.close();
    cleanupMiniDbTempDirs();
  });
});
