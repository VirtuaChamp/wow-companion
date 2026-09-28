import { describe, expect, it } from "vitest";
import { allowedArmorSubclass, compare } from "../src/gear.ts";
import type { EquippedItem, GearCandidate } from "../src/gear.ts";
import { createTools } from "../src/tools.ts";
import { buildMiniDb, cleanupMiniDbTempDirs } from "./fixtures/build-mini-db.ts";
import { createStubLocalApi } from "./fixtures/local-api-stub.ts";
import { makeItemDetail, makeSnapshot } from "./fixtures/snapshot.ts";

const NPC_DROP = { kind: "npc_drop" as const, entityId: 1 };
const MAGE_CLASS_ID = 8;
const WARRIOR_CLASS_ID = 1;
const HUNTER_CLASS_ID = 3;
const ROGUE_CLASS_ID = 4;
const PALADIN_CLASS_ID = 2;
const SHAMAN_CLASS_ID = 7;
const DRUID_CLASS_ID = 11;

describe("gear.compare", () => {
  it("matches candidate to equipped slot by equipLoc and reports the delta", () => {
    const equipped: EquippedItem[] = [
      { slot: 5, item: makeItemDetail({ itemId: 200, equipLoc: "INVTYPE_CHEST" }) },
    ];
    const candidate: GearCandidate = {
      ...makeItemDetail({
        itemId: 300,
        name: "Better Robe",
        itemLevel: 20,
        subClassId: 1,
        stats: { ITEM_MOD_INTELLECT_SHORT: 12 },
      }),
      source: NPC_DROP,
    };
    const upgrades = compare(equipped, [candidate], MAGE_CLASS_ID, 10);
    expect(upgrades).toEqual([
      {
        slot: 5,
        current: equipped[0]?.item,
        candidate,
        source: NPC_DROP,
        delta: { ITEM_MOD_INTELLECT_SHORT: 7 },
      },
    ]);
  });

  it("excludes a candidate of the wrong armour class", () => {
    const equipped: EquippedItem[] = [
      { slot: 5, item: makeItemDetail({ itemId: 200, equipLoc: "INVTYPE_CHEST", subClassId: 1 }) },
    ];
    const plateCandidate: GearCandidate = {
      ...makeItemDetail({ itemId: 301, name: "Plate Chestguard", itemLevel: 20, subClassId: 4 }),
      source: NPC_DROP,
    };
    expect(compare(equipped, [plateCandidate], MAGE_CLASS_ID, 10)).toEqual([]);
  });

  it("exempts a cloak from the armour-type check", () => {
    const cloakCandidate: GearCandidate = {
      ...makeItemDetail({
        itemId: 302,
        name: "Cloak of Testing",
        equipLoc: "INVTYPE_CLOAK",
        subClassId: 4,
        stats: { ITEM_MOD_STAMINA_SHORT: 5 },
      }),
      source: NPC_DROP,
    };
    const upgrades = compare([], [cloakCandidate], MAGE_CLASS_ID, 10);
    expect(upgrades.map((upgrade) => upgrade.candidate.itemId)).toEqual([302]);
  });

  it("uses the lower armour tier below level 40 and the top tier at 40+", () => {
    expect(allowedArmorSubclass(WARRIOR_CLASS_ID, 39)).toBe(3);
    expect(allowedArmorSubclass(WARRIOR_CLASS_ID, 40)).toBe(4);
    expect(allowedArmorSubclass(HUNTER_CLASS_ID, 39)).toBe(2);
    expect(allowedArmorSubclass(HUNTER_CLASS_ID, 40)).toBe(3);
  });

  it("does not offer plate to a warrior below level 40", () => {
    const plateCandidate: GearCandidate = {
      ...makeItemDetail({ itemId: 303, name: "Plate Chestguard", subClassId: 4 }),
      source: NPC_DROP,
    };
    expect(compare([], [plateCandidate], WARRIOR_CLASS_ID, 20)).toEqual([]);
    const mailCandidate: GearCandidate = {
      ...makeItemDetail({ itemId: 304, name: "Mail Chestguard", subClassId: 3 }),
      source: NPC_DROP,
    };
    expect(
      compare([], [mailCandidate], WARRIOR_CLASS_ID, 20).map((u) => u.candidate.itemId),
    ).toEqual([304]);
  });

  it("does not offer the equipped item back as its own upgrade", () => {
    const equipped: EquippedItem[] = [
      { slot: 5, item: makeItemDetail({ itemId: 200, equipLoc: "INVTYPE_CHEST" }) },
    ];
    const sameCandidate: GearCandidate = { ...makeItemDetail({ itemId: 200 }), source: NPC_DROP };
    expect(compare(equipped, [sameCandidate], MAGE_CLASS_ID, 10)).toEqual([]);
  });

  it("does not offer the equipped item back even if its record reports a higher item level", () => {
    const equipped: EquippedItem[] = [
      {
        slot: 5,
        item: makeItemDetail({ itemId: 200, equipLoc: "INVTYPE_CHEST", itemLevel: 10 }),
      },
    ];
    const sameIdHigherLevel: GearCandidate = {
      ...makeItemDetail({ itemId: 200, itemLevel: 99 }),
      source: NPC_DROP,
    };
    expect(compare(equipped, [sameIdHigherLevel], MAGE_CLASS_ID, 10)).toEqual([]);
  });

  it("does not offer a candidate with no item-level gain over the equipped item", () => {
    const equipped: EquippedItem[] = [
      {
        slot: 5,
        item: makeItemDetail({ itemId: 200, equipLoc: "INVTYPE_CHEST", itemLevel: 20 }),
      },
    ];
    const sideGrade: GearCandidate = {
      ...makeItemDetail({ itemId: 305, name: "Side Grade Robe", itemLevel: 20 }),
      source: NPC_DROP,
    };
    expect(compare(equipped, [sideGrade], MAGE_CLASS_ID, 10)).toEqual([]);
  });

  it("pairs a second ring against the lower item-level ring, not always the first", () => {
    const equipped: EquippedItem[] = [
      {
        slot: 11,
        item: makeItemDetail({ itemId: 400, equipLoc: "INVTYPE_FINGER", itemLevel: 20 }),
      },
      { slot: 12, item: makeItemDetail({ itemId: 401, equipLoc: "INVTYPE_FINGER", itemLevel: 5 }) },
    ];
    const ringCandidate: GearCandidate = {
      ...makeItemDetail({
        itemId: 402,
        name: "Ring of Testing",
        equipLoc: "INVTYPE_FINGER",
        itemLevel: 15,
        classId: 0,
        subClassId: 0,
        stats: { ITEM_MOD_STAMINA_SHORT: 5 },
      }),
      source: NPC_DROP,
    };
    const upgrades = compare(equipped, [ringCandidate], MAGE_CLASS_ID, 10);
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.slot).toBe(12);
    expect(upgrades[0]?.current?.itemId).toBe(401);
  });

  it("offers an empty twin slot before the lower item-level occupant (aca-r2-1)", () => {
    const equipped: EquippedItem[] = [
      {
        slot: 11,
        item: makeItemDetail({ itemId: 400, equipLoc: "INVTYPE_FINGER", itemLevel: 20 }),
      },
    ];
    const ringCandidate: GearCandidate = {
      ...makeItemDetail({
        itemId: 403,
        name: "Ring of Testing",
        equipLoc: "INVTYPE_FINGER",
        itemLevel: 15,
        classId: 0,
        subClassId: 0,
        stats: { ITEM_MOD_STAMINA_SHORT: 5 },
      }),
      source: NPC_DROP,
    };
    const upgrades = compare(equipped, [ringCandidate], MAGE_CLASS_ID, 10);
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.slot).toBe(12);
    expect(upgrades[0]?.current).toBeUndefined();
  });

  it("skips a candidate for a slot whose equipped item detail is unresolved (aca-r2-5)", () => {
    const candidate: GearCandidate = {
      ...makeItemDetail({
        itemId: 300,
        name: "Better Robe",
        equipLoc: "INVTYPE_CHEST",
        itemLevel: 20,
      }),
      source: NPC_DROP,
    };
    const upgrades = compare([], [candidate], MAGE_CLASS_ID, 10, [5]);
    expect(upgrades).toEqual([]);
  });

  it("offers a shield only to warrior, paladin and shaman (aca-r2-4)", () => {
    const shield: GearCandidate = {
      ...makeItemDetail({
        itemId: 600,
        name: "Buckler",
        equipLoc: "INVTYPE_SHIELD",
        classId: 4,
        subClassId: 6,
      }),
      source: NPC_DROP,
    };
    expect(
      compare([], [shield], WARRIOR_CLASS_ID, 10).map((upgrade) => upgrade.candidate.itemId),
    ).toEqual([600]);
    expect(
      compare([], [shield], PALADIN_CLASS_ID, 10).map((upgrade) => upgrade.candidate.itemId),
    ).toEqual([600]);
    expect(
      compare([], [shield], SHAMAN_CLASS_ID, 10).map((upgrade) => upgrade.candidate.itemId),
    ).toEqual([600]);
    expect(compare([], [shield], MAGE_CLASS_ID, 10)).toEqual([]);
  });

  it("offers a libram to paladin only, an idol to druid only, a totem to shaman only (aca-r2-4)", () => {
    const libram: GearCandidate = {
      ...makeItemDetail({ itemId: 601, equipLoc: "INVTYPE_RELIC", classId: 4, subClassId: 7 }),
      source: NPC_DROP,
    };
    const idol: GearCandidate = {
      ...makeItemDetail({ itemId: 602, equipLoc: "INVTYPE_RELIC", classId: 4, subClassId: 8 }),
      source: NPC_DROP,
    };
    const totem: GearCandidate = {
      ...makeItemDetail({ itemId: 603, equipLoc: "INVTYPE_RELIC", classId: 4, subClassId: 9 }),
      source: NPC_DROP,
    };
    expect(
      compare([], [libram], PALADIN_CLASS_ID, 10).map((upgrade) => upgrade.candidate.itemId),
    ).toEqual([601]);
    expect(compare([], [libram], DRUID_CLASS_ID, 10)).toEqual([]);
    expect(
      compare([], [idol], DRUID_CLASS_ID, 10).map((upgrade) => upgrade.candidate.itemId),
    ).toEqual([602]);
    expect(compare([], [idol], PALADIN_CLASS_ID, 10)).toEqual([]);
    expect(
      compare([], [totem], SHAMAN_CLASS_ID, 10).map((upgrade) => upgrade.candidate.itemId),
    ).toEqual([603]);
    expect(compare([], [totem], WARRIOR_CLASS_ID, 10)).toEqual([]);
  });

  it("does not offer an unrecognised armour sub_class to anyone (aca-r2-4)", () => {
    const mystery: GearCandidate = {
      ...makeItemDetail({ itemId: 604, equipLoc: "INVTYPE_HEAD", classId: 4, subClassId: 99 }),
      source: NPC_DROP,
    };
    expect(compare([], [mystery], WARRIOR_CLASS_ID, 10)).toEqual([]);
    expect(compare([], [mystery], MAGE_CLASS_ID, 10)).toEqual([]);
  });

  it("maps INVTYPE_WEAPON to both hands for a rogue at any level (aca-r2-6)", () => {
    const equipped: EquippedItem[] = [
      {
        slot: 16,
        item: makeItemDetail({
          itemId: 700,
          equipLoc: "INVTYPE_WEAPON",
          classId: 2,
          itemLevel: 20,
        }),
      },
    ];
    const oneHander: GearCandidate = {
      ...makeItemDetail({
        itemId: 701,
        name: "Off-hand Dagger",
        equipLoc: "INVTYPE_WEAPON",
        classId: 2,
        itemLevel: 10,
      }),
      source: NPC_DROP,
    };
    const upgrades = compare(equipped, [oneHander], ROGUE_CLASS_ID, 5);
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.slot).toBe(17);
    expect(upgrades[0]?.current).toBeUndefined();
  });

  it("maps INVTYPE_WEAPON to the off-hand for a warrior only from level 20 (aca-r2-6)", () => {
    const equipped: EquippedItem[] = [
      {
        slot: 16,
        item: makeItemDetail({
          itemId: 702,
          equipLoc: "INVTYPE_WEAPON",
          classId: 2,
          itemLevel: 20,
        }),
      },
    ];
    const oneHander: GearCandidate = {
      ...makeItemDetail({
        itemId: 703,
        equipLoc: "INVTYPE_WEAPON",
        classId: 2,
        itemLevel: 10,
      }),
      source: NPC_DROP,
    };
    expect(compare(equipped, [oneHander], WARRIOR_CLASS_ID, 19)).toEqual([]);
    const upgrades = compare(equipped, [oneHander], WARRIOR_CLASS_ID, 20);
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.slot).toBe(17);
  });

  it("never offers a one-hander for the off-hand to a mage (aca-r2-6)", () => {
    const oneHander: GearCandidate = {
      ...makeItemDetail({
        itemId: 704,
        equipLoc: "INVTYPE_WEAPON",
        classId: 2,
        itemLevel: 10,
      }),
      source: NPC_DROP,
    };
    const upgrades = compare([], [oneHander], MAGE_CLASS_ID, 60);
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.slot).toBe(16);
  });

  it("offers no one-hander for the off-hand when a two-hander is wielded (PM ruling, round 2)", () => {
    const equipped: EquippedItem[] = [
      {
        slot: 16,
        item: makeItemDetail({
          itemId: 705,
          equipLoc: "INVTYPE_2HWEAPON",
          classId: 2,
          itemLevel: 30,
        }),
      },
    ];
    const oneHander: GearCandidate = {
      ...makeItemDetail({
        itemId: 706,
        equipLoc: "INVTYPE_WEAPON",
        classId: 2,
        itemLevel: 10,
      }),
      source: NPC_DROP,
    };
    expect(compare(equipped, [oneHander], WARRIOR_CLASS_ID, 20)).toEqual([]);
  });

  it("still offers a one-hander for the main hand while a two-hander blocks the off-hand (PM ruling, round 2)", () => {
    const equipped: EquippedItem[] = [
      {
        slot: 16,
        item: makeItemDetail({
          itemId: 707,
          equipLoc: "INVTYPE_2HWEAPON",
          classId: 2,
          itemLevel: 5,
        }),
      },
    ];
    const betterOneHander: GearCandidate = {
      ...makeItemDetail({
        itemId: 708,
        equipLoc: "INVTYPE_WEAPON",
        classId: 2,
        itemLevel: 20,
      }),
      source: NPC_DROP,
    };
    const upgrades = compare(equipped, [betterOneHander], WARRIOR_CLASS_ID, 20);
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.slot).toBe(16);
  });

  it("leaves current undefined for an empty slot", () => {
    const candidate: GearCandidate = {
      ...makeItemDetail({
        itemId: 400,
        name: "Ring of Testing",
        equipLoc: "INVTYPE_FINGER",
        classId: 0,
        subClassId: 0,
        stats: { ITEM_MOD_STAMINA_SHORT: 5 },
      }),
      source: NPC_DROP,
    };
    const upgrades = compare([], [candidate], MAGE_CLASS_ID, 10);
    expect(upgrades).toEqual([
      {
        slot: 11,
        candidate,
        source: NPC_DROP,
        delta: { ITEM_MOD_STAMINA_SHORT: 5 },
      },
    ]);
  });

  it("ignores a candidate with no known equip slot", () => {
    const candidate: GearCandidate = {
      ...makeItemDetail({ itemId: 500, equipLoc: "INVTYPE_NON_EQUIP" }),
      source: NPC_DROP,
    };
    expect(compare([], [candidate], MAGE_CLASS_ID, 10)).toEqual([]);
  });

  it("suggest_gear_upgrades reports item_timeout when the item lookup exceeds the deadline", async () => {
    const db = buildMiniDb();
    const tools = createTools(
      db,
      createStubLocalApi({ snapshot: makeSnapshot(), itemTimeout: true }),
    );
    const result = await tools.suggestGearUpgrades({});
    expect(result).toEqual({ ok: false, error: "item_timeout" });
    db.close();
    cleanupMiniDbTempDirs();
  });
});
