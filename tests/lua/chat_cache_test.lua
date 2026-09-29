dofile("tests/lua/wow_stubs.lua")

local NOW = 1000000
_G.WOWC_TEST_SERVER_TIME = NOW

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
  ns.AiWindow.create()
  ns.AiWindow.messageBox:SetSize(400, 300)
  ns.AiWindow.sidebarBox:SetSize(120, 300)
  return ns
end

local function chatsMessage(active, ids)
  local list = {}
  for i, id in ipairs(ids) do
    list[i] = { id = id, name = "Chat " .. id, provider = "claude", lastAt = NOW - i, running = false, unread = 0 }
  end
  return { t = "chats", active = active, list = list }
end

local function lines(prefix, count)
  local out = {}
  for i = 1, count do
    out[i] = { who = i % 2 == 1 and "you" or "claude", text = prefix .. " " .. i, at = i }
  end
  return out
end

local function texts(ns)
  local out = {}
  for i, entry in ipairs(ns.AiWindow.entries()) do
    out[i] = entry.full or entry.display
  end
  return table.concat(out, "|")
end

local function lastOpen(ns)
  for i = #ns.Transport.sent, 1, -1 do
    local msg = ns.Transport.sent[i]
    if msg.name == "open" then
      return msg
    end
  end
end

local ns = load()
local box = ns.AiWindow.messageBox
ns.Core.dispatch(chatsMessage("A", { "A", "B", "C" }))
ns.Core.dispatch({ t = "history", chat = "A", lines = lines("a", 3) })
ns.Core.dispatch({ t = "history", chat = "B", lines = lines("b", 2) })
assert(texts(ns) == "b 1|b 2", "chat B is shown after its history")

local rowFor = {}
for _, frame in ipairs(ns.AiWindow.sidebarBox:GetVisibleFrames()) do
  rowFor[frame.chat.id] = frame
end

