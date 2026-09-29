local _, ns = ...

ns.State = ns.State or {}

local function questObjectives(questID)
  local objectives = {}
  local raw = C_QuestLog.GetQuestObjectives(questID)
  if raw then
    for i = 1, #raw do
      local o = raw[i]
      objectives[i] = {
        text = o.text or "",
        done = o.finished == true,
        have = o.numFulfilled or 0,
        need = o.numRequired or 0,
      }
    end
  end
  return objectives
end

local function collectQuests()
  local list = {}
  local total = C_QuestLog.GetNumQuestLogEntries()
  for i = 1, total do
    local info = C_QuestLog.GetInfo(i)
    if info and not info.isHeader and not info.isHidden then
      list[#list + 1] = {
        questId = info.questID,
        title = info.title or "",
        level = info.level or 0,
        complete = C_QuestLog.IsComplete(info.questID) == true,
        objectives = questObjectives(info.questID),
      }
    end
  end
  return list
end

local function collectEquipped()
  local list = {}
  for slot = INVSLOT_FIRST_EQUIPPED, INVSLOT_LAST_EQUIPPED do
    local itemId = GetInventoryItemID("player", slot)
    if itemId then
      local name, _, _, itemLevel = C_Item.GetItemInfo(itemId)
      if name then
        list[#list + 1] = { slot = slot, itemId = itemId, itemLevel = itemLevel or 0 }
      else
        C_Item.RequestLoadItemDataByID(itemId)
      end
    end
  end
  return list
end

local function collectBags()
  local list = {}
  for bag = BACKPACK_CONTAINER, NUM_BAG_SLOTS do
    local slots = C_Container.GetContainerNumSlots(bag)
    for slot = 1, slots do
      local info = C_Container.GetContainerItemInfo(bag, slot)
      if info and info.itemID then
        list[#list + 1] = { bag = bag, slot = slot, itemId = info.itemID, count = info.stackCount or 1 }
      end
    end
  end
  return list
end

local function collectProfessions()
  local list = {}
  for i = 1, select("#", GetProfessions()) do
    local profIndex = select(i, GetProfessions())
    if profIndex then
      local name, _, rank, maxRank = GetProfessionInfo(profIndex)
      if name then
        list[#list + 1] = { name = name, rank = rank or 0, max = maxRank or 0 }
      end
    end
  end
  return list
end

local function collectTalents()
  local list = {}
  local total = GetNumSpecializations()
  for i = 1, total do
    local _, name, _, _, _, _, pointsSpent = C_SpecializationInfo.GetSpecializationInfo(i)
    list[#list + 1] = { tab = name or "", points = pointsSpent or 0 }
  end
  return list
end

local function roundTo1Decimal(value)
  return math.floor(value * 10 + 0.5) / 10
end

local function collectPosition()
  local mapId = C_Map.GetBestMapForUnit("player")
  local x, y = 0, 0
  if mapId then
    local mapPos = C_Map.GetPlayerMapPosition(mapId, "player")
    if mapPos then
      x, y = mapPos:GetXY()
    end
  end
  return {
    uiMapId = mapId or 0,
    zone = GetZoneText() or "",
    subzone = GetSubZoneText() or "",
    x = roundTo1Decimal(x * 100),
    y = roundTo1Decimal(y * 100),
  }
end

local function collectCharacter()
  local _, _, raceId = UnitRace("player")
  local _, _, classId = UnitClass("player")
  local faction = UnitFactionGroup("player")
  return {
    name = UnitName("player") or "",
    level = UnitLevel("player") or 0,
    classId = classId or 0,
    raceId = raceId or 0,
    faction = faction,
    xp = UnitXP("player") or 0,
    xpMax = UnitXPMax("player") or 0,
  }
end

function ns.State.snapshot()
  local snapshot = {
    position = collectPosition(),
    money = GetMoney() or 0,
    quests = collectQuests(),
    equipped = collectEquipped(),
    bags = collectBags(),
    professions = collectProfessions(),
    talents = collectTalents(),
  }
  local character = collectCharacter()
  if character.faction == "Alliance" or character.faction == "Horde" then
    snapshot.character = character
  end
  return snapshot
end

local function deepEqual(a, b)
  if a == b then
    return true
  end
  if type(a) ~= "table" or type(b) ~= "table" then
    return false
  end
  for k, v in pairs(a) do
    if not deepEqual(v, b[k]) then
      return false
    end
  end
  for k in pairs(b) do
    if a[k] == nil then
      return false
    end
  end
  return true
end

function ns.State.delta(prev, nextSnapshot)
  if not prev then
    return nextSnapshot
  end
  local out = nil
  for key, value in pairs(nextSnapshot) do
    if not deepEqual(prev[key], value) then
      out = out or {}
      out[key] = value
    end
  end
  return out
end
