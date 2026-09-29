dofile("tests/lua/wow_stubs.lua")

local function load()
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
  return ns
end

local ns = load()

assert(ns.AiWindow.textSize() == "normal", "the default text size is Normal, one step above the size used before")
local choices = ns.AiWindow.textSizeChoices()
local labels = {}
for i, choice in ipairs(choices) do
  labels[i] = choice.key .. "=" .. choice.label
end
assert(table.concat(labels, ",") == "small=Small,normal=Normal,large=Large,larger=Larger", "four choices, Small to Larger")

assert(ns.AiWindow.setTextSize("large") == true, "a size can be chosen before the window exists")
assert(WoWCompanionDB.textSize == "large", "the choice is saved in WoWCompanionDB")
WoWCompanionDB.textSize = nil

ns.AiWindow.create()
local box = ns.AiWindow.messageBox
box:SetSize(400, 300)
local sidebarBox = ns.AiWindow.sidebarBox
sidebarBox:SetSize(120, 200)

ns.Core.dispatch({
  t = "chats",
  active = "default",
  list = { { id = "default", name = "Default", provider = "claude", lastAt = 1, running = false, unread = 2 } },
})
ns.Core.dispatch({
  t = "history",
  chat = "default",
  lines = {
    { who = "you", text = "hello", at = 1 },
    { who = "claude", text = "hi there", at = 2 },
  },
})
ns.AiWindow.notice("a notice")

local function fonts()
  local bubble = box:GetVisibleFrames()[1].bubble
  local aiRow = box:GetVisibleFrames()[2]
  local noticeRow = box:GetVisibleFrames()[3]
  local chatRow = sidebarBox:GetVisibleFrames()[1]
  return {
    userText = bubble.text.fontObject,
    aiName = aiRow.who.fontObject,
    line = noticeRow.line.fontObject,
    chatTitle = chatRow.title.fontObject,
    chatSub = chatRow.sub.fontObject,
    chatUnread = chatRow.unread.fontObject,
    input = ns.AiWindow.inputBox.fontObject,
    ghost = ns.AiWindow.ghostText.fontObject,
    hint = ns.AiWindow.emptyHint.fontObject,
  }
end

local normal = fonts()
assert(normal.userText == GameFontHighlight, "bubbles use GameFontHighlight at Normal")
assert(normal.aiName == GameFontNormal, "the provider name uses GameFontNormal at Normal")
assert(normal.line == GameFontHighlight, "status and notice lines use GameFontHighlight at Normal")
assert(normal.chatTitle == GameFontHighlight, "sidebar titles use GameFontHighlight at Normal")
assert(normal.chatSub == GameFontNormal and normal.chatUnread == GameFontNormal, "sidebar detail lines use GameFontNormal at Normal")
assert(normal.input == GameFontHighlight, "the input line uses GameFontHighlight at Normal")
assert(normal.ghost == GameFontHighlight, "the ghost text follows the input line's font")
assert(normal.hint == GameFontHighlight, "the empty hint follows the size too")
assert(sidebarBox.view.elementExtent == 38, "chat rows are 38 px high at Normal: two 12 px lines, a 4 px gap and 5 px above and below")
local sidebar = ns.AiWindow.sidebar
assert(sidebar:GetWidth() == 168, "the sidebar is 168 px wide at Normal (140 scaled by 12 / 10)")
local view = box.view
assert(view.spacing == 16 and view.bottom == 16 and view.top == 6, "spacing under a bubble is the 12 px provider name plus a margin at Normal")

local boxRebuilds, sidebarRebuilds = box.rebuildCount, sidebarBox.rebuildCount
assert(ns.AiWindow.setTextSize("large") == true, "Large is accepted")
local large = fonts()
assert(large.userText == GameFontHighlightMedium, "bubbles switch to GameFontHighlightMedium")
assert(large.aiName == GameFontNormalMed3, "the provider name switches to GameFontNormalMed3")
assert(large.line == GameFontHighlightMedium, "lines switch")
assert(large.chatTitle == GameFontHighlightMedium, "sidebar titles switch")
assert(large.chatSub == GameFontNormalMed3 and large.chatUnread == GameFontNormalMed3, "sidebar detail lines switch")
assert(large.input == GameFontHighlightMedium, "the input line switches")
assert(large.ghost == GameFontHighlightMedium, "the ghost text switches with the input line")
assert(sidebarBox.view.elementExtent == 42, "chat rows grow to 42 px at Large: two 14 px lines")
assert(sidebar:GetWidth() == 196, "the sidebar grows to 196 px at Large so titles keep their room")
assert(box.view.spacing == 18 and box.view.bottom == 18, "the room under a bubble follows the 14 px provider name at Large: nothing runs into the next bubble")
assert(box.view.spacing >= 14, "the spacing is at least the provider name's font height")
assert(box.rebuildCount == boxRebuilds + 1, "the message list is rebuilt at once so extents are measured again")
assert(sidebarBox.rebuildCount == sidebarRebuilds + 1, "the chat list is rebuilt at once too")
assert(ns.AiWindow.textSize() == "large", "the size in use reads back")
assert(WoWCompanionDB.textSize == "large", "the choice is saved")

assert(ns.AiWindow.setTextSize("larger") == true and fonts().userText == GameFontHighlightLarge, "Larger uses GameFontHighlightLarge")
assert(box.view.spacing == 20 and box.view.bottom == 20 and box.view.spacing >= 16, "at Larger the room under a bubble covers the 16 px provider name")
assert(sidebarBox.view.elementExtent == 46, "chat rows are 46 px at Larger")
assert(sidebar:GetWidth() == 200, "the sidebar width is capped at 200 px")
assert(fonts().chatSub == GameFontNormalLarge, "Larger uses GameFontNormalLarge for the small lines")
assert(ns.AiWindow.setTextSize("small") == true and fonts().userText == GameFontHighlightSmall, "Small returns to GameFontHighlightSmall")
assert(fonts().chatSub == GameFontNormalSmall, "Small returns to GameFontNormalSmall")
assert(sidebarBox.view.elementExtent == 34, "Small rows are 34 px high")
assert(sidebar:GetWidth() == 140 and box.view.spacing == 14, "Small keeps the original 140 px sidebar and 14 px spacing")

local before = WoWCompanionDB.textSize
assert(ns.AiWindow.setTextSize("huge") == false, "an unknown size is refused")
assert(WoWCompanionDB.textSize == before and fonts().userText == GameFontHighlightSmall, "a refused size changes nothing")

local reloaded = load()
assert(reloaded.AiWindow.textSize() == "small", "the saved size is restored on load")
reloaded.AiWindow.create()
reloaded.AiWindow.messageBox:SetSize(400, 300)
reloaded.AiWindow.notice("after reload")
assert(reloaded.AiWindow.messageBox:GetVisibleFrames()[1].line.fontObject == GameFontHighlightSmall, "the window opens in the saved size")
assert(reloaded.AiWindow.inputBox.fontObject == GameFontHighlightSmall, "so does the input line")
assert(reloaded.AiWindow.sidebarBox.view.elementExtent == 34, "and the chat list")

WoWCompanionDB.textSize = "bogus"
local garbled = load()
assert(garbled.AiWindow.textSize() == "normal", "a saved value that is not a size falls back to Normal")

print("text.size: all assertions passed")
