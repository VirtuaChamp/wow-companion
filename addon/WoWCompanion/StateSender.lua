local _, ns = ...

ns.StateSender = ns.StateSender or {}

local COALESCE_SECONDS = 0.5
local POSITION_SECONDS = 2
local FULL_SNAPSHOT_SECONDS = 60
local EVENTS = {
  "PLAYER_ENTERING_WORLD",
  "PLAYER_LEVEL_UP",
  "PLAYER_XP_UPDATE",
  "PLAYER_MONEY",
  "ZONE_CHANGED",
  "ZONE_CHANGED_INDOORS",
  "ZONE_CHANGED_NEW_AREA",
  "QUEST_LOG_UPDATE",
  "BAG_UPDATE_DELAYED",
  "PLAYER_EQUIPMENT_CHANGED",
  "SKILL_LINES_CHANGED",
}

local SNAPSHOT_KEYS = {
  "character",
  "position",
  "money",
  "quests",
  "equipped",
  "bags",
  "professions",
  "talents",
}

local previous = nil
local ready = false
local flushPending = false
local stateSeq = 0
local snapshotFailWarned = false

local function sendOne(delta)
  stateSeq = stateSeq + 1
  return ns.Transport.send({ t = "state", seq = stateSeq, delta = delta })
end

local function sendDelta(delta)
  local seq = sendOne(delta)
  if seq then
    return
  end
  for key, value in pairs(delta) do
    local keyed = {}
    keyed[key] = value
    sendOne(keyed)
  end
end

local function isComplete(snapshot)
  for i = 1, #SNAPSHOT_KEYS do
    if snapshot[SNAPSHOT_KEYS[i]] == nil then
      return false
    end
  end
  return true
end

local function flush()
  flushPending = false
  if not ready then
    return
  end
  local ok, snapshot = pcall(ns.State.snapshot)
  if not ok then
    if not snapshotFailWarned then
      snapshotFailWarned = true
      print("WoW Companion: state snapshot failed: " .. tostring(snapshot))
    end
    return
  end
  if previous == nil and not isComplete(snapshot) then
    return
  end
  local delta = ns.State.delta(previous, snapshot)
  if delta == nil then
    return
  end
  sendDelta(delta)
  previous = snapshot
end

function ns.StateSender.schedule()
  if flushPending then
    return
  end
  flushPending = true
  C_Timer.After(COALESCE_SECONDS, flush)
end

local function onHelloAcked()
  ready = true
  previous = nil
  flushPending = false
  flush()
end

local function fullTick()
  if ready then
    previous = nil
    ns.StateSender.schedule()
  end
  C_Timer.After(FULL_SNAPSHOT_SECONDS, fullTick)
end

local function positionTick()
  if ready then
    ns.StateSender.schedule()
  end
  C_Timer.After(POSITION_SECONDS, positionTick)
end

local frame = CreateFrame("Frame")
for i = 1, #EVENTS do
  frame:RegisterEvent(EVENTS[i])
end
frame:SetScript("OnEvent", function()
  if ready then
    ns.StateSender.schedule()
  end
end)

ns.Transport.onHelloAcked(onHelloAcked)
C_Timer.After(POSITION_SECONDS, positionTick)
C_Timer.After(FULL_SNAPSHOT_SECONDS, fullTick)
