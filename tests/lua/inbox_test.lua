dofile("tests/lua/wow_stubs.lua")
_G.WOWC_TEST_SET_SIGNAL_PRESENT("Interface\\AddOns\\WoWCompanion_Signals\\sig\\ctl-gone.wav", false)

local realPrint = print
local printed = {}
_G.print = function(msg)
  table.insert(printed, msg)
end

local paintCalls = {}
local hideCalls = 0
local positionCalls = {}
local fakePosition = "top"
local encodeCalls = {}
local encodeFailFor = nil

local fakeCodec = {
  encode = function(tbl, seq)
    table.insert(encodeCalls, { tbl = tbl, seq = seq })
    if encodeFailFor ~= nil and tbl.id == encodeFailFor then
      return nil, "boom"
    end
    return { { seq = seq, tbl = tbl } }, nil
  end,
  render = function(frame)
    return frame
  end,
  paint = function(cells)
    table.insert(paintCalls, cells)
    return true
  end,
  hide = function()
    hideCalls = hideCalls + 1
  end,
  setPosition = function(position)
    if position ~= "top" and position ~= "bottom" then
      return nil, "bad_position"
    end
    positionCalls[#positionCalls + 1] = position
    fakePosition = position
    return true
  end,
  position = function()
    return fakePosition
  end,
}

local ns = {}
ns.Codec = fakeCodec
local chunk = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
chunk("WoWCompanion", ns)

local timerCallbacks = _G.WOWC_TEST_TIMER_CALLBACKS
assert(
  timerCallbacks ~= nil and #timerCallbacks == 3,
  "repaint, slot-poll and hello-announce timers registered at load"
)

local repaintCursor = 1
local pollCursor = 2
local helloCursor = 3

local function tickRepaint()
  local entry = timerCallbacks[repaintCursor]
  entry.callback()
  repaintCursor = #timerCallbacks
end

local function tickPoll()
  local entry = timerCallbacks[pollCursor]
  entry.callback()
  pollCursor = #timerCallbacks
end

local function tickHello()
  local entry = timerCallbacks[helloCursor]
  entry.callback()
  helloCursor = #timerCallbacks
end

do
  assert(#paintCalls == 1, "inbox: hello is painted at load")
  assert(paintCalls[1].tbl.t == "hello", "the first paint is a hello")
  assert(paintCalls[1].tbl.slot == 1, "hello carries the addon's current next-slot index")
  assert(paintCalls[1].tbl.session == ns.Transport.session(), "hello carries the addon's session")
end

do
  local helloSeq = paintCalls[1].seq
  tickRepaint()
  assert(#paintCalls == 2, "an unacked hello keeps repainting")
  assert(paintCalls[2].tbl.t == "hello", "hello never gives up, it is still current")
  assert(paintCalls[2].seq == helloSeq, "hello keeps the same seq while its slot position is unchanged")
end

local SIGNAL_DIR = "Interface\\AddOns\\WoWCompanion_Signals\\sig\\"
local CONTROL_PRESENT = SIGNAL_DIR .. "ctl-present.wav"
local CONTROL_GONE = SIGNAL_DIR .. "ctl-gone.wav"
local SLOT_1_SIGNAL = SIGNAL_DIR .. "001.wav"

local function countMatching(pattern)
  local count = 0
  for i = 1, #printed do
    if printed[i]:find(pattern, 1, true) then
      count = count + 1
    end
  end
  return count
end

do
  local before = #printed
  local ok = pcall(WoWCompanion_Deliver, nil, nil)
  assert(ok, "a placeholder slot (WoWCompanion_Deliver(nil, nil)) raises nothing")
  local handled = 0
  ns.Transport.onMessage(function()
    handled = handled + 1
  end)
  WoWCompanion_Deliver(nil, nil)
  WoWCompanion_Deliver(nil, {})
  WoWCompanion_Deliver("not-the-session", { { t = "state", seq = 1 } })
  assert(handled == 0, "a placeholder or foreign-session delivery reaches no handler")
  assert(#printed == before, "a placeholder slot prints nothing")
end

do
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, true)
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(SLOT_1_SIGNAL, false)
  for _ = 1, 5 do
    tickPoll()
  end
  assert(_G.WOWC_TEST_LOADED_ADDONS == nil, "self-test: with ctl-gone still present the addon waits and reads no slot even when a slot signal is absent")
  assert(countMatching("reply signals not working") == 0, "self-test: waiting for the companion to delete ctl-gone prints nothing")
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(SLOT_1_SIGNAL, true)
end

do
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  for _ = 1, 20 do
    tickPoll()
  end
  assert(_G.WOWC_TEST_LOADED_ADDONS == nil, "field bug: with every slot signal file present and nothing written, no slot addon is loaded")
  assert(_G.WOWC_TEST_ENABLED_ADDONS == nil, "field bug: no slot addon is enabled while every slot signal file is present")
  assert(ns.Transport.slotsLeft() == 200, "field bug: the slot position stays at the first slot while every slot signal file is present")
  assert(countMatching("failed to load reply slot") == 0, "field bug: no slot load failure is reported")
  assert(countMatching("is empty") == 0, "field bug: no empty-file error is reported")
end

do
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_PRESENT, false)
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(SLOT_1_SIGNAL, false)
  for _ = 1, 5 do
    tickPoll()
  end
  assert(_G.WOWC_TEST_LOADED_ADDONS == nil, "self-test: with ctl-present missing the client cannot be trusted and no slot is read")
  assert(countMatching("reply signals not working on this client, restart the game after setup") == 1, "self-test: the warning is printed once, not on every tick")
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_PRESENT, true)
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(SLOT_1_SIGNAL, true)
end

do
  local issuedBefore = #_G.WOWC_TEST_ISSUED_SOUND_HANDLES
  local stoppedBefore = #_G.WOWC_TEST_STOPPED_SOUND_HANDLES
  tickPoll()
  local issued = {}
  for i = issuedBefore + 1, #_G.WOWC_TEST_ISSUED_SOUND_HANDLES do
    table.insert(issued, _G.WOWC_TEST_ISSUED_SOUND_HANDLES[i])
  end
  local stopped = {}
  for i = stoppedBefore + 1, #_G.WOWC_TEST_STOPPED_SOUND_HANDLES do
    table.insert(stopped, _G.WOWC_TEST_STOPPED_SOUND_HANDLES[i])
  end
  assert(#issued == 2, "each present signal file probed returns a sound handle (ctl-present and slot 1)")
  assert(#stopped == #issued, "StopSound is called once per handle a present file returned")
  for i = 1, #issued do
    assert(stopped[i] == issued[i], "StopSound receives the very handle PlaySoundFile returned")
  end
end

do
  local sigPath = "Interface\\AddOns\\WoWCompanion_Signals\\sig\\001.wav"
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(sigPath, false)
  tickPoll()
  assert(_G.WOWC_TEST_LOADED_ADDONS[1] == "WoWCompanion_R001", "a reload during which the addon passed slot 1 advances its own position")

  local before = #encodeCalls
  tickRepaint()
  assert(#encodeCalls == before + 1, "hello is re-encoded once the addon's slot position changes while it is pending")
  local last = encodeCalls[#encodeCalls]
  assert(last.tbl.t == "hello" and last.tbl.slot == 2, "the re-encoded hello reports the addon's real position")
  assert(last.seq ~= paintCalls[1].seq, "the re-encoded hello uses a fresh seq")
end

do
  local helloSeq = paintCalls[#paintCalls].seq
  local probesBefore = _G.WOWC_TEST_SIGNAL_PROBES[CONTROL_GONE]
  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = helloSeq } })
  assert(_G.WOWC_TEST_SIGNAL_PROBES[CONTROL_GONE] > probesBefore, "self-test: the check runs again when the hello is acked")
  local before = #paintCalls
  tickRepaint()
  assert(#paintCalls == before, "acking hello stops its re-paint")
end

do
  local before = #paintCalls
  tickHello()
  assert(#paintCalls == before + 1, "the hello-announce timer re-sends hello on its interval")
  assert(paintCalls[#paintCalls].tbl.t == "hello", "the re-announce is a hello")
  assert(paintCalls[#paintCalls].tbl.again == true, "the re-announce is marked again")

  local beforeSecondTick = #paintCalls
  tickHello()
  assert(#paintCalls == beforeSecondTick, "a second interval tick does not queue another hello while one is still in flight")

  local beforeRepaint = #paintCalls
  tickRepaint()
  assert(
    #paintCalls == beforeRepaint,
    "an again hello is never held or repainted for an ack; it advances on its own after one pass"
  )
end

do
  local before = #paintCalls
  local delivered = {}
  ns.Transport.onMessage(function(msg)
    table.insert(delivered, msg)
  end)
  WoWCompanion_Deliver(
    ns.Transport.session(),
    { { t = "state", seq = 1 }, { t = "cmd", chat = "c", name = "new" } }
  )
  assert(#delivered == 2, "inbox.deliver: both messages dispatched")
  assert(delivered[1].t == "state", "inbox.deliver: dispatched in order, first")
  assert(delivered[2].t == "cmd", "inbox.deliver: dispatched in order, second")
end

do
  local before = #paintCalls
  local seq = ns.Transport.send({ t = "ask", id = "a1", chat = "c", text = "hi", mentions = {} })
  assert(type(seq) == "number", "send returns a numeric seq")
  assert(#paintCalls == before + 1, "send paints immediately once nothing else is in flight")
  tickRepaint()
  assert(#paintCalls == before + 2, "unacked ask is re-painted on the next tick")
  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = seq } })
  tickRepaint()
  assert(#paintCalls == before + 2, "inbox.deliver: an ack stops the matching re-paint")
end

do
  local before = #paintCalls
  local seqA = ns.Transport.send({ t = "ask", id = "a2", chat = "c", text = "a", mentions = {} })
  assert(#paintCalls == before + 1, "a fresh send paints immediately once nothing else is in flight")
  local seqB = ns.Transport.send({ t = "ask", id = "b2", chat = "c", text = "b", mentions = {} })
  assert(#paintCalls == before + 1, "a queued second send does not paint until the first is acked")
  tickRepaint()
  tickRepaint()
  tickRepaint()
  assert(#paintCalls == before + 4, "a2 keeps repainting on every tick while unacked")
  assert(paintCalls[#paintCalls].seq == seqA, "the queue does not advance to b2 while a2 is unacked")
  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = seqA } })
  assert(paintCalls[#paintCalls].seq == seqB, "the ack of a2 hands the line to b2")
  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = seqB } })
  local afterAcks = #paintCalls
  tickRepaint()
  assert(#paintCalls == afterAcks, "b2 stops repainting once acked")
  assert(seqA ~= seqB, "each send gets a distinct seq")
end

do
  local delivered = {}
  ns.Transport.onMessage(function(msg)
    table.insert(delivered, msg)
  end)
  WoWCompanion_Deliver("stale-session-token", { { t = "state", seq = 42 } })
  assert(#delivered == 0, "a delivery stamped with a stale session token is ignored")
end

do
  local before = #paintCalls
  local seq = ns.Transport.send({ t = "state", seq = 9 })
  assert(#paintCalls == before + 1, "a state message paints once immediately")
  tickRepaint()
  assert(#paintCalls == before + 1, "a state message is not re-painted after one pass, unlike ask/items/cmd")
end

do
  local before = #paintCalls
  local askSeq = ns.Transport.send({ t = "ask", id = "hold-current", chat = "c", text = "x", mentions = {} })
  assert(askSeq ~= nil, "an ask is held as the current entry")
  ns.Transport.send({ t = "state", seq = 1, delta = { bags = { 1 }, money = 1 } })
  ns.Transport.send({ t = "state", seq = 2, delta = { position = { 2 }, money = 2 } })
  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = askSeq } })
  local painted = paintCalls[#paintCalls]
  assert(painted.tbl.t == "state", "the queued state is painted once the ask is acked")
  assert(painted.tbl.delta.bags ~= nil, "a key only the older state carries is kept")
  assert(painted.tbl.delta.position ~= nil, "a key only the newer state carries is kept")
  assert(painted.tbl.delta.money == 2, "on a shared key the newer value wins")
  for _ = 1, 3 do
    tickRepaint()
  end
  local stateFrames = 0
  for index = before + 1, #paintCalls do
    if paintCalls[index].tbl.t == "state" then
      stateFrames = stateFrames + 1
    end
  end
  assert(stateFrames >= 1, "the merged state is painted")
end

do
  encodeFailFor = "bad-encode"
  local seq, err = ns.Transport.send({ t = "ask", id = "bad-encode", chat = "c", text = "x", mentions = {} })
  assert(seq == nil, "an encode failure returns no seq")
  assert(err == "boom", "an encode failure returns the codec error")
  encodeFailFor = nil
end

do
  for i = 1, 8 do
    ns.Transport.send({ t = "ask", id = "queue" .. i, chat = "c", text = "x", mentions = {} })
  end
  local seq, err = ns.Transport.send({ t = "ask", id = "overflow", chat = "c", text = "x", mentions = {} })
  assert(seq == nil, "the ninth queued-or-current send is refused")
  assert(err == "busy", "queue overflow returns busy")
  local before = #printed
  ns.Transport.send({ t = "ask", id = "overflow2", chat = "c", text = "x", mentions = {} })
  assert(#printed == before, "a refused ask prints nothing here: the Claude window reports it")
  local cmdSeq, cmdErr = ns.Transport.send({ t = "cmd", id = "cmd-full", chat = "c", name = "new" })
  assert(cmdSeq == nil and cmdErr == "busy", "a cmd that meets a full queue is refused with busy")
  assert(printed[#printed] == "WoW Companion: busy, not sent" and #printed == before + 1, "and the busy notice is shown instead of the cmd vanishing")
  local itemsSeq, itemsErr = ns.Transport.send({ t = "items", req = "r-full", items = {} })
  assert(itemsSeq == nil and itemsErr == "busy", "an items reply that meets a full queue is refused with busy")
  assert(printed[#printed] == "WoW Companion: busy, not sent" and #printed == before + 2, "and it shows the same notice")
end

do
  local runnerFired = false
  local sigPath = "Interface\\AddOns\\WoWCompanion_Signals\\sig\\002.wav"
  _G.WOWC_TEST_ADDON_RUNNERS = {
    WoWCompanion_R002 = function()
      runnerFired = true
      WoWCompanion_Deliver(ns.Transport.session(), { { t = "state", seq = 99 } })
    end,
  }
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(sigPath, false)
  tickPoll()
  assert(runnerFired, "an absent signal file loads and runs the matching slot addon")
  assert(_G.WOWC_TEST_ENABLED_ADDONS[2] == "WoWCompanion_R002", "the addon is enabled before load")
  assert(_G.WOWC_TEST_LOADED_ADDONS[2] == "WoWCompanion_R002", "the addon is loaded once ready")
end

do
  _G.WOWC_TEST_ADDON_LOAD_RESULTS = { WoWCompanion_R003 = { false, "DISABLED" } }
  local before = ns.Transport.slotsLeft()
  local sigPath = "Interface\\AddOns\\WoWCompanion_Signals\\sig\\003.wav"
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(sigPath, false)
  tickPoll()
  assert(ns.Transport.slotsLeft() == before, "a LoadAddOn failure does not advance the slot position")
  local sawFailure = false
  for i = 1, #printed do
    if printed[i]:find("failed to load reply slot") then
      sawFailure = true
    end
  end
  assert(sawFailure, "a LoadAddOn failure is reported")
  _G.WOWC_TEST_ADDON_LOAD_RESULTS = nil
  tickPoll()
  assert(ns.Transport.slotsLeft() == before - 1, "the slot loads and advances once the failure clears")
end

do
  for i = 4, 180 do
    local path = ("Interface\\AddOns\\WoWCompanion_Signals\\sig\\%03d.wav"):format(i)
    _G.WOWC_TEST_SET_SIGNAL_PRESENT(path, false)
    tickPoll()
  end
  local sawWarning = false
  for i = 1, #printed do
    if printed[i]:find("reply slots left") then
      sawWarning = true
    end
  end
  assert(sawWarning, "the 20-left warning prints once the pool drops to 20 remaining")
end

do
  for i = 181, 200 do
    local path = ("Interface\\AddOns\\WoWCompanion_Signals\\sig\\%03d.wav"):format(i)
    _G.WOWC_TEST_SET_SIGNAL_PRESENT(path, false)
    tickPoll()
  end
  tickPoll()
  local sawExhausted = false
  for i = 1, #printed do
    if printed[i]:find("reload") then
      sawExhausted = true
    end
  end
  assert(sawExhausted, "the pool exhausted message asks the user to /reload")
end

do
  local fakeCodecForReload = {
    encode = function(tbl, seq)
      return { { seq = seq, tbl = tbl } }, nil
    end,
    render = function(frame)
      return frame
    end,
    hide = function() end,
    paint = function() end,
  }

  math.randomseed(1)
  _G.WOWC_TEST_SERVER_TIME = 1000
  _G.WOWC_TEST_PROFILE_STOP = 500
  _G.WOWC_TEST_GAME_TIME = 10.25
  local firstNs = {}
  firstNs.Codec = fakeCodecForReload
  local firstChunk = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  firstChunk("WoWCompanion", firstNs)
  local firstSession = firstNs.Transport.session()

  math.randomseed(1)
  _G.WOWC_TEST_SERVER_TIME = 1000
  _G.WOWC_TEST_PROFILE_STOP = 500.7
  _G.WOWC_TEST_GAME_TIME = 10.9
  local secondNs = {}
  secondNs.Codec = fakeCodecForReload
  local secondChunk = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  secondChunk("WoWCompanion", secondNs)
  local secondSession = secondNs.Transport.session()

  assert(
    firstSession ~= secondSession,
    "gen-r2-1: even with the same math.random seed and the same whole-second server time on both "
      .. "loads (the worst case, an unseeded client RNG reset every reload), a fresh debugprofilestop/"
      .. "GetTime reading still changes the session token"
  )
end

do
  local encodeCalls = {}
  local fakeCodecForSeq = {
    encode = function(tbl, seq)
      table.insert(encodeCalls, seq)
      return { { seq = seq, tbl = tbl } }, nil
    end,
    render = function(frame)
      return frame
    end,
    hide = function() end,
    paint = function() end,
  }

  math.randomseed(1)
  _G.WOWC_TEST_TIME = 5000
  _G.WOWC_TEST_SERVER_TIME = 2000
  _G.WOWC_TEST_PROFILE_STOP = 900
  _G.WOWC_TEST_GAME_TIME = 3.5
  local firstNs = {}
  firstNs.Codec = fakeCodecForSeq
  local firstChunk = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  firstChunk("WoWCompanion", firstNs)
  local firstSeq = encodeCalls[#encodeCalls]

  math.randomseed(1)
  _G.WOWC_TEST_TIME = 5000
  _G.WOWC_TEST_SERVER_TIME = 2000
  _G.WOWC_TEST_PROFILE_STOP = 900.3
  _G.WOWC_TEST_GAME_TIME = 3.9
  local secondNs = {}
  secondNs.Codec = fakeCodecForSeq
  local secondChunk = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  secondChunk("WoWCompanion", secondNs)
  local secondSeq = encodeCalls[#encodeCalls]

  assert(
    firstSeq ~= secondSeq,
    "aca-r2-10: nextFrameSeq's starting value is not derived from time() alone -- two loads with an "
      .. "identical time() reading still start their frame seq differently"
  )
end

do
  local paintCallsB = {}
  local fakeCodecB = {
    encode = function(tbl, seq)
      return { { seq = seq, tbl = tbl } }, nil
    end,
    render = function(frame)
      return frame
    end,
    hide = function() end,
    paint = function(cells)
      table.insert(paintCallsB, cells)
    end,
  }
  local nsB = {}
  nsB.Codec = fakeCodecB
  local chunkB = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  chunkB("WoWCompanion", nsB)

  local allCallbacks = _G.WOWC_TEST_TIMER_CALLBACKS
  local nB = #allCallbacks
  local repaintIndexB = nB - 2
  local pollIndexB = nB - 1

  assert(#paintCallsB == 1, "aca-r3-5: fresh load paints hello once")
  local firstSeq = paintCallsB[1].seq

  local sigPathB = "Interface\\AddOns\\WoWCompanion_Signals\\sig\\001.wav"
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(sigPathB, false)
  allCallbacks[pollIndexB].callback()

  allCallbacks[repaintIndexB].callback()
  repaintIndexB = #allCallbacks
  assert(#paintCallsB == 2, "aca-r3-5: the hello is rebuilt after the slot position changes")
  assert(paintCallsB[2].seq ~= firstSeq, "aca-r3-5: the rebuild uses a fresh seq")

  WoWCompanion_Deliver(nsB.Transport.session(), { { t = "ack", seq = firstSeq } })
  local beforeB = #paintCallsB
  allCallbacks[repaintIndexB].callback()
  assert(
    #paintCallsB == beforeB,
    "aca-r3-5: an ack for the first seq issued still stops the current (rebuilt) hello's re-paint"
  )
end

do
  local paintCallsC = {}
  local fakeCodecC = {
    encode = function(tbl, seq)
      if tbl.t == "hello" then
        return { { seq = seq, tbl = tbl } }, nil
      end
      if tbl.big then
        return nil, "too_large"
      end
      return { { seq = seq, tbl = tbl } }, nil
    end,
    encodeJson = function(value)
      return string.rep("x", value.size)
    end,
    render = function(frame)
      return frame
    end,
    hide = function() end,
    paint = function(cells)
      table.insert(paintCallsC, cells)
    end,
  }
  local nsC = {}
  nsC.Codec = fakeCodecC
  local chunkC = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  chunkC("WoWCompanion", nsC)
  local paintsBefore = #paintCallsC

  printed = {}
  local seq, err = nsC.Transport.send({
    t = "state",
    seq = 1,
    big = true,
    delta = { quests = { size = 20000 }, bags = { size = 300 }, money = { size = 3 } },
  })
  assert(seq == nil and err == "too_large", "too-large state is refused with too_large")
  assert(#printed == 1, "one line is printed for a refused state, got " .. #printed)
  assert(printed[1] == "WoW Companion: some game data was not sent, it is too large for the signal line", "the line is plain: prefix, what was not sent, why")
  for _, internal in ipairs({ "state", "quests", "bags", "delta" }) do
    assert(not printed[1]:find(internal, 1, true), "the line names no internal term: " .. internal)
  end

  printed = {}
  seq, err = nsC.Transport.send({ t = "ask", id = "a1", chat = "default", text = "x", mentions = {}, big = true })
  assert(seq == nil and err == "too_large", "too-large ask is refused with too_large")
  assert(#printed == 1 and printed[1] == "WoW Companion: your question was not sent, it is too large for the signal line", "the line says in plain words that the question was not sent")
  assert(#paintCallsC == paintsBefore, "nothing is painted for a refused payload")

  printed = {}
  seq = nsC.Transport.send({ t = "state", seq = 2, delta = { money = { size = 3 } } })
  assert(seq ~= nil and #printed == 0, "a payload within the limit is sent and prints nothing")
end

do
  local paintCallsD = {}
  local fakeCodecD = {
    encode = function(tbl, seq)
      if tbl.big then
        return nil, "too_large"
      end
      return { { seq = seq, tbl = tbl } }, nil
    end,
    encodeJson = function(value)
      return string.rep("x", value.size)
    end,
    render = function(frame)
      return frame
    end,
    hide = function() end,
    paint = function(cells)
      table.insert(paintCallsD, cells)
    end,
  }
  local nsD = {}
  nsD.Codec = fakeCodecD
  local chunkD = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  chunkD("WoWCompanion", nsD)

  local acked = 0
  nsD.Transport.onHelloAcked(function()
    acked = acked + 1
  end)
  local helloSeq = paintCallsD[1].seq
  WoWCompanion_Deliver(nsD.Transport.session(), { { t = "ack", seq = helloSeq } })
  assert(acked == 1, "the hello-acked handler runs once when the hello is acked")
  WoWCompanion_Deliver(nsD.Transport.session(), { { t = "ack", seq = helloSeq } })
  assert(acked == 1, "a repeated ack does not run the handler again")

  printed = {}
  local bigState = { t = "state", seq = 1, big = true, delta = { quests = { size = 20000 } } }
  for _ = 1, 3 do
    local seq, err = nsD.Transport.send(bigState)
    assert(seq == nil and err == "too_large", "a too-large state is refused every time")
  end
  assert(#printed == 1, "the too-large line is printed once per message description, got " .. #printed)
  local seqAsk = nsD.Transport.send({ t = "ask", id = "a", chat = "c", text = "x", mentions = {}, big = true })
  assert(seqAsk == nil and #printed == 2, "a different message type prints its own line once")

  local cmdSeq = nsD.Transport.send({ t = "cmd", chat = "c", name = "new" })
  assert(cmdSeq ~= nil, "a cmd becomes the current entry")
  local queuedSeq = nsD.Transport.send({ t = "state", seq = 2, delta = { money = { size = 1 } } })
  assert(queuedSeq ~= nil, "a valid state queues behind the cmd")
  local refusedSeq, refusedErr =
    nsD.Transport.send({ t = "state", seq = 3, big = true, delta = { quests = { size = 20000 } } })
  assert(refusedSeq == nil and refusedErr == "too_large", "the too-large state is refused")
  WoWCompanion_Deliver(nsD.Transport.session(), { { t = "ack", seq = cmdSeq } })
  local lastPainted = paintCallsD[#paintCallsD]
  assert(
    lastPainted.tbl.t == "state" and lastPainted.tbl.seq == 2,
    "a refused state does not drop the earlier valid queued state"
  )
end

do
  local paintCallsM = {}
  local fakeCodecM = {
    encode = function(tbl, seq)
      if tbl.t == "hello" then
        return { { seq = seq, tbl = tbl } }, nil
      end
      local keys = 0
      for _ in pairs(tbl.delta or {}) do
        keys = keys + 1
      end
      if keys > 1 then
        return nil, "too_large"
      end
      return { { seq = seq, tbl = tbl } }, nil
    end,
    render = function(frame)
      return frame
    end,
    hide = function() end,
    paint = function(cells)
      table.insert(paintCallsM, cells)
    end,
  }
  local nsM = {}
  nsM.Codec = fakeCodecM
  local chunkM = assert(loadfile("addon/WoWCompanion/Inbox.lua"))
  chunkM("WoWCompanion", nsM)
  local helloSeqM = paintCallsM[1].seq
  WoWCompanion_Deliver(nsM.Transport.session(), { { t = "ack", seq = helloSeqM } })
  local holdSeq = nsM.Transport.send({ t = "cmd", chat = "c", name = "new" })
  nsM.Transport.send({ t = "state", seq = 1, delta = { bags = { 1 } } })
  nsM.Transport.send({ t = "state", seq = 2, delta = { position = { 2 } } })
  WoWCompanion_Deliver(nsM.Transport.session(), { { t = "ack", seq = holdSeq } })
  local first = paintCallsM[#paintCallsM]
  assert(first.tbl.t == "state" and first.tbl.delta.bags ~= nil, "when the merge is too large the older state stays queued and is painted first")
  local firstSeq = first.seq
  local repaintM = _G.WOWC_TEST_TIMER_CALLBACKS
  local seenPosition = false
  local repaintIndex = #repaintM - 2
  for _ = 1, 4 do
    repaintM[repaintIndex].callback()
    repaintIndex = #repaintM
    local painted = paintCallsM[#paintCallsM]
    if painted.tbl.t == "state" and painted.tbl.delta.position ~= nil then
      seenPosition = true
    end
  end
  assert(firstSeq ~= nil and seenPosition, "when the merge is too large the newer state stays queued behind the older one")
end

do
  local function freshInbox()
    local painted = {}
    local hides = { count = 0 }
    local codec = {
      encode = function(tbl, seq)
        local frames = {}
        for i = 1, tbl.n or 1 do
          frames[i] = { seq = seq, tbl = tbl, index = i }
        end
        return frames, nil
      end,
      render = function(frame)
        return frame
      end,
      paint = function(frame)
        table.insert(painted, frame)
        return true
      end,
      hide = function()
        hides.count = hides.count + 1
      end,
    }
    _G.WOWC_TEST_TIMER_CALLBACKS = {}
    local fresh = { Codec = codec }
    assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", fresh)
    local list = _G.WOWC_TEST_TIMER_CALLBACKS
    local cursors = { repaint = 1, poll = 2, hello = 3 }
    local function fire(name)
      list[cursors[name]].callback()
      cursors[name] = #list
    end
    return fresh, painted, hides, fire
  end

  local fresh, painted, hides, fire = freshInbox()
  assert(#painted == 1 and hides.count == 0, "the line shows while the first hello waits for its ack")
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = painted[1].seq } })
  assert(hides.count == 1, "the line is hidden once the queue is empty")

  local askSeq = fresh.Transport.send({ t = "ask", id = "q1", chat = "c", text = "x", mentions = {} })
  assert(#painted == 2 and hides.count == 1, "sending an ask shows the line")
  fire("repaint")
  assert(hides.count == 1, "an unacked ask keeps the line showing")
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = askSeq } })
  assert(hides.count == 2, "the acked ask hides the line again")

  local before = #painted
  fresh.Transport.send({ t = "state", seq = 9, delta = {}, n = 2 })
  assert(#painted == before + 1 and painted[#painted].index == 1, "a two frame state paints its first frame at once")
  _G.WOWC_TEST_FREEZE_CLOCK = true
  fire("repaint")
  assert(#painted == before + 1, "a frame is held at least 200 ms before the next one")
  _G.WOWC_TEST_GAME_TIME = (_G.WOWC_TEST_GAME_TIME or 0) + 0.25
  fire("repaint")
  assert(#painted == before + 2 and painted[#painted].index == 2, "after the hold the second frame is painted")
  _G.WOWC_TEST_GAME_TIME = _G.WOWC_TEST_GAME_TIME + 0.25
  fire("repaint")
  assert(hides.count == 3, "after its last frame a state hides the line")
  _G.WOWC_TEST_FREEZE_CLOCK = nil

  local hidesBefore = hides.count
  fire("repaint")
  fire("repaint")
  assert(hides.count == hidesBefore and #painted == before + 2, "an idle queue paints nothing")

  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, true)
  local waiting, waitingPainted, waitingHides, waitingFire = freshInbox()
  assert(#waitingPainted == 0, "companion not running (ctl-gone present): the first hello is not painted at load")
  for _ = 1, 10 do
    waitingFire("poll")
    waitingFire("repaint")
  end
  assert(#waitingPainted == 0, "companion not running: nothing is painted while ctl-gone stays")
  assert(waitingHides.count >= 1 and waiting.Transport.session() ~= nil, "the line is kept hidden while the addon keeps polling")
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  waitingFire("poll")
  assert(#waitingPainted == 1 and waitingPainted[1].tbl.t == "hello", "the hello is painted on the poll tick that sees ctl-gone deleted")

  local running, runningPainted, runningHides, runningFire = freshInbox()
  assert(#runningPainted == 1, "companion running: the hello is painted at load")
  for _ = 1, 3 do
    runningFire("repaint")
  end
  assert(#runningPainted == 4, "companion running, hello unacked: the hello is repainted on every tick")
  local unreadableBefore = countMatching("can't read its signal line")
  for _ = 1, 82 do
    runningFire("poll")
  end
  assert(countMatching("can't read its signal line") == unreadableBefore + 1, "still unacked after 20 s: the video settings line is printed once")
  local afterWarning = #runningPainted
  local hidesAfterWarning = runningHides.count
  assert(hidesAfterWarning >= 1, "still unacked after 20 s: the line is hidden")
  for _ = 1, 4 do
    runningFire("repaint")
  end
  assert(#runningPainted == afterWarning, "dormant hello: nothing is painted between the 10 s ticks")
  runningFire("hello")
  assert(#runningPainted == afterWarning + 1 and runningPainted[#runningPainted].tbl.t == "hello", "dormant hello: it is repainted at the 10 s tick")
  runningFire("repaint")
  assert(#runningPainted == afterWarning + 1, "dormant hello: the blink is held then not repainted")
  assert(runningHides.count > hidesAfterWarning, "dormant hello: the line is hidden again after the blink")
  runningFire("hello")
  assert(#runningPainted == afterWarning + 2, "dormant hello: every 10 s tick blinks again")
  runningFire("repaint")
  WoWCompanion_Deliver(running.Transport.session(), { { t = "ack", seq = runningPainted[#runningPainted].seq } })
  local afterAck = #runningPainted
  for _ = 1, 3 do
    runningFire("repaint")
  end
  assert(#runningPainted == afterAck, "an ack returns to normal: the idle line stays hidden")
  running.Transport.send({ t = "ask", id = "q9", chat = "c", text = "x", mentions = {} })
  assert(#runningPainted == afterAck + 1 and runningPainted[#runningPainted].tbl.t == "ask", "after the ack a new message paints normally")
end

do
  local function unreadableCount()
    return countMatching("can't read its signal line")
  end
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, true)
  local function loadFresh()
    _G.WOWC_TEST_TIMER_CALLBACKS = {}
    local painted = {}
    local fresh = {
      Codec = {
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
      },
    }
    assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", fresh)
    local list = _G.WOWC_TEST_TIMER_CALLBACKS
    local cursor = 2
    local function poll(times)
      for _ = 1, times do
        list[cursor].callback()
        cursor = #list
      end
    end
    return fresh, painted, poll
  end

  local baseline = unreadableCount()
  local _, _, pollIdle = loadFresh()
  pollIdle(100)
  assert(unreadableCount() == baseline, "no warning while the companion is not running (ctl-gone present)")

  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local fresh, painted, poll = loadFresh()
  poll(75)
  assert(unreadableCount() == baseline, "no warning before 20 seconds without an ack")
  poll(10)
  assert(unreadableCount() == baseline + 1, "one warning after 20 seconds with the companion running")
  local text = printed[#printed]
  for _, word in ipairs({ "anti-aliasing", "render scale to 100% in Options > Graphics", "Options > AddOns > WoW Companion" }) do
    assert(text:find(word, 1, true), "the warning names " .. word)
  end
  assert(#text <= 170 and #printed[#printed - 1] <= 90, "the warning is two short lines")
  assert(printed[#printed - 1]:find("Alt+Z", 1, true), "the first line says the line cannot be read while the interface is hidden")
  for _, line in ipairs({ printed[#printed - 1], text }) do
    assert(line:sub(1, 15) == "WoW Companion: ", "the warning lines use the addon's one chat prefix")
    for _, internal in ipairs({ "hello", "cmd", "ask", "items", "state", "daemon", "seq" }) do
      assert(not line:find(internal, 1, true), "the warning names no internal term: " .. internal)
    end
  end
  for _, product in ipairs({ "Discord", "GeForce", "Steam", "f.lux" }) do
    assert(not text:find(product, 1, true), "the warning names no product: " .. product)
  end
  poll(40)
  assert(unreadableCount() == baseline + 1, "the warning prints once per load")
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, true)
  local lateFresh, latePainted, latePoll = loadFresh()
  latePoll(100)
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local afterLate = unreadableCount()
  latePoll(10)
  assert(unreadableCount() == afterLate, "a companion that starts after the game gets 20 seconds of its own before any warning")
  latePoll(75)
  assert(unreadableCount() == afterLate + 1, "one warning 20 seconds after the companion appeared")
  WoWCompanion_Deliver(lateFresh.Transport.session(), { { t = "ack", seq = latePainted[1].seq } })
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = painted[1].seq } })
  poll(100)
  assert(unreadableCount() == afterLate + 1, "an acked hello stops the warning")
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, true)
end

do
  local function loadWith(codec)
    _G.WOWC_TEST_TIMER_CALLBACKS = {}
    _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
    local fresh = { Codec = codec }
    assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", fresh)
    local list = _G.WOWC_TEST_TIMER_CALLBACKS
    local cursors = { repaint = 1, poll = 2, hello = 3 }
    return fresh, function(name)
      list[cursors[name]].callback()
      cursors[name] = #list
    end
  end

  local attempts = {}
  local encodes = {}
  local hides = 0
  local shrinkAfter = 1
  local failWith = "too_large"
  local codec = {
    encode = function(tbl, seq)
      encodes[#encodes + 1] = { tbl = tbl, seq = seq }
      local count = 0
      for _, e in ipairs(encodes) do
        if e.tbl == tbl then
          count = count + 1
        end
      end
      local frames = {}
      for i = 1, (count > shrinkAfter and 2 or 1) do
        frames[i] = { seq = seq, tbl = tbl, index = i, big = count <= shrinkAfter }
      end
      return frames, nil
    end,
    render = function(frame)
      return frame
    end,
    paint = function(frame)
      attempts[#attempts + 1] = frame
      if frame.big and frame.tbl.t == "ask" then
        return nil, failWith
      end
      return true
    end,
    hide = function()
      hides = hides + 1
    end,
  }
  local fresh, fire = loadWith(codec)
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = attempts[1].seq } })

  local before = #attempts
  local firstSeq = fresh.Transport.send({ t = "ask", id = "wide", chat = "c", text = "x", mentions = {} })
  assert(attempts[before + 1].big and attempts[before + 1].seq == firstSeq, "the first attempt does not fit")
  local repainted = attempts[before + 2]
  assert(repainted ~= nil and not repainted.big and repainted.index == 1, "after too_large the message is re-encoded and its first frame painted")
  assert(repainted.seq ~= firstSeq, "the re-encoded frames carry a fresh seq, never the old one with a new total")
  assert(#attempts == before + 2, "one re-encode, one repaint")
  local hidesBefore = hides
  fire("repaint")
  assert(attempts[#attempts].index == 2 and attempts[#attempts].seq == repainted.seq, "the re-encoded frames advance from frame 1 to frame 2")
  assert(hides == hidesBefore, "the line stays showing through the re-encoded frames")
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = firstSeq } })
  assert(hides == hidesBefore + 1, "an ack that names the seq the message was first encoded with still clears it")

  local other = fresh.Transport.send({ t = "ask", id = "wide2", chat = "c", text = "x", mentions = {} })
  local secondSeq = attempts[#attempts].seq
  assert(other == attempts[#attempts - 1].seq, "the second message also re-encodes")
  hidesBefore = hides
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = secondSeq } })
  assert(hides == hidesBefore + 1, "an ack that names the seq of the re-encoded frames clears the message")

  shrinkAfter = 99
  local printedBefore = #printed
  fresh.Transport.send({ t = "ask", id = "never", chat = "c", text = "x", mentions = {} })
  assert(countMatching("your question was not sent, it is too large for the signal line at this screen size") == 1, "a message that still does not fit is reported once")
  assert(#printed == printedBefore + 1, "the report is one line")
  local droppedAttempts = #attempts
  fire("repaint")
  fire("repaint")
  assert(#attempts == droppedAttempts, "the message that never fits is dropped, not retried")
  local sentAfter = fresh.Transport.send({ t = "state", seq = 1, delta = {} })
  assert(sentAfter ~= nil and attempts[#attempts].tbl.t == "state", "the queue moves on after a dropped message")
end

do
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local tries = {}
  local failures = 2
  local hides = 0
  local codec = {
    encode = function(tbl, seq)
      return { { seq = seq, tbl = tbl, index = 1 }, { seq = seq, tbl = tbl, index = 2 } }, nil
    end,
    render = function(frame)
      return frame
    end,
    paint = function(frame)
      tries[#tries + 1] = frame
      if failures > 0 then
        failures = failures - 1
        return nil, "nothing_to_paint"
      end
      return true
    end,
    hide = function()
      hides = hides + 1
    end,
  }
  local flaky = { Codec = codec }
  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", flaky)
  local list = _G.WOWC_TEST_TIMER_CALLBACKS
  local cursor = 1
  local function tick()
    list[cursor].callback()
    cursor = #list
  end
  assert(#tries == 1 and hides >= 1, "a failed paint at load leaves the line hidden")
  tick()
  assert(#tries == 2, "a failed paint is retried on the next tick")
  tick()
  assert(#tries == 3 and tries[3].index == 1, "the retry that succeeds paints the same frame")
  tick()
  assert(#tries == 4, "after a successful paint the hello repaints as usual")
end

do
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local narrow = false
  local hidden = 0
  local lastFrame
  local codec = {
    encode = function(tbl, seq)
      return { { seq = seq, tbl = tbl, wide = not narrow } }, nil
    end,
    render = function(frame)
      return frame
    end,
    paint = function(frame)
      lastFrame = frame
      if frame.wide and narrow and frame.tbl.t == "items" then
        return nil, "too_large"
      end
      return true
    end,
    hide = function()
      hidden = hidden + 1
    end,
  }
  local holder = { Codec = codec }
  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", holder)
  local list = _G.WOWC_TEST_TIMER_CALLBACKS
  local cursor = 1
  local function tick()
    list[cursor].callback()
    cursor = #list
  end
  WoWCompanion_Deliver(holder.Transport.session(), { { t = "ack", seq = lastFrame.seq } })
  holder.Transport.send({ t = "items", req = "r1", items = {} })
  tick()
  narrow = true
  tick()
  assert(not lastFrame.wide and lastFrame.tbl.t == "items", "the second pass re-encoded the message for the narrower line")
  hidden = 0
  for _ = 1, 12 do
    tick()
  end
  assert(hidden == 0, "a re-encoded unacked message keeps repainting, it is never given up")
  assert(lastFrame.tbl.t == "items", "the re-encoded message is still the one on the line")
  WoWCompanion_Deliver(holder.Transport.session(), { { t = "ack", seq = lastFrame.seq } })
  assert(hidden == 1, "its ack clears it and hides the line")
end

do
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local painted = {}
  local codec = {
    encode = function(tbl, seq)
      return { { seq = seq, tbl = tbl, index = 1 }, { seq = seq, tbl = tbl, index = 2 } }, nil
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
  local holder = { Codec = codec }
  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", holder)
  local list = _G.WOWC_TEST_TIMER_CALLBACKS
  local cursor = 1
  local function tick()
    list[cursor].callback()
    cursor = #list
  end
  WoWCompanion_Deliver(holder.Transport.session(), { { t = "ack", seq = painted[1].seq } })
  local askSeq = holder.Transport.send({ t = "ask", id = "long", chat = "c", text = "x", mentions = {} })
  local cmdSeq = holder.Transport.send({ t = "cmd", chat = "c", name = "new" })
  for _ = 1, 40 do
    tick()
  end
  local sawCmd = false
  local askFrames = 0
  for i = 2, #painted do
    if painted[i].seq == cmdSeq then
      sawCmd = true
    elseif painted[i].seq == askSeq then
      askFrames = askFrames + 1
    end
  end
  assert(askFrames >= 40 and not sawCmd, "an unacked ask stays current for far more than three passes and the queue does not advance")
  WoWCompanion_Deliver(holder.Transport.session(), { { t = "ack", seq = askSeq } })
  assert(painted[#painted].seq == cmdSeq, "the ack of the ask starts the next queued message")
end

do
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local painted = {}
  local hides = 0
  local cmdEncodes = 0
  local codec = {
    encode = function(tbl, seq)
      local wide = false
      if tbl.t == "cmd" then
        cmdEncodes = cmdEncodes + 1
        wide = cmdEncodes == 1
      end
      return { { seq = seq, tbl = tbl, wide = wide } }, nil
    end,
    render = function(frame)
      return frame
    end,
    paint = function(frame)
      table.insert(painted, frame)
      if frame.wide and frame.tbl.t == "cmd" then
        return nil, "too_large"
      end
      return true
    end,
    hide = function()
      hides = hides + 1
    end,
  }
  local holder = { Codec = codec }
  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", holder)
  WoWCompanion_Deliver(holder.Transport.session(), { { t = "ack", seq = painted[1].seq } })
  local printedBefore = #printed
  local firstSeq = holder.Transport.send({ t = "cmd", id = "cmd-rename-1", chat = "c", name = "rename", arg = "x" })
  local last = painted[#painted]
  assert(last.tbl.t == "cmd" and last.tbl.id == "cmd-rename-1", "a cmd that no longer fits is re-encoded like an ask, with the same id")
  assert(not last.wide and last.seq ~= firstSeq, "under a fresh seq")
  assert(#printed == printedBefore, "and it is not dropped, nothing is printed")
  hides = 0
  WoWCompanion_Deliver(holder.Transport.session(), { { t = "ack", seq = firstSeq } })
  assert(hides == 1, "an ack that names the seq it was first encoded with still clears it")
end

do
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local function loadStalling(withWindow)
    _G.WOWC_TEST_TIMER_CALLBACKS = {}
    local painted = {}
    local notices = {}
    local fresh = {
      Codec = {
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
      },
    }
    if withWindow then
      fresh.AiWindow = {
        notice = function(text)
          table.insert(notices, text)
        end,
      }
    end
    assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", fresh)
    local list = _G.WOWC_TEST_TIMER_CALLBACKS
    local cursor = 2
    local function poll(times)
      for _ = 1, times do
        list[cursor].callback()
        cursor = #list
      end
    end
    WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = painted[1].seq } })
    return fresh, painted, notices, poll
  end

  local fresh, painted, notices, poll = loadStalling(true)
  local askSeq = fresh.Transport.send({ t = "ask", id = "stuck", chat = "c", text = "x", mentions = {} })
  poll(100)
  assert(#notices == 0, "no notice before 30 s without an ack")
  poll(30)
  assert(#notices == 1 and notices[1] == "[Claude] the companion isn't answering; your message is still waiting.", "one notice after 30 s, through the Claude window")
  poll(80)
  assert(#notices == 1, "the notice is shown once per stalled message")
  assert(painted[#painted].seq == askSeq, "the stalled message is still current and still painted, never dropped")
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = askSeq } })
  fresh.Transport.send({ t = "cmd", id = "cmd-stuck", chat = "c", name = "new" })
  poll(130)
  assert(#notices == 2, "the next message that stalls gets its own notice")

  local before = countMatching("isn't answering")
  local plainFresh, _, _, plainPoll = loadStalling(false)
  plainFresh.Transport.send({ t = "items", req = "r-stuck", items = {} })
  plainPoll(130)
  assert(countMatching("isn't answering") == before + 1, "without a Claude window the notice is printed")
end

do
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local painted = {}
  local hides = 0
  local fresh = {
    Codec = {
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
      hide = function()
        hides = hides + 1
      end,
    },
  }
  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", fresh)
  local list = _G.WOWC_TEST_TIMER_CALLBACKS
  local cursors = { repaint = 1, hello = 3 }
  local function fire(name)
    list[cursors[name]].callback()
    cursors[name] = #list
  end
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = painted[1].seq } })
  local askSeq = fresh.Transport.send({ t = "ask", id = "stuck", chat = "c", text = "x", mentions = {} })
  assert(painted[#painted].seq == askSeq, "the ask is on the line")
  fire("hello")
  assert(painted[#painted].seq == askSeq, "the hello timer only flags a hello: it does not cut into the waiting ask")
  fire("repaint")
  assert(painted[#painted].tbl.t == "hello" and painted[#painted].tbl.again == true, "at the ask's pass boundary the flagged hello takes one turn on the line")
  fire("repaint")
  assert(painted[#painted].seq == askSeq, "after its turn the hello gives the line back to the waiting ask")
  fire("repaint")
  assert(painted[#painted].seq == askSeq, "the ask keeps repainting until it is acked")
  fire("hello")
  fire("repaint")
  assert(painted[#painted].tbl.t == "hello", "every hello interval the hello takes another turn at a pass boundary")
  local paintedBefore = #painted
  hides = 0
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = askSeq } })
  fire("repaint")
  assert(#painted == paintedBefore and hides >= 1, "an ack that arrives during the hello's turn clears the ask: it is not repainted afterwards and the line hides")
end

do
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local painted = {}
  local frameCount = { state = 2, ask = 1, cmd = 1 }
  local fresh = {
    Codec = {
      encode = function(tbl, seq)
        local frames = {}
        for i = 1, tbl.frames or frameCount[tbl.t] or 1 do
          frames[i] = { seq = seq, tbl = tbl, index = i }
        end
        return frames, nil
      end,
      render = function(frame)
        return frame
      end,
      paint = function(frame)
        table.insert(painted, frame)
        return true
      end,
      hide = function() end,
    },
  }
  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", fresh)
  local list = _G.WOWC_TEST_TIMER_CALLBACKS
  local cursors = { repaint = 1, hello = 3 }
  local function fire(name)
    list[cursors[name]].callback()
    cursors[name] = #list
  end
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = painted[1].seq } })
  fresh.Transport.send({ t = "state", seq = 5, delta = {} })
  local askSeq = fresh.Transport.send({ t = "ask", id = "behind-state", chat = "c", text = "x", mentions = {} })
  local cmdSeq = fresh.Transport.send({ t = "cmd", id = "cmd-behind", chat = "c", name = "new" })
  fire("hello")
  local order = {}
  for _ = 1, 8 do
    fire("repaint")
    local last = painted[#painted]
    order[#order + 1] = last.tbl.t
  end
  local firstAsk
  for i, kind in ipairs(order) do
    if kind == "ask" then
      firstAsk = i
      break
    end
  end
  assert(firstAsk ~= nil, "the ask reaches the line behind the state")
  local sawHelloBeforeAsk = false
  for i = 1, firstAsk - 1 do
    if order[i] == "hello" then
      sawHelloBeforeAsk = true
    end
  end
  assert(sawHelloBeforeAsk, "the flagged hello is painted between the finished state and the queued ask, it never sits in the queue behind the ask")
  fire("hello")
  for _ = 1, 3 do
    fire("repaint")
  end
  local sawSecondHello = false
  for i = #painted - 3, #painted do
    if painted[i].tbl.t == "hello" then
      sawSecondHello = true
    end
  end
  assert(sawSecondHello, "while the ask waits unacked the hello still reaches the line at its pass boundary")
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = askSeq } })
  local drained = false
  for _ = 1, 4 do
    fire("repaint")
    if painted[#painted].seq == cmdSeq then
      drained = true
    end
  end
  assert(drained, "once the ask is acked the queue behind it drains")
end

do
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local painted = {}
  local fresh = {
    Codec = {
      encode = function(tbl, seq)
        local frames = {}
        for i = 1, tbl.frames or 1 do
          frames[i] = { seq = seq, tbl = tbl, index = i }
        end
        return frames, nil
      end,
      render = function(frame)
        return frame
      end,
      paint = function(frame)
        table.insert(painted, frame)
        return true
      end,
      hide = function() end,
    },
  }
  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", fresh)
  local list = _G.WOWC_TEST_TIMER_CALLBACKS
  local cursors = { repaint = 1, hello = 3 }
  local function fire(name)
    list[cursors[name]].callback()
    cursors[name] = #list
  end
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = painted[1].seq } })
  local longSeq = fresh.Transport.send({ t = "ask", id = "long", chat = "c", text = "x", mentions = {}, frames = 41 })
  local start = #painted
  fire("hello")
  for _ = 1, 40 do
    fire("repaint")
  end
  local indexes = {}
  for i = start, #painted do
    local frame = painted[i]
    assert(frame.seq == longSeq, "no hello cuts into the pass, even though it is longer than the hello interval")
    indexes[#indexes + 1] = frame.index
  end
  assert(#indexes == 41 and indexes[1] == 1 and indexes[41] == 41, "the message paints all 41 frames in one uninterrupted pass")
  fire("repaint")
  assert(painted[#painted].tbl.t == "hello", "the hello takes its turn only after the complete pass")
  fire("repaint")
  assert(painted[#painted].seq == longSeq and painted[#painted].index == 1, "and the message then resumes from its first frame")
  WoWCompanion_Deliver(fresh.Transport.session(), { { t = "ack", seq = longSeq } })
end

do
  local paintsSeen = 0
  local hides = 0
  local failing = false
  local codec = {
    encode = function(tbl, seq)
      return { { seq = seq, tbl = tbl } }, nil
    end,
    render = function(frame)
      return frame
    end,
    paint = function()
      paintsSeen = paintsSeen + 1
      if failing then
        return nil, "nothing_to_paint"
      end
      return true
    end,
    hide = function()
      hides = hides + 1
    end,
  }
  _G.WOWC_TEST_TIMER_CALLBACKS = {}
  _G.WOWC_TEST_SET_SIGNAL_PRESENT(CONTROL_GONE, false)
  local holder = { Codec = codec }
  assert(loadfile("addon/WoWCompanion/Inbox.lua"))("WoWCompanion", holder)
  local list = _G.WOWC_TEST_TIMER_CALLBACKS
  local cursor = 1
  local hidesBefore = hides
  failing = true
  list[cursor].callback()
  cursor = #list
  assert(hides > hidesBefore, "a paint that fails takes the stale line off the screen")
end

do
  local before = #positionCalls
  assert(ns.Transport.setLinePosition("bottom") == true, "setLinePosition forwards to the codec")
  assert(positionCalls[before + 1] == "bottom", "the codec receives the position")
  assert(ns.Transport.linePosition() == "bottom", "linePosition reads back what the codec now holds")
  assert(ns.Transport.setLinePosition("top") == true and ns.Transport.linePosition() == "top", "and follows the next change")
  local refused, reason = ns.Transport.setLinePosition("sideways")
  assert(refused == nil and reason == "bad_position", "a refusal from the codec reaches the caller")
  assert(ns.Transport.linePosition() == "top", "a refused position changes nothing")
end

realPrint("inbox: all assertions passed")
