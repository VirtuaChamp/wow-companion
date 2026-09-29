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

local fullText = string.rep("word ", 60)
ns.AiWindow.onReply({
  t = "reply",
  id = "ask-1",
  chat = "default",
  provider = "claude",
  summary = "short summary",
  full = fullText,
})

local lastMessage = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text
assert(lastMessage:find("[more]", 1, true) ~= nil, "the summary line carries a [more] link")

local bareLink = lastMessage:match("|H(addon:[^|]+)|h")
assert(bareLink ~= nil, "the addon hyperlink is present in the reply line")
assert(bareLink:find("WoWCompanion", 1, true) ~= nil, "the link is namespaced by the addon name")

ns.AiWindow.scrollFrame:Fire("OnHyperlinkClick", "addon:SomeOtherAddon:more:more-1", "[more]", "LeftButton")
assert(ns.AiWindow.moreBoxEditBox == nil, "another addon's more link does not open this window's box")
ns.AiWindow.scrollFrame:Fire("OnHyperlinkClick", "addon:SomeOtherAddon:open:default", "[open]", "LeftButton")
assert(#ns.Transport.sent == 0, "another addon's open link sends nothing")

-- The client strips |H...|h before invoking the widget's OnHyperlinkClick script;
-- drive that script with the bare link, the payload the client actually produces.
ns.AiWindow.scrollFrame:Fire("OnHyperlinkClick", bareLink, "[more]", "LeftButton")

assert(ns.AiWindow.moreBoxEditBox ~= nil, "clicking [more] opens the full-text box")
assert(ns.AiWindow.moreBoxEditBox:GetText() == fullText, "the box shows the full reply text")

local box = ns.AiWindow.moreBoxEditBox
box:SetText("tampered")
box:Fire("OnTextChanged", true)
assert(box:GetText() == fullText, "typing into the full-text box restores the reply text: the box is read-only")
box:Fire("OnTextChanged", false)
assert(box:GetText() == fullText, "a programmatic change notification leaves the text as it is")

local scroll = ns.AiWindow.moreBox.scrollFrame
assert(scroll.template == "InputScrollFrameTemplate", "the full-text box scrolls in Blizzard's input scroll frame")
local viewportHeight = scroll:GetHeight()
assert(viewportHeight > 0, "the scroll viewport has an explicit height")
assert(box:GetHeight() <= viewportHeight, "a short reply fits the viewport")

local longText = string.rep("word ", 400)
ns.AiWindow.onReply({ t = "reply", id = "ask-long", chat = "default", provider = "claude", summary = "long", full = longText })
local longLink = ns.AiWindow.scrollFrame.messages[#ns.AiWindow.scrollFrame.messages].text:match("|H(addon:[^|]+)|h")
ns.AiWindow.scrollFrame:Fire("OnHyperlinkClick", longLink, "[more]", "LeftButton")
assert(ns.AiWindow.moreBoxEditBox:GetText() == longText, "the long reply is shown in full")
assert(
  ns.AiWindow.moreBoxEditBox:GetHeight() > viewportHeight,
  "the edit box grows past the viewport for a long reply, so the scroll frame has content to scroll"
)

local moreBox = ns.AiWindow.moreBox
local SCROLLBAR_ALLOWANCE = 18
local _, _, _, insetLeft, insetTop = moreBox.Inset:GetPointByName("TOPLEFT")
local _, _, _, _, insetBottom = moreBox.Inset:GetPointByName("BOTTOMRIGHT")
assert(insetTop == -24, "the full-reply box hides the header attic: the inset starts right under the title bar")
assert(insetBottom == 4, "the full-reply box hides the empty button bar: the inset reaches the bottom border")
assert(insetLeft == 9, "the full-reply box keeps the portrait-less inset offset after the attic is hidden")
local scrollTopLeft = { scroll:GetPointByName("TOPLEFT") }
local scrollBottomRight = { scroll:GetPointByName("BOTTOMRIGHT") }
assert(scrollTopLeft[2] == moreBox.Inset and scrollBottomRight[2] == moreBox.Inset, "the scroll frame is anchored to the inset")
assert(
  scrollTopLeft[4] > 0 and scrollTopLeft[4] == -scrollTopLeft[5],
  "the scroll frame's top and left padding are equal"
)
assert(
  scrollBottomRight[4] == -scrollTopLeft[4] and scrollBottomRight[5] == scrollTopLeft[4],
  "the scroll frame's right and bottom padding equal its top and left"
)
assert(scroll:GetWidth() == moreBox:GetWidth() - 9 - 6 - 2 * scrollTopLeft[4], "the scroll width is what the anchors lay out")
assert(box:GetWidth() == scroll:GetWidth() - SCROLLBAR_ALLOWANCE, "the text width comes from the laid-out scroll frame")
assert(moreBox.measure:GetWidth() == box:GetWidth(), "the height measure wraps at the same width as the edit box")

moreBox:SetSize(600, 400)
scroll:Fire("OnSizeChanged")
assert(box:GetWidth() == scroll:GetWidth() - SCROLLBAR_ALLOWANCE, "resizing the box re-lays the text out at the new width")
assert(scroll:GetWidth() == 600 - 9 - 6 - 2 * scrollTopLeft[4], "the resized scroll frame follows its anchors")

print("more.link: all assertions passed")
