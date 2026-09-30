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
    assert(entry.seconds == 0.5 or entry.seconds == 2 or entry.seconds == 60, "only the coalescing, position and resync timers exist")
  end
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

do
  local s = newSession()
  s.ack()
  assert(#s.sent == 1, "full snapshot sent")
  s.set("money", 7)
  assert(s.runTimers(60) == 1, "a full snapshot resync runs on a 60 second timer")
  s.runTimers(0.5)
  assert(#s.sent == 2, "the resync sends a snapshot even when nothing changed since the last send")
  for _, key in ipairs(SNAPSHOT_KEYS) do
    assert(s.sent[2].delta[key] ~= nil, "the resync carries every key: " .. key)
  end
  assert(s.runTimers(60) == 1, "the resync timer re-arms itself")
end

do
  local s = newSession()
  s.set("character", nil)
  s.ack()
  assert(#s.sent == 0, "an incomplete first snapshot is not sent")
  s.set("character", freshSnapshot().character)
  s.runTimers(2)
  s.runTimers(0.5)
  assert(#s.sent == 1, "the first snapshot goes out once every key is present")
  for _, key in ipairs(SNAPSHOT_KEYS) do
    assert(s.sent[1].delta[key] ~= nil, "the first snapshot carries every key: " .. key)
  end
end

do
  local ns = {}
  local painted = {}
  ns.Codec = {
    encode = function(tbl, seq)
      return { { seq = seq, tbl = tbl } }, nil
    end,
    render = function(frame)
      return frame
    end,
    paint = function(frame)
      table.insert(painted, frame)
      return true
    end,
    hide = function() end,
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
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT("Interface\\AddOns\\WoWCompanion_Signals\\sig\\ctl-gone.wav", false)
  local inboxChunk = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  inboxChunk("WoWCompanion", ns)
  local senderChunk = assert(loadfile("addon/WoWCompanion/StateSender.lua"))
  local frameCreator = _G.CreateFrame
  _G.CreateFrame = function()
    return { RegisterEvent = function() end, SetScript = function() end }
  end
  senderChunk("WoWCompanion", ns)
  _G.CreateFrame = frameCreator

  local function runTimersFor(seconds)
    local pending = _G.WOWC_TEST_TIMER_CALLBACKS
    _G.WOWC_TEST_TIMER_CALLBACKS = {}
    for _, entry in ipairs(pending) do
      if entry.seconds == seconds then
        entry.callback()
      else
        table.insert(_G.WOWC_TEST_TIMER_CALLBACKS, entry)
      end
    end
  end

  local helloSeq = painted[1].seq
  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = helloSeq } })
  assert(painted[#painted].tbl.t == "state", "the full snapshot is painted right after the hello ack")
  runTimersFor(0.25)
  local askSeq = ns.Transport.send({ t = "ask", id = "a", chat = "c", text = "x", mentions = {} })
  assert(askSeq ~= nil, "an ask is held as the current entry")

  current.bags = { { bag = 0, slot = 1, itemId = 5, count = 1 } }
  ns.StateSender.schedule()
  runTimersFor(0.5)
  current.position = { uiMapId = 85, zone = "Z", subzone = "", x = 9, y = 9 }
  ns.StateSender.schedule()
  runTimersFor(0.5)

  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = askSeq } })
  local reached = {}
  for _, frame in ipairs(painted) do
    if frame.tbl.t == "state" and frame.tbl.delta then
      for key in pairs(frame.tbl.delta) do
        reached[key] = true
      end
    end
  end
  local last = painted[#painted]
  assert(last.tbl.t == "state", "the queued state is painted after the ask is acked")
  assert(last.tbl.delta.bags ~= nil and last.tbl.delta.position ~= nil, "two deltas queued behind an ask both reach the painted frames")
  assert(reached.bags and reached.position, "no key is lost")
end

do
  local ns = {}
  local sent = {}
  ns.Transport = {
    send = function(tbl)
      table.insert(sent, tbl)
      return #sent
    end,
    onHelloAcked = function() end,
    onMessage = function() end,
  }
  loadStateModule(ns)
  _G.UnitFactionGroup = function()
    return nil
  end
  local snapshot = ns.State.snapshot()
  assert(snapshot.character == nil, "the real snapshot omits character while the faction is unknown, so the sender must wait for it")
end

_G.print = realPrint
realPrint("state_sender: all assertions passed")
