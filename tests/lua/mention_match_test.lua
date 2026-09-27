dofile("tests/lua/wow_stubs.lua")

local ns = {}
local chunk = assert(loadfile("addon/WoWCompanion/Mention.lua"))
chunk("WoWCompanion", ns)

local candidates = {
  { name = "Wolfsbane Root", mention = { kind = "item", itemId = 1 } },
  { name = "A Simple Task", mention = { kind = "quest", questId = 101 } },
  { name = "Defend Goldshire", mention = { kind = "quest", questId = 102 } },
  { name = "Iron Ore", mention = { kind = "item", itemId = 2 } },
}

local prefixResult = ns.Mention.match("wolf", candidates)
assert(#prefixResult.items == 1, "prefix match count")
assert(prefixResult.items[1].name == "Wolfsbane Root", "prefix match name")
assert(prefixResult.ghost == "Wolfsbane Root", "ghost text is top match")

local infixResult = ns.Mention.match("gold", candidates)
assert(#infixResult.items == 1, "infix match count")
assert(infixResult.items[1].name == "Defend Goldshire", "infix match name")

local ordering = ns.Mention.match("iron", {
  { name = "Chained Iron Bar", mention = { kind = "item", itemId = 3 } },
  { name = "Iron Ore", mention = { kind = "item", itemId = 2 } },
})
assert(ordering.items[1].name == "Iron Ore", "prefix match ranks before infix match")
assert(ordering.items[2].name == "Chained Iron Bar", "infix match still included")

local manyCandidates = {}
for i = 1, 10 do
  manyCandidates[i] = { name = "Test Item " .. i, mention = { kind = "item", itemId = i } }
end
local capped = ns.Mention.match("test", manyCandidates)
assert(#capped.items == 8, "max 8 matches")

local noMatch = ns.Mention.match("zzz", candidates)
assert(#noMatch.items == 0, "no match yields empty items")
assert(noMatch.ghost == nil, "no match yields nil ghost")

local candidateList = ns.Mention.candidates()

local questTitles = {}
local itemOccurrences = {}
local itemNamesById = {}
for _, candidate in ipairs(candidateList) do
  if candidate.mention.kind == "quest" then
    questTitles[candidate.mention.questId] = candidate.name
  elseif candidate.mention.kind == "item" then
    itemOccurrences[candidate.mention.itemId] = (itemOccurrences[candidate.mention.itemId] or 0) + 1
    itemNamesById[candidate.mention.itemId] = candidate.name
  end
end

assert(questTitles[101] == "A Simple Task", "visible quest present with its title")
assert(questTitles[102] == nil, "hidden quest is skipped from candidates")

assert(itemNamesById[2001] == "Bagged Trinket", "bag candidate uses info.itemName, not C_Item.GetItemInfo")

assert(itemOccurrences[1001] == 1, "item present in both a bag slot and an equipped slot appears once, got " .. tostring(itemOccurrences[1001]))
assert(itemNamesById[1001] == "Duplicate In Bag", "de-duplicated candidate keeps the first (bag) occurrence")

_G.WOWC_TEST_REQUESTED_ITEM_IDS = {}
_G.WOWC_TEST_SET_ITEM_INFO(1007, nil)
local uncachedCandidates = ns.Mention.candidates()
local foundUncachedItem = false
for _, candidate in ipairs(uncachedCandidates) do
  if candidate.mention.kind == "item" and candidate.mention.itemId == 1007 then
    foundUncachedItem = true
  end
end
assert(not foundUncachedItem, "an uncached equipped item is omitted from candidates rather than resolved with a nil name")
local requestedUncachedEquipped = false
for _, id in ipairs(_G.WOWC_TEST_REQUESTED_ITEM_IDS) do
  if id == 1007 then
    requestedUncachedEquipped = true
  end
end
assert(requestedUncachedEquipped, "RequestLoadItemDataByID called for the uncached equipped item")

_G.WOWC_TEST_SET_ITEM_INFO(1007, {
  name = "Equipped Item 7",
  quality = 1,
  itemLevel = 27,
  requiredLevel = 1,
  equipLoc = "INVTYPE_CHEST",
  classId = 4,
  subClassId = 0,
})
local loadedCandidates = ns.Mention.candidates()
local loadedEquippedName
for _, candidate in ipairs(loadedCandidates) do
  if candidate.mention.kind == "item" and candidate.mention.itemId == 1007 then
    loadedEquippedName = candidate.name
  end
end
assert(loadedEquippedName == "Equipped Item 7", "the equipped item's name resolves and rebuilds the candidate list once ITEM_DATA_LOAD_RESULT has cached it")

print("mention.match: all assertions passed")
