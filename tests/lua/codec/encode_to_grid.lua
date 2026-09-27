local outDir = (assert(arg[1], "usage: encode_to_grid.lua <outDir> <payloadLen> <seq>"))
local payloadLen = tonumber((assert(arg[2], "usage: encode_to_grid.lua <outDir> <payloadLen> <seq>")))
local seq = tonumber(arg[3] or "0")

local scriptDir = "tests/lua/codec/"
local loadCodec = dofile(scriptDir .. "load_codec.lua")
local Codec = loadCodec()

local payloadBytes = {}
for i = 1, payloadLen do
  payloadBytes[i] = string.char((i - 1) % 256)
end
local payload = table.concat(payloadBytes)

local frames, err = Codec.toFrames(payload, seq)
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
