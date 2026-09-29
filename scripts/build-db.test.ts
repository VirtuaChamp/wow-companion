import Database from "better-sqlite3";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDb, formatNulledReferences, formatSkipReport, parseArgs } from "./build-db.ts";
import type { ExportedData } from "./build-db/rows.ts";
import { DEFAULT_EXPORTER_TIMEOUT_MS } from "./build-db/run-exporter.ts";
import { sanitizeExportedData } from "./build-db/sanitize.ts";
import { isValidRow } from "./build-db/validate.ts";
import { writeDatabase } from "./build-db/write-database.ts";

const fixturesDir = join(process.cwd(), "tests", "build-db", "fixtures");
const fixtureCheckout = join(fixturesDir, "verified-layout-checkout");

const tempDirs: string[] = [];

const makeTempOutPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "build-db-test-"));
  tempDirs.push(dir);
  return join(dir, "questie.sqlite");
};

const makeTempCheckout = (objectCount: number, ...emptyNameIds: number[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "build-db-checkout-"));
  tempDirs.push(dir);
  cpSync(fixtureCheckout, dir, { recursive: true });
  const lines = Array.from({ length: objectCount }, (_, index) => {
    const id = 8001 + index;
    const name = emptyNameIds.includes(id) ? "" : `Fixture Object ${id}`;
    return `[${id}] = {"${name}",nil,nil,{[1]={{1.5,2.5}}},1,0,nil},`;
  });
  writeFileSync(
    join(dir, "data", "Forever", "foreverObjectDB.lua"),
    `local QuestieDB = QuestieLoader:ImportModule("QuestieDB")\n\nQuestieDB.objectData = [[return {\n${lines.join("\n")}\n}]]\n`,
  );
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("builddb.smoke", () => {
  it("builds every table from the fixture checkout with resolved ui_map_id", () => {
    const outPath = makeTempOutPath();
    const result = buildDb(fixtureCheckout, outPath, process.cwd());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.counts).toEqual({
      npc: 3,
      npc_spawn: 3,
      quest: 3,
      quest_start: 3,
      quest_end: 3,
      object: 3,
      object_spawn: 3,
      item: 3,
      item_source: 3,
    });
    expect(result.value.unresolvedUiMapIds).toBe(2);

    const db = new Database(outPath, { readonly: true });
    try {
      const guard = db.prepare("SELECT * FROM npc WHERE id = 7001").get();
      expect(guard).toEqual({
        id: 7001,
        name: "Fixture Guard",
        sub_name: "Watchman",
        min_level: 5,
        max_level: 8,
        faction_id: 1,
        friendly_to: "A",
      });

      const trainer = db.prepare("SELECT * FROM npc WHERE id = 7002").get();
      expect(trainer).toEqual({
        id: 7002,
        name: "Fixture Trainer",
        sub_name: null,
        min_level: 2,
        max_level: 3,
        faction_id: 2,
        friendly_to: null,
      });

      const guardSpawnRow = db.prepare("SELECT * FROM npc_spawn WHERE npc_id = 7001").get();
      expect(guardSpawnRow).toEqual({
        npc_id: 7001,
        zone_id: 1,
        ui_map_id: 101,
        x: 12.5,
        y: 45.25,
      });

      const trainerSpawnRow = db.prepare("SELECT * FROM npc_spawn WHERE npc_id = 7002").get();
      expect(trainerSpawnRow).toEqual({
        npc_id: 7002,
        zone_id: 2,
        ui_map_id: 102,
        x: 5,
        y: 5,
      });

      const wandererSpawnRow = db.prepare("SELECT * FROM npc_spawn WHERE npc_id = 7003").get();
      expect(wandererSpawnRow).toEqual({
        npc_id: 7003,
        zone_id: 3,
        ui_map_id: null,
        x: 1,
        y: 1,
      });

      const chest = db.prepare("SELECT * FROM object WHERE id = 8001").get();
      expect(chest).toEqual({ id: 8001, name: "Fixture Chest" });

      const chestSpawnRow = db.prepare("SELECT * FROM object_spawn WHERE object_id = 8001").get();
      expect(chestSpawnRow).toEqual({
        object_id: 8001,
        zone_id: 1,
        ui_map_id: 101,
        x: 15.0,
        y: 25.0,
      });

      const statueSpawnRow = db.prepare("SELECT * FROM object_spawn WHERE object_id = 8003").get();
      expect(statueSpawnRow).toEqual({
        object_id: 8003,
        zone_id: 3,
        ui_map_id: null,
        x: 2,
        y: 2,
      });

      const firstQuestRow = db.prepare("SELECT * FROM quest WHERE id = 9001").get();
      expect(firstQuestRow).toEqual({
        id: 9001,
        name: "Fixture First Steps",
        required_level: 1,
        quest_level: 2,
        zone_or_sort: 1,
        objectives_text: "Talk to the Fixture Guard.",
        next_in_chain: 9002,
      });

      const secondQuestRow = db.prepare("SELECT * FROM quest WHERE id = 9002").get();
      expect(secondQuestRow).toEqual({
        id: 9002,
        name: "Fixture Middle Step",
        required_level: 3,
        quest_level: 4,
        zone_or_sort: 2,
        objectives_text: "Return the fixture item.",
        next_in_chain: null,
      });

      const sword = db.prepare("SELECT * FROM item WHERE id = 10001").get();
      expect(sword).toEqual({
        id: 10001,
        name: "Fixture Sword",
        item_level: 15,
        required_level: 5,
        class: 2,
        sub_class: 7,
      });

      const questStart = db
        .prepare("SELECT kind, entity_id FROM quest_start WHERE quest_id = 9001")
        .get();
      expect(questStart).toEqual({ kind: "npc", entity_id: 7001 });

      const questEnd = db
        .prepare("SELECT kind, entity_id FROM quest_end WHERE quest_id = 9001")
        .get();
      expect(questEnd).toEqual({ kind: "object", entity_id: 8001 });

      const secondQuestStart = db
        .prepare("SELECT kind, entity_id FROM quest_start WHERE quest_id = 9002")
        .get();
      expect(secondQuestStart).toEqual({ kind: "object", entity_id: 8002 });

      const secondQuestEnd = db
        .prepare("SELECT kind, entity_id FROM quest_end WHERE quest_id = 9002")
        .get();
      expect(secondQuestEnd).toEqual({ kind: "npc", entity_id: 7002 });

      const npcDropSource = db
        .prepare("SELECT kind, entity_id FROM item_source WHERE item_id = 10001")
        .get();
      expect(npcDropSource).toEqual({ kind: "npc_drop", entity_id: 7001 });

      const objectDropSource = db
        .prepare("SELECT kind, entity_id FROM item_source WHERE item_id = 10002")
        .get();
      expect(objectDropSource).toEqual({ kind: "object_drop", entity_id: 8002 });

      const questRewardSource = db
        .prepare("SELECT kind, entity_id FROM item_source WHERE item_id = 10003")
        .get();
      expect(questRewardSource).toEqual({ kind: "quest_reward", entity_id: 9002 });
    } finally {
      db.close();
    }
  });

  it("rebuilds over an existing database instead of failing", () => {
    const outPath = makeTempOutPath();
    const first = buildDb(fixtureCheckout, outPath, process.cwd());
    expect(first.ok).toBe(true);
    const second = buildDb(fixtureCheckout, outPath, process.cwd());
    expect(second.ok).toBe(true);
    expect(existsSync(`${outPath}.tmp`)).toBe(false);
  });

  it("refuses a data file that reaches outside the sandbox", () => {
    const outPath = makeTempOutPath();
    const result = buildDb(join(fixturesDir, "sandbox-escape-checkout"), outPath, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("foreverNpcDB.lua");
      expect(result.error).toContain("attempt to index global 'os'");
    }
    expect(existsSync(outPath)).toBe(false);
  });

  it("refuses a data file that is precompiled Lua bytecode", () => {
    const outPath = makeTempOutPath();
    const result = buildDb(join(fixturesDir, "bytecode-checkout"), outPath, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("foreverNpcDB.lua: refusing precompiled Lua bytecode");
    }
    expect(existsSync(outPath)).toBe(false);
  });

  it("refuses a data string that is itself precompiled Lua bytecode", () => {
    const outPath = makeTempOutPath();
    const result = buildDb(join(fixturesDir, "inner-bytecode-checkout"), outPath, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("foreverNpcDB.lua: refusing precompiled Lua bytecode");
    }
    expect(existsSync(outPath)).toBe(false);
  });

  it("refuses a table whose every row is invalid before writing", () => {
    const outPath = makeTempOutPath();
    const result = buildDb(join(fixturesDir, "write-failure-checkout"), outPath, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "npc: 1 of 1 rows skipped, above the 2% limit (first source ids: 7001)",
      );
    }
    expect(existsSync(outPath)).toBe(false);
    expect(existsSync(`${outPath}.tmp`)).toBe(false);
  });

  it("skips an empty-named object and its spawn on a checkout, and reports them", () => {
    const outPath = makeTempOutPath();
    const checkout = makeTempCheckout(200, 8137);
    const result = buildDb(checkout, outPath, process.cwd());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.counts.object).toBe(199);
    expect(result.value.counts.object_spawn).toBe(199);
    expect(result.value.skips.object).toEqual({ total: 200, skipped: 1, firstIds: ["8137"] });
    expect(result.value.skips.object_spawn).toEqual({ total: 200, skipped: 1, firstIds: ["8137"] });
    expect(result.value.skips.npc.skipped).toBe(0);
    expect(formatSkipReport(result.value.skips)).toContain(
      "object: 200 source rows, 1 skipped, first source ids: 8137",
    );
    const db = new Database(outPath, { readonly: true });
    try {
      expect(db.prepare("SELECT count(*) AS c FROM object WHERE name = ''").get()).toEqual({
        c: 0,
      });
      expect(db.prepare("SELECT count(*) AS c FROM object WHERE id = 8137").get()).toEqual({
        c: 0,
      });
      expect(
        db.prepare("SELECT count(*) AS c FROM object_spawn WHERE object_id = 8137").get(),
      ).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it("fails the checkout build when more than 2% of a table is skipped", () => {
    const outPath = makeTempOutPath();
    const checkout = makeTempCheckout(100, 8005, 8006, 8007);
    const result = buildDb(checkout, outPath, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "object: 3 of 100 rows skipped, above the 2% limit (first source ids: 8005, 8006, 8007)",
      );
    }
    expect(existsSync(outPath)).toBe(false);
  });

  it("times out a data file that never returns, without leaving a partial database", () => {
    const outPath = makeTempOutPath();
    const result = buildDb(
      join(fixturesDir, "infinite-loop-checkout"),
      outPath,
      process.cwd(),
      300,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("timed out");
    }
    expect(existsSync(outPath)).toBe(false);
  });

  it("stops a data file that allocates without bound, without leaving a partial database", () => {
    const outPath = makeTempOutPath();
    const result = buildDb(
      join(fixturesDir, "unbounded-memory-checkout"),
      outPath,
      process.cwd(),
      DEFAULT_EXPORTER_TIMEOUT_MS,
      500,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("exceeded memory ceiling of 500 KB");
    }
    expect(existsSync(outPath)).toBe(false);
  });

  it("rejects an item_source kind the schema check does not allow", () => {
    const outPath = makeTempOutPath();
    const schemaPath = join(process.cwd(), "scripts", "db-schema.sql");
    const data: ExportedData = {
      npc: [],
      npc_spawn: [],
      quest: [],
      quest_start: [],
      quest_end: [],
      object: [],
      object_spawn: [],
      item: [
        {
          id: 10001,
          name: "Fixture Sword",
          item_level: null,
          required_level: null,
          class: null,
          sub_class: null,
        },
      ],
      item_source: [{ item_id: 10001, kind: "loot_box", entity_id: 7001 }],
    };
    const result = writeDatabase(outPath, schemaPath, data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("CHECK");
    }
    expect(existsSync(outPath)).toBe(false);
    expect(existsSync(`${outPath}.tmp`)).toBe(false);
  });

  it("refuses a missing checkout path without leaving a partial database", () => {
    const outPath = makeTempOutPath();
    const missingCheckout = join(fixtureCheckout, "..", "does-not-exist");
    const result = buildDb(missingCheckout, outPath, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("data");
      expect(result.error).toContain("Forever");
    }
    expect(existsSync(outPath)).toBe(false);
  });
});

