local outDir = (assert(arg[1], "usage: state_sender_encode.lua <outDir> <mode>"))
local mode = arg[2] or "full"

local loadCodec = dofile("tests/lua/codec/load_codec.lua")
local Codec = loadCodec()

local ns = {}
local ackHandlers = {}
local messageCount = 0

ns.Transport = {
  send = function(tbl)
    messageCount = messageCount + 1
    local frames, err = Codec.encode(tbl, messageCount)
    if not frames then
      return nil, err
    end
    for index, frame in ipairs(frames) do
      local cells = Codec.render(frame)
      local grid = assert(Codec.layoutGrid(cells))
      local file = assert(io.open(outDir .. "/msg-" .. messageCount .. "-frame-" .. (index - 1) .. ".grid", "w"))
      for _, cell in ipairs(grid) do
        file:write(tostring(cell), "\n")
      end
      file:close()
    end
    return messageCount
  end,
  onHelloAcked = function(fn)
    table.insert(ackHandlers, fn)
  end,
  onMessage = function() end,
}

if mode == "nofaction" then
  _G.UnitFactionGroup = function()
    return nil
  end
end

assert(loadfile("addon/WoWCompanion/State.lua"))("WoWCompanion", ns)
assert(loadfile("addon/WoWCompanion/StateSender.lua"))("WoWCompanion", ns)

for _, handler in ipairs(ackHandlers) do
  handler()
end

local file = assert(io.open(outDir .. "/count.txt", "w"))
file:write(tostring(messageCount))
file:close()
os.exit(0)
