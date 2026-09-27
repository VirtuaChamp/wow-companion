local function loadCodec()
  dofile("tests/lua/wow_stubs.lua")
  local ns = {}
  local chunk = assert(loadfile("addon/WoWCompanion/Codec.lua"))
  chunk("WoWCompanion", ns)
  return ns.Codec
end

return loadCodec