const validData: ExportedData = {
  npc: [
    {
      id: 1,
      name: "Guard",
      sub_name: null,
      min_level: 1,
      max_level: 2,
      faction_id: 1,
      friendly_to: "A",
    },
  ],
  npc_spawn: [{ npc_id: 1, zone_id: 1, ui_map_id: 1, x: 1, y: 1 }],
  quest: [
    {
      id: 1,
      name: "Quest",
      required_level: 1,
      quest_level: 1,
      zone_or_sort: -1,
      objectives_text: "Do the thing.",
      next_in_chain: null,
    },
  ],
  quest_start: [{ quest_id: 1, kind: "npc", entity_id: 1 }],
  quest_end: [{ quest_id: 1, kind: "npc", entity_id: 1 }],
  object: [{ id: 1, name: "Chest" }],
  object_spawn: [{ object_id: 1, zone_id: 1, ui_map_id: 1, x: 1, y: 1 }],
  item: [{ id: 1, name: "Sword", item_level: 1, required_level: 1, class: 1, sub_class: 1 }],
  item_source: [{ item_id: 1, kind: "npc_drop", entity_id: 1 }],
};

const many = <Row>(count: number, make: (id: number) => Row): Row[] =>
  Array.from({ length: count }, (_, index) => make(index + 1));

