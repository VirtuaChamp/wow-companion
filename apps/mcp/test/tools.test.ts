import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db.ts";
import { createTools } from "../src/tools.ts";
import type { Tools } from "../src/tools.ts";
import { buildCustomDb, buildMiniDb, cleanupMiniDbTempDirs } from "./fixtures/build-mini-db.ts";
import { createStubLocalApi } from "./fixtures/local-api-stub.ts";
import { makeItemDetail, makeSnapshot } from "./fixtures/snapshot.ts";

describe("mcp.<tool>", () => {
  let db: Db;
  let tools: Tools;

  beforeAll(() => {
    db = buildMiniDb();
    tools = createTools(db, createStubLocalApi({ snapshot: makeSnapshot() }));
  });

  afterAll(() => {
    db.close();
    cleanupMiniDbTempDirs();
  });

  it("get_game_state returns the snapshot", async () => {
    const result = await tools.getGameState();
    expect(result).toEqual({ ok: true, value: makeSnapshot() });
  });

  it("find_npc by name returns matches with spawns", async () => {
    const result = await tools.findNpc({ name: "Hogger" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.name).toBe("Hogger");
    expect(result.value[0]?.spawns).toEqual([{ zoneId: 40, uiMapId: 85, x: 45.2, y: 63.8 }]);
  });

  it("find_npc by id returns a single match", async () => {
    const result = await tools.findNpc({ id: 1 });
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: 1,
          name: "Hogger",
          subName: undefined,
          minLevel: 6,
          maxLevel: 8,
          factionId: 2,
          friendlyTo: "Horde",
          spawns: [{ zoneId: 40, uiMapId: 85, x: 45.2, y: 63.8 }],
        },
      ],
    });
  });

  it("find_npc name search escapes LIKE wildcards and rejects an empty name", async () => {
    expect(await tools.findNpc({ name: "%" })).toEqual({ ok: true, value: [] });
    expect(await tools.findNpc({ name: "" })).toEqual({ ok: true, value: [] });
  });

  it("find_quest by name returns start and end entities", async () => {
    const result = await tools.findQuest({ name: "Hogger" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.start).toEqual([{ kind: "npc", entityId: 2 }]);
    expect(result.value[0]?.end).toEqual([{ kind: "npc", entityId: 2 }]);
  });

  it("find_object by name returns spawns", async () => {
    const result = await tools.findObject({ name: "Mailbox" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { id: 10, name: "Mailbox", spawns: [{ zoneId: 40, uiMapId: 85, x: 50, y: 50 }] },
    ]);
  });

  it("suggest_gear_upgrades excludes wrong armour class and matches slot", async () => {
    const details = [
      makeItemDetail({ itemId: 200, subClassId: 1 }),
      makeItemDetail({ itemId: 201, name: "Leather Vest", subClassId: 2, itemLevel: 12 }),
      makeItemDetail({ itemId: 202, name: "Mail Hauberk", subClassId: 3, itemLevel: 14 }),
      makeItemDetail({ itemId: 203, name: "Plate Chestguard", subClassId: 4, itemLevel: 16 }),
      makeItemDetail({
        itemId: 205,
        name: "Battered Ring",
        equipLoc: "INVTYPE_FINGER",
        subClassId: 0,
        itemLevel: 9,
        stats: { ITEM_MOD_STAMINA_SHORT: 3 },
      }),
      makeItemDetail({
        itemId: 204,
        name: "Worn Shortsword",
        equipLoc: "INVTYPE_WEAPON",
        classId: 2,
        subClassId: 7,
        itemLevel: 8,
        stats: { ITEM_MOD_ATTACK_POWER_SHORT: 2 },
      }),
    ];
    const localTools = createTools(
      db,
      createStubLocalApi({ snapshot: makeSnapshot(), items: details }),
    );
    const result = await localTools.suggestGearUpgrades({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.upgrades.map((upgrade) => upgrade.candidate.itemId).sort((a, b) => a - b),
    ).toEqual([204, 205]);
    expect(result.value.missingItemIds).toEqual([]);
  });

  it("suggest_gear_upgrades judges armour type from the client ItemDetail, not QuestieDB's sub_class (D7)", async () => {
    const snapshot = makeSnapshot({
      character: { ...makeSnapshot().character, classId: 8 },
      equipped: [],
    });
    const details = [makeItemDetail({ itemId: 200, subClassId: 4 })];
    const localTools = createTools(db, createStubLocalApi({ snapshot, items: details }));
    const result = await localTools.suggestGearUpgrades({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.upgrades).toEqual([]);
  });

  it("suggest_gear_upgrades surfaces missing item ids instead of hiding them", async () => {
    const localTools = createTools(db, createStubLocalApi({ snapshot: makeSnapshot(), items: [] }));
    const result = await localTools.suggestGearUpgrades({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.upgrades).toEqual([]);
    expect(result.value.missingItemIds).toContain(200);
  });

  it("does not offer an equipped ring back as an upgrade for its slot-mate (aca-r2-2)", async () => {
    const snapshot = makeSnapshot({
      equipped: [
        { slot: 11, itemId: 205, itemLevel: 9 },
        { slot: 12, itemId: 210, itemLevel: 3 },
      ],
    });
    const details = [
      makeItemDetail({
        itemId: 205,
        name: "Battered Ring",
        equipLoc: "INVTYPE_FINGER",
        subClassId: 0,
        itemLevel: 9,
      }),
      makeItemDetail({
        itemId: 210,
        name: "Old Band",
        equipLoc: "INVTYPE_FINGER",
        subClassId: 0,
        itemLevel: 3,
      }),
    ];
    const localTools = createTools(db, createStubLocalApi({ snapshot, items: details }));
    const result = await localTools.suggestGearUpgrades({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.upgrades.some((upgrade) => upgrade.candidate.itemId === 205)).toBe(false);
  });

  it("skips a slot whose equipped item detail failed to resolve instead of offering the full candidate value (aca-r2-5)", async () => {
    const snapshot = makeSnapshot({ equipped: [{ slot: 5, itemId: 999, itemLevel: 5 }] });
    const details = [makeItemDetail({ itemId: 200, equipLoc: "INVTYPE_CHEST", itemLevel: 20 })];
    const localTools = createTools(db, createStubLocalApi({ snapshot, items: details }));
    const result = await localTools.suggestGearUpgrades({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.upgrades).toEqual([]);
    expect(result.value.missingItemIds).toContain(999);
  });

  it("offers a cloth cloak to a warrior even though warriors cannot wear cloth armour otherwise (aca-r2-3)", async () => {
    const cloakDb = buildCustomDb((writable) => {
      writable
        .prepare(
          "INSERT INTO item (id, name, item_level, required_level, class, sub_class) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(9300, "Cloak of Testing", 15, 1, 4, 1);
      writable
        .prepare("INSERT INTO item_source (item_id, kind, entity_id) VALUES (?, ?, ?)")
        .run(9300, "npc_drop", 1);
    });
    const snapshot = makeSnapshot({
      character: { ...makeSnapshot().character, classId: 1 },
      equipped: [],
    });
    const cloakDetail = makeItemDetail({
      itemId: 9300,
      name: "Cloak of Testing",
      equipLoc: "INVTYPE_CLOAK",
      subClassId: 1,
      itemLevel: 15,
      stats: { ITEM_MOD_STAMINA_SHORT: 4 },
    });
    const cloakTools = createTools(cloakDb, createStubLocalApi({ snapshot, items: [cloakDetail] }));
    const result = await cloakTools.suggestGearUpgrades({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.upgrades.map((upgrade) => upgrade.candidate.itemId)).toContain(9300);
    cloakDb.close();
  });

  it("set_waypoint forwards to the local API", async () => {
    const result = await tools.setWaypoint({ uiMapId: 85, x: 10, y: 20, label: "Here" });
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

describe("mcp.not_connected", () => {
  let db: Db;

  beforeAll(() => {
    db = buildMiniDb();
  });

  afterAll(() => {
    db.close();
    cleanupMiniDbTempDirs();
  });

  it("get_game_state returns not_connected when the daemon has no hello", async () => {
    const tools = createTools(db, createStubLocalApi({ connected: false }));
    const result = await tools.getGameState();
    expect(result).toEqual({ ok: false, error: "not_connected" });
  });

  it("suggest_gear_upgrades returns not_connected when the daemon has no hello", async () => {
    const tools = createTools(db, createStubLocalApi({ connected: false }));
    const result = await tools.suggestGearUpgrades({});
    expect(result).toEqual({ ok: false, error: "not_connected" });
  });
});
