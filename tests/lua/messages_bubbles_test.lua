dofile("tests/lua/wow_stubs.lua")

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
local box = ns.AiWindow.messageBox
box:SetSize(400, 200)

local function flushTimers()
  local callbacks = _G.WOWC_TEST_TIMER_CALLBACKS or {}
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  for _, entry in ipairs(callbacks) do
    entry.callback()
  end
end

local function rowAt(index)
  return box:GetVisibleFrames()[index]
end

ns.Core.dispatch({
  t = "chats",
  active = "default",
  list = { { id = "default", name = "Default", provider = "codex", lastAt = 1, running = false, unread = 0 } },
})

local LONG = string.rep("word ", 80)
ns.Core.dispatch({
  t = "history",
  chat = "default",
  lines = {
    { who = "you", text = "where is the flight master in Ironforge?", at = 1 },
    { who = "codex", text = "Gryth Thurden stands at the Great Forge.", at = 2 },
    { who = "you", text = LONG, at = 3 },
    { who = "codex", text = LONG, at = 4 },
  },
})

local entries = ns.AiWindow.entries()
assert(#entries == 4, "history fills the list, one element per line")
assert(entries[1].kind == "user" and entries[2].kind == "ai", "the user's lines are user bubbles, the provider's are AI bubbles")
assert(entries[2].provider == "codex", "an AI bubble remembers which provider spoke")

local userRow, aiRow, longUserRow, longAiRow = rowAt(1), rowAt(2), rowAt(3), rowAt(4)

assert(userRow.bubble.template == "TooltipBackdropTemplate", "a bubble is a Blizzard TooltipBackdropTemplate frame")
assert(userRow.bubble.points.TOPRIGHT ~= nil and userRow.bubble.points.TOPLEFT == nil, "the user's bubble hangs from the right edge")
assert(userRow.bubble.points.TOPRIGHT.relativeTo == userRow and userRow.bubble.points.TOPRIGHT.x < 0, "the user's bubble is inset from the right edge of its row")
assert(aiRow.bubble.points.TOPLEFT ~= nil and aiRow.bubble.points.TOPRIGHT == nil, "the AI's bubble hangs from the left edge")
assert(aiRow.bubble.points.TOPLEFT.relativeTo == aiRow and aiRow.bubble.points.TOPLEFT.x > 0, "the AI's bubble is inset from the left edge of its row")

local grayR = GRAY_FONT_COLOR:GetRGB()
local tooltipR = TOOLTIP_DEFAULT_BACKGROUND_COLOR:GetRGB()
assert(aiRow.bubble.backdropColor.r == tooltipR and aiRow.bubble.backdropColor.a == 1, "the AI's bubble takes the tooltip background: the darker tint")
assert(userRow.bubble.backdropColor.r == grayR and userRow.bubble.backdropColor.a < 1, "the user's bubble takes Blizzard's grey constant at partial alpha: the lighter tint")
assert(userRow.bubble.backdropColor.r > aiRow.bubble.backdropColor.r, "the user's tint colour is lighter than the AI's")

assert(aiRow.who:IsShown() == true and aiRow.who:GetText() == "Codex", "the AI's provider name shows under its bubble")
local whoPoint = aiRow.who.points.TOPLEFT
assert(whoPoint.relativeTo == aiRow.bubble and whoPoint.relativePoint == "BOTTOMLEFT", "the provider name sits under the bubble, left aligned")
local gr, gg, gb = GRAY_FONT_COLOR:GetRGB()
assert(
  aiRow.who.textColor.r == gr and aiRow.who.textColor.g == gg and aiRow.who.textColor.b == gb,
  "the provider name is small grey text from Blizzard's grey constant"
)
assert(aiRow.who.template == "GameFontNormalSmall", "the provider name uses a small Blizzard font")
assert(userRow.who:IsShown() == false, "the user's bubble carries no name")

assert(userRow.bubble.text:GetText() == "where is the flight master in Ironforge?", "the bubble shows the line's text")
assert(userRow.bubble.text.template == "GameFontHighlightSmall", "bubble text uses a Blizzard font")

local maxBubble = math.floor(400 * 0.75)
assert(longUserRow.bubble:GetWidth() <= maxBubble, "a long bubble stays within 75% of the list width")
assert(longAiRow.bubble:GetWidth() <= maxBubble, "a long AI bubble stays within 75% of the list width")
assert(userRow.bubble:GetWidth() < maxBubble, "a short bubble shrinks to its text")
assert(longAiRow.bubble.text:GetWidth() == longAiRow.bubble:GetWidth() - 16, "the text wraps inside the bubble's padding")
assert(rowAt(4).bubble:GetHeight() > rowAt(2).bubble:GetHeight(), "a wrapped bubble is taller: variable height")
assert(longAiRow:GetHeight() == longAiRow.bubble:GetHeight(), "the element extent is the bubble's height")
assert(userRow:GetHeight() == userRow.bubble:GetHeight(), "the element extent of a short bubble follows its text")
assert(box.view.spacing >= 12, "the spacing leaves room for the name under each bubble")

assert(box.scrollPercentage == 1 and box.scrollEndCalls >= 1, "a filled history is shown from its end")

ns.AiWindow.messageBox:SetSize(400, 200)
local scrollEndBefore = box.scrollEndCalls
ns.Core.dispatch({ t = "reply", id = "ask-1", chat = "default", provider = "codex", summary = "hi back", full = "hi back" })
assert(#ns.AiWindow.entries() == 5, "a reply adds one bubble")
assert(box.scrollEndCalls == scrollEndBefore + 1, "the list follows a new message when the user is at the end")
assert(rowAt(5).bubble.points.TOPLEFT ~= nil, "a live reply is an AI bubble on the left")
assert(rowAt(5).bubble:GetWidth() < userRow.bubble:GetWidth(), "a shorter text gives a narrower bubble")

box:SetScrollPercentage(0.4)
scrollEndBefore = box.scrollEndCalls
ns.Core.dispatch({ t = "reply", id = "ask-2", chat = "default", provider = "codex", summary = "another", full = "another" })
assert(#ns.AiWindow.entries() == 6, "the message still arrives")
assert(box.scrollEndCalls == scrollEndBefore, "the list does not jump when the user scrolled up")
assert(box.scrollPercentage == 0.4, "the scroll position is left alone")

box:SetScrollPercentage(1)
ns.Transport.sent = {}
local askId = ns.AiWindow.submitAsk("my question")
assert(askId ~= nil, "the ask is sent")
local sentEntries = ns.AiWindow.entries()
assert(sentEntries[#sentEntries].kind == "user" and sentEntries[#sentEntries].display == "my question", "the typed question shows as the user's bubble")
assert(rowAt(#sentEntries).bubble.points.TOPRIGHT ~= nil, "the question bubble is on the right")

ns.Core.dispatch({ t = "progress", chat = "default", id = askId, status = "thinking" })
local afterProgress = ns.AiWindow.entries()
local status = afterProgress[#afterProgress]
assert(status.kind == "status", "progress is a status line, not a bubble")
assert(status.display == "Codex \194\183 thinking\226\128\166", "the status line says who is thinking")
local statusRow = rowAt(#afterProgress)
assert(statusRow.bubble:IsShown() == false and statusRow.line:IsShown() == true, "a status line draws text without a bubble")
assert(statusRow.line.textColor.r == gr, "the status line is grey")

ns.Core.dispatch({ t = "progress", chat = "default", id = askId, status = "tool", detail = "find_npc" })
local afterTool = ns.AiWindow.entries()
assert(#afterTool == #afterProgress, "a second progress replaces the first instead of stacking")
assert(afterTool[#afterTool].display == "Codex \194\183 looking up an NPC\226\128\166", "the replacement uses the plain phrase for the tool")

ns.Core.dispatch({ t = "reply", id = askId, chat = "default", provider = "codex", summary = "done", full = "done" })
local afterReply = ns.AiWindow.entries()
for _, entry in ipairs(afterReply) do
  assert(entry.kind ~= "status", "the status line is gone when the reply arrives")
end
assert(afterReply[#afterReply].kind == "ai" and afterReply[#afterReply].display == "done", "the reply takes the status line's place")

local secondAsk = ns.AiWindow.submitAsk("second question")
ns.Core.dispatch({ t = "progress", chat = "default", id = secondAsk, status = "thinking" })
ns.Core.dispatch({ t = "error", id = secondAsk, code = "provider_failed", message = "x" })
for _, entry in ipairs(ns.AiWindow.entries()) do
  assert(entry.kind ~= "status", "an error for the ask removes its status line too")
end

local elsewhere = ns.AiWindow.submitAsk("in the default chat")
ns.Core.dispatch({
  t = "history",
  chat = "other",
  lines = {},
})
local countBefore = #ns.AiWindow.entries()
ns.Core.dispatch({ t = "progress", chat = "default", id = elsewhere, status = "thinking" })
assert(#ns.AiWindow.entries() == countBefore, "progress of an ask from a chat that is not shown is not printed")

ns.Core.dispatch({ t = "history", chat = "default", lines = { { who = "you", text = "only **typed**", at = 1 } } })
assert(#ns.AiWindow.entries() == 1, "history replaces the list content")
assert(box.frames[2]:IsShown() == false, "frames beyond the new content are released")
assert(box.scrollEndCalls > scrollEndBefore, "a history load scrolls to its end")

ns.Core.dispatch({ t = "reply", id = "ask-long", chat = "default", provider = "codex", summary = "short summary", full = LONG })
local longEntries = ns.AiWindow.entries()
local longEntry = longEntries[#longEntries]
assert(longEntry.display == LONG, "the bubble shows the reply's full text, never the summary")
assert(longEntry.display:find("short summary", 1, true) == nil, "the summary is not shown")
assert(longEntry.display:find("[more]", 1, true) == nil, "there is no [more] link on a long reply")
assert(longEntry.full == LONG, "the bubble remembers the full text for the copy menu")
local longBubble = rowAt(#longEntries).bubble
assert(longBubble.text:GetText() == LONG, "the font string carries the full text")

_G.WOWC_TEST_LAST_CONTEXT_MENU = nil
longBubble:Fire("OnMouseUp", "LeftButton")
assert(_G.WOWC_TEST_LAST_CONTEXT_MENU == nil, "a left click on a bubble opens nothing")
longBubble:Fire("OnMouseUp", "RightButton")
local copyMenu = _G.WOWC_TEST_LAST_CONTEXT_MENU
assert(copyMenu ~= nil and copyMenu.owner == longBubble, "right-click on an AI bubble opens a native context menu")
assert(#copyMenu.buttons == 1 and copyMenu.buttons[1].text == "Copy text", "the menu offers Copy text")
copyMenu.buttons[1]:Pick()
assert(ns.AiWindow.copyBoxEditBox:GetText() == LONG, "Copy text opens the copy box with the reply's full text")

_G.WOWC_TEST_LAST_CONTEXT_MENU = nil
rowAt(1).bubble:Fire("OnMouseUp", "RightButton")
assert(_G.WOWC_TEST_LAST_CONTEXT_MENU ~= nil and _G.WOWC_TEST_LAST_CONTEXT_MENU.buttons[1].text == "Copy text", "the user's own bubble can be copied too")
_G.WOWC_TEST_LAST_CONTEXT_MENU.buttons[1]:Pick()
assert(ns.AiWindow.copyBoxEditBox:GetText() == "only **typed**", "the user's text opens in the copy box as written")

for _, bubble in ipairs({ rowAt(1).bubble, longBubble }) do
  bubble:Fire("OnEnter")
  assert(GameTooltip.owner == bubble and GameTooltip.shown == true, "hovering any bubble shows a tooltip on it")
  assert(GameTooltip.lines[1].text == "Right-click: copy text", "the tooltip says how to copy")
  bubble:Fire("OnLeave")
  assert(GameTooltip.shown == false, "leaving the bubble hides the tooltip")
end

ns.Core.dispatch({ t = "reply", id = "ask-w", chat = "default", provider = "codex", summary = "waypoint set", full = "waypoint set", waypoint = { label = "Forge", x = 10, y = 20, uiMapId = 84 } })
ns.Waypoint = { set = function() return true end }
ns.Core.dispatch({ t = "reply", id = "ask-w2", chat = "default", provider = "codex", summary = "waypoint again", full = "waypoint again", waypoint = { label = "Forge", x = 10, y = 20, uiMapId = 84 } })
local waypointEntries = ns.AiWindow.entries()
local waypointLine = waypointEntries[#waypointEntries]
assert(waypointLine.kind == "line" and waypointLine.display:find("Forge", 1, true) ~= nil, "a set waypoint prints a small grey line, not a bubble")

ns.Core.dispatch({ t = "reply", id = "ask-esc", chat = "default", provider = "codex", summary = "|Hitem:1|h[Sword]|h", full = "|Hitem:1|h[Sword]|h" })
local escEntries = ns.AiWindow.entries()
assert(escEntries[#escEntries].display:find("||H", 1, true) ~= nil, "WoW escapes in a reply print literally")

local dupBefore = #ns.AiWindow.entries()
ns.Core.dispatch({ t = "reply", id = "ask-esc", chat = "default", provider = "codex", summary = "again", full = "again" })
assert(#ns.AiWindow.entries() == dupBefore, "a reply delivered twice shows once")

ns.AiWindow.notice("[Claude] busy, not sent")
local noticeEntries = ns.AiWindow.entries()
assert(noticeEntries[#noticeEntries].kind == "line" and noticeEntries[#noticeEntries].tone == "yellow", "notices are yellow lines")
local noticeRow = rowAt(#noticeEntries)
assert(noticeRow.line.textColor.g == YELLOW_FONT_COLOR.g, "the notice line is painted with Blizzard's yellow constant")

for i = 1, 210 do
  ns.Core.dispatch({ t = "reply", id = "cap-" .. i, chat = "default", provider = "codex", summary = "line " .. i, full = "line " .. i })
end
assert(#ns.AiWindow.entries() == 200, "the list keeps at most 200 lines")
assert(box.provider:GetSize() == 200, "the data provider holds the same 200 lines")
assert(ns.AiWindow.entries()[200].display == "line 210", "the newest line is kept")
assert(ns.AiWindow.entries()[1].display ~= "only **typed**", "the oldest lines are dropped")

box:SetSize(800, 200)
local rebuildsBefore = box.rebuildCount
box:TriggerEvent("OnSizeChanged", 800, 200, 1)
box:TriggerEvent("OnSizeChanged", 800, 200, 1)
assert(box.rebuildCount == rebuildsBefore, "a resize does not rebuild synchronously inside the size callback")
flushTimers()
assert(box.rebuildCount == rebuildsBefore + 1, "a resize rebuilds the list once, so bubbles re-wrap at the new width")
assert(rowAt(#ns.AiWindow.entries()).bubble:GetWidth() <= math.floor(800 * 0.75), "bubble width follows the new list width")
flushTimers()
box:TriggerEvent("OnSizeChanged", 800, 200, 1)
flushTimers()
assert(box.rebuildCount == rebuildsBefore + 1, "an unchanged width rebuilds nothing")

local function freshWindow()
  local fresh = {}
  fresh.Transport = { sent = {} }
  fresh.Transport.session = function()
    return "sessionB"
  end
  function fresh.Transport.send(msg)
    table.insert(fresh.Transport.sent, msg)
  end
  fresh.Settings = { onChats = function() end, onError = function() end, onOptions = function() end }
  assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", fresh)
  assert(loadfile("addon/WoWCompanion/Core.lua"))("WoWCompanion", fresh)
  return fresh
end

local early = freshWindow()
early.AiWindow.notice("early notice")
assert(#early.AiWindow.entries() == 0, "a notice before the window exists is held back, not lost or raised as an error")
early.AiWindow.create()
early.AiWindow.messageBox:SetSize(400, 300)
assert(#early.AiWindow.entries() == 1 and early.AiWindow.entries()[1].display == "early notice", "the held notice appears once the window exists")
assert(early.AiWindow.messageBox:GetVisibleFrames()[1].line:GetText() == "early notice", "and is drawn")
assert(early.AiWindow.emptyHint:IsShown() == false, "a chat with a line shows no hint")

local hint = early.AiWindow.emptyHint
early.Core.dispatch({ t = "history", chat = "default", lines = {} })
assert(hint:IsShown() == true and hint:GetText() == "Ask anything about your game", "an empty chat shows one grey hint line")
assert(hint.textColor.r == GRAY_FONT_COLOR:GetRGB(), "the hint is grey")
early.Core.dispatch({ t = "reply", id = "hint-1", chat = "default", provider = "claude", summary = "s", full = "first line" })
assert(hint:IsShown() == false, "the hint goes away with the first entry")

local function statusFor(fresh, message)
  fresh.Core.dispatch(message)
  local list = fresh.AiWindow.entries()
  return list[#list]
end

local phrases = {
  { "get_game_state", "reading your character" },
  { "find_npc", "looking up an NPC" },
  { "find_quest", "looking up a quest" },
  { "suggest_gear_upgrades", "checking gear upgrades" },
  { "set_waypoint", "setting a waypoint" },
  { "mcp__wowc__find_npc", "looking up an NPC" },
}
for index, pair in ipairs(phrases) do
  local status = statusFor(early, { t = "progress", id = "tool-" .. index, chat = "default", status = "tool", detail = pair[1] })
  assert(status.display == "Claude \194\183 " .. pair[2] .. "\226\128\166", "the tool " .. pair[1] .. " has a plain phrase")
end
local unknown = statusFor(early, { t = "progress", id = "tool-x", chat = "default", status = "tool", detail = "brand_new_tool" })
assert(unknown.display == "Claude \194\183 using brand_new_tool\226\128\166", "a tool without a phrase falls back to using <tool>")

early.Core.dispatch({
  t = "chats",
  active = "default",
  list = {
    { id = "default", name = "Default", provider = "claude", lastAt = 1, running = false, unread = 0 },
    { id = "cx", name = "Codex chat", provider = "codex", lastAt = 1, running = false, unread = 0 },
  },
})
local before = #early.AiWindow.entries()
early.Core.dispatch({ t = "progress", id = "route-1", chat = "cx", status = "thinking" })
assert(#early.AiWindow.entries() == before, "progress for a chat that is not shown is dropped, routed by the chat the message names")
early.Core.dispatch({ t = "history", chat = "cx", lines = {} })
local routed = statusFor(early, { t = "progress", id = "route-2", chat = "cx", status = "thinking" })
assert(routed.display == "Codex \194\183 thinking\226\128\166", "progress for the shown chat is labelled with that chat provider")

early.Core.dispatch({ t = "history", chat = "default", lines = {} })
local seenReply = { t = "reply", id = "dup-1", chat = "default", provider = "claude", summary = "s", full = "answer" }
early.Core.dispatch({ t = "progress", id = "dup-1", chat = "default", status = "thinking" })
early.Core.dispatch(seenReply)

local reloadedWindow = freshWindow()
reloadedWindow.AiWindow.create()
reloadedWindow.AiWindow.messageBox:SetSize(400, 300)
reloadedWindow.Core.dispatch({ t = "progress", id = "dup-1", chat = "default", status = "thinking" })
assert(#reloadedWindow.AiWindow.entries() == 0, "a progress for an already answered ask shows nothing at all")
reloadedWindow.Core.dispatch(seenReply)
for _, entry in ipairs(reloadedWindow.AiWindow.entries()) do
  assert(entry.kind ~= "status", "a progress re-delivered after a reload for an answered ask leaves no stuck status line")
  assert(entry.display ~= "answer", "and its reply is not printed twice")
end

reloadedWindow.Core.dispatch({ t = "progress", id = "live-1", chat = "default", status = "thinking" })
assert(#reloadedWindow.AiWindow.entries() == 1, "a progress for an unanswered ask shows after a reload, by the chat the message names")
reloadedWindow.Core.dispatch({ t = "reply", id = "live-1", chat = "default", provider = "claude", summary = "s", full = "done" })
reloadedWindow.Core.dispatch({ t = "reply", id = "live-1", chat = "default", provider = "claude", summary = "s", full = "done" })
assert(#reloadedWindow.AiWindow.entries() == 1 and reloadedWindow.AiWindow.entries()[1].kind == "ai", "the reply replaces the status and a duplicate adds nothing")

reloadedWindow.Core.dispatch({
  t = "history",
  chat = "default",
  lines = { { who = "you", text = "a", at = 1 }, { who = "claude", text = "b", at = 2 }, { who = "you", text = "c", at = 3 } },
})
reloadedWindow.Core.dispatch({ t = "reply", id = "after-history", chat = "default", provider = "claude", summary = "s", full = "d" })
assert(#reloadedWindow.AiWindow.entries() == 4, "a reply after a history load adds one entry")
assert(reloadedWindow.AiWindow.messageBox.provider:GetSize() == 4, "the data provider holds exactly the same four entries")

local stuck = freshWindow()
stuck.AiWindow.create()
stuck.AiWindow.messageBox:SetSize(400, 300)
stuck.Core.dispatch({ t = "progress", id = "stuck-1", chat = "default", status = "thinking" })
assert(stuck.AiWindow.entries()[1].kind == "status", "the status shows while the ask runs")
WoWCompanionDB.seenReplies.set["stuck-1"] = true
stuck.Core.dispatch({ t = "reply", id = "stuck-1", chat = "default", provider = "claude", summary = "s", full = "late" })
assert(#stuck.AiWindow.entries() == 0, "a re-delivered reply that was already shown still clears the status line")

print("messages.bubbles: all assertions passed")