const bulkData = (count: number): ExportedData => ({
  npc: many(count, (id) => ({ ...validData.npc[0]!, id })),
  npc_spawn: many(count, (id) => ({ ...validData.npc_spawn[0]!, npc_id: id })),
  quest: many(count, (id) => ({ ...validData.quest[0]!, id })),
  quest_start: many(count, (id) => ({ quest_id: id, kind: "npc", entity_id: id })),
  quest_end: many(count, (id) => ({ quest_id: id, kind: "object", entity_id: id })),
  object: many(count, (id) => ({ ...validData.object[0]!, id })),
  object_spawn: many(count, (id) => ({ ...validData.object_spawn[0]!, object_id: id })),
  item: many(count, (id) => ({ ...validData.item[0]!, id })),
  item_source: many(count, (id) => ({ item_id: id, kind: "npc_drop", entity_id: id })),
});

const sanitized = (data: ExportedData, maxSkippedPercent?: number) => {
  const result = sanitizeExportedData(data, maxSkippedPercent);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
};

describe("isValidRow", () => {
  it("accepts a valid row of every table", () => {
    expect(isValidRow("npc", validData.npc[0])).toBe(true);
    expect(isValidRow("item_source", validData.item_source[0])).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(isValidRow("npc", { ...validData.npc[0]!, name: "" })).toBe(false);
  });

  it("rejects a missing spawn coordinate", () => {
    const { x: _x, ...withoutX } = validData.npc_spawn[0]!;
    expect(isValidRow("npc_spawn", withoutX)).toBe(false);
  });

  it("rejects a non-integer id and a row that is not an object", () => {
    expect(isValidRow("object", { ...validData.object[0]!, id: 1.5 })).toBe(false);
    expect(isValidRow("object", null)).toBe(false);
  });

  it("allows a negative zone_or_sort", () => {
    expect(isValidRow("quest", { ...validData.quest[0]!, zone_or_sort: -5 })).toBe(true);
  });

  it("rejects an item_source kind outside the allowed set", () => {
    expect(isValidRow("item_source", { item_id: 1, kind: "loot_box", entity_id: 1 })).toBe(false);
  });
});

