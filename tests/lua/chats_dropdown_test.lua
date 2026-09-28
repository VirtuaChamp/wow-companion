dofile("tests/lua/wow_stubs.lua")

local NOW = 1000000
_G.WOWC_TEST_SERVER_TIME = NOW

local ns = {}
ns.Transport = { sent = {} }
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end

local settingsChatsCalls = {}
local settingsErrorCalls = {}
ns.Settings = {
  onChats = function(msg)
    table.insert(settingsChatsCalls, msg)
  end,
  onError = function(msg)
    table.insert(settingsErrorCalls, msg)
  end,
  onOptions = function() end,
}

local aiWindowChunk = assert(loadfile("addon/WoWCompanion/AiWindow.lua"))
aiWindowChunk("WoWCompanion", ns)
local coreChunk = assert(loadfile("addon/WoWCompanion/Core.lua"))
coreChunk("WoWCompanion", ns)

ns.AiWindow.create()

ns.Core.dispatch({
  t = "chats",
  active = "chat-1",
  list = {
    { id = "chat-1", name = "Gearing up", provider = "claude", lastAt = NOW - 7200, running = false, unread = 0 },
    { id = "chat-2", name = "Leveling plan", provider = "codex", lastAt = NOW - 120, running = true, unread = 1 },
  },
})

