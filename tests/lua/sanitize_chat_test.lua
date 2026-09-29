dofile("tests/lua/wow_stubs.lua")

local ns = {}
local chunk = assert(loadfile("addon/WoWCompanion/AiWindow.lua"))
chunk("WoWCompanion", ns)

local raw = "|cffff0000Red|r plus |Hitem:1|h[Sword]|h and |Tinterface\\icon:16|t and |Kbinding|k"
local expected = raw:gsub("|", "||")
local got = ns.AiWindow.sanitize(raw)

assert(got == expected, "every pipe character is doubled")
assert(got:find("||c", 1, true) ~= nil, "|c colour escape neutralized")
assert(got:find("||H", 1, true) ~= nil, "|H hyperlink escape neutralized")
assert(got:find("||T", 1, true) ~= nil, "|T texture escape neutralized")
assert(got:find("||K", 1, true) ~= nil, "|K keybind escape neutralized")
assert(ns.AiWindow.sanitize(nil) == "", "non-string input sanitizes to an empty string")
assert(ns.AiWindow.sanitize("plain text") == "plain text", "text without escapes is unchanged")

print("sanitize.chat: all assertions passed")
