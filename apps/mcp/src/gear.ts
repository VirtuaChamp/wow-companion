import type { ItemDetail, Upgrade } from "@wow-companion/contracts";

export type GearCandidate = ItemDetail & { source: Upgrade["source"] };

export type EquippedItem = { slot: number; item: ItemDetail };

export const ARMOR_ITEM_CLASS = 4;
export const WEAPON_ITEM_CLASS = 2;
const ARMOR_SUBCLASS = { cloth: 1, leather: 2, mail: 3, plate: 4 } as const;
export const TYPED_ARMOR_SUBCLASSES: readonly number[] = Object.values(ARMOR_SUBCLASS);
export const CLOTH_ARMOR_SUBCLASS: number = ARMOR_SUBCLASS.cloth;
const MISC_ARMOR_SUBCLASS = 0;

const PLATE_AT_40_CLASSES = new Set([1, 2]);
const MAIL_AT_40_CLASSES = new Set([3, 7]);
const PROFICIENCY_LEVEL_THRESHOLD = 40;

const CLASS_ARMOR_SUBCLASS: Record<number, number> = {
  1: ARMOR_SUBCLASS.plate,
  2: ARMOR_SUBCLASS.plate,
  3: ARMOR_SUBCLASS.mail,
  4: ARMOR_SUBCLASS.leather,
  5: ARMOR_SUBCLASS.cloth,
  6: ARMOR_SUBCLASS.plate,
  7: ARMOR_SUBCLASS.mail,
  8: ARMOR_SUBCLASS.cloth,
  9: ARMOR_SUBCLASS.cloth,
  10: ARMOR_SUBCLASS.leather,
  11: ARMOR_SUBCLASS.leather,
  12: ARMOR_SUBCLASS.leather,
  13: ARMOR_SUBCLASS.mail,
};

const RELIC_SUBCLASS_ALLOWED_CLASSES: Record<number, ReadonlySet<number>> = {
  6: new Set([1, 2, 7]),
  7: new Set([2]),
  8: new Set([11]),
  9: new Set([7]),
};

export function allowedArmorSubclass(classId: number, characterLevel: number): number | undefined {
  const isBelowThreshold = characterLevel < PROFICIENCY_LEVEL_THRESHOLD;
  if (isBelowThreshold && PLATE_AT_40_CLASSES.has(classId)) return ARMOR_SUBCLASS.mail;
  if (isBelowThreshold && MAIL_AT_40_CLASSES.has(classId)) return ARMOR_SUBCLASS.leather;
  return CLASS_ARMOR_SUBCLASS[classId];
}

const EQUIP_LOC_TO_SLOTS: Record<string, readonly number[]> = {
  INVTYPE_HEAD: [1],
  INVTYPE_NECK: [2],
  INVTYPE_SHOULDER: [3],
  INVTYPE_CHEST: [5],
  INVTYPE_ROBE: [5],
  INVTYPE_WAIST: [6],
  INVTYPE_LEGS: [7],
  INVTYPE_FEET: [8],
  INVTYPE_WRIST: [9],
  INVTYPE_HAND: [10],
  INVTYPE_FINGER: [11, 12],
  INVTYPE_TRINKET: [13, 14],
  INVTYPE_CLOAK: [15],
  INVTYPE_2HWEAPON: [16],
  INVTYPE_WEAPONMAINHAND: [16],
  INVTYPE_SHIELD: [17],
  INVTYPE_HOLDABLE: [17],
  INVTYPE_WEAPONOFFHAND: [17],
  INVTYPE_RANGED: [18],
  INVTYPE_RANGEDRIGHT: [18],
  INVTYPE_THROWN: [18],
  INVTYPE_RELIC: [18],
};

const DUAL_WIELD_ANY_LEVEL_CLASSES = new Set([4]);
const DUAL_WIELD_AT_LEVEL_CLASSES = new Set([1, 3]);
const DUAL_WIELD_LEVEL_THRESHOLD = 20;

function isDualWieldEligible(classId: number, characterLevel: number): boolean {
  if (DUAL_WIELD_ANY_LEVEL_CLASSES.has(classId)) return true;
  return DUAL_WIELD_AT_LEVEL_CLASSES.has(classId) && characterLevel >= DUAL_WIELD_LEVEL_THRESHOLD;
}