assert(#settingsChatsCalls == 1, "Core dispatches chats to ns.Settings.onChats as well as the window")

local chatsDropdown = _G.WoWCompanionAiWindowChats
assert(chatsDropdown ~= nil, "the chats dropdown is created")
assert(chatsDropdown:GetText() == "Gearing up", "the dropdown label is the active chat name")
assert(chatsDropdown.menuButtons ~= nil and #chatsDropdown.menuButtons >= 3, "entries built: New chat plus every chat")
assert(chatsDropdown.menuButtons[1].text == "New chat", "the first entry is New chat")

local firstEntryButton = chatsDropdown.menuButtons[2]
assert(firstEntryButton.text:find("Leveling plan", 1, true) ~= nil, "newest chat (lastAt 2) sorts before the older one")
assert(firstEntryButton.text:find("Codex", 1, true) ~= nil, "the provider label is shown")
assert(firstEntryButton.text:find("(1)", 1, true) ~= nil, "the unread count is shown")
assert(firstEntryButton.text:find("2m", 1, true) ~= nil, "the relative age is computed in seconds against GetServerTime")
assert(chatsDropdown.menuButtons[3].text:find("2h", 1, true) ~= nil, "a chat two hours old reads 2h")
assert(ns.AiWindow.relativeLabel(1000, 2000) == "0s", "a lastAt ahead of the server time never shows a negative age")
assert(ns.AiWindow.relativeLabel(1000, 400) == "10m", "relativeLabel works in whole seconds")
assert(firstEntryButton.text:find("\226\151\143", 1, true) ~= nil, "a running marker is shown for the running chat")

local pickChat2 = chatsDropdown.menuButtons[2]
assert(pickChat2.text:find("Leveling plan", 1, true) ~= nil, "the chat-2 entry is present")
assert(#pickChat2.children == 2, "the chat row carries a Rename and a Delete child")
assert(#chatsDropdown.menuButtons == 3, "the menu holds New chat plus one row per chat, not three rows per chat")

pickChat2:Pick()

assert(#ns.Transport.sent == 1, "picking a chat sends a command")
assert(ns.Transport.sent[1].t == "cmd", "the command message type is cmd")
assert(ns.Transport.sent[1].name == "open", "picking sends open")
assert(ns.Transport.sent[1].chat == "chat-2", "open is sent for the picked chat")
assert(
  chatsDropdown:GetText() == "Gearing up",
  "the dropdown label survives the client's own selection-text update after a pick"
)

local renameButton = pickChat2.children[1]
local deleteButton = pickChat2.children[2]
assert(renameButton.text == "Rename", "the first child of a chat row is Rename")
assert(deleteButton.text == "Delete", "the second child of a chat row is Delete")

renameButton:Pick()
assert(_G.WOWC_TEST_LAST_STATIC_POPUP.which == "WOWCOMPANION_RENAME_CHAT", "rename opens a confirm dialog")
local renamePopup = _G.WOWC_TEST_LAST_STATIC_POPUP
renamePopup.dialog:GetEditBox():SetText("New name")
renamePopup.info.OnAccept(renamePopup.dialog, renamePopup.data)
assert(ns.Transport.sent[#ns.Transport.sent].name == "rename", "confirming the rename dialog sends a rename command")
assert(ns.Transport.sent[#ns.Transport.sent].arg == "New name", "the new name is carried")
assert(ns.Transport.sent[#ns.Transport.sent].chat == "chat-2", "the rename targets the chat the row belongs to")

deleteButton:Pick()
assert(_G.WOWC_TEST_LAST_STATIC_POPUP.which == "WOWCOMPANION_DELETE_CHAT", "delete opens a confirm dialog")
local deletePopup = _G.WOWC_TEST_LAST_STATIC_POPUP
deletePopup.info.OnAccept(deletePopup.dialog, deletePopup.data)
assert(ns.Transport.sent[#ns.Transport.sent].name == "delete", "confirming the delete dialog sends a delete command")

ns.Core.dispatch({
  t = "history",
  chat = "chat-2",
  lines = {
    { who = "you", text = "any leveling tips", at = 1 },
    { who = "claude", text = "Try the coastal quests first.", at = 2 },
  },
})

assert(#ns.AiWindow.scrollFrame.messages == 2, "picking a chat reprints its history")
assert(
  ns.AiWindow.scrollFrame.messages[2].text:find("coastal quests", 1, true) ~= nil,
  "history line content is carried"
)
assert(chatsDropdown:GetText() == "Leveling plan", "the label follows the chat the history belongs to")
chatsDropdown:CloseMenu()
assert(chatsDropdown:GetText() == "Leveling plan", "closing the menu keeps the active chat name as the label")

ns.Core.dispatch({
  t = "reply",
  id = "ask-9",
  chat = "chat-1",
  provider = "claude",
  summary = "not shown",
  full = "not shown",
})

local messagesBeforeDuplicate = #ns.AiWindow.scrollFrame.messages
local lastMessage = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text
assert(lastMessage:find("replied", 1, true) ~= nil, "a reply for a chat not shown prints a notice")
assert(lastMessage:find("[open]", 1, true) ~= nil, "the notice offers to open the reply")

ns.Core.dispatch({
  t = "reply",
  id = "ask-9",
  chat = "chat-1",
  provider = "claude",
  summary = "not shown",
  full = "not shown",
})
assert(
  #ns.AiWindow.scrollFrame.messages == messagesBeforeDuplicate,
  "the same reply id delivered twice prints its notice once"
)

local openLink = lastMessage:match("|H(addon:[^|]+)|h")
assert(openLink ~= nil, "the [open] notice carries a real addon hyperlink")

ns.Transport.sent = {}
ns.AiWindow.scrollFrame:Fire("OnHyperlinkClick", openLink, "[open]", "LeftButton")
assert(#ns.Transport.sent == 1, "clicking [open] sends a command")
assert(ns.Transport.sent[1].t == "cmd", "clicking [open] sends a cmd message")
assert(ns.Transport.sent[1].name == "open", "clicking [open] asks to open the chat")
assert(ns.Transport.sent[1].chat == "chat-1", "clicking [open] targets the chat the reply belongs to")

local optionsCalls = {}
ns.Settings.onOptions = function(msg)
  table.insert(optionsCalls, msg)
end
ns.Core.dispatch({ t = "options", active = { provider = "claude" } })
assert(#optionsCalls == 1, "Core dispatches options to ns.Settings.onOptions")

ns.Core.dispatch({ t = "error", code = "provider_missing" })
assert(#settingsErrorCalls == 1, "Core dispatches error to ns.Settings.onError as well as the window")

print("chats.dropdown: all assertions passed")
