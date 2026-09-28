dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {} }
ns.Transport.session = function()
  return "sessionA"
end
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end
local optionsCalls = {}
ns.Settings = {
  onChats = function() end,
  onError = function() end,
  onOptions = function(msg)
    table.insert(optionsCalls, msg)
  end,
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

ns.Core.dispatch({
  t = "reply",
  id = "ask-refused-waypoint",
  chat = "default",
  provider = "claude",
  summary = "no map",
  full = "no map",
  waypoint = { label = "Nowhere", x = 10, y = 20, uiMapId = 999 },
})
local refusedLine = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text
assert(refusedLine:find("no_waypoint_map", 1, true) ~= nil, "a waypoint the client refuses prints a no_waypoint_map line")

ns.Core.dispatch({ t = "options", active = { provider = "claude" } })
assert(#optionsCalls == 1, "an options message reaches ns.Settings.onOptions")

local messagesBeforeRepeat = #ns.AiWindow.scrollFrame.messages
local sentBeforeRepeat = #ns.Transport.sent
for _ = 1, 2 do
  ns.Core.dispatch({
    t = "reply",
    id = "ask-repeated",
    chat = "default",
    provider = "claude",
    summary = "delivered twice",
    full = "delivered twice",
    waypoint = { label = "Once", x = 10, y = 20, uiMapId = 84 },
  })
end
local repeatedCount = 0
for _, message in ipairs(ns.AiWindow.scrollFrame.messages) do
  if message.text:find("delivered twice", 1, true) then
    repeatedCount = repeatedCount + 1
  end
end
assert(repeatedCount == 1, "a reply delivered twice (at-least-once) prints once")
assert(#ns.AiWindow.scrollFrame.messages == messagesBeforeRepeat + 2, "the repeat prints neither a second reply nor a second waypoint line")
assert(#ns.Transport.sent == sentBeforeRepeat, "the repeat sends nothing")

for i = 1, 200 do
  ns.Core.dispatch({ t = "reply", id = "flood-" .. i, chat = "default", provider = "claude", summary = "flood", full = "flood" })
end
ns.Core.dispatch({
  t = "reply",
  id = "ask-repeated",
  chat = "default",
  provider = "claude",
  summary = "delivered twice",
  full = "delivered twice",
})
local lastAfterBound = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text
assert(
  lastAfterBound:find("delivered twice", 1, true) ~= nil,
  "the seen-id set is bounded to the 200 most recent ids: the oldest is forgotten"
)

ns.AiWindow.notice("session |Hexpired|h")
local noticeMessage = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages]
assert(noticeMessage.text:find("||H", 1, true) ~= nil, "notice() sanitizes its text")
assert(noticeMessage.r == 1 and noticeMessage.g == 1 and noticeMessage.b == 0, "notice() prints in the Blizzard system colour")

ns.Transport.sent = {}
_G.SlashCmdList["AI"]("help me find Hogger")
assert(#ns.Transport.sent == 1 and ns.Transport.sent[1].t == "ask", "/ai help with trailing text is asked, not run as help")
assert(ns.Transport.sent[1].text == "help me find Hogger", "the whole line is the question")
ns.Transport.sent = {}
_G.SlashCmdList["AI"]("reset the world")
assert(#ns.Transport.sent == 1 and ns.Transport.sent[1].t == "ask", "/ai reset with trailing text is asked, not sent as reset")

local itemFixture = { { itemId = 1, name = "Sword" } }
local requestedIds
ns.Items = {
  details = function(ids, onDone)
    requestedIds = ids
    onDone(itemFixture)
  end,
}
ns.Transport.sent = {}
ns.Core.dispatch({ t = "itemreq", req = "r1", ids = { 1, 2 } })
assert(requestedIds ~= nil and #requestedIds == 2, "an itemreq asks ns.Items.details for the requested ids")
assert(#ns.Transport.sent == 1, "an itemreq is answered with one message")
assert(ns.Transport.sent[1].t == "items", "the answer is an items message")
assert(ns.Transport.sent[1].req == "r1", "the answer carries the request id")
assert(ns.Transport.sent[1].items == itemFixture, "the answer carries the item details")

local registered
ns.Transport.onMessage = function(fn)
  registered = fn
end
_G.WOWC_TEST_LAST_FRAME:Fire("OnEvent", "ADDON_LOADED", "WoWCompanion")
assert(
  registered == ns.Core.dispatch,
  "ADDON_LOADED registers the dispatcher through ns.Transport.onMessage, per slice 13's registration contract"
)

local ASK_ID_PATTERN = "^[A-Za-z0-9_-]+$"
local firstAsk = ns.AiWindow.submitAsk("first")
local secondAsk = ns.AiWindow.submitAsk("second")
assert(firstAsk ~= secondAsk, "two asks in one load never share an id")
assert(firstAsk:match(ASK_ID_PATTERN) and #firstAsk <= 64, "an ask id stays within [A-Za-z0-9_-]{1,64}")

local function loadFresh(sessionToken)
  local fresh = {}
  fresh.Transport = { sent = {} }
  fresh.Transport.send = function(msg)
    table.insert(fresh.Transport.sent, msg)
  end
  fresh.Transport.session = function()
    return sessionToken
  end
  assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", fresh)
  fresh.AiWindow.create()
  return fresh
end

local reloaded = loadFresh("sessionB")
local reloadedAsk = reloaded.AiWindow.submitAsk("first")
assert(reloadedAsk ~= firstAsk, "the first ask of a new load never reuses an ask id of the previous load")
local secondLoadAsk = loadFresh("sessionD").AiWindow.submitAsk("first")
assert(secondLoadAsk ~= reloadedAsk, "two loads with the same ask counter never mint the same ask id")
local oddSession = loadFresh(string.rep("x y!", 30))
local oddAsk = oddSession.AiWindow.submitAsk("first")
assert(oddAsk:match(ASK_ID_PATTERN) and #oddAsk <= 64, "a session token with odd characters or length still gives a valid ask id")

ns.Core.dispatch({ t = "reply", id = "before-reload", chat = "default", provider = "claude", summary = "shown once", full = "shown once" })
local reloadedAgain = loadFresh("sessionC")
reloadedAgain.AiWindow.onReply({ t = "reply", id = "before-reload", chat = "default", provider = "claude", summary = "shown once", full = "shown once" })
assert(
  #reloadedAgain.AiWindow.scrollFrame.messages == 0,
  "a reply re-queued after a reload, already shown before it, is not printed again"
)
reloadedAgain.AiWindow.onReply({ t = "reply", id = "after-reload", chat = "default", provider = "claude", summary = "new", full = "new" })
assert(#reloadedAgain.AiWindow.scrollFrame.messages == 1, "a reply not shown before the reload still prints")

print("ai.route: all assertions passed")
