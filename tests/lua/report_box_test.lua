dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {}, handlers = {} }
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end
function ns.Transport.onMessage(handler)
  table.insert(ns.Transport.handlers, handler)
end

ns.AiWindow = { notice = function() end }

_G.GetRealmName = function()
  return "TestRealm"
end

local stateChunk = assert(loadfile("addon/WoWCompanion/State.lua"))
stateChunk("WoWCompanion", ns)

local settingsChunk = assert(loadfile("addon/WoWCompanion/Settings.lua"))
settingsChunk("WoWCompanion", ns)

local reportChunk = assert(loadfile("addon/WoWCompanion/Report.lua"))
reportChunk("WoWCompanion", ns)

local snapshot = ns.State.snapshot()
assert(snapshot.character.name == "Testcharacter", "character fixture is loaded and reachable through ns.State")

local beforeOptionsText = ns.Report.buildText()
assert(string.find(beforeOptionsText, "https://github.com/VirtuaChamp/wow-companion/issues/new/choose", 1, true), "issue url present")
assert(string.find(beforeOptionsText, "Client build: 1.60.1.70009", 1, true), "client build present")
assert(string.find(beforeOptionsText, "Addon version: 0.1.0", 1, true), "addon version present")
assert(string.find(beforeOptionsText, "Companion version: unknown", 1, true), "companion version placeholder before it is known")
assert(string.find(beforeOptionsText, "Provider: unknown", 1, true), "provider placeholder before settings arrive")

ns.Settings.onOptions({
  t = "options",
  companionVersion = "0.4.2",
  providers = {
    {
      id = "claude",
      installed = true,
      enabled = true,
      models = { "sonnet" },
      efforts = { "medium" },
      current = { model = "sonnet", effort = "medium" },
    },
  },
  active = { provider = "claude", model = "sonnet", effort = "medium" },
})

local reportFrame = ns.Report.open()
assert(reportFrame:IsShown() == true, "report frame is shown")
assert(reportFrame.TitleText:GetText() ~= "" and reportFrame.TitleText:GetText() ~= nil, "report frame has a title")
assert(reportFrame.Instructions:GetText() ~= "" and reportFrame.Instructions:GetText() ~= nil, "report frame tells the user what to do with the box (ui-r2-5)")
assert(reportFrame.ScrollFrame.CharCount:IsShown() == false, "the character counter is hidden (aca-r2-12/ui-r2-1)")

local titledFrameName = reportFrame:GetName()
local registeredAsSpecial = false
for _, name in ipairs(_G.UISpecialFrames) do
  if name == titledFrameName then
    registeredAsSpecial = true
  end
end
assert(registeredAsSpecial, "report frame is closable with Escape (UISpecialFrames)")

local text = ns.Report.buildText()
assert(reportFrame.EditBox:GetText() == text, "the box holds the built report text")
assert(string.find(text, "Companion version: 0.4.2", 1, true), "companion version carried from the options message")
assert(string.find(text, "Provider: claude", 1, true), "provider carried")
assert(string.find(text, "Model: sonnet", 1, true), "model carried")
assert(string.find(text, "Effort: medium", 1, true), "effort carried")

assert(not string.find(text, "Testcharacter", 1, true), "no character name in the report")
assert(not string.find(text, snapshot.character.name, 1, true), "the loaded character fixture's name is not in the report")
assert(not string.find(text, "TestRealm", 1, true), "no realm name in the report, even though GetRealmName is available")
assert(not string.find(text:lower(), "c:\\users", 1, true), "no account path in the report")

reportFrame.EditBox.text = "a user typed this"
local onTextChanged = reportFrame.EditBox:GetScript("OnTextChanged")
onTextChanged(reportFrame.EditBox)
assert(reportFrame.EditBox:GetText() == text, "the box reverts a user edit, staying read-only")

reportFrame.CloseButton:GetScript("OnClick")()
assert(reportFrame:IsShown() == false, "close button hides the report frame")

print("report.box: all assertions passed")
