local scriptDir = arg[0]:match("^(.*[/\\])") or "./"
local json = dofile(scriptDir .. "json-encode.lua")

local dataForeverDir = arg[1]
local areaMapPath = arg[2]

local DEFAULT_MEMORY_CEILING_KB = 512 * 1024
local memoryCeilingKb = tonumber(arg[3]) or DEFAULT_MEMORY_CEILING_KB

local function checkMemoryCeiling()
  if collectgarbage("count") > memoryCeilingKb then
    error("exporter exceeded memory ceiling of " .. memoryCeilingKb .. " KB")
  end
end

debug.sethook(checkMemoryCeiling, "", 100000)

local BYTECODE_SIGNATURE = "\27Lua"

local function refuse(path, message)
  io.stderr:write(path .. ": " .. message .. "\n")
  os.exit(1)
end

local function readFile(path)
  local file, openError = io.open(path, "rb")
  if not file then
    io.stderr:write(tostring(openError) .. "\n")
    os.exit(1)
  end
  local content = file:read("*a")
  file:close()
  return content
end

local function refuseBytecode(path, content)
  if content:sub(1, #BYTECODE_SIGNATURE) == BYTECODE_SIGNATURE then
    refuse(path, "refusing precompiled Lua bytecode")
  end
end

local function loadSandboxed(path, content, env)
  local chunk, loadError = loadstring(content, path)
  if not chunk then
    io.stderr:write(tostring(loadError) .. "\n")
    os.exit(1)
  end
  setfenv(chunk, env)
  local ok, result = pcall(chunk)
  if not ok then
    io.stderr:write(path .. ": " .. tostring(result) .. "\n")
    os.exit(1)
  end
  return result
end

local function newModuleRegistry()
  local modules = {}
  local questieLoader = {
    ImportModule = function(_, name)
      if not modules[name] then
        modules[name] = { private = {} }
      end
      return modules[name]
    end,
  }
  return modules, { QuestieLoader = questieLoader }
end

local function loadDataString(path, moduleName, dataKey)
  local content = readFile(path)
  refuseBytecode(path, content)
  local modules, env = newModuleRegistry()
  loadSandboxed(path, content, env)
  local moduleTable = modules[moduleName]
  local dataString = moduleTable and moduleTable[dataKey]
  if type(dataString) ~= "string" then
    refuse(path, "did not assign " .. moduleName .. "." .. dataKey .. " a string")
  end
  return dataString
end

local function loadInnerTable(path, dataString)
  refuseBytecode(path, dataString)
  local result = loadSandboxed(path, dataString, {})
  if type(result) ~= "table" then
    refuse(path, "inner data string did not return a table")
  end
  return result
end

local function loadTable(path, moduleName, dataKey)
  return loadInnerTable(path, loadDataString(path, moduleName, dataKey))
end

local function loadAreaMap(path)
  local content = readFile(path)
  refuseBytecode(path, content)
  local modules, env = newModuleRegistry()
  loadSandboxed(path, content, env)
  local zoneDb = modules.ZoneDB
  local baseString = zoneDb and zoneDb.private and zoneDb.private.areaIdToUiMapId
  local overrideString = zoneDb and zoneDb.private and zoneDb.private.areaIdToUiMapIdOverride
  if type(baseString) ~= "string" then
    refuse(path, "did not assign ZoneDB.private.areaIdToUiMapId a string")
  end
  if type(overrideString) ~= "string" then
    refuse(path, "did not assign ZoneDB.private.areaIdToUiMapIdOverride a string")
  end
  local merged = {}
  for zoneId, uiMapId in pairs(loadInnerTable(path, baseString)) do
    merged[zoneId] = uiMapId
  end
  for zoneId, uiMapId in pairs(loadInnerTable(path, overrideString)) do
    merged[zoneId] = uiMapId
  end
  return merged
end

local function sortedIds(t)
  local ids = {}
  for id in pairs(t) do
    ids[#ids + 1] = id
  end
  table.sort(ids)
  return ids
end

local NPC_SCALAR_FIELDS = { name = 1, min_level = 4, max_level = 5, faction_id = 12, friendly_to = 13, sub_name = 14 }
local NPC_SPAWN_INDEX = 7

local OBJECT_SCALAR_FIELDS = { name = 1 }
local OBJECT_SPAWN_INDEX = 4

local QUEST_SCALAR_FIELDS = { name = 1, required_level = 4, quest_level = 5, zone_or_sort = 17, next_in_chain = 22 }
local QUEST_OBJECTIVES_TEXT_INDEX = 8
local QUEST_STARTED_BY_INDEX = 2
local QUEST_FINISHED_BY_INDEX = 3
local QUEST_START_KIND_ORDER = { "npc", "object", "item" }
local QUEST_END_KIND_ORDER = { "npc", "object" }

local ITEM_SCALAR_FIELDS = { name = 1, item_level = 9, required_level = 10, class = 12, sub_class = 13 }
local ITEM_SOURCE_FIELD_INDEX = { npc_drop = 2, object_drop = 3, quest_reward = 6, vendor = 14 }
local ITEM_SOURCE_KIND_ORDER = { "npc_drop", "object_drop", "quest_reward", "vendor" }

local function extractScalars(fieldMap, id, row)
  local scalars = { id = id }
  for key, index in pairs(fieldMap) do
    local value = row[index]
    scalars[key] = value == nil and json.NULL or value
  end
  return scalars
end

local function resolveUiMapId(areaMap, zoneId)
  local resolved = areaMap[zoneId]
  if resolved == nil then
    return json.NULL
  end
  return resolved
end

local function extractSpawnRows(entityKey, entityId, spawns, areaMap)
  local out = {}
  if spawns == nil then
    return out
  end
  for _, zoneId in ipairs(sortedIds(spawns)) do
    for _, coord in ipairs(spawns[zoneId]) do
      out[#out + 1] = {
        [entityKey] = entityId,
        zone_id = zoneId,
        ui_map_id = resolveUiMapId(areaMap, zoneId),
        x = coord[1],
        y = coord[2],
      }
    end
  end
  return out
end

local function extractQuestLinks(questId, kindTable, kindOrder, out)
  if kindTable == nil then
    return
  end
  for position, kind in ipairs(kindOrder) do
    local ids = kindTable[position]
    if ids ~= nil then
      for _, entityId in ipairs(ids) do
        out[#out + 1] = { quest_id = questId, kind = kind, entity_id = entityId }
      end
    end
  end
end

local npcTable = loadTable(dataForeverDir .. "/foreverNpcDB.lua", "QuestieDB", "npcData")
local objectTable = loadTable(dataForeverDir .. "/foreverObjectDB.lua", "QuestieDB", "objectData")
local questTable = loadTable(dataForeverDir .. "/foreverQuestDB.lua", "QuestieDB", "questData")
local itemTable = loadTable(dataForeverDir .. "/foreverItemDB.lua", "QuestieDB", "itemData")
local areaMap = loadAreaMap(areaMapPath)

local npcRows, npcSpawnRows = {}, {}
for _, id in ipairs(sortedIds(npcTable)) do
  local row = npcTable[id]
  npcRows[#npcRows + 1] = extractScalars(NPC_SCALAR_FIELDS, id, row)
  local spawns = extractSpawnRows("npc_id", id, row[NPC_SPAWN_INDEX], areaMap)
  for _, spawn in ipairs(spawns) do
    npcSpawnRows[#npcSpawnRows + 1] = spawn
  end
end

local objectRows, objectSpawnRows = {}, {}
for _, id in ipairs(sortedIds(objectTable)) do
  local row = objectTable[id]
  objectRows[#objectRows + 1] = extractScalars(OBJECT_SCALAR_FIELDS, id, row)
  local spawns = extractSpawnRows("object_id", id, row[OBJECT_SPAWN_INDEX], areaMap)
  for _, spawn in ipairs(spawns) do
    objectSpawnRows[#objectSpawnRows + 1] = spawn
  end
end

local questRows, questStartRows, questEndRows = {}, {}, {}
for _, id in ipairs(sortedIds(questTable)) do
  local row = questTable[id]
  local scalars = extractScalars(QUEST_SCALAR_FIELDS, id, row)
  local objectivesText = row[QUEST_OBJECTIVES_TEXT_INDEX]
  if objectivesText == nil then
    scalars.objectives_text = json.NULL
  else
    scalars.objectives_text = table.concat(objectivesText, " ")
  end
  questRows[#questRows + 1] = scalars
  extractQuestLinks(id, row[QUEST_STARTED_BY_INDEX], QUEST_START_KIND_ORDER, questStartRows)
  extractQuestLinks(id, row[QUEST_FINISHED_BY_INDEX], QUEST_END_KIND_ORDER, questEndRows)
end

local itemRows, itemSourceRows = {}, {}
for _, id in ipairs(sortedIds(itemTable)) do
  local row = itemTable[id]
  itemRows[#itemRows + 1] = extractScalars(ITEM_SCALAR_FIELDS, id, row)
  for _, kind in ipairs(ITEM_SOURCE_KIND_ORDER) do
    local ids = row[ITEM_SOURCE_FIELD_INDEX[kind]]
    if ids ~= nil then
      for _, entityId in ipairs(ids) do
        itemSourceRows[#itemSourceRows + 1] = { item_id = id, kind = kind, entity_id = entityId }
      end
    end
  end
end

io.write(json.encode({
  npc = npcRows,
  npc_spawn = npcSpawnRows,
  quest = questRows,
  quest_start = questStartRows,
  quest_end = questEndRows,
  object = objectRows,
  object_spawn = objectSpawnRows,
  item = itemRows,
  item_source = itemSourceRows,
}))
