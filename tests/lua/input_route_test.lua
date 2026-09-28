dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {} }
ns.Transport.session = function()
  return "sessionA"
end
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end
local settingsOpenCalls = 0
ns.Settings = {
  onChats = function() end,
  onError = function() end,
  onOptions = function() end,
  open = function()
    settingsOpenCalls = settingsOpenCalls + 1
  end,
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

local popupFrame = ns.AiWindow.popupFrame
local rows = popupFrame.rows
assert(popupFrame:IsShown(), "the popup frame is shown when there are matches")
assert(rows[1].text:GetText() == "Bagged Trinket", "the top match fills the first row")
local quality = ITEM_QUALITY_COLORS[3].color
assert(
  rows[1].text.textColor.r == quality.r and rows[1].text.textColor.g == quality.g and rows[1].text.textColor.b == quality.b,
  "an item row takes its item-quality colour"
)
assert(rows[1].icon:IsShown() == false, "an item row carries no quest icon")
assert(rows[1].highlight:IsShown(), "the selected row shows the Blizzard highlight texture")
assert(rows[#popup1.items + 1].text:IsShown() == false, "rows beyond the matches are hidden")
assert(popupFrame:GetHeight() == #popup1.items * 16 + 12, "the popup is as tall as its matches, not always eight rows")
local ghost = ns.AiWindow.ghostText
assert(ghost:GetText() == "gged Trinket", "the ghost shows only the untyped remainder of the top match")
local _, ghostRelative, _, ghostX = ghost:GetPoint(1)
assert(ghostRelative == input, "the ghost sits inside the input line, not above the popup")
assert(ghostX == 10 + 3 * 6, "the ghost starts after the typed text: text inset plus the width of '@Ba'")

_G.WOWC_TEST_SET_ITEM_INFO(2001, nil)
input:SetText("@Ba")
input:Fire("OnTextChanged", true)
assert(
  ns.AiWindow.popupFrame.rows[1].text.textColor.r == 1,
  "an item whose quality is not cached yet falls back to the normal colour"
)
_G.WOWC_TEST_SET_ITEM_INFO(2001, {
  name = "Bag Item",
  quality = 3,
  itemLevel = 15,
  requiredLevel = 8,
  equipLoc = "INVTYPE_TRINKET",
  classId = 7,
  subClassId = 4,
})
input:SetText("@Ba")
input:Fire("OnTextChanged", true)

input:SetText("@Sim")
input:Fire("OnTextChanged", true)
assert(rows[1].text:GetText() == "A Simple Task", "a quest whose name contains the query is offered")
assert(rows[1].icon:IsShown() and rows[1].icon.atlas == "QuestNormal", "a quest row carries the quest icon")
assert(ghost:GetText() == "", "a match that does not start with the query has no ghost remainder")
input:SetText("@Ba")
input:Fire("OnTextChanged", true)

input:Fire("OnArrowPressed", "DOWN")
assert(ns.AiWindow.popup.selected == math.min(2, #popup1.items), "Down moves the popup selection forward")
input:Fire("OnArrowPressed", "UP")
assert(ns.AiWindow.popup.selected == 1, "Up moves the popup selection back")

input:Fire("OnEscapePressed")
assert(ns.AiWindow.popup == nil, "Esc closes the popup without touching the typed text")
assert(ghost:GetText() == "", "Esc clears the ghost text")
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
assert(ghost:GetText() == "ttings", "the sub-command ghost shows the untyped remainder")
local _, _, _, subGhostX = ghost:GetPoint(1)
assert(subGhostX == 10 + 6 * 6, "the sub-command ghost starts after '/ai se'")
input:Fire("OnTabPressed")
assert(input:GetText() == "/ai settings ", "Tab completes the /ai sub-command ghost text")

ns.Transport.sent = {}
input:Fire("OnEnterPressed")
assert(#ns.Transport.sent == 0, "an accepted /ai sub-command routes through Core, not as a plain ask")
assert(settingsOpenCalls == 1, "an accepted /ai settings typed in the input line opens the settings panel")
assert(input:GetText() == "", "the input line clears after the routed command")

input:SetText("@zzzzzz-no-match")
input:Fire("OnTextChanged", true)
assert(ns.AiWindow.popup == nil, "a query with no match closes the popup instead of showing an empty one")

ns.Transport.sent = {}
input:Fire("OnEnterPressed")
assert(#ns.Transport.sent == 1, "with no popup open, Enter sends the literal text")
assert(ns.Transport.sent[1].text == "@zzzzzz-no-match", "unmatched @ text is sent literally, not swallowed")

ns.AiWindow.onChats({
  active = "chat-1",
  list = {
    { id = "chat-1", name = "Gearing up", provider = "claude", lastAt = 1 },
    { id = "chat-2", name = "Leveling plan", provider = "codex", lastAt = 2 },
    { id = "chat-3", name = "Gearing later", provider = "claude", lastAt = 3 },
  },
})

input:SetText("/ai ch")
input:Fire("OnTextChanged", true)
assert(ns.AiWindow.popup.kind == "sub", "a partial sub-command still offers sub-command names")
input:Fire("OnTabPressed")
assert(input:GetText() == "/ai chat ", "Tab completes the chat sub-command")
assert(ns.AiWindow.popup ~= nil and ns.AiWindow.popup.kind == "chat", "completing chat offers the chat names straight away")
assert(#ns.AiWindow.popup.items == 3, "an empty chat query lists every chat")
assert(ns.AiWindow.popup.items[1].name == "Gearing later", "chat names are offered newest first")

input:SetText("/ai chat Gear")
input:Fire("OnTextChanged", true)
assert(ns.AiWindow.popup.kind == "chat", "typing after /ai chat completes chat names")
assert(#ns.AiWindow.popup.items == 2, "only chats matching the typed name are offered")
assert(ns.AiWindow.popup.items[1].name == "Gearing later" and ns.AiWindow.popup.items[2].name == "Gearing up", "matches keep the newest-first order")
assert(ns.AiWindow.ghostText:GetText() == "ing later", "the chat-name ghost shows the untyped remainder of the top match")
input:Fire("OnArrowPressed", "DOWN")
ns.Transport.sent = {}
input:Fire("OnTabPressed")
assert(#ns.Transport.sent == 1, "accepting a chat name sends one command")
assert(ns.Transport.sent[1].t == "cmd" and ns.Transport.sent[1].name == "open", "accepting a chat name sends open")
assert(ns.Transport.sent[1].chat == "chat-1", "the picked name resolves to its chat id, not the name")
assert(input:GetText() == "", "accepting a chat name clears the input line")
assert(ns.AiWindow.popup == nil, "accepting a chat name closes the popup")

input:SetText("/ai chat plan")
input:Fire("OnTextChanged", true)
assert(#ns.AiWindow.popup.items == 1 and ns.AiWindow.popup.items[1].chatId == "chat-2", "a name containing the query is offered with its chat id")
assert(ns.AiWindow.ghostText:GetText() == "", "a contained match has no ghost remainder")

input:SetText("/ai chat zzz")
input:Fire("OnTextChanged", true)
assert(ns.AiWindow.popup == nil, "no chat name matching closes the popup")

input:SetText("/ai chat Level")
input:Fire("OnTextChanged", true)
ns.Transport.sent = {}
input:Fire("OnEnterPressed")
assert(#ns.Transport.sent == 1 and ns.Transport.sent[1].chat == "chat-2", "Enter accepts the chat name and opens that chat")

print("input.route: all assertions passed")
