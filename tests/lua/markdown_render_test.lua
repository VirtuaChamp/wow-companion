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

local render = ns.AiWindow.renderMarkdown
local BULLET = "\226\128\162 "

local function gold(text)
  return NORMAL_FONT_COLOR:WrapTextInColorCode(text)
end

local function grey(text)
  return GRAY_FONT_COLOR:WrapTextInColorCode(text)
end

assert(gold("x") ~= grey("x"), "gold and grey wrap to different colour codes")
assert(gold("x"):find("^|cff[0-9a-f]+x|r$") ~= nil, "a wrapped span is one colour code, the text, then a reset")

assert(render("plain text") == "plain text", "plain text is untouched")
assert(render("say **bold** now") == "say " .. gold("bold") .. " now", "bold becomes gold")
assert(render("# Heading") == gold("Heading"), "a heading is gold without its marker")
assert(render("### Deep heading") == gold("Deep heading"), "any heading level is gold")
assert(render("## Mixed **bold** and *x*") == gold("Mixed bold and x"), "markers inside a heading are dropped")
assert(render("use `find_npc` here") == "use " .. grey("find_npc") .. " here", "inline code is grey and keeps its underscore")
assert(render("`a*b`") == grey("a*b"), "code content is never stripped")

assert(render("- item") == BULLET .. "item", "a dash item becomes a bullet")
assert(render("* item") == BULLET .. "item", "a star item becomes a bullet")
assert(render("  - nested") == "  " .. BULLET .. "nested", "indent is kept before the bullet")
assert(render("- **bold** item") == BULLET .. gold("bold") .. " item", "a bullet renders its inline markup")
assert(render("1. first") == "1. first", "numbered items are kept")
assert(render("2) second") == "2) second", "numbered items with a bracket are kept")
assert(render("**not a bullet** at line start") == gold("not a bullet") .. " at line start", "bold at the start of a line is not a bullet")

assert(render("**unclosed bold") == "unclosed bold", "an unbalanced bold marker is removed")
assert(render("`unclosed code") == "unclosed code", "an unbalanced backtick is removed")
assert(render("a * b") == "a  b", "a lone star is removed")
assert(render("**bold `code` bold**") == gold("bold code bold"), "nested markers inside bold are flattened into the gold span")
assert(render("****") == "", "empty markers vanish")

assert(render("_italic_ word") == "italic word", "emphasis underscores are removed")
assert(render("snake_case stays") == "snake_case stays", "an underscore inside a word stays")
assert(render("#hash line") == "hash line", "a leftover hash marker at the start of a line is removed")
assert(render("quest #12 done") == "quest #12 done", "a hash inside a line stays")
assert(render("first\nsecond **b**") == "first\n" .. "second " .. gold("b"), "lines are rendered one by one and newlines kept")
assert(render("") == "", "empty text stays empty")

local escaped = ns.AiWindow.sanitize("a |Hitem:1|h[Sword]|h **x**")
assert(render(escaped) == "a ||Hitem:1||h[Sword]||h " .. gold("x"), "escaped pipes stay doubled next to markdown")
assert(
  render(ns.AiWindow.sanitize("**|cffff0000red|r**")) == gold("||cffff0000red||r"),
  "text that tries to bring its own colour code stays literal inside the addon's own span"
)
assert(
  render(ns.AiWindow.sanitize("|cffff0000red|r")) == "||cffff0000red||r",
  "a colour code in the reply is never let through"
)

ns.AiWindow.create()
ns.AiWindow.messageBox:SetSize(400, 300)

ns.Core.dispatch({ t = "reply", id = "md-1", chat = "default", provider = "claude", summary = "s", full = "# Title\n- one **two**\n`three`" })
local entries = ns.AiWindow.entries()
local reply = entries[#entries]
assert(reply.display == gold("Title") .. "\n" .. BULLET .. "one " .. gold("two") .. "\n" .. grey("three"), "a reply is rendered")
assert(reply.full == "# Title\n- one **two**\n`three`", "the raw text is kept for the copy box")
assert(ns.AiWindow.messageBox:GetVisibleFrames()[#entries].bubble.text:GetText() == reply.display, "the bubble shows the rendering")

ns.AiWindow.submitAsk("what is **this**")
entries = ns.AiWindow.entries()
assert(entries[#entries].display == "what is **this**", "the user's own text is not rendered")

ns.Core.dispatch({
  t = "history",
  chat = "default",
  lines = {
    { who = "you", text = "**mine**", at = 1 },
    { who = "claude", text = "**theirs**", at = 2 },
  },
})
entries = ns.AiWindow.entries()
assert(entries[1].display == "**mine**" and entries[2].display == gold("theirs"), "history renders the provider's lines only")

ns.Core.dispatch({ t = "chats", active = "default", list = { { id = "default", name = "Default", provider = "claude", lastAt = 1, running = false, unread = 0 }, { id = "other", name = "Other", provider = "claude", lastAt = 1, running = false, unread = 0 } } })
ns.Core.dispatch({ t = "reply", id = "md-2", chat = "other", provider = "claude", summary = "s", full = "**hidden**" })
entries = ns.AiWindow.entries()
local notice = entries[#entries]
assert(notice.display:find("|Haddon:WoWCompanion:open:other|h[open]|h", 1, true) ~= nil, "an off-screen notice keeps its hyperlink")
assert(notice.display:find("|cff", 1, true) == nil, "notice lines are not rendered")

local plain = ns.AiWindow.stripMarkdown
assert(plain("say **bold** now") == "say bold now", "plain: bold loses its markers and its colour")
assert(plain("# Heading") == "Heading", "plain: a heading loses its marker")
assert(plain("use `find_npc` here") == "use find_npc here", "plain: code loses its backticks and keeps its text")
assert(plain("- one\n* two\n1. three") == BULLET .. "one\n" .. BULLET .. "two\n1. three", "plain: list items become bullets, numbers stay")
assert(plain("**a** `b` # c") == "a b # c", "plain: mixed markup leaves only text")
assert(plain("**unclosed and _x_") == "unclosed and x", "plain: unbalanced markers are removed")
assert(plain("a ||Hb||h **x**") == "a ||Hb||h x", "plain: escaped pipes stay doubled")
assert(plain("# T\n- **b** `c`"):find("|c", 1, true) == nil, "plain text never contains a colour code")

ns.AiWindow.openCopyBox("# Title\n- **bold** and `code`")
assert(ns.AiWindow.copyBoxEditBox:GetText() == "Title\n" .. BULLET .. "bold and code", "the copy box shows plain text: markers removed, no colour codes")
ns.AiWindow.copyBoxEditBox:SetText("tampered")
ns.AiWindow.copyBoxEditBox:Fire("OnTextChanged", true)
assert(ns.AiWindow.copyBoxEditBox:GetText() == "Title\n" .. BULLET .. "bold and code", "the copy box stays read-only")

print("markdown.render: all assertions passed")
