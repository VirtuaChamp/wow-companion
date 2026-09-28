dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {} }
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

print("more.link: all assertions passed")
