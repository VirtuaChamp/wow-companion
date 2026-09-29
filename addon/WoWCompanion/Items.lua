local _, ns = ...

ns.Items = ns.Items or {}

local RESOLVE_TIMEOUT_SECONDS = 8

local function buildDetail(itemId)
  local name, itemLink, quality, itemLevel, requiredLevel, _, _, _, equipLoc, _, _, classId, subClassId =
    C_Item.GetItemInfo(itemId)
  if not name then
    return nil
  end
  local stats = {}
  if itemLink then
    stats = C_Item.GetItemStats(itemLink) or {}
  end
  return {
    itemId = itemId,
    name = name,
    quality = quality or 0,
    itemLevel = itemLevel or 0,
    requiredLevel = requiredLevel or 0,
    equipLoc = equipLoc or "",
    classId = classId or 0,
    subClassId = subClassId or 0,
    stats = stats,
  }
end

local pendingByItem = {}

local listenerFrame = CreateFrame("Frame")
listenerFrame:RegisterEvent("ITEM_DATA_LOAD_RESULT")
listenerFrame:SetScript("OnEvent", function(_, _, itemId, success)
  local handlers = pendingByItem[itemId]
  if not handlers then
    return
  end
  pendingByItem[itemId] = nil
  for i = 1, #handlers do
    handlers[i](success)
  end
end)

function ns.Items.pendingHandlerCount(itemId)
  local handlers = pendingByItem[itemId]
  return handlers and #handlers or 0
end

local function removeHandler(itemId, handler)
  local handlers = pendingByItem[itemId]
  if not handlers then
    return
  end
  for i = #handlers, 1, -1 do
    if handlers[i] == handler then
      table.remove(handlers, i)
      break
    end
  end
  if #handlers == 0 then
    pendingByItem[itemId] = nil
  end
end

function ns.Items.details(ids, onDone)
  local results = {}
  local seen = {}
  local uniqueIds = {}
  for i = 1, #ids do
    local id = ids[i]
    if not seen[id] then
      seen[id] = true
      uniqueIds[#uniqueIds + 1] = id
    end
  end

  local pending = {}
  local pendingHandlers = {}
  local pendingCount = 0
  local finished = false
  local dispatching = true

  local function finish()
    if finished then
      return
    end
    finished = true
    for id in pairs(pending) do
      removeHandler(id, pendingHandlers[id])
      pending[id] = nil
    end
    onDone(results)
  end

  for i = 1, #uniqueIds do
    local id = uniqueIds[i]
    local detail = buildDetail(id)
    if detail then
      results[#results + 1] = detail
    else
      pending[id] = true
      pendingCount = pendingCount + 1
      pendingByItem[id] = pendingByItem[id] or {}
      local handler
      handler = function(success)
        if finished or not pending[id] then
          return
        end
        pending[id] = nil
        pendingCount = pendingCount - 1
        if success then
          local resolved = buildDetail(id)
          if resolved then
            results[#results + 1] = resolved
          end
        end
        if pendingCount == 0 and not dispatching then
          finish()
        end
      end
      pendingHandlers[id] = handler
      table.insert(pendingByItem[id], handler)
      C_Item.RequestLoadItemDataByID(id)
    end
  end

  dispatching = false

  if pendingCount == 0 then
    finish()
    return
  end

  C_Timer.After(RESOLVE_TIMEOUT_SECONDS, finish)
end
