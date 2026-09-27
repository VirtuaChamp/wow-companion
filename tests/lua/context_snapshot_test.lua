dofile("tests/lua/wow_stubs.lua")

local ns = {}
local chunk = assert(loadfile("addon/WoWCompanion/State.lua"))
chunk("WoWCompanion", ns)

local snapshot = ns.State.snapshot()

assert(type(snapshot.character) == "table", "character present")
assert(snapshot.character.name == "Testcharacter", "character name")

assert(#snapshot.equipped == 19, "19 equipped slots present, got " .. #snapshot.equipped)
for slot = 1, 19 do
  local found = false
  for _, entry in ipairs(snapshot.equipped) do
    if entry.slot == slot then
      found = true
    end
  end
  assert(found, "equipped slot " .. slot .. " present")
end

assert(#snapshot.bags >= 1, "bag items present")
assert(snapshot.bags[1].itemId == 2001, "bag item id carried")
assert(snapshot.bags[1].count == 3, "bag item count carried")

assert(snapshot.position.x == 42.0, "position.x scaled to 0-100, got " .. tostring(snapshot.position.x))
assert(snapshot.position.y == 58.0, "position.y scaled to 0-100, got " .. tostring(snapshot.position.y))

assert(snapshot.money == 12345, "money carried")
assert(#snapshot.quests == 1, "quest log entry present")
assert(#snapshot.professions == 2, "professions present")
assert(#snapshot.talents == 1, "talents present")

local noChange = ns.State.delta(ns.State.snapshot(), ns.State.snapshot())
assert(noChange == nil, "no delta when two fresh snapshots are structurally equal")

local changedBags = ns.State.snapshot()
changedBags.bags[1].count = changedBags.bags[1].count + 1
local partial = ns.State.delta(snapshot, changedBags)
assert(partial.bags ~= nil, "delta carries changed top-level key whole")
assert(partial.bags[1].count == snapshot.bags[1].count + 1, "delta bag reflects the changed value")
assert(partial.character == nil, "delta omits unchanged top-level key")
for key in pairs(partial) do
  assert(key == "bags", "delta contains only the changed top-level key, got " .. key)
end

local full = ns.State.delta(nil, snapshot)
assert(full == snapshot, "delta(nil, snapshot) returns the full snapshot")
for key in pairs(snapshot) do
  assert(full[key] ~= nil, "delta(nil, snapshot) carries every key, missing " .. key)
end

local originalFactionGroup = _G.UnitFactionGroup
_G.UnitFactionGroup = function()
  return nil
end
local unresolvedFaction = ns.State.snapshot()
assert(unresolvedFaction.character == nil, "character omitted while faction is unresolved")
_G.UnitFactionGroup = originalFactionGroup

_G.WOWC_TEST_REQUESTED_ITEM_IDS = {}
_G.WOWC_TEST_SET_ITEM_INFO(1005, nil)
local uncachedSnapshot = ns.State.snapshot()
local foundUncachedSlot = false
for _, entry in ipairs(uncachedSnapshot.equipped) do
  if entry.slot == 5 then
    foundUncachedSlot = true
  end
end
assert(not foundUncachedSlot, "an uncached equipped item is omitted, never reported with a fabricated level")
assert(
  #uncachedSnapshot.equipped == 18,
  "only the uncached slot is missing from equipped, got " .. #uncachedSnapshot.equipped
)
local requestedUncached = false
for _, id in ipairs(_G.WOWC_TEST_REQUESTED_ITEM_IDS) do
  if id == 1005 then
    requestedUncached = true
  end
end
assert(requestedUncached, "RequestLoadItemDataByID called for the uncached equipped item")

_G.WOWC_TEST_SET_ITEM_INFO(1005, {
  name = "Equipped Item 5",
  quality = 1,
  itemLevel = 25,
  requiredLevel = 1,
  equipLoc = "INVTYPE_CHEST",
  classId = 4,
  subClassId = 0,
})
local loadedSnapshot = ns.State.snapshot()
local loadedSlot
for _, entry in ipairs(loadedSnapshot.equipped) do
  if entry.slot == 5 then
    loadedSlot = entry
  end
end
assert(loadedSlot ~= nil, "the equipped item appears once its data has loaded")
assert(loadedSlot.itemLevel == 25, "the real item level is reported once loaded, got " .. tostring(loadedSlot.itemLevel))

local cacheMissDelta = ns.State.delta(uncachedSnapshot, loadedSnapshot)
assert(
  cacheMissDelta ~= nil and cacheMissDelta.equipped ~= nil,
  "the newly-resolved equipped item is included in a later state delta"
)

print("context.snapshot: all assertions passed")
