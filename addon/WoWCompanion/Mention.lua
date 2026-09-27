local _, ns = ...

ns.Mention = ns.Mention or {}

local MAX_MATCHES = 8

local function matchScore(query, name)
  if query == "" or not name then
    return nil
  end
  local q = string.lower(query)
  local n = string.lower(name)
  local at = string.find(n, q, 1, true)
  if not at then
    return nil
  end
  if at == 1 then
    return 1
  end
  return 2
end

function ns.Mention.match(query, candidates)
  local scored = {}
  for i = 1, #candidates do
    local candidate = candidates[i]
    local score = matchScore(query or "", candidate.name)
    if score then
      scored[#scored + 1] = { candidate = candidate, score = score, index = i }
    end
  end

  table.sort(scored, function(a, b)
    if a.score ~= b.score then
      return a.score < b.score
    end
    return a.index < b.index
  end)

  local items = {}
  for i = 1, math.min(MAX_MATCHES, #scored) do
    items[i] = scored[i].candidate
  end

  local ghost = nil
  if #items > 0 then
    ghost = items[1].name
  end

  return { items = items, ghost = ghost }
end

function ns.Mention.candidates()
  local list = {}
  local seenItemIds = {}

  local questTotal = C_QuestLog.GetNumQuestLogEntries()
  for i = 1, questTotal do
    local info = C_QuestLog.GetInfo(i)
    if info and not info.isHeader and not info.isHidden then
      list[#list + 1] = {
        name = info.title or "",
        mention = { kind = "quest", questId = info.questID },
      }
    end
  end

  for bag = BACKPACK_CONTAINER, NUM_BAG_SLOTS do
    local slots = C_Container.GetContainerNumSlots(bag)
    for slot = 1, slots do
      local info = C_Container.GetContainerItemInfo(bag, slot)
      if info and info.itemID and info.itemName and not seenItemIds[info.itemID] then
        seenItemIds[info.itemID] = true
        list[#list + 1] = {
          name = info.itemName,
          mention = { kind = "item", itemId = info.itemID, bag = bag, slot = slot },
        }
      end
    end
  end

  for slot = INVSLOT_FIRST_EQUIPPED, INVSLOT_LAST_EQUIPPED do
    local itemId = GetInventoryItemID("player", slot)
    if itemId and not seenItemIds[itemId] then
      local name = C_Item.GetItemInfo(itemId)
      if name then
        seenItemIds[itemId] = true
        list[#list + 1] = {
          name = name,
          mention = { kind = "item", itemId = itemId, equipSlot = slot },
        }
      else
        C_Item.RequestLoadItemDataByID(itemId)
      end
    end
  end

  return list
end
