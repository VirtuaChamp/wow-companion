dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {} }
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end
ns.Settings = {
  onChats = function() end,
  onError = function() end,
  onOptions = function() end,
}

local aiWindowChunk = assert(loadfile("addon/WoWCompanion/AiWindow.lua"))
aiWindowChunk("WoWCompanion", ns)
local waypointChunk = assert(loadfile("addon/WoWCompanion/Waypoint.lua"))
waypointChunk("WoWCompanion", ns)
local coreChunk = assert(loadfile("addon/WoWCompanion/Core.lua"))
coreChunk("WoWCompanion", ns)

assert(not ns.AiWindow.isShown(), "the Claude window starts hidden")

_G.SlashCmdList["AI"]("hello there")

assert(ns.AiWindow.isShown(), "/ai <text> shows the Claude window when it was hidden")
assert(#ns.AiWindow.scrollFrame.messages >= 1, "the question is echoed into the window")
assert(
  ns.AiWindow.scrollFrame.messages[1].text:find("hello there", 1, true) ~= nil,
  "the echoed line carries the typed question"
)

assert(#ns.Transport.sent == 1, "the ask is sent to the companion")
assert(ns.Transport.sent[1].t == "ask", "an ask message is sent")
assert(ns.Transport.sent[1].text == "hello there", "the ask carries the typed text")

ns.Core.dispatch({
  t = "reply",
  id = ns.Transport.sent[1].id,
  chat = "default",
  provider = "claude",
  summary = "hi back",
  full = "hi back",
})

local lastMessage = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text
assert(lastMessage:find("hi back", 1, true) ~= nil, "the reply lands in the Claude window")

ns.Core.dispatch({
  t = "reply",
  id = "ask-injected",
  chat = "default",
  provider = "claude",
  summary = "|Hitem:1|h[Sword]|h go get it",
  full = "|Hitem:1|h[Sword]|h go get it",
})
local injectedReply = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text
assert(injectedReply:find("||H", 1, true) ~= nil, "a reply summary with a raw WoW escape is sanitized before printing")

ns.Core.dispatch({ t = "progress", detail = "using |Kfind_npc|k" })
local progressLine = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text
assert(progressLine:find("||K", 1, true) ~= nil, "a progress detail with a raw WoW escape is sanitized before printing")

ns.Core.dispatch({
  t = "reply",
  id = "ask-waypoint",
  chat = "default",
  provider = "claude",
  summary = "waypoint set",
  full = "waypoint set",
  waypoint = { label = "|Hitem:1|h[Bad]|h", x = 10, y = 20, uiMapId = 84 },
})
local waypointLine = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text
assert(waypointLine:find("||H", 1, true) ~= nil, "a waypoint label with a raw WoW escape is sanitized before printing")

ns.AiWindow.notice("session |Hexpired|h")
local noticeMessage = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages]
assert(noticeMessage.text:find("||H", 1, true) ~= nil, "notice() sanitizes its text")
assert(noticeMessage.r == 1 and noticeMessage.g == 1 and noticeMessage.b == 0, "notice() prints in the Blizzard system colour")

local registered
ns.Transport.onMessage = function(fn)
  registered = fn
end
_G.WOWC_TEST_LAST_FRAME:Fire("OnEvent", "ADDON_LOADED", "WoWCompanion")
assert(
  registered == ns.Core.dispatch,
  "ADDON_LOADED registers the dispatcher through ns.Transport.onMessage, per slice 13's registration contract"
)

print("ai.route: all assertions passed")
