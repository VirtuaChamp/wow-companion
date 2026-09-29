dofile("tests/lua/wow_stubs.lua")

local NOW = 1000000
_G.WOWC_TEST_SERVER_TIME = NOW

local ns = {}
ns.Transport = { sent = {} }
ns.Transport.session = function()
  return "sessionA"
end
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end

local settingsChatsCalls = {}
local settingsErrorCalls = {}
local settingsOptionsCalls = {}
ns.Settings = {
  onChats = function(msg)
    table.insert(settingsChatsCalls, msg)
  end,
  onError = function(msg)
    table.insert(settingsErrorCalls, msg)
  end,
  onOptions = function(msg)
    table.insert(settingsOptionsCalls, msg)
  end,
}

assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", ns)
assert(loadfile("addon/WoWCompanion/Core.lua"))("WoWCompanion", ns)

ns.AiWindow.create()
ns.AiWindow.messageBox:SetSize(400, 300)
local list = ns.AiWindow.sidebarBox
list:SetSize(120, 200)

local function rowAt(index)
  return list:GetVisibleFrames()[index]
end

ns.Core.dispatch({
  t = "chats",
  active = "chat-1",
  list = {
    { id = "chat-1", name = "Gearing up", provider = "claude", lastAt = NOW - 7200, running = false, unread = 0 },
    { id = "chat-2", name = "Leveling plan", provider = "codex", lastAt = NOW - 120, running = true, unread = 3 },
  },
})

