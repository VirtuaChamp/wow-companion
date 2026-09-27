local stubAreas = { "transport", "context", "chat", "panels" }

_G.bit = dofile("tests/lua/bit_shim.lua")

for _, area in ipairs(stubAreas) do
  dofile("tests/lua/stubs/" .. area .. ".lua")
end
