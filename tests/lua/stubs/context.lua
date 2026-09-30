local characterFixture = {
  name = "Testcharacter",
  level = 12,
  classId = 1,
  raceId = 1,
  faction = "Alliance",
  xp = 400,
  xpMax = 1000,
}

local questFixture = {
  {
    questID = 101,
    title = "A Simple Task",
    level = 5,
    isHeader = false,
    isHidden = false,
    complete = false,
    objectives = {
      { text = "Collect 5 Wolf Pelts", finished = false, numFulfilled = 2, numRequired = 5 },
    },
  },
  {
    questID = 102,
    title = "Hidden Escort",
    level = 5,
    isHeader = false,
    isHidden = true,
    complete = false,
    objectives = {},
  },
}

local equippedFixture = {}
for slot = 1, 19 do
  equippedFixture[slot] = { itemId = 1000 + slot, itemLevel = 20 + slot }
end

local bagFixture = {
  [0] = {
    { itemId = 2001, count = 3, name = "Bagged Trinket" },
    { itemId = 1001, count = 1, name = "Duplicate In Bag" },
  },
}

local itemInfoFixture = {}
for slot = 1, 19 do
  itemInfoFixture[1000 + slot] = {
    name = "Equipped Item " .. slot,
    quality = 1,
    itemLevel = 20 + slot,
    requiredLevel = 1,
    equipLoc = "INVTYPE_CHEST",
    classId = 4,
    subClassId = 0,
  }
end
itemInfoFixture[2001] = {
  name = "Bag Item",
  quality = 3,
  itemLevel = 15,
  requiredLevel = 8,
  equipLoc = "INVTYPE_TRINKET",
  classId = 7,
  subClassId = 4,
}

_G.WOWC_TEST_SET_ITEM_INFO = function(itemId, info)
  itemInfoFixture[itemId] = info
end

_G.UnitName = function(unit)
  if unit == "player" then
    return characterFixture.name
  end
end

_G.UnitLevel = function(unit)
  if unit == "player" then
    return characterFixture.level
  end
end

_G.UnitRace = function(unit)
  if unit == "player" then
    return "Human", "Human", characterFixture.raceId
  end
end

_G.UnitClass = function(unit)
  if unit == "player" then
    return "Warrior", "WARRIOR", characterFixture.classId
  end
end

_G.UnitFactionGroup = function(unit)
  if unit == "player" then
    return characterFixture.faction, characterFixture.faction
  end
end

_G.UnitXP = function(unit)
  if unit == "player" then
    return characterFixture.xp
  end
end

_G.UnitXPMax = function(unit)
  if unit == "player" then
    return characterFixture.xpMax
  end
end

_G.GetZoneText = function()
  return "Elwynn Forest"
end

_G.GetSubZoneText = function()
  return "Goldshire"
end

_G.GetMoney = function()
  return 12345
end

_G.INVSLOT_FIRST_EQUIPPED = 1
_G.INVSLOT_LAST_EQUIPPED = 19
_G.BACKPACK_CONTAINER = 0
_G.NUM_BAG_SLOTS = 4

_G.GetInventoryItemID = function(unit, slot)
  if unit ~= "player" then
    return nil
  end
  local entry = equippedFixture[slot]
  return entry and entry.itemId or nil
end

_G.GetProfessions = function()
  return 1, 2
end

_G.GetProfessionInfo = function(index)
  if index == 1 then
    return "Mining", 0, 30, 75
  elseif index == 2 then
    return "Blacksmithing", 0, 15, 75
  end
end

_G.GetNumSpecializations = function()
  return 1
end

_G.C_SpecializationInfo = {
  GetSpecializationInfo = function(index)
    if index == 1 then
      return 1, "Arms", "desc", 0, "DAMAGER", 1, 5
    end
  end,
}

