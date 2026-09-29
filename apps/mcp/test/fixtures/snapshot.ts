import type { ItemDetail, Snapshot } from "@wow-companion/contracts";

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    character: {
      name: "Testalot",
      level: 10,
      classId: 8,
      raceId: 1,
      faction: "Alliance",
      xp: 100,
      xpMax: 1000,
    },
    position: { uiMapId: 85, zone: "Elwynn Forest", subzone: "", x: 40, y: 60 },
    money: 500,
    quests: [],
    equipped: [{ slot: 5, itemId: 200, itemLevel: 10 }],
    bags: [],
    professions: [],
    talents: [],
    ...overrides,
  };
}

export function makeItemDetail(overrides: Partial<ItemDetail> = {}): ItemDetail {
  return {
    itemId: 200,
    name: "Cloth Robe of the Whale",
    quality: 2,
    itemLevel: 10,
    requiredLevel: 5,
    equipLoc: "INVTYPE_CHEST",
    classId: 4,
    subClassId: 1,
    stats: { ITEM_MOD_INTELLECT_SHORT: 5 },
    ...overrides,
  };
}
