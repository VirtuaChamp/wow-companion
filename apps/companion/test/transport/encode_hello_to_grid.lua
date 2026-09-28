local outDir = (assert(arg[1], "usage: encode_hello_to_grid.lua <outDir> <session> <slot> [seq]"))
local session = (assert(arg[2], "usage: encode_hello_to_grid.lua <outDir> <session> <slot> [seq]"))
local slot = tonumber((assert(arg[3], "usage: encode_hello_to_grid.lua <outDir> <session> <slot> [seq]")))
local seq = tonumber(arg[4] or "0")
local again = arg[5] == "again"

local scriptDir = "tests/lua/codec/"
local loadCodec = dofile(scriptDir .. "load_codec.lua")
local Codec = loadCodec()

local message = {
  t = "hello",
  v = 1,
  build = "1.60.1.70009",
  iface = 16001,
  session = session,
  slot = slot,
}
if again then
  message.again = true
end

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

os.exit(0)