_G.C_QuestLog = {
  GetNumQuestLogEntries = function()
    return #questFixture
  end,
  GetInfo = function(index)
    local quest = questFixture[index]
    if not quest then
      return nil
    end
    return {
      questID = quest.questID,
      title = quest.title,
      level = quest.level,
      isHeader = quest.isHeader,
      isHidden = quest.isHidden,
    }
  end,
  GetQuestObjectives = function(questID)
    for _, quest in ipairs(questFixture) do
      if quest.questID == questID then
        return quest.objectives
      end
    end
    return {}
  end,
  IsComplete = function(questID)
    for _, quest in ipairs(questFixture) do
      if quest.questID == questID then
        return quest.complete
      end
    end
    return false
  end,
}

_G.C_Container = {
  GetContainerNumSlots = function(bag)
    local items = bagFixture[bag]
    return items and #items or 0
  end,
  GetContainerItemInfo = function(bag, slot)
    local items = bagFixture[bag]
    local item = items and items[slot]
    if not item then
      return nil
    end
    return { itemID = item.itemId, stackCount = item.count, itemName = item.name }
  end,
}

_G.C_Item = {
  GetItemInfo = function(itemId)
    local info = itemInfoFixture[itemId]
    if not info then
      return nil
    end
    return info.name,
      "item:" .. itemId,
      info.quality,
      info.itemLevel,
      info.requiredLevel,
      "type",
      "subtype",
      1,
      info.equipLoc,
      0,
      0,
      info.classId,
      info.subClassId
  end,
  GetItemStats = function()
    return { ITEM_MOD_STAMINA_SHORT = 10 }
  end,
  RequestLoadItemDataByID = function(itemId)
    _G.WOWC_TEST_REQUESTED_ITEM_IDS = _G.WOWC_TEST_REQUESTED_ITEM_IDS or {}
    table.insert(_G.WOWC_TEST_REQUESTED_ITEM_IDS, itemId)
  end,
}

_G.C_Map = {
  GetBestMapForUnit = function()
    return 84
  end,
  GetPlayerMapPosition = function()
    return {
      GetXY = function()
        return 0.42, 0.58
      end,
    }
  end,
  CanSetUserWaypointOnMap = function(mapId)
    return mapId ~= 999
  end,
  SetUserWaypoint = function(point)
    _G.WOWC_TEST_LAST_WAYPOINT = point
    return true
  end,
}

_G.C_SuperTrack = {
  SetSuperTrackedUserWaypoint = function(flag)
    _G.WOWC_TEST_SUPER_TRACKED = flag
  end,
}

_G.UiMapPoint = {
  CreateFromCoordinates = function(mapId, x, y)
    return { uiMapId = mapId, x = x, y = y }
  end,
}

_G.CreateFrame = function()
  local frame = {}
  frame.registeredEvents = {}
  frame.RegisterEvent = function(_, event)
    frame.registeredEvents[event] = true
  end
  frame.SetScript = function(_, scriptType, handler)
    if scriptType == "OnEvent" then
      frame.onEvent = handler
      _G.WOWC_TEST_LAST_FRAME = frame
    end
  end
  return frame
end

_G.WOWC_TEST_FIRE_EVENT = function(frame, event, ...)
  assert(frame.registeredEvents[event], "event fired without registration: " .. tostring(event))
  frame.onEvent(frame, event, ...)
end

_G.C_Timer = {
  After = function(seconds, callback)
    _G.WOWC_TEST_TIMER_CALLBACKS = _G.WOWC_TEST_TIMER_CALLBACKS or {}
    table.insert(_G.WOWC_TEST_TIMER_CALLBACKS, {
      seconds = seconds,
      callback = function(...)
        if not _G.WOWC_TEST_FREEZE_CLOCK then
          _G.WOWC_TEST_GAME_TIME = (_G.WOWC_TEST_GAME_TIME or 0) + seconds
        end
        return callback(...)
      end,
    })
  end,
  NewTicker = function(seconds, callback)
    _G.WOWC_TEST_TICKERS = _G.WOWC_TEST_TICKERS or {}
    local ticker = { seconds = seconds, callback = callback, cancelled = false }
    function ticker:Cancel()
      self.cancelled = true
    end
    table.insert(_G.WOWC_TEST_TICKERS, ticker)
    return ticker
  end,
}
