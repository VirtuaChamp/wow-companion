local outDir = (assert(arg[1], "usage: encode_state_to_grid.lua <outDir> <seq>"))
local seq = tonumber(arg[2] or "0")

local scriptDir = "tests/lua/codec/"
local loadCodec = dofile(scriptDir .. "load_codec.lua")
local Codec = loadCodec()

local message = {
  t = "state",
  seq = seq,
  delta = {},
}

local frames, err = Codec.encode(message, seq)
if not frames then
  local file = assert(io.open(outDir .. "/error.txt", "w"))
  file:write(err)
  file:close()
  os.exit(0)
end

for index, frame in ipairs(frames) do
  local cells = Codec.render(frame)
  local grid = assert(Codec.layoutGrid(cells))
  local file = assert(io.open(outDir .. "/frame-" .. (index - 1) .. ".grid", "w"))
  for _, cell in ipairs(grid) do
    file:write(tostring(cell), "\n")
  end
  file:close()
end

local metaFile = assert(io.open(outDir .. "/meta.txt", "w"))
metaFile:write(tostring(#frames))
metaFile:close()

os.exit(0)
