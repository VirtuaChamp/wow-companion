dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {} }
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end

local aiWindowChunk = assert(loadfile("addon/WoWCompanion/AiWindow.lua"))
aiWindowChunk("WoWCompanion", ns)

local first = ns.AiWindow.create()
assert(first ~= nil, "window frame created")
assert(first.TitleContainer.TitleText:GetText() == "Claude", "window titled Claude")
assert(first:IsShown() == false, "window starts hidden until shown")

local second = ns.AiWindow.create()
assert(second == first, "create is idempotent: no second window is created on reload")

first:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 55, -40)
first:SetSize(500, 360)
first:Fire("OnDragStop")

assert(WoWCompanionDB.window ~= nil, "window position is kept in WoWCompanionDB")
assert(WoWCompanionDB.window.point == "TOPLEFT", "saved anchor point")
assert(WoWCompanionDB.window.x == 55, "saved x position")
assert(WoWCompanionDB.window.width == 500, "saved width")
assert(WoWCompanionDB.window.height == 360, "saved height")

local ns2 = {}
ns2.Transport = { sent = {} }
function ns2.Transport.send(msg)
  table.insert(ns2.Transport.sent, msg)
end

local aiWindowChunk2 = assert(loadfile("addon/WoWCompanion/AiWindow.lua"))
aiWindowChunk2("WoWCompanion", ns2)

local reloaded = ns2.AiWindow.create()
local point, _, _, x, y = reloaded:GetPoint(1)
assert(point == "TOPLEFT", "reload restores the saved anchor point")
assert(x == 55, "reload restores the saved x position")
assert(y == -40, "reload restores the saved y position")
assert(reloaded:GetWidth() == 500, "reload restores the saved width")
assert(reloaded:GetHeight() == 360, "reload restores the saved height")

print("aiwindow.create: all assertions passed")
