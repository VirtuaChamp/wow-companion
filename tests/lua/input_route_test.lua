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
local mentionChunk = assert(loadfile("addon/WoWCompanion/Mention.lua"))
mentionChunk("WoWCompanion", ns)
local coreChunk = assert(loadfile("addon/WoWCompanion/Core.lua"))
coreChunk("WoWCompanion", ns)

ns.AiWindow.create()
local input = _G.WoWCompanionAiWindowInput
assert(input ~= nil, "the Claude window's own input line is created")

input:SetText("what should I do next")
input:Fire("OnEnterPressed")

assert(#ns.Transport.sent == 1, "text typed in the input line reaches the companion")
assert(ns.Transport.sent[1].t == "ask", "typed text is sent as an ask")
assert(ns.Transport.sent[1].text == "what should I do next", "the exact typed text is carried")
assert(input:GetText() == "", "the input line clears once the ask is sent")

ns.Transport.sent = {}
input:SetText("/r hello whisper friend")
input:Fire("OnEnterPressed")

assert(#ns.Transport.sent == 1, "/r typed in the input line is sent like any other text")
assert(ns.Transport.sent[1].t == "ask", "/r never triggers a different message shape")
assert(
  ns.Transport.sent[1].text == "/r hello whisper friend",
  "/r is never redirected: the text is carried verbatim, not intercepted"
)

-- The point everything turns on: the @ popup, ghost text and key handling.

input:SetText("@Ba")
input:Fire("OnTextChanged", true)
local popup1 = ns.AiWindow.popup
assert(popup1 ~= nil, "a mention query with matches opens the popup")
assert(#popup1.items >= 1, "at least one candidate matches the query")

input:Fire("OnArrowPressed", "DOWN")
assert(ns.AiWindow.popup.selected == math.min(2, #popup1.items), "Down moves the popup selection forward")
input:Fire("OnArrowPressed", "UP")
assert(ns.AiWindow.popup.selected == 1, "Up moves the popup selection back")

input:Fire("OnEscapePressed")
assert(ns.AiWindow.popup == nil, "Esc closes the popup without touching the typed text")
assert(input:GetText() == "@Ba", "Esc leaves the typed text untouched")

input:SetText("@Ba")
input:Fire("OnTextChanged", true)
ns.Transport.sent = {}
input:Fire("OnEnterPressed")
assert(#ns.Transport.sent == 0, "Enter with an open popup accepts it instead of sending the raw typed text")
assert(input:GetText():find("@[", 1, true) ~= nil, "Enter accepts the popup and inserts the mention token")
assert(ns.AiWindow.popup == nil, "Enter closes the popup after accepting it")

input:SetText("@Ba")
input:Fire("OnTextChanged", true)
input:Fire("OnTabPressed")
assert(ns.AiWindow.popup == nil, "Tab accepts the popup and closes it")
assert(input:GetText():find("@[", 1, true) ~= nil, "Tab inserts the @[Name] mention token")

ns.Transport.sent = {}
input:Fire("OnEnterPressed")
assert(#ns.Transport.sent == 1, "Enter after accepting a mention sends the ask")
assert(#ns.Transport.sent[1].mentions == 1, "the mentions array carries the picked candidate")

input:SetText("/ai se")
input:Fire("OnTextChanged", true)
assert(ns.AiWindow.popup ~= nil, "a matching /ai sub-command opens the popup")
input:Fire("OnTabPressed")
assert(input:GetText() == "/ai settings ", "Tab completes the /ai sub-command ghost text")

ns.Transport.sent = {}
input:Fire("OnEnterPressed")
assert(#ns.Transport.sent == 0, "an accepted /ai sub-command routes through Core, not as a plain ask")

input:SetText("@zzzzzz-no-match")
input:Fire("OnTextChanged", true)
assert(ns.AiWindow.popup == nil, "a query with no match closes the popup instead of showing an empty one")

ns.Transport.sent = {}
input:Fire("OnEnterPressed")
assert(#ns.Transport.sent == 1, "with no popup open, Enter sends the literal text")
assert(ns.Transport.sent[1].text == "@zzzzzz-no-match", "unmatched @ text is sent literally, not swallowed")

print("input.route: all assertions passed")
