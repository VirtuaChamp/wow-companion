local dir = assert(arg[1], "usage: two_sided_addon.lua <dir>")

dofile("tests/lua/wow_stubs.lua")
local json = dofile("scripts/build-db/json-encode.lua")

io.stdout:setvbuf("no")

local SLOT_COUNT = 200
local timers = {}
local chain = {}
local recorded = {}
local received = {}
local ns
local lastTbl
local lastGrid
local paintCount = 0
local loads = 0

local function readAll(path)
  local file = io.open(path, "rb")
  if not file then
    return nil
  end
  local content = file:read("*a")
  file:close()
  return content
end

_G.PlaySoundFile = function(path)
  local index = path:match("(%d+)%.wav$")
  local content = index and readAll(dir .. "/sig/" .. index .. ".wav")
  return content ~= nil and #content > 0
end

_G.C_AddOns.LoadAddOn = function(name)
  local content = readAll(dir .. "/addons/" .. name .. "/r.lua")
  if not content then
    return false, "MISSING"
  end
  local chunk, err = loadstring(content)
  if not chunk then
    return false, err
  end
  chunk()
  return true
end

_G.C_Timer.After = function(_, callback)
  table.insert(timers, callback)
end

local function loadAddon()
  loads = loads + 1
  timers = {}
  received = {}
  paintCount = 0
  lastTbl = nil
  lastGrid = nil
  math.randomseed(1)
  _G.WOWC_TEST_SERVER_TIME = 1000 + loads * 37
  _G.WOWC_TEST_PROFILE_STOP = 500 + loads * 911
  _G.WOWC_TEST_GAME_TIME = 10 + loads * 0.371

  ns = {}
  assert(loadfile("addon/WoWCompanion/Codec.lua"))("WoWCompanion", ns)

  local originalEncode = ns.Codec.encode
  ns.Codec.encode = function(tbl, seq)
    local frames, err = originalEncode(tbl, seq)
    if frames then
      for _, frame in ipairs(frames) do
        recorded[frame] = tbl
      end
    end
    return frames, err
  end
  local originalRender = ns.Codec.render
  ns.Codec.render = function(frame)
    lastTbl = recorded[frame]
    return originalRender(frame)
  end
  ns.Codec.paint = function(cells)
    local grid, err = ns.Codec.layoutGrid(cells)
    assert(grid, err)
    lastGrid = grid
    paintCount = paintCount + 1
    return true
  end

  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", ns)
  ns.Transport.onMessage(function(msg)
    table.insert(received, msg)
  end)
  chain = { timers[1], timers[2], timers[3] }
  assert(#chain == 3, "Inbox.lua registers exactly three timer chains at load")
  timers = {}
end

local tickIndex = { repaint = 1, poll = 2, hello = 3 }

local function tick(name)
  local index = assert(tickIndex[name], "unknown tick " .. tostring(name))
  timers = {}
  chain[index]()
  assert(#timers == 1, "a timer chain re-arms itself exactly once per tick")
  chain[index] = timers[1]
end

local function writeGrid()
  local file = assert(io.open(dir .. "/grid.txt", "w"))
  for _, cell in ipairs(assert(lastGrid, "nothing painted yet")) do
    file:write(tostring(cell), "\n")
  end
  file:close()
end

local function info()
  local painted = nil
  if lastTbl then
    painted = { t = lastTbl.t, again = lastTbl.again, slot = lastTbl.slot }
  end
  return {
    session = ns.Transport.session(),
    slot = SLOT_COUNT - ns.Transport.slotsLeft() + 1,
    paintCount = paintCount,
    painted = painted,
    received = received,
  }
end

for line in io.lines() do
  local command, rest = line:match("^(%S+)%s*(.*)$")
  if command == "load" then
    loadAddon()
    io.write("ok\n")
  elseif command == "tick" then
    tick(rest)
    io.write("ok\n")
  elseif command == "grid" then
    writeGrid()
    io.write("ok\n")
  elseif command == "ask" then
    local id, text = rest:match("^(%S+)%s+(.*)$")
    local seq, err = ns.Transport.send({ t = "ask", id = id, chat = "general", text = text, mentions = {} })
    io.write(seq and ("ok " .. seq) or ("err " .. tostring(err)), "\n")
  elseif command == "info" then
    io.write(json.encode(info()), "\n")
  else
    io.write("err unknown command\n")
  end
end