describe("sanitizeExportedData", () => {
  it("passes a fully valid export through untouched", () => {
    const data = bulkData(3);
    const { data: kept, skips } = sanitized(data);
    expect(kept).toEqual(data);
    expect(skips.npc).toEqual({ total: 3, skipped: 0, firstIds: [] });
  });

  it("skips an empty-named npc with its spawns, quest links and item sources", () => {
    const data = bulkData(200);
    data.npc[6] = { ...data.npc[6]!, name: "" };
    data.item_source[9] = { item_id: 10, kind: "vendor", entity_id: 7 };
    const { data: kept, skips } = sanitized(data);
    expect(kept.npc.map((row) => row.id)).not.toContain(7);
    expect(kept.npc).toHaveLength(199);
    expect(kept.npc_spawn.map((row) => row.npc_id)).not.toContain(7);
    expect(kept.quest_start.map((row) => row.entity_id)).not.toContain(7);
    expect(kept.item_source.map((row) => row.entity_id)).not.toContain(7);
    expect(kept.quest_end).toHaveLength(200);
    expect(skips.npc).toEqual({ total: 200, skipped: 1, firstIds: ["7"] });
    expect(skips.npc_spawn).toEqual({ total: 200, skipped: 1, firstIds: ["7"] });
    expect(skips.quest_start).toEqual({ total: 200, skipped: 1, firstIds: ["7"] });
    expect(skips.item_source).toEqual({ total: 200, skipped: 2, firstIds: ["7", "10"] });
  });

  it("skips an empty-named object with its spawn, quest end links and drops", () => {
    const data = bulkData(200);
    data.object[3] = { ...data.object[3]!, name: "" };
    data.item_source[0] = { item_id: 1, kind: "object_drop", entity_id: 4 };
    const { data: kept, skips } = sanitized(data);
    expect(kept.object).toHaveLength(199);
    expect(kept.object_spawn.map((row) => row.object_id)).not.toContain(4);
    expect(kept.quest_end.map((row) => row.entity_id)).not.toContain(4);
    expect(kept.item_source.map((row) => row.kind)).not.toContain("object_drop");
    expect(skips.object_spawn.skipped).toBe(1);
    expect(skips.quest_end.skipped).toBe(1);
    expect(skips.item_source.skipped).toBe(1);
  });

  it("skips an empty-named quest with its links and reward sources", () => {
    const data = bulkData(200);
    data.quest[19] = { ...data.quest[19]!, name: "" };
    data.item_source[0] = { item_id: 1, kind: "quest_reward", entity_id: 20 };
    const { data: kept, skips } = sanitized(data);
    expect(kept.quest).toHaveLength(199);
    expect(kept.quest_start.map((row) => row.quest_id)).not.toContain(20);
    expect(kept.quest_end.map((row) => row.quest_id)).not.toContain(20);
    expect(kept.item_source.map((row) => row.kind)).not.toContain("quest_reward");
    expect(skips.quest.firstIds).toEqual(["20"]);
    expect(skips.item_source.skipped).toBe(1);
  });

  it("skips an empty-named item with its sources and the quest start links that name it", () => {
    const data = bulkData(200);
    data.item[49] = { ...data.item[49]!, name: "" };
    data.quest_start[0] = { quest_id: 1, kind: "item", entity_id: 50 };
    const { data: kept, skips } = sanitized(data);
    expect(kept.item).toHaveLength(199);
    expect(kept.item_source.map((row) => row.item_id)).not.toContain(50);
    expect(kept.quest_start.map((row) => row.kind)).not.toContain("item");
    expect(skips.item.firstIds).toEqual(["50"]);
    expect(skips.item_source.skipped).toBe(1);
    expect(skips.quest_start.skipped).toBe(1);
  });

  it("skips only the spawn row when its own coordinate is missing", () => {
    const data = bulkData(200);
    const { x: _x, ...withoutX } = data.npc_spawn[4]!;
    data.npc_spawn[4] = withoutX as ExportedData["npc_spawn"][number];
    const { data: kept, skips } = sanitized(data);
    expect(kept.npc).toHaveLength(200);
    expect(kept.npc_spawn).toHaveLength(199);
    expect(skips.npc_spawn.firstIds).toEqual(["5"]);
  });

  it("reports at most five source ids per table", () => {
    const data = bulkData(1000);
    for (let index = 0; index < 8; index += 1) {
      data.object[index] = { ...data.object[index]!, name: "" };
    }
    const { skips } = sanitized(data);
    expect(skips.object.skipped).toBe(8);
    expect(skips.object.firstIds).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("skips a row that is not an object and reports an unknown id", () => {
    const data = bulkData(200);
    data.object[0] = null as unknown as ExportedData["object"][number];
    const { data: kept, skips } = sanitized(data);
    expect(kept.object).toHaveLength(199);
    expect(skips.object.firstIds).toEqual(["?"]);
  });

  it("accepts exactly 2% skipped", () => {
    const data = bulkData(100);
    data.object[0] = { ...data.object[0]!, name: "" };
    data.object[1] = { ...data.object[1]!, name: "" };
    expect(sanitizeExportedData(data).ok).toBe(true);
  });

  it("fails closed when more than 2% of a table is skipped", () => {
    const data = bulkData(100);
    data.npc_spawn[0] = { ...data.npc_spawn[0]!, x: Number.NaN };
    data.npc_spawn[1] = { ...data.npc_spawn[1]!, x: Number.NaN };
    data.npc_spawn[2] = { ...data.npc_spawn[2]!, x: Number.NaN };
    const result = sanitizeExportedData(data);
    expect(result).toEqual({
      ok: false,
      error: "npc_spawn: 3 of 100 rows skipped, above the 2% limit (first source ids: 1, 2, 3)",
    });
  });

  it("honours an explicit cap", () => {
    const data = bulkData(100);
    data.npc_spawn[0] = { ...data.npc_spawn[0]!, x: Number.NaN };
    data.npc_spawn[1] = { ...data.npc_spawn[1]!, x: Number.NaN };
    expect(sanitizeExportedData(data, 1).ok).toBe(false);
    expect(sanitizeExportedData(data, 3).ok).toBe(true);
  });

  it("drops a link whose target is absent from the source and counts it against the cap", () => {
    const data = bulkData(200);
    data.quest_start[0] = { quest_id: 1, kind: "npc", entity_id: 9999 };
    data.quest_end[0] = { quest_id: 1, kind: "object", entity_id: 9999 };
    data.quest_start[1] = { quest_id: 2, kind: "item", entity_id: 9999 };
    data.item_source[0] = { item_id: 1, kind: "npc_drop", entity_id: 9999 };
    data.item_source[1] = { item_id: 2, kind: "quest_reward", entity_id: 9999 };
    const { data: kept, skips } = sanitized(data);
    expect(kept.quest_start).toHaveLength(198);
    expect(kept.quest_end).toHaveLength(199);
    expect(kept.item_source).toHaveLength(198);
    expect(skips.quest_start).toEqual({ total: 200, skipped: 2, firstIds: ["1", "2"] });
    expect(skips.quest_end.skipped).toBe(1);
    expect(skips.item_source.skipped).toBe(2);
  });

  it("drops a link of an unknown kind", () => {
    const data = bulkData(200);
    data.quest_start[0] = { quest_id: 1, kind: "spell", entity_id: 1 };
    const { data: kept, skips } = sanitized(data);
    expect(kept.quest_start).toHaveLength(199);
    expect(skips.quest_start.skipped).toBe(1);
  });

  it("fails closed when dropped links push a table over the cap", () => {
    const data = bulkData(100);
    for (const index of [0, 1, 2]) {
      data.item_source[index] = { item_id: index + 1, kind: "vendor", entity_id: 9999 };
    }
    expect(sanitizeExportedData(data)).toEqual({
      ok: false,
      error: "item_source: 3 of 100 rows skipped, above the 2% limit (first source ids: 1, 2, 3)",
    });
  });

  it("sets a next_in_chain that names an absent or skipped quest to null and reports it", () => {
    const data = bulkData(100);
    data.quest[0] = { ...data.quest[0]!, next_in_chain: 9999 };
    data.quest[1] = { ...data.quest[1]!, next_in_chain: 100 };
    data.quest[2] = { ...data.quest[2]!, next_in_chain: 2 };
    data.quest[99] = { ...data.quest[99]!, name: "" };
    const { data: kept, skips, nulledReferences } = sanitized(data);
    expect(kept.quest.find((row) => row.id === 1)?.next_in_chain).toBeNull();
    expect(kept.quest.find((row) => row.id === 2)?.next_in_chain).toBeNull();
    expect(kept.quest.find((row) => row.id === 3)?.next_in_chain).toBe(2);
    expect(kept.quest).toHaveLength(99);
    expect(skips.quest.skipped).toBe(1);
    expect(nulledReferences).toEqual([
      { field: "quest.next_in_chain", count: 2, firstIds: ["1", "2"] },
    ]);
  });

  it("does not count a nulled reference against the skip cap", () => {
    const data = bulkData(100);
    for (let index = 0; index < 10; index += 1) {
      data.quest[index] = { ...data.quest[index]!, next_in_chain: 9999 };
    }
    const { data: kept, skips, nulledReferences } = sanitized(data);
    expect(kept.quest).toHaveLength(100);
    expect(skips.quest.skipped).toBe(0);
    expect(nulledReferences[0]?.count).toBe(10);
    expect(formatNulledReferences(nulledReferences)).toEqual([
      "quest.next_in_chain: 10 reference(s) to a dropped row set to null, first source ids: 1, 2, 3, 4, 5",
    ]);
  });

  it("refuses a cap that is not a finite non-negative number", () => {
    const data = bulkData(3);
    for (const cap of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(sanitizeExportedData(data, cap).ok).toBe(false);
    }
  });

  it("fails closed on a table with no source rows", () => {
    const data = { ...bulkData(100), quest_end: [] };
    expect(sanitizeExportedData(data)).toEqual({
      ok: false,
      error: "quest_end: no rows in the source",
    });
  });
});

describe("parseArgs", () => {
  it("accepts exactly one positional checkout path", () => {
    const result = parseArgs(["C:/checkout"]);
    expect(result).toEqual({
      ok: true,
      value: { checkoutPath: "C:/checkout", outPath: "data/questie.sqlite" },
    });
  });

  it("rejects more than one positional checkout path", () => {
    const result = parseArgs(["C:/checkout", "C:/unexpected"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "usage: build-db <questie checkout path> [--out data/questie.sqlite]",
      );
    }
  });

  it("rejects an extra positional path even after --out", () => {
    const result = parseArgs(["C:/checkout", "--out", "data/out.sqlite", "C:/unexpected"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "usage: build-db <questie checkout path> [--out data/questie.sqlite]",
      );
    }
  });
});