assert(#settingsChatsCalls == 1, "Core dispatches chats to ns.Settings.onChats as well as the window")
assert(_G.WoWCompanionAiWindowChats == nil, "there is no chats dropdown any more")
assert(#list:GetVisibleFrames() == 2, "one row per chat")

local first, second = rowAt(1), rowAt(2)
assert(first.chat.id == "chat-2", "newest chat first (lastAt NOW - 120 before NOW - 7200)")
assert(second.chat.id == "chat-1", "the older chat comes second")
assert(first.title:GetText():find("Leveling plan", 1, true) ~= nil, "row line one is the chat title")
assert(first.title:GetText():find("\226\151\143", 1, true) == 1, "a running chat carries the running mark before its title")
assert(second.title:GetText() == "Gearing up", "an idle chat carries no running mark")
assert(first.sub:GetText() == "Codex \194\183 2m", "row line two is provider and relative age")
assert(second.sub:GetText() == "Claude \194\183 2h", "a chat two hours old reads 2h")
assert(first.unread:GetText() == "3", "the unread count is shown")
assert(second.unread:GetText() == "", "no unread count when there is none")
assert(first.title.wordWrap == false and first.sub.wordWrap == false, "long titles truncate instead of wrapping")
assert(second.selection:IsShown() == true, "the shown chat is highlighted")
assert(first.selection:IsShown() == false, "other chats are not highlighted")
assert(first.selection.atlas == "Options_List_Active", "the selection uses Blizzard's list selection atlas")
assert(first.highlightAtlas == "Options_List_Hover", "hovering uses Blizzard's list hover atlas")
assert(first.clickRegistrations[1] == "LeftButtonUp" and first.clickRegistrations[2] == "RightButtonUp", "rows register right clicks")
assert(ns.AiWindow.relativeLabel(1000, 2000) == "0s", "a lastAt ahead of the server time never shows a negative age")
assert(ns.AiWindow.relativeLabel(1000, 400) == "10m", "relativeLabel works in whole seconds")

ns.Transport.sent = {}
first:Fire("OnClick", "LeftButton")
assert(#ns.Transport.sent == 1, "left-click sends one command")
assert(ns.Transport.sent[1].t == "cmd" and ns.Transport.sent[1].name == "open", "left-click sends open")
assert(ns.Transport.sent[1].chat == "chat-2", "open targets the clicked chat")

ns.Transport.sent = {}
_G.WOWC_TEST_LAST_CONTEXT_MENU = nil
first:Fire("OnClick", "RightButton")
assert(#ns.Transport.sent == 0, "right-click does not open the chat")
local menu = _G.WOWC_TEST_LAST_CONTEXT_MENU
assert(menu ~= nil, "right-click opens a native context menu")
assert(menu.owner == first, "the menu belongs to the clicked row")
assert(#menu.buttons == 2, "the menu offers exactly two entries")
assert(menu.buttons[1].text == "Rename" and menu.buttons[2].text == "Delete", "the entries are Rename and Delete")

menu.buttons[1]:Pick()
local dialog = ns.AiWindow.chatDialog
assert(dialog ~= nil and dialog:IsShown(), "Rename opens the addon's own rename dialog")
assert(dialog.editBox:GetText() == "Leveling plan", "the dialog starts with the chat's current name")
dialog.editBox:SetText("New name")
dialog.accept:Fire("OnClick")
assert(ns.Transport.sent[#ns.Transport.sent].name == "rename", "confirming sends rename")
assert(ns.Transport.sent[#ns.Transport.sent].arg == "New name", "the new name is carried")
assert(ns.Transport.sent[#ns.Transport.sent].chat == "chat-2", "the rename targets the right-clicked chat")
assert(dialog:IsShown() == false, "the dialog closes after confirming")

menu.buttons[2]:Pick()
assert(dialog:IsShown() and dialog.accept:GetText() == "Delete", "Delete opens the same dialog in delete mode")
dialog.accept:Fire("OnClick")
assert(ns.Transport.sent[#ns.Transport.sent].name == "delete", "confirming sends delete")
assert(ns.Transport.sent[#ns.Transport.sent].chat == "chat-2", "the delete targets the right-clicked chat")

ns.Transport.sent = {}
ns.AiWindow.newChatButton:Fire("OnClick", "LeftButton")
assert(#ns.Transport.sent == 1 and ns.Transport.sent[1].name == "new", "New chat sends new")
assert(ns.Transport.sent[1].chat == "chat-2", "New chat is sent from the shown chat (chat-2 after the click above)")

ns.Core.dispatch({
  t = "history",
  chat = "chat-2",
  lines = { { who = "you", text = "any leveling tips", at = 1 } },
})
assert(rowAt(1).selection:IsShown() == true and rowAt(2).selection:IsShown() == false, "the highlight follows the chat the history belongs to")

local acquiredBefore = rowAt(1).acquireCount
ns.Core.dispatch({
  t = "chats",
  active = "chat-2",
  list = {
    { id = "chat-3", name = "Quest: Ever...", provider = "claude", lastAt = NOW, running = false, unread = 0 },
    { id = "chat-2", name = "Leveling plan", provider = "codex", lastAt = NOW - 100, running = false, unread = 0 },
    { id = "chat-1", name = "Gearing up", provider = "claude", lastAt = NOW - 7200, running = false, unread = 0 },
  },
})
assert(#list:GetVisibleFrames() == 3, "a new chat adds a row")
assert(rowAt(1).chat.id == "chat-3", "the newest chat moves to the top")
assert(rowAt(1).acquireCount == acquiredBefore + 1, "the row frames are reused from the pool, not rebuilt")
assert(rowAt(2).selection:IsShown() == true, "the shown chat stays highlighted after a chats update")
assert(rowAt(1).title:GetText() == "Quest: Ever...", "titles are shown as sent")

ns.Core.dispatch({
  t = "chats",
  active = "chat-2",
  list = { { id = "c9", name = "|Hitem:1|h[Bad]|h", provider = "claude", lastAt = NOW, running = false, unread = 0 } },
})
assert(rowAt(1).title:GetText():find("||H", 1, true) ~= nil, "a chat title with a raw WoW escape is sanitized")
assert(list.frames[2]:IsShown() == false, "rows beyond the list are released")

local many = {}
for i = 1, 30 do
  many[i] = { id = "m" .. i, name = "Chat " .. i, provider = "claude", lastAt = NOW - i, running = false, unread = 0 }
end
ns.Core.dispatch({ t = "chats", active = "m1", list = many })
assert(list:HasScrollableExtent() == true, "a long chat list scrolls")
assert(list.view.elementExtent == 38, "every chat row is a fixed two-line row, 38 px at the default text size (12 + 12 + 4 + 2 x 5)")

ns.Core.dispatch({ t = "chats", active = "chat-1", list = { { id = "chat-1", name = "Gearing up", provider = "claude", lastAt = NOW - 7200, running = false, unread = 0 }, { id = "chat-2", name = "Leveling plan", provider = "codex", lastAt = NOW - 120, running = false, unread = 0 } } })
ns.Core.dispatch({
  t = "reply",
  id = "ask-9",
  chat = "chat-2",
  provider = "codex",
  summary = "not shown",
  full = "not shown",
})

local entries = ns.AiWindow.entries()
local lastEntry = entries[#entries]
assert(lastEntry.kind == "line", "a reply for a chat not shown prints a line, not a bubble")
assert(lastEntry.display:find("Codex \194\183 Leveling plan", 1, true) ~= nil, "the notice names the provider and the chat")
assert(lastEntry.display:find("replied", 1, true) ~= nil, "the notice says the chat replied")
assert(lastEntry.display:find("[open]", 1, true) ~= nil, "the notice offers to open the reply")

local before = #entries
ns.Core.dispatch({ t = "reply", id = "ask-9", chat = "chat-2", provider = "codex", summary = "not shown", full = "not shown" })
assert(#ns.AiWindow.entries() == before, "the same reply id delivered twice prints its notice once")

local openLink = lastEntry.display:match("|H(addon:[^|]+)|h")
assert(openLink ~= nil, "the [open] notice carries a real addon hyperlink")
local noticeRow = ns.AiWindow.messageBox:GetVisibleFrames()[#entries]
assert(noticeRow.hyperlinksEnabled == true, "the frame that parents the notice text takes hyperlink clicks")
ns.Transport.sent = {}
noticeRow:Fire("OnHyperlinkClick", openLink, "[open]", "LeftButton")
assert(#ns.Transport.sent == 1 and ns.Transport.sent[1].name == "open", "clicking [open] sends open")
assert(ns.Transport.sent[1].chat == "chat-2", "clicking [open] targets the chat the reply belongs to")

ns.Core.dispatch({
  t = "chats",
  active = "chat-1",
  list = {
    { id = "chat-1", name = "Gearing up", provider = "claude", lastAt = NOW - 7200, running = false, unread = 0 },
    { id = "chat-2", name = "Leveling plan", provider = "codex", lastAt = NOW - 120, running = false, unread = 0 },
  },
})
local hoverRow = rowAt(1)
hoverRow:Fire("OnEnter")
assert(GameTooltip.owner == hoverRow and GameTooltip.shown == true, "hovering a row shows a native tooltip on it")
assert(GameTooltip.lines[1].text == "Leveling plan", "the tooltip starts with the full title")
assert(GameTooltip.lines[2].text == "Codex \194\183 2m", "then provider and age")
assert(GameTooltip.lines[3].text == "Right-click: rename or delete", "then the right-click hint")
hoverRow:Fire("OnLeave")
assert(GameTooltip.shown == false, "leaving the row hides the tooltip")

ns.AiWindow.show()
local tickers = _G.WOWC_TEST_TICKERS
assert(tickers ~= nil and #tickers == 1, "showing the window starts one age ticker")
assert(tickers[1].seconds >= 30 and tickers[1].seconds <= 60, "the ticker runs every 30 to 60 seconds")
assert(rowAt(1).sub:GetText() == "Codex \194\183 2m", "the age reads two minutes before the tick")
_G.WOWC_TEST_SERVER_TIME = NOW + 3600
tickers[1].callback()
assert(rowAt(1).sub:GetText() == "Codex \194\183 1h", "a tick refreshes the age labels while the window stays open")
ns.AiWindow.hide()
assert(tickers[1].cancelled == true, "hiding the window cancels the ticker")
ns.AiWindow.show()
assert(#tickers == 2 and tickers[2].cancelled == false, "showing it again starts a new ticker")
ns.AiWindow.show()
assert(#tickers == 2, "showing an already shown window does not start a second ticker")
_G.WOWC_TEST_SERVER_TIME = NOW

ns.Core.dispatch({ t = "options", active = { provider = "claude" } })
assert(#settingsOptionsCalls == 1, "Core dispatches options to ns.Settings.onOptions")
ns.Core.dispatch({ t = "error", code = "provider_missing" })
assert(#settingsErrorCalls == 1, "Core dispatches error to ns.Settings.onError as well as the window")

print("chats.sidebar: all assertions passed")
