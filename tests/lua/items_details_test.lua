dofile("tests/lua/wow_stubs.lua")

local ns = {}
local chunk = assert(loadfile("addon/WoWCompanion/Items.lua"))
chunk("WoWCompanion", ns)

assert(_G.WOWC_TEST_LAST_FRAME ~= nil, "listener frame registered at module load, before any request")
assert(
  _G.WOWC_TEST_LAST_FRAME.registeredEvents["ITEM_DATA_LOAD_RESULT"] == true,
  "listener frame registers ITEM_DATA_LOAD_RESULT"
)

local cachedResults
ns.Items.details({ 2001 }, function(results)
  cachedResults = results
end)
assert(cachedResults ~= nil, "onDone called synchronously for an all-cached request")
assert(#cachedResults == 1, "one item resolved")
assert(cachedResults[1].itemId == 2001, "item id carried")
assert(cachedResults[1].name == "Bag Item", "name carried")
assert(cachedResults[1].quality == 3, "quality carried, got " .. tostring(cachedResults[1].quality))
assert(cachedResults[1].itemLevel == 15, "itemLevel carried, got " .. tostring(cachedResults[1].itemLevel))
assert(cachedResults[1].requiredLevel == 8, "requiredLevel carried, got " .. tostring(cachedResults[1].requiredLevel))
assert(cachedResults[1].equipLoc == "INVTYPE_TRINKET", "equipLoc carried, got " .. tostring(cachedResults[1].equipLoc))
assert(cachedResults[1].classId == 7, "classId carried, got " .. tostring(cachedResults[1].classId))
assert(cachedResults[1].subClassId == 4, "subClassId carried, got " .. tostring(cachedResults[1].subClassId))
assert(cachedResults[1].stats.ITEM_MOD_STAMINA_SHORT == 10, "stats carried from GetItemStats")

local requestedIds = {}
_G.C_Item.RequestLoadItemDataByID = function(id)
  requestedIds[#requestedIds + 1] = id
end

local uncachedResults
ns.Items.details({ 3001, 3001, 3001 }, function(results)
  uncachedResults = results
end)
assert(uncachedResults == nil, "onDone not called synchronously while the item is uncached")
assert(#requestedIds == 1, "duplicate ids are de-duped before requesting, got " .. #requestedIds)
assert(requestedIds[1] == 3001, "RequestLoadItemDataByID called for the uncached item")

_G.WOWC_TEST_SET_ITEM_INFO(3001, {
  name = "Newly Cached Item",
  quality = 2,
  itemLevel = 30,
  requiredLevel = 10,
  equipLoc = "INVTYPE_WEAPON",
  classId = 2,
  subClassId = 1,
})
_G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 3001, true)
assert(uncachedResults ~= nil, "onDone called once the retried item resolves")
assert(#uncachedResults == 1, "one item resolved after retry, no duplicate rows for the deduped ids")
assert(uncachedResults[1].itemId == 3001, "resolved item id carried")
assert(uncachedResults[1].name == "Newly Cached Item", "resolved item name carried")

requestedIds = {}
local failedResults
ns.Items.details({ 4001 }, function(results)
  failedResults = results
end)
assert(#requestedIds == 1 and requestedIds[1] == 4001, "RequestLoadItemDataByID called for the failing item")
_G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 4001, false)
assert(failedResults ~= nil, "onDone called after a failed load result")
assert(#failedResults == 0, "failed item is not present in results")

_G.WOWC_TEST_TIMER_CALLBACKS = nil
local timedOutResults
local onDoneCallCount = 0
ns.Items.details({ 5001 }, function(results)
  onDoneCallCount = onDoneCallCount + 1
  timedOutResults = results
end)
assert(timedOutResults == nil, "onDone not called before the timeout fires")
assert(_G.WOWC_TEST_TIMER_CALLBACKS ~= nil and #_G.WOWC_TEST_TIMER_CALLBACKS == 1, "an 8s timer was scheduled")
assert(_G.WOWC_TEST_TIMER_CALLBACKS[1].seconds == 8, "timeout is 8 seconds")
_G.WOWC_TEST_TIMER_CALLBACKS[1].callback()
assert(onDoneCallCount == 1, "onDone called exactly once by the timeout")
assert(#timedOutResults == 0, "timeout with no resolved items yields an empty result list")

_G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 5001, true)
assert(onDoneCallCount == 1, "a late event after the timeout does not call onDone a second time")

requestedIds = {}
local allLoadedResults
local allLoadedCallCount = 0
ns.Items.details({ 6001, 6002 }, function(results)
  allLoadedCallCount = allLoadedCallCount + 1
  allLoadedResults = results
end)
assert(#requestedIds == 2, "both uncached ids requested, got " .. #requestedIds)
assert(allLoadedResults == nil, "onDone not called while any id is still pending")
_G.WOWC_TEST_SET_ITEM_INFO(6001, {
  name = "First Loaded",
  quality = 1,
  itemLevel = 1,
  requiredLevel = 1,
  equipLoc = "",
  classId = 0,
  subClassId = 0,
})
_G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 6001, true)
assert(allLoadedResults == nil, "onDone still not called after only the first of two ids resolves")
_G.WOWC_TEST_SET_ITEM_INFO(6002, {
  name = "Second Loaded",
  quality = 1,
  itemLevel = 1,
  requiredLevel = 1,
  equipLoc = "",
  classId = 0,
  subClassId = 0,
})
_G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 6002, true)
assert(allLoadedCallCount == 1, "onDone called once all ids resolve (all-loaded path, not timeout)")
assert(#allLoadedResults == 2, "both resolved items present")

_G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 6001, true)
assert(allLoadedCallCount == 1, "a duplicate late event for an id from a finished call does not re-fire onDone")
assert(#allLoadedResults == 2, "a duplicate late event does not add a duplicate result row")

_G.WOWC_TEST_TIMER_CALLBACKS = nil
local clearedTimeoutResults
local clearedCallCount = 0
ns.Items.details({ 8001 }, function(results)
  clearedCallCount = clearedCallCount + 1
  clearedTimeoutResults = results
end)
assert(
  _G.WOWC_TEST_TIMER_CALLBACKS ~= nil and #_G.WOWC_TEST_TIMER_CALLBACKS == 1,
  "an 8s timer was scheduled for the pending-clear case"
)
_G.WOWC_TEST_TIMER_CALLBACKS[1].callback()
assert(clearedCallCount == 1, "onDone called once by the timeout")
assert(#clearedTimeoutResults == 0, "timeout with no resolved items yields an empty result list")

_G.WOWC_TEST_SET_ITEM_INFO(8001, {
  name = "Resolved After Timeout",
  quality = 1,
  itemLevel = 1,
  requiredLevel = 1,
  equipLoc = "",
  classId = 0,
  subClassId = 0,
})
_G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 8001, true)
assert(clearedCallCount == 1, "a late resolve after timeout does not call onDone again")
assert(
  #clearedTimeoutResults == 0,
  "a late resolve after timeout does not silently mutate the delivered results table"
    .. " (this call's pending state is cleared on finish)"
)

_G.WOWC_TEST_TIMER_CALLBACKS = nil
_G.C_Item.RequestLoadItemDataByID = function(id)
  requestedIds[#requestedIds + 1] = id
end
local leakCallCount = 0
ns.Items.details({ 9001 }, function()
  leakCallCount = leakCallCount + 1
end)
assert(ns.Items.pendingHandlerCount(9001) == 1, "handler registered while the request is pending")
_G.WOWC_TEST_TIMER_CALLBACKS[1].callback()
assert(leakCallCount == 1, "onDone called once by the timeout")
assert(
  ns.Items.pendingHandlerCount(9001) == 0,
  "a timed-out request removes its handler from the module-level pending list instead of retaining it"
)

_G.C_Item.RequestLoadItemDataByID = function(id)
  if id == 7001 then
    _G.WOWC_TEST_SET_ITEM_INFO(7001, {
      name = "Synchronously Resolved",
      quality = 1,
      itemLevel = 1,
      requiredLevel = 1,
      equipLoc = "",
      classId = 0,
      subClassId = 0,
    })
    _G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 7001, true)
  end
end
local syncResults
local syncCallCount = 0
ns.Items.details({ 7001, 7002 }, function(results)
  syncCallCount = syncCallCount + 1
  syncResults = results
end)
assert(
  syncResults == nil,
  "a synchronous ITEM_DATA_LOAD_RESULT fired during RequestLoadItemDataByID for the first id"
    .. " does not finish the call before the second id is even requested"
)
_G.WOWC_TEST_SET_ITEM_INFO(7002, {
  name = "Resolved Later",
  quality = 1,
  itemLevel = 1,
  requiredLevel = 1,
  equipLoc = "",
  classId = 0,
  subClassId = 0,
})
_G.WOWC_TEST_FIRE_EVENT(_G.WOWC_TEST_LAST_FRAME, "ITEM_DATA_LOAD_RESULT", 7002, true)
assert(syncCallCount == 1, "onDone called exactly once, after both ids resolve")
assert(#syncResults == 2, "both ids present, the synchronous resolve was not lost")

print("items.details: all assertions passed")