ns.Transport.sent = {}
local setBefore, endBefore = box.setProviderCalls, box.scrollEndCalls
rowFor.A:Fire("OnClick", "LeftButton")
assert(texts(ns) == "a 1|a 2|a 3", "switching renders the cached chat at once, without waiting for history")
assert(box.setProviderCalls == setBefore + 1 and box.scrollEndCalls > endBefore, "the list is rebuilt once and shown from its end")
assert(lastOpen(ns).chat == "A" and #ns.Transport.sent == 1, "the switch still sends open")
assert(rowFor.A.selection:IsShown() == true and rowFor.B.selection:IsShown() == false, "the highlight moves with the click")

ns.Core.dispatch(chatsMessage("B", { "A", "B", "C" }))
ns.AiWindow.submitAsk("typed in A")
assert(ns.Transport.sent[#ns.Transport.sent].chat == "A", "a chats message that still names the old chat does not send asks to it while the switch is pending")

ns.Core.dispatch({ t = "progress", id = ns.Transport.sent[#ns.Transport.sent].id, chat = "A", status = "thinking" })
local statusShown = ns.AiWindow.entries()[#ns.AiWindow.entries()].kind == "status"
assert(statusShown, "a status line shows for the chat now shown")

local entriesBefore = ns.AiWindow.entries()
local providerBefore = box.provider
setBefore, endBefore = box.setProviderCalls, box.scrollEndCalls
local same = lines("a", 3)
same[4] = { who = "you", text = "typed in A", at = 9 }
ns.Core.dispatch({ t = "history", chat = "A", lines = same })
assert(ns.AiWindow.entries() == entriesBefore and box.provider == providerBefore, "an identical history re-renders nothing")
assert(box.setProviderCalls == setBefore and box.scrollEndCalls == endBefore, "no rebuild and no scroll jump either")
assert(ns.AiWindow.entries()[#ns.AiWindow.entries()].kind == "status", "the running status line survives an identical history")

local different = lines("a", 3)
different[4] = { who = "you", text = "typed in A", at = 9 }
different[5] = { who = "claude", text = "a new answer", at = 10 }
ns.Core.dispatch({ t = "history", chat = "A", lines = different })
assert(texts(ns) == "a 1|a 2|a 3|typed in A|a new answer", "a different history replaces the cache and the list")
assert(box.setProviderCalls == setBefore + 1 and box.scrollPercentage == 1, "the replacement is rendered once and stays at the end")

rowFor.B:Fire("OnClick", "LeftButton")
assert(texts(ns) == "b 1|b 2", "switching back shows chat B from its cache")
rowFor.A:Fire("OnClick", "LeftButton")
assert(texts(ns) == "a 1|a 2|a 3|typed in A|a new answer", "the user's ask and the reply live in the cache of their chat")

ns.Core.dispatch({ t = "reply", id = "off-1", chat = "B", provider = "claude", summary = "s", full = "off screen answer" })
assert(texts(ns) == "a 1|a 2|a 3|typed in A|a new answer|" .. ns.AiWindow.entries()[#ns.AiWindow.entries()].display, "the reply for another chat prints only the notice in the shown chat")
rowFor.B:Fire("OnClick", "LeftButton")
assert(texts(ns) == "b 1|b 2|off screen answer", "the off-screen reply was appended to the cache of the chat it belongs to")
ns.Core.dispatch({ t = "history", chat = "B", lines = { { who = "you", text = "b 1", at = 1 }, { who = "claude", text = "b 2", at = 2 }, { who = "claude", text = "off screen answer", at = 3 } } })
assert(texts(ns) == "b 1|b 2|off screen answer", "the history that confirms it changes nothing")

ns.Transport.sent = {}
local setNow = box.setProviderCalls
rowFor.B:Fire("OnClick", "LeftButton")
assert(lastOpen(ns).chat == "B" and box.setProviderCalls == setNow, "clicking the chat already shown still sends open and re-renders nothing")

rowFor.C:Fire("OnClick", "LeftButton")
local loading = ns.AiWindow.entries()
assert(#loading == 1 and loading[1].kind == "line" and loading[1].display == "loading\226\128\166", "a chat with no cache shows one loading line")
assert(loading[1].tone == "grey", "the loading line is grey")
assert(ns.AiWindow.emptyHint:IsShown() == false, "the empty hint does not show over the loading line")
ns.Core.dispatch({ t = "history", chat = "C", lines = {} })
assert(#ns.AiWindow.entries() == 0, "an empty history replaces the loading line")
assert(ns.AiWindow.emptyHint:IsShown() == true, "and the empty hint takes over")
rowFor.A:Fire("OnClick", "LeftButton")
rowFor.C:Fire("OnClick", "LeftButton")
assert(#ns.AiWindow.entries() == 0 and ns.AiWindow.entries()[1] == nil, "an empty chat is cached as empty, no loading line the second time")

ns.Core.dispatch(chatsMessage("A", { "A", "C" }))
rowFor = {}
for _, frame in ipairs(ns.AiWindow.sidebarBox:GetVisibleFrames()) do
  rowFor[frame.chat.id] = frame
end
ns.Core.dispatch({ t = "history", chat = "A", lines = different })
ns.Core.dispatch(chatsMessage("A", { "A", "B", "C" }))
rowFor = {}
for _, frame in ipairs(ns.AiWindow.sidebarBox:GetVisibleFrames()) do
  rowFor[frame.chat.id] = frame
end
rowFor.B:Fire("OnClick", "LeftButton")
assert(ns.AiWindow.entries()[1].display == "loading\226\128\166", "a chat deleted from the list lost its cache: re-created under the same id it starts from a loading line")

rowFor = {}
ns.Core.dispatch(chatsMessage("A", { "A", "B", "C", "D" }))
for _, frame in ipairs(ns.AiWindow.sidebarBox:GetVisibleFrames()) do
  rowFor[frame.chat.id] = frame
end
rowFor.D:Fire("OnClick", "LeftButton")
assert(ns.AiWindow.entries()[1].display == "loading\226\128\166", "an uncached chat shows the loading line")
ns.Core.dispatch({ t = "reply", id = "during-load", chat = "D", provider = "claude", summary = "s", full = "answer while loading" })
ns.Core.dispatch({ t = "history", chat = "D", lines = { { who = "claude", text = "answer while loading", at = 1 } } })
assert(#ns.AiWindow.entries() == 1 and ns.AiWindow.entries()[1].full == "answer while loading", "a history that matches what arrived meanwhile still replaces the loading line")

local reloaded = load()
reloaded.Core.dispatch(chatsMessage("A", { "A", "B" }))
local reloadedRows = {}
for _, frame in ipairs(reloaded.AiWindow.sidebarBox:GetVisibleFrames()) do
  reloadedRows[frame.chat.id] = frame
end
reloadedRows.B:Fire("OnClick", "LeftButton")
assert(reloaded.AiWindow.entries()[1].display == "loading\226\128\166", "a fresh load starts with no cache")

local bounded = load()
bounded.Core.dispatch(chatsMessage("A", { "A", "B" }))
bounded.Core.dispatch({ t = "history", chat = "A", lines = lines("x", 1) })
for i = 1, 205 do
  bounded.Core.dispatch({ t = "reply", id = "flood-" .. i, chat = "A", provider = "claude", summary = "s", full = "flood " .. i })
end
assert(#bounded.AiWindow.entries() == 200, "the shown list keeps 200 entries")
bounded.Core.dispatch({ t = "history", chat = "B", lines = lines("b", 1) })
local boundedRows = {}
for _, frame in ipairs(bounded.AiWindow.sidebarBox:GetVisibleFrames()) do
  boundedRows[frame.chat.id] = frame
end
boundedRows.A:Fire("OnClick", "LeftButton")
assert(#bounded.AiWindow.entries() == 200 and bounded.AiWindow.entries()[200].full == "flood 205", "a chat's cache is bounded to 200 entries, newest kept")
assert(bounded.AiWindow.entries()[1].full ~= "x 1", "the oldest entries are dropped")

local wide = load()
local ids = {}
for i = 1, 40 do
  ids[i] = "w" .. i
end
wide.Core.dispatch(chatsMessage("w1", ids))
for i = 1, 40 do
  wide.Core.dispatch({ t = "history", chat = "w" .. i, lines = lines("w" .. i, 1) })
end
local wideRows = {}
for _, frame in ipairs(wide.AiWindow.sidebarBox:GetVisibleFrames()) do
  wideRows[frame.chat.id] = frame
end
wideRows.w1:Fire("OnClick", "LeftButton")
assert(wide.AiWindow.entries()[1].display == "loading\226\128\166", "the least recently used chat lost its cache once more than 30 chats are kept")
wideRows.w40:Fire("OnClick", "LeftButton")
assert(wide.AiWindow.entries()[1].full == "w40 1", "the most recent chats are still cached")

print("chat.cache: all assertions passed")
