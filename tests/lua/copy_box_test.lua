dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {} }
ns.Transport.session = function()
  return "sessionA"
end
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end

local aiWindowChunk = assert(loadfile("addon/WoWCompanion/AiWindow.lua"))
aiWindowChunk("WoWCompanion", ns)

ns.AiWindow.create()
ns.AiWindow.messageBox:SetSize(500, 300)

local function lastBubble()
  local entries = ns.AiWindow.entries()
  return entries[#entries], ns.AiWindow.messageBox:GetVisibleFrames()[#entries].bubble
end

local fullText = string.rep("word ", 60)
ns.AiWindow.onReply({
  t = "reply",
  id = "ask-1",
  chat = "default",
  provider = "claude",
  summary = "short summary",
  full = fullText,
})

local lastEntry, bubble = lastBubble()
assert(lastEntry.display == fullText, "the bubble shows the full text")
assert(ns.AiWindow.copyBoxEditBox == nil, "nothing opens the copy box by itself")
assert(bubble.text:GetText():find("|H", 1, true) == nil, "a reply carries no hyperlink of its own")

bubble:Fire("OnMouseUp", "RightButton")
assert(ns.AiWindow.copyBoxEditBox == nil, "the menu alone does not open the box")
_G.WOWC_TEST_LAST_CONTEXT_MENU.buttons[1]:Pick()

assert(ns.AiWindow.copyBoxEditBox ~= nil, "Copy text opens the copy box")
assert(ns.AiWindow.copyBox.TitleContainer.TitleText:GetText() == "Copy text", "the copy box is titled Copy text, whichever provider wrote the reply")
assert(ns.AiWindow.copyBoxEditBox:GetText() == fullText, "the box shows the full reply text")

local box = ns.AiWindow.copyBoxEditBox
box:SetText("tampered")
box:Fire("OnTextChanged", true)
assert(box:GetText() == fullText, "typing into the full-text box restores the reply text: the box is read-only")
box:Fire("OnTextChanged", false)
assert(box:GetText() == fullText, "a programmatic change notification leaves the text as it is")

local scroll = ns.AiWindow.copyBox.scrollFrame
assert(scroll.template == "InputScrollFrameTemplate", "the full-text box scrolls in Blizzard's input scroll frame")
local viewportHeight = scroll:GetHeight()
assert(viewportHeight > 0, "the scroll viewport has an explicit height")
assert(box:GetHeight() <= viewportHeight, "a short reply fits the viewport")

local longText = string.rep("word ", 400)
ns.AiWindow.onReply({ t = "reply", id = "ask-long", chat = "default", provider = "claude", summary = "long", full = longText })
local longEntry, longBubble = lastBubble()
assert(longEntry.display == longText, "the long reply is one bubble with its full text")
longBubble:Fire("OnMouseUp", "RightButton")
_G.WOWC_TEST_LAST_CONTEXT_MENU.buttons[1]:Pick()
assert(ns.AiWindow.copyBoxEditBox:GetText() == longText, "the long reply is shown in full")
assert(
  ns.AiWindow.copyBoxEditBox:GetHeight() > viewportHeight,
  "the edit box grows past the viewport for a long reply, so the scroll frame has content to scroll"
)

local copyBox = ns.AiWindow.copyBox
local SCROLLBAR_ALLOWANCE = 18
local _, _, _, insetLeft, insetTop = copyBox.Inset:GetPointByName("TOPLEFT")
local _, _, _, _, insetBottom = copyBox.Inset:GetPointByName("BOTTOMRIGHT")
assert(insetTop == -24, "the copy box hides the header attic: the inset starts right under the title bar")
assert(insetBottom == 4, "the copy box hides the empty button bar: the inset reaches the bottom border")
assert(insetLeft == 9, "the copy box keeps the portrait-less inset offset after the attic is hidden")
local scrollTopLeft = { scroll:GetPointByName("TOPLEFT") }
local scrollBottomRight = { scroll:GetPointByName("BOTTOMRIGHT") }
assert(scrollTopLeft[2] == copyBox.Inset and scrollBottomRight[2] == copyBox.Inset, "the scroll frame is anchored to the inset")
assert(
  scrollTopLeft[4] > 0 and scrollTopLeft[4] == -scrollTopLeft[5],
  "the scroll frame's top and left padding are equal"
)
assert(
  scrollBottomRight[4] == -scrollTopLeft[4] and scrollBottomRight[5] == scrollTopLeft[4],
  "the scroll frame's right and bottom padding equal its top and left"
)
assert(scroll:GetWidth() == copyBox:GetWidth() - 9 - 6 - 2 * scrollTopLeft[4], "the scroll width is what the anchors lay out")
assert(box:GetWidth() == scroll:GetWidth() - SCROLLBAR_ALLOWANCE, "the text width comes from the laid-out scroll frame")
assert(copyBox.measure:GetWidth() == box:GetWidth(), "the height measure wraps at the same width as the edit box")

copyBox:SetSize(600, 400)
scroll:Fire("OnSizeChanged")
assert(box:GetWidth() == scroll:GetWidth() - SCROLLBAR_ALLOWANCE, "resizing the box re-lays the text out at the new width")
assert(scroll:GetWidth() == 600 - 9 - 6 - 2 * scrollTopLeft[4], "the resized scroll frame follows its anchors")

print("copy.box: all assertions passed")
