std = "lua51"

local globalAreas = { "transport", "context", "chat", "panels" }

local readGlobals = { "bit" }
for _, area in ipairs(globalAreas) do
  local areaGlobals = dofile("tests/lua/globals/" .. area .. ".lua")
  for _, name in ipairs(areaGlobals) do
    table.insert(readGlobals, name)
  end
end

read_globals = readGlobals
globals = { "WoWCompanion_Deliver", "WoWCompanionDB" }

ignore = { "211/ns" }
