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
ns.AiWindow.messageBox:SetSize(400, 300)
ns.AiWindow.sidebarBox:SetSize(120, 300)

local function chatsMessage(active, ids)
  local list = {}
  for i, id in ipairs(ids) do
    list[i] = { id = id, name = "Chat " .. id, provider = "claude", lastAt = NOW - i, running = false, unread = 0 }
  end
  return { t = "chats", active = active, list = list }
end

local function rows()
  local out = {}
  for _, frame in ipairs(ns.AiWindow.sidebarBox:GetVisibleFrames()) do
    out[frame.chat.id] = frame
  end
  return out
end

local function displays()
  local out = {}
  for i, entry in ipairs(ns.AiWindow.entries()) do
    out[i] = entry.display
  end
  return table.concat(out, "|")
end

ns.Core.dispatch(chatsMessage("A", { "A", "B", "C" }))
ns.Core.dispatch({ t = "history", chat = "A", lines = { { who = "you", text = "in A", at = 1 } } })
ns.Core.dispatch({ t = "history", chat = "B", lines = { { who = "you", text = "in B", at = 1 } } })
ns.Core.dispatch({ t = "history", chat = "A", lines = { { who = "you", text = "in A", at = 1 } } })

local transcript = displays()
ns.Core.dispatch({ t = "error", id = "ask-b", chat = "B", code = "provider_failed", message = "x" })
assert(displays() == transcript, "a failure of a background chat leaves the shown transcript alone")

ns.Core.dispatch({ t = "error", id = "ask-a", chat = "A", code = "provider_failed", message = "x" })
assert(displays() == transcript .. "|[Claude] error: x", "a failure of the shown chat is printed in it")

ns.Core.dispatch({ t = "error", code = "bad_settings", message = "refused" })
ns.Core.dispatch({ t = "error", id = "ask-d", chat = "A", code = "daemon_error", message = "the companion could not apply this message" })
assert(displays():find("the companion could not handle that message; try again.", 1, true) ~= nil, "a daemon_error is shown as its own readable line")
ns.Core.dispatch({ t = "error", code = "unheard_of", message = "a readable reason" })
assert(displays():find("[Claude] error: a readable reason", 1, true) ~= nil, "a code without a line shows the message the companion sent")
ns.Core.dispatch({ t = "error", code = "unheard_of" })
assert(displays():find("[Claude] error: unheard_of", 1, true) ~= nil, "and with no message it shows the code")
assert(displays():find("refused", 1, true) ~= nil, "an error without a chat is printed where the player is")

local rowsNow = rows()
rowsNow.B:Fire("OnClick", "LeftButton")
assert(displays() == "in B|[Claude] error: x", "switching to that chat shows its failure after its messages")

ns.Core.dispatch({ t = "history", chat = "B", lines = { { who = "you", text = "in B", at = 1 }, { who = "claude", text = "later", at = 2 } } })
assert(displays():find("[Claude] error: x", 1, true) ~= nil, "a history that replaces the cache keeps the failure notice")

rowsNow.A:Fire("OnClick", "LeftButton")
ns.Core.dispatch({ t = "error", id = "busy-c", chat = "C", code = "busy", message = "busy" })
rowsNow.C:Fire("OnClick", "LeftButton")
assert(displays() == "loading\226\128\166|[Claude] busy \226\128\148 still answering the last question.", "an uncached chat shows its failure beside the loading line")

ns.AiWindow.submitAsk("try again")
assert(displays():find("busy", 1, true) ~= nil, "the failure stays in the shown transcript until re-rendered")
rowsNow.A:Fire("OnClick", "LeftButton")
rowsNow.C:Fire("OnClick", "LeftButton")
assert(displays():find("busy", 1, true) == nil, "a new ask in that chat clears its old failure notices")

ns.Core.dispatch({ t = "error", id = "gone", chat = "C", code = "provider_failed", message = "x" })
rowsNow.A:Fire("OnClick", "LeftButton")
ns.Core.dispatch({ t = "error", id = "gone-2", chat = "C", code = "provider_failed", message = "x" })
ns.Core.dispatch(chatsMessage("A", { "A", "B" }))
ns.Core.dispatch(chatsMessage("A", { "A", "B", "C" }))
rows().C:Fire("OnClick", "LeftButton")
assert(displays():find("provider_failed", 1, true) == nil, "a deleted chat loses its failure notices")

ns.Core.dispatch(chatsMessage("A", { "A", "B", "C", "D" }))
ns.Core.dispatch({ t = "error", id = "never-shown", chat = "D", code = "provider_failed", message = "x" })
ns.Core.dispatch(chatsMessage("A", { "A", "B", "C" }))
ns.Core.dispatch(chatsMessage("A", { "A", "B", "C", "D" }))
rows().D:Fire("OnClick", "LeftButton")
assert(displays() == "loading\226\128\166", "a chat that was never shown and was deleted loses its failure notices as well")

for i = 1, 25 do
  ns.Core.dispatch({ t = "error", id = "many-" .. i, chat = "B", code = "provider_failed", message = "x" })
end
rows().A:Fire("OnClick", "LeftButton")
rows().B:Fire("OnClick", "LeftButton")
local count = 0
for _, entry in ipairs(ns.AiWindow.entries()) do
  if entry.display == "[Claude] error: x" then
    count = count + 1
  end
end
assert(count == 20, "at most 20 notices are kept per chat")

print("error.routing: all assertions passed")
