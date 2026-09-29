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
local setCalls = {}
local setResult = true
ns.Waypoint = {
  set = function(waypoint)
    table.insert(setCalls, waypoint)
    return setResult
  end,
}

assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", ns)
assert(loadfile("addon/WoWCompanion/Core.lua"))("WoWCompanion", ns)
ns.AiWindow.create()
local box = ns.AiWindow.messageBox
box:SetSize(400, 300)

local function lastEntries(count)
  local list = ns.AiWindow.entries()
  local out = {}
  for i = #list - count + 1, #list do
    out[#out + 1] = list[i]
  end
  return out
end

local function linkOf(entry)
  return entry.display:match("|H(addon:[^|]+)|h")
end

ns.Core.dispatch({
  t = "chats",
  active = "default",
  list = {
    { id = "default", name = "Default", provider = "claude", lastAt = 2, running = false, unread = 0 },
    { id = "other", name = "Other", provider = "claude", lastAt = 1, running = false, unread = 0 },
  },
})
ns.Core.dispatch({ t = "history", chat = "default", lines = { { who = "you", text = "where is the forge", at = 1 } } })
ns.Core.dispatch({ t = "history", chat = "other", lines = { { who = "you", text = "hello", at = 1 } } })
ns.Core.dispatch({ t = "history", chat = "default", lines = { { who = "you", text = "where is the forge", at = 1 } } })

local waypoint = { uiMapId = 84, x = 55.5, y = 47.8, label = "Great Forge" }
ns.Core.dispatch({ t = "reply", id = "wp-1", chat = "default", provider = "claude", summary = "s", full = "Gryth Thurden stands at the Great Forge.", waypoint = waypoint })
assert(#setCalls == 0, "a reply with a waypoint never calls Waypoint.set by itself")

local shown = lastEntries(2)
assert(shown[1].kind == "ai" and shown[1].waypoint == waypoint, "the reply entry keeps its waypoint")
local offer = shown[2]
assert(offer.kind == "line" and offer.tone == "grey", "the offer is a grey line, not a bubble")
assert(offer.display:find("waypoint: Great Forge (55.5, 47.8) ", 1, true) == 1, "it reads waypoint: <label> (x, y)")
assert(offer.display:find("[Set waypoint]", 1, true) ~= nil, "and carries a [Set waypoint] link")
local link = linkOf(offer)
assert(link ~= nil and link:find("WoWCompanion", 1, true) ~= nil, "the link is an addon hyperlink named after the addon")

local offerRow = box:GetVisibleFrames()[#ns.AiWindow.entries()]
assert(offerRow.hyperlinksEnabled == true, "the row that parents the offer text takes hyperlink clicks")
offerRow:Fire("OnHyperlinkClick", link, "[Set waypoint]", "LeftButton")
assert(#setCalls == 1, "clicking the link calls Waypoint.set once")
assert(setCalls[1].uiMapId == 84 and setCalls[1].x == 55.5 and setCalls[1].y == 47.8 and setCalls[1].label == "Great Forge", "with the right map, coordinates and label")
local confirm = lastEntries(1)[1]
assert(confirm.kind == "line" and confirm.display == "[Claude] waypoint set: Great Forge", "a set waypoint is confirmed in a grey line")

offerRow:Fire("OnHyperlinkClick", link, "[Set waypoint]", "LeftButton")
assert(#setCalls == 2, "every click sets it again, nothing more")

setResult = "no_waypoint_map"
offerRow:Fire("OnHyperlinkClick", link, "[Set waypoint]", "LeftButton")
assert(lastEntries(1)[1].display == "[Claude] waypoint: no_waypoint_map", "a refusal by the client is shown after the click")
setResult = true

local before = #setCalls
ns.AiWindow.handleAddonLink("addon:WoWCompanion:waypoint:wp-unknown")
ns.AiWindow.handleAddonLink("addon:SomeOtherAddon:waypoint:wp-1")
assert(#setCalls == before, "an unknown id or another addon's link sets nothing")

ns.Core.dispatch({ t = "reply", id = "plain-1", chat = "default", provider = "claude", summary = "s", full = "no waypoint here" })
local plain = lastEntries(1)[1]
assert(plain.kind == "ai" and plain.waypoint == nil, "a reply without a waypoint adds no offer line")

local rowsFor = {}
for _, frame in ipairs(ns.AiWindow.sidebarBox:GetVisibleFrames()) do
  rowsFor[frame.chat.id] = frame
end
rowsFor.other:Fire("OnClick", "LeftButton")
rowsFor.default:Fire("OnClick", "LeftButton")
local rendered = ns.AiWindow.entries()
local offerAfterSwitch
for _, entry in ipairs(rendered) do
  if entry.kind == "line" and entry.display:find("[Set waypoint]", 1, true) then
    offerAfterSwitch = entry
  end
end
assert(offerAfterSwitch ~= nil, "the offer survives a switch away and back")
before = #setCalls
ns.AiWindow.handleAddonLink(linkOf(offerAfterSwitch))
assert(#setCalls == before + 1 and setCalls[#setCalls].label == "Great Forge", "and still sets the same waypoint")

ns.Core.dispatch({
  t = "history",
  chat = "default",
  lines = {
    { who = "you", text = "where is the forge", at = 1 },
    { who = "claude", text = "Gryth Thurden stands at the Great Forge.", at = 2 },
    { who = "claude", text = "no waypoint here", at = 3 },
    { who = "you", text = "thanks", at = 4 },
  },
})
local afterHistory
for _, entry in ipairs(ns.AiWindow.entries()) do
  if entry.kind == "line" and entry.display:find("[Set waypoint]", 1, true) then
    afterHistory = entry
  end
end
assert(afterHistory ~= nil, "a different history, which carries no waypoints, keeps the offer of the same reply")
before = #setCalls
ns.AiWindow.handleAddonLink(linkOf(afterHistory))
assert(#setCalls == before + 1, "and its link still works")

ns.Core.dispatch({ t = "reply", id = "wp-off", chat = "other", provider = "claude", summary = "s", full = "Off screen forge.", waypoint = { uiMapId = 85, x = 1, y = 2, label = "Elsewhere" } })
assert(#setCalls == before + 1, "an off-screen reply with a waypoint sets nothing either")
rowsFor.other:Fire("OnClick", "LeftButton")
local elsewhere
for _, entry in ipairs(ns.AiWindow.entries()) do
  if entry.kind == "line" and entry.display:find("Elsewhere", 1, true) then
    elsewhere = entry
  end
end
assert(elsewhere ~= nil, "switching to that chat shows its offer")
ns.AiWindow.handleAddonLink(linkOf(elsewhere))
assert(setCalls[#setCalls].uiMapId == 85 and setCalls[#setCalls].label == "Elsewhere", "its link sets that chat's waypoint")

print("waypoint.offer: all assertions passed")
