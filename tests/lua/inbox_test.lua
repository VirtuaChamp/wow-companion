dofile("tests/lua/wow_stubs.lua")

local realPrint = print
local printed = {}
_G.print = function(msg)
  table.insert(printed, msg)
end

local paintCalls = {}
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

do
  local sigPath = "Interface\\AddOns\\WoWCompanion_Signals\\sig\\001.wav"
  _G.WOWC_TEST_SET_SIGNAL(sigPath, "RIFF")
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
  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = helloSeq } })
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
  assert(#paintCalls == before + 1, "a queued second send does not paint until the first gives up or acks")
  tickRepaint()
  tickRepaint()
  tickRepaint()
  assert(#paintCalls == before + 4, "two re-paints of a2 then the handoff paint of b2 on the third tick")
  WoWCompanion_Deliver(ns.Transport.session(), { { t = "ack", seq = seqB } })
  tickRepaint()
  assert(#paintCalls == before + 4, "b2 stops repainting once acked, so the giveup handoff already covered it")
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
  _G.WOWC_TEST_SET_SIGNAL(sigPath, "RIFF")
  tickPoll()
  assert(runnerFired, "a valid signal loads and runs the matching slot addon")
  assert(_G.WOWC_TEST_ENABLED_ADDONS[2] == "WoWCompanion_R002", "the addon is enabled before load")
  assert(_G.WOWC_TEST_LOADED_ADDONS[2] == "WoWCompanion_R002", "the addon is loaded once ready")
end

do
  _G.WOWC_TEST_ADDON_LOAD_RESULTS = { WoWCompanion_R003 = { false, "DISABLED" } }
  local before = ns.Transport.slotsLeft()
  local sigPath = "Interface\\AddOns\\WoWCompanion_Signals\\sig\\003.wav"
  _G.WOWC_TEST_SET_SIGNAL(sigPath, "RIFF")
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
    _G.WOWC_TEST_SET_SIGNAL(path, "RIFF")
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
    _G.WOWC_TEST_SET_SIGNAL(path, "RIFF")
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
  _G.WOWC_TEST_SET_SIGNAL(sigPathB, "RIFF")
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
  assert(printed[1]:find("state", 1, true), "the line names the message type")
  assert(printed[1]:find("quests", 1, true), "the line names the top-level key that is too large")
  assert(not printed[1]:find("bags", 1, true), "only the offending key is named")

  printed = {}
  seq, err = nsC.Transport.send({ t = "ask", id = "a1", chat = "default", text = "x", mentions = {}, big = true })
  assert(seq == nil and err == "too_large", "too-large ask is refused with too_large")
  assert(#printed == 1 and printed[1]:find("ask", 1, true), "the line names the ask type")
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

realPrint("inbox: all assertions passed")
