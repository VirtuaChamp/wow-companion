import type { ItemDetail, Result, Snapshot, ToolError, Upgrade } from "@wow-companion/contracts";
import type { Db, NpcResult, ObjectResult, QuestResult } from "./db.ts";
import {
  findNpcById,
  findNpcByName,
  findObjectByName,
  findQuestById,
  findQuestByName,
  gearCandidateIds,
  itemSources,
} from "./db.ts";
import type { EquippedItem, GearCandidate } from "./gear.ts";
import { compare, equipLocToSlots } from "./gear.ts";
import type { LocalApi } from "./local-api.ts";

const GEAR_CANDIDATE_LIMIT = 25;
const PER_SLOT_CANDIDATE_LIMIT = 5;

type GearSuggestion = { upgrades: Upgrade[]; missingItemIds: number[] };

export type Tools = {
  getGameState(): Promise<Result<Snapshot, ToolError>>;
  findNpc(query: {
    name?: string | undefined;
    id?: number | undefined;
  }): Promise<Result<NpcResult[], ToolError>>;
  findQuest(query: {
    name?: string | undefined;
    id?: number | undefined;
  }): Promise<Result<QuestResult[], ToolError>>;
  findObject(query: { name: string }): Promise<Result<ObjectResult[], ToolError>>;
  suggestGearUpgrades(query: {
    slot?: number | undefined;
  }): Promise<Result<GearSuggestion, ToolError>>;
  setWaypoint(waypoint: {
    uiMapId: number;
    x: number;
    y: number;
    label: string;
  }): Promise<Result<void, ToolError>>;
};

function toGearCandidates(
  db: Db,
  itemIds: readonly number[],
  items: readonly ItemDetail[],
): GearCandidate[] {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const candidates: GearCandidate[] = [];
  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    if (item === undefined) continue;
    const [firstSource] = itemSources(db, itemId);
    if (firstSource === undefined) continue;
    candidates.push({ ...item, source: firstSource });
  }
  return candidates;
}

function capPerSlot(
  candidates: readonly GearCandidate[],
  perSlotLimit: number,
  classId: number,
  characterLevel: number,
): GearCandidate[] {
  const bySlot = new Map<number, GearCandidate[]>();
  for (const candidate of candidates) {
    const slots = equipLocToSlots(
      candidate.equipLoc,
      candidate.equipLoc === "INVTYPE_WEAPON" ? { classId, characterLevel } : undefined,
    );
    if (slots === undefined) continue;
    for (const slot of slots) {
      const bucket = bySlot.get(slot) ?? [];
      bucket.push(candidate);
      bySlot.set(slot, bucket);
    }
  }
  const capped = new Map<number, GearCandidate>();
  for (const bucket of bySlot.values()) {
    const top = [...bucket].sort((a, b) => b.itemLevel - a.itemLevel).slice(0, perSlotLimit);
    for (const candidate of top) capped.set(candidate.itemId, candidate);
  }
  return Array.from(capped.values());
}

export function createTools(db: Db, localApi: LocalApi): Tools {
  return {
    async getGameState() {
      return localApi.getState();
    },
    async findNpc(query) {
      if (query.id !== undefined) {
        const npc = findNpcById(db, query.id);
        return { ok: true, value: npc === undefined ? [] : [npc] };
      }
      if (query.name !== undefined) return { ok: true, value: findNpcByName(db, query.name) };
      return { ok: true, value: [] };
    },
    async findQuest(query) {
      if (query.id !== undefined) {
        const quest = findQuestById(db, query.id);
        return { ok: true, value: quest === undefined ? [] : [quest] };
      }
      if (query.name !== undefined) return { ok: true, value: findQuestByName(db, query.name) };
      return { ok: true, value: [] };
    },
    async findObject(query) {
      return { ok: true, value: findObjectByName(db, query.name) };
    },
    async suggestGearUpgrades(query) {
      const state = await localApi.getState();
      if (!state.ok) return state;
      const snapshot = state.value;
      const candidateIds = gearCandidateIds(db, {
        characterLevel: snapshot.character.level,
        classId: snapshot.character.classId,
        limit: GEAR_CANDIDATE_LIMIT,
      });
      const equippedIds = snapshot.equipped.map((item) => item.itemId);
      const freshCandidateIds = candidateIds.filter((id) => !equippedIds.includes(id));
      const requestedIds = Array.from(new Set([...equippedIds, ...freshCandidateIds]));
      if (requestedIds.length === 0)
        return { ok: true, value: { upgrades: [], missingItemIds: [] } };
      const itemsResult = await localApi.postItems(requestedIds);
      if (!itemsResult.ok) return itemsResult;
      const items = itemsResult.value;
      const foundIds = new Set(items.map((item) => item.itemId));
      const missingItemIds = requestedIds.filter((id) => !foundIds.has(id));
      const itemById = new Map(items.map((item) => [item.itemId, item]));
      const equipped: EquippedItem[] = [];
      const unresolvedSlots: number[] = [];
      for (const equippedItem of snapshot.equipped) {
        const item = itemById.get(equippedItem.itemId);
        if (item !== undefined) equipped.push({ slot: equippedItem.slot, item });
        else unresolvedSlots.push(equippedItem.slot);
      }
      const candidateDetails = capPerSlot(
        toGearCandidates(db, freshCandidateIds, items),
        PER_SLOT_CANDIDATE_LIMIT,
        snapshot.character.classId,
        snapshot.character.level,
      );
      const upgrades = compare(
        equipped,
        candidateDetails,
        snapshot.character.classId,
        snapshot.character.level,
        unresolvedSlots,
      );
      const filtered =
        query.slot === undefined
          ? upgrades
          : upgrades.filter((upgrade) => upgrade.slot === query.slot);
      return { ok: true, value: { upgrades: filtered, missingItemIds } };
    },
    async setWaypoint(waypoint) {
      return localApi.postWaypoint(waypoint);
    },
  };
}