export function equipLocToSlots(
  equipLoc: string,
  dualWield?: { classId: number; characterLevel: number },
): readonly number[] | undefined {
  if (equipLoc === "INVTYPE_WEAPON") {
    if (dualWield === undefined) return [16];
    return isDualWieldEligible(dualWield.classId, dualWield.characterLevel) ? [16, 17] : [16];
  }
  return EQUIP_LOC_TO_SLOTS[equipLoc];
}

function isArmorClassAllowed(item: ItemDetail, classId: number, characterLevel: number): boolean {
  if (item.classId !== ARMOR_ITEM_CLASS) return true;
  if (item.equipLoc === "INVTYPE_CLOAK") return true;
  if (item.subClassId === MISC_ARMOR_SUBCLASS) return true;
  if (TYPED_ARMOR_SUBCLASSES.includes(item.subClassId)) {
    const allowedSubclass = allowedArmorSubclass(classId, characterLevel);
    if (allowedSubclass === undefined) return true;
    return item.subClassId === allowedSubclass;
  }
  const relicAllowedClasses = RELIC_SUBCLASS_ALLOWED_CLASSES[item.subClassId];
  if (relicAllowedClasses !== undefined) return relicAllowedClasses.has(classId);
  return false;
}

function statDelta(current: ItemDetail | undefined, candidate: ItemDetail): Record<string, number> {
  const keys = new Set<string>(Object.keys(candidate.stats));
  if (current !== undefined) {
    for (const key of Object.keys(current.stats)) keys.add(key);
  }
  const delta: Record<string, number> = {};
  for (const key of keys) {
    const candidateValue = candidate.stats[key] ?? 0;
    const currentValue = current?.stats[key] ?? 0;
    delta[key] = candidateValue - currentValue;
  }
  return delta;
}

type SlotState =
  | { kind: "unresolved" }
  | { kind: "empty"; slot: number }
  | { kind: "occupied"; entry: EquippedItem };

function currentForSlots(
  equipped: readonly EquippedItem[],
  unresolvedSlots: readonly number[],
  slots: readonly number[],
): SlotState {
  const availableSlots = slots.filter((slot) => !unresolvedSlots.includes(slot));
  if (availableSlots.length === 0) return { kind: "unresolved" };
  const occupying = equipped.filter((entry) => availableSlots.includes(entry.slot));
  const emptySlot = availableSlots.find((slot) => !occupying.some((entry) => entry.slot === slot));
  if (emptySlot !== undefined) return { kind: "empty", slot: emptySlot };
  const lowest = occupying.reduce((current, entry) =>
    entry.item.itemLevel < current.item.itemLevel ? entry : current,
  );
  return { kind: "occupied", entry: lowest };
}

const MAIN_HAND_SLOT = 16;
const OFF_HAND_SLOT = 17;

function twoHanderBlocksOffHand(equipped: readonly EquippedItem[]): boolean {
  const mainHand = equipped.find((entry) => entry.slot === MAIN_HAND_SLOT);
  return mainHand?.item.equipLoc === "INVTYPE_2HWEAPON";
}

export function compare(
  equipped: readonly EquippedItem[],
  candidates: readonly GearCandidate[],
  classId: number,
  characterLevel: number,
  unresolvedSlots: readonly number[] = [],
): Upgrade[] {
  const excludedSlots = twoHanderBlocksOffHand(equipped)
    ? [...unresolvedSlots, OFF_HAND_SLOT]
    : unresolvedSlots;
  const upgrades: Upgrade[] = [];
  for (const candidate of candidates) {
    if (!isArmorClassAllowed(candidate, classId, characterLevel)) continue;
    const slots = equipLocToSlots(
      candidate.equipLoc,
      candidate.equipLoc === "INVTYPE_WEAPON" ? { classId, characterLevel } : undefined,
    );
    if (slots === undefined) continue;
    const state = currentForSlots(equipped, excludedSlots, slots);
    if (state.kind === "unresolved") continue;
    const current = state.kind === "occupied" ? state.entry.item : undefined;
    const upgradeSlot = state.kind === "occupied" ? state.entry.slot : state.slot;
    if (current !== undefined && current.itemId === candidate.itemId) continue;
    if (current !== undefined && candidate.itemLevel <= current.itemLevel) continue;
    const upgrade: Upgrade = {
      slot: upgradeSlot,
      candidate,
      source: candidate.source,
      delta: statDelta(current, candidate),
    };
    if (current !== undefined) upgrade.current = current;
    upgrades.push(upgrade);
  }
  return upgrades;
}
