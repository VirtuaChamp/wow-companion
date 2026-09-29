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
ns.Settings = { onChats = function() end, onError = function() end, onOptions = function() end }

assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", ns)
assert(loadfile("addon/WoWCompanion/Core.lua"))("WoWCompanion", ns)
ns.AiWindow.create()

local messages = ns.AiWindow.messageBox
local chats = ns.AiWindow.sidebarBox
messages:SetSize(400, 100)
chats:SetSize(120, 100)

assert(messages.scrollBarBehavior ~= nil, "the message list's bar uses Blizzard's managed visibility behaviour")
assert(chats.scrollBarBehavior ~= nil, "so does the chat list's bar")
assert(messages.scrollBar.name == "WoWCompanionAiWindowMessagesBar", "the message list bar is the one created for it")

local function bottomRight(box)
  local anchor = box.points.BOTTOMRIGHT
  return anchor.relativeTo, anchor.x
end

ns.Core.dispatch({ t = "history", chat = "default", lines = { { who = "you", text = "short", at = 1 } } })
assert(messages:HasScrollableExtent() == false, "one short line fits the list")
assert(messages.scrollBar:IsShown() == false, "the message bar is hidden when the content fits")
local inset, withoutX = bottomRight(messages)
assert(inset == ns.AiWindow.frame.Inset and withoutX == -8, "without the bar the list runs to the inset with 8 px padding, using the freed width")

local lines = {}
for i = 1, 20 do
  lines[i] = { who = i % 2 == 0 and "claude" or "you", text = "line number " .. i, at = i }
end
ns.Core.dispatch({ t = "history", chat = "default", lines = lines })
assert(messages:HasScrollableExtent() == true, "twenty lines overflow a 100 px list")
assert(messages.scrollBar:IsShown() == true, "the message bar shows when the content overflows")
local _, withX = bottomRight(messages)
assert(withX == -16, "with the bar the list stops 16 px short of the inset to leave room for it")
assert(messages.points.TOPLEFT.relativeTo == ns.AiWindow.sidebar, "the top left anchor stays on the sidebar")

ns.Core.dispatch({ t = "history", chat = "default", lines = { { who = "you", text = "again short", at = 99 } } })
assert(messages.scrollBar:IsShown() == false, "the bar hides again when the content shrinks")
assert(select(2, bottomRight(messages)) == -8, "and the list takes the freed width back")

ns.Core.dispatch({ t = "chats", active = "default", list = { { id = "default", name = "Default", provider = "claude", lastAt = NOW, running = false, unread = 0 } } })
assert(chats:HasScrollableExtent() == false, "one chat fits the sidebar list")
assert(chats.scrollBar:IsShown() == false, "the chat bar is hidden when the chats fit")
local sidebar = ns.AiWindow.sidebar
assert(chats.points.BOTTOMRIGHT.relativeTo == sidebar and chats.points.BOTTOMRIGHT.x == -6, "without the bar the chat list uses the whole sidebar width")
assert(chats.points.TOPLEFT.relativeTo == ns.AiWindow.newChatButton, "the chat list stays under the New chat button")

local many = {}
for i = 1, 12 do
  many[i] = { id = "c" .. i, name = "Chat " .. i, provider = "claude", lastAt = NOW - i, running = false, unread = 0 }
end
ns.Core.dispatch({ t = "chats", active = "c1", list = many })
assert(chats:HasScrollableExtent() == true, "twelve chats overflow the list")
assert(chats.scrollBar:IsShown() == true, "the chat bar shows when the chats overflow")
assert(chats.points.BOTTOMRIGHT.x == -14, "with the bar the chat list leaves 14 px for it")

ns.Core.dispatch({ t = "chats", active = "c1", list = { many[1] } })
assert(chats.scrollBar:IsShown() == false and chats.points.BOTTOMRIGHT.x == -6, "the chat bar hides and the width returns when chats are deleted")

print("scroll.bars: all assertions passed")
