import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDb, parseArgs } from "./build-db.ts";
import type { ExportedData } from "./build-db/rows.ts";
import { DEFAULT_EXPORTER_TIMEOUT_MS } from "./build-db/run-exporter.ts";
import { validateExportedData } from "./build-db/validate.ts";
import { writeDatabase } from "./build-db/write-database.ts";

const fixturesDir = join(process.cwd(), "tests", "build-db", "fixtures");
const fixtureCheckout = join(fixturesDir, "verified-layout-checkout");

const tempDirs: string[] = [];

const makeTempOutPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "build-db-test-"));
  tempDirs.push(dir);
  return join(dir, "questie.sqlite");
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

  it("refuses an invalid row at the JSON boundary before writing", () => {
    const outPath = makeTempOutPath();
    const result = buildDb(join(fixturesDir, "write-failure-checkout"), outPath, process.cwd());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("npc: row 0 field name is invalid");
    }
    expect(existsSync(outPath)).toBe(false);
    expect(existsSync(`${outPath}.tmp`)).toBe(false);
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

describe("validateExportedData", () => {
  it("accepts a fully valid export", () => {
    expect(validateExportedData(validData)).toBeNull();
  });

  it("rejects a missing required npc name", () => {
    const data: ExportedData = { ...validData, npc: [{ ...validData.npc[0]!, name: "" }] };
    expect(validateExportedData(data)).toBe("npc: row 0 field name is invalid");
  });

  it("rejects a non-finite spawn coordinate", () => {
    const data: ExportedData = {
      ...validData,
      npc_spawn: [{ ...validData.npc_spawn[0]!, x: Number.POSITIVE_INFINITY }],
    };
    expect(validateExportedData(data)).toBe("npc_spawn: row 0 field x is invalid");
  });

  it("rejects a non-integer id", () => {
    const data: ExportedData = { ...validData, object: [{ ...validData.object[0]!, id: 1.5 }] };
    expect(validateExportedData(data)).toBe("object: row 0 field id is invalid");
  });

  it("allows a negative zone_or_sort", () => {
    const data: ExportedData = {
      ...validData,
      quest: [{ ...validData.quest[0]!, zone_or_sort: -5 }],
    };
    expect(validateExportedData(data)).toBeNull();
  });

  it("rejects a row that is not an object", () => {
    const data: ExportedData = {
      ...validData,
      object: [null as unknown as ExportedData["object"][number]],
    };
    expect(validateExportedData(data)).toBe("object: row 0 is not an object");
  });

  it("rejects an item_source kind outside the allowed set", () => {
    const data: ExportedData = {
      ...validData,
      item_source: [{ item_id: 1, kind: "loot_box", entity_id: 1 }],
    };
    expect(validateExportedData(data)).toBe("item_source: row 0 field kind is invalid");
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
