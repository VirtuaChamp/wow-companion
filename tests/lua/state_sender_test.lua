dofile("tests/lua/wow_stubs.lua")

local realPrint = print
local printed = {}
_G.print = function(msg)
  table.insert(printed, msg)
end

local EXPECTED_EVENTS = {
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

local function freshSnapshot()
  return {
    character = { name = "N", level = 10, classId = 1, raceId = 1, faction = "Alliance", xp = 1, xpMax = 2 },
    position = { uiMapId = 85, zone = "Z", subzone = "", x = 1.5, y = 2.5 },
    money = 100,
    quests = {},
    equipped = {},
    bags = {},
    professions = {},
    talents = {},
  }
end

local function loadStateModule(ns)
  local chunk = assert(loadfile("addon/WoWCompanion/State.lua"))
  chunk("WoWCompanion", ns)
end

local function newSession(sendBehaviour)
  local ns = {}
  local sent = {}
  local ackedHandlers = {}
  ns.Transport = {
    send = function(tbl)
      table.insert(sent, tbl)
      if sendBehaviour then
        return sendBehaviour(tbl, #sent)
      end
      return #sent
    end,
    onHelloAcked = function(fn)
      table.insert(ackedHandlers, fn)
    end,
    onMessage = function() end,
  }
  loadStateModule(ns)
  local current = freshSnapshot()
  ns.State.snapshot = function()
    local copy = {}
    for key, value in pairs(current) do
      copy[key] = value
    end
    return copy
  end

  local frames = {}
  local realCreateFrame = _G.CreateFrame
  _G.CreateFrame = function()
    local frame = { events = {} }
    frame.RegisterEvent = function(self, event)
      self.events[event] = true
    end
    frame.SetScript = function(self, scriptType, handler)
      if scriptType == "OnEvent" then
        self.onEvent = handler
      end
    end
    table.insert(frames, frame)
    return frame
  end
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  local chunk = assert(loadfile("addon/WoWCompanion/StateSender.lua"))
  chunk("WoWCompanion", ns)
  _G.CreateFrame = realCreateFrame

  local session = {
    ns = ns,
    sent = sent,
    frame = frames[1],
    set = function(key, value)
      current[key] = value
    end,
    ack = function()
      for _, handler in ipairs(ackedHandlers) do
        handler()
      end
    end,
    fire = function(event)
      frames[1].onEvent(frames[1], event)
    end,
    timers = function()
      return _G.WOWC_TEST_TIMER_CALLBACKS
    end,
  }
  session.runTimers = function(seconds)
    local pending = _G.WOWC_TEST_TIMER_CALLBACKS
    _G.WOWC_TEST_TIMER_CALLBACKS = {}
    local ran = 0
    for _, entry in ipairs(pending) do
      if entry.seconds == seconds then
        entry.callback()
        ran = ran + 1
      else
        table.insert(_G.WOWC_TEST_TIMER_CALLBACKS, entry)
      end
    end
    return ran
  end
  return session
end

do
  local s = newSession()
  for _, event in ipairs(EXPECTED_EVENTS) do
    assert(s.frame.events[event], "state sender registers " .. event)
  end
  local count = 0
  for _ in pairs(s.frame.events) do
    count = count + 1
  end
  assert(count == #EXPECTED_EVENTS, "state sender registers only the listed events")
end

do
  local s = newSession()
  s.fire("PLAYER_MONEY")
  s.runTimers(0.5)
  assert(#s.sent == 0, "nothing is sent before the hello is acked")
  s.ack()
  assert(#s.sent == 1, "a full snapshot is sent right after the hello is acked")
  assert(s.sent[1].t == "state", "the message is a state message")
  assert(type(s.sent[1].seq) == "number", "the state message carries a numeric seq")
  for _, key in ipairs(SNAPSHOT_KEYS) do
    assert(s.sent[1].delta[key] ~= nil, "the first snapshot carries every key: " .. key)
  end
end

do
  local s = newSession()
  s.ack()
  assert(#s.sent == 1, "full snapshot sent")
  s.set("money", 250)
  s.set("position", { uiMapId = 85, zone = "Z", subzone = "", x = 9, y = 9 })
  for _ = 1, 5 do
    s.fire("PLAYER_MONEY")
    s.fire("ZONE_CHANGED")
  end
  assert(#s.sent == 1, "events alone send nothing before the coalescing tick")
  local ran = s.runTimers(0.5)
  assert(ran == 1, "a burst of events schedules exactly one coalescing tick, got " .. ran)
  assert(#s.sent == 2, "one delta per burst")
  assert(s.sent[2].delta.money == 250 and s.sent[2].delta.position.x == 9, "the delta carries the changed keys")
  assert(s.sent[2].delta.quests == nil and s.sent[2].delta.character == nil, "the delta carries only changed keys")
  assert(s.sent[2].seq ~= s.sent[1].seq, "each state message has its own seq")
end

do
  local s = newSession()
  s.ack()
  s.fire("QUEST_LOG_UPDATE")
  s.runTimers(0.5)
  assert(#s.sent == 1, "an event with nothing changed sends nothing")
end

do
  local s = newSession()
  s.ack()
  assert(#s.sent == 1, "full snapshot sent")

  assert(s.runTimers(2) == 1, "the position check runs on a 2 second timer")
  s.runTimers(0.5)
  assert(#s.sent == 1, "an unchanged position sends nothing")

  s.set("position", { uiMapId = 85, zone = "Z", subzone = "", x = 50, y = 60 })
  assert(#s.sent == 1, "a position change alone sends nothing until the next position check")
  assert(s.runTimers(2) == 1, "the position check re-arms itself every 2 seconds")
  assert(s.runTimers(0.5) == 1, "a changed position schedules one coalesced send")
  assert(#s.sent == 2, "a changed position is sent")
  local keys = 0
  for _ in pairs(s.sent[2].delta) do
    keys = keys + 1
  end
  assert(keys == 1 and s.sent[2].delta.position.x == 50, "only the position is sent")
end

do
  local s = newSession()
  s.ack()
  s.set("money", 5)
  s.runTimers(2)
  s.runTimers(2)
  assert(#s.timers() >= 1, "position checks re-arm")
  for _, entry in ipairs(s.timers()) do
    assert(entry.seconds == 0.5 or entry.seconds == 2, "only the coalescing and position timers exist")
  end
end

do
  local busy = true
  local s = newSession(function(_, index)
    if busy then
      return nil, "busy"
    end
    return index
  end)
  s.ack()
  assert(#s.sent == 1, "the busy attempt was made")
  busy = false
  s.runTimers(0.5)
  assert(#s.sent == 2, "a busy send is retried on the next coalescing tick")
  assert(s.sent[2].delta.character ~= nil, "the retry still carries the full snapshot")
  s.fire("PLAYER_MONEY")
  s.runTimers(0.5)
  assert(#s.sent == 2, "once delivered, an unchanged snapshot is not resent")
end

do
  local accepted = {}
  local s = newSession(function(tbl, index)
    local keyCount = 0
    for _ in pairs(tbl.delta) do
      keyCount = keyCount + 1
    end
    if keyCount > 1 or tbl.delta.quests ~= nil then
      return nil, "too_large"
    end
    for key in pairs(tbl.delta) do
      accepted[key] = true
    end
    return index
  end)
  s.ack()
  assert(accepted.money and accepted.position and accepted.character, "when the whole delta is too large, the other keys are still sent one by one")
  assert(accepted.quests == nil, "the key that is too large is the only one dropped")
  local before = #s.sent
  s.fire("PLAYER_MONEY")
  s.runTimers(0.5)
  assert(#s.sent == before, "a refused key is not retried every tick")
end

do
  local first = newSession()
  first.ack()
  assert(#first.sent == 1, "first session sends a full snapshot")
  local second = newSession()
  second.ack()
  assert(#second.sent == 1, "a new session sends a full snapshot again")
  assert(second.sent[1].delta.character ~= nil, "the new session's snapshot is complete")
end

_G.print = realPrint
realPrint("state_sender: all assertions passed")
