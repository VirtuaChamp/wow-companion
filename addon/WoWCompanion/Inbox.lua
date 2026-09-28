local _, ns = ...

ns.Transport = ns.Transport or {}

local REPAINT_INTERVAL_SECONDS = 0.25
local HOLD_CYCLES = 3
local QUEUE_CAP = 8
local SLOT_COUNT = 200
local SLOT_WARNING_THRESHOLD = 20
local HELLO_INTERVAL_SECONDS = 10
local ACKED_TYPES = { ask = true, items = true, cmd = true, hello = true }

local function computeEntropyMix()
  local serverTime = GetServerTime and GetServerTime() or 0
  local profileStop = debugprofilestop and math.floor(debugprofilestop()) or 0
  local frac = 0
  if GetTime then
    local t = GetTime()
    frac = math.floor((t - math.floor(t)) * 1000000)
  end
  local mixed = bit.bxor(bit.band(serverTime, 0x7fffffff), bit.band(profileStop, 0x7fffffff))
  mixed = bit.bxor(mixed, bit.band(frac, 0x7fffffff))
  return mixed
end

local entropyMix = computeEntropyMix()
local session = ("%08x-%08x"):format(bit.band(entropyMix, 0x7fffffff), math.random(0, 0x7fffffff))
local nextFrameSeq = bit.band(entropyMix, 0xffff)
local sendQueue = {}
local current = nil
local messageHandlers = {}
local nextSlotIndex = 1
local exhausted = false
local lowWarned = false
local slotFailWarned = {}
local helloSeqsInFlight = {}
local helloAckedHandlers = {}
local tooLargeWarned = {}

local function slotAddonName(index)
  return ("WoWCompanion_R%03d"):format(index)
end

local function slotSignalPath(index)
  return ("Interface\\AddOns\\WoWCompanion_Signals\\sig\\%03d.wav"):format(index)
end

local function slotsLeft()
  return SLOT_COUNT - (nextSlotIndex - 1)
end

function ns.Transport.slotsLeft()
  return slotsLeft()
end

function ns.Transport.session()
  return session
end

local function fireOnMessage(msg)
  for i = 1, #messageHandlers do
    messageHandlers[i](msg)
  end
end

local function paintCurrentFrame()
  if not current then
    return
  end
  local frame = current.frames[current.frameIndex]
  local cells = ns.Codec.render(frame)
  ns.Codec.paint(cells)
end

local function startCurrent(entry)
  current = entry
  current.frameIndex = 1
  current.cyclesCompleted = 0
  paintCurrentFrame()
end

local function nextSeq()
  local seq = nextFrameSeq
  nextFrameSeq = (nextFrameSeq + 1) % 0x10000
  return seq
end

local function registerHelloSeq(seq)
  helloSeqsInFlight[seq] = true
end

local function buildHelloEntry(again)
  local version, build, _, tocversion = GetBuildInfo()
  local tbl = {
    t = "hello",
    v = 1,
    build = version .. "." .. build,
    iface = tocversion,
    session = session,
    slot = nextSlotIndex,
  }
  if again then
    tbl.again = true
  end
  local seq = nextSeq()
  local frames, err = ns.Codec.encode(tbl, seq)
  if not frames then
    return nil, err
  end
  local entry = { seq = seq, frames = frames, t = "hello", again = again or false }
  if not again then
    entry.neverGivesUp = true
    entry.slotAtSend = nextSlotIndex
  end
  return entry
end

local function tryAck(seq)
  if not current then
    return
  end
  if current.t == "hello" then
    if current.again or not helloSeqsInFlight[seq] then
      return
    end
  elseif current.seq ~= seq then
    return
  end
  local wasHello = current.t == "hello"
  helloSeqsInFlight = {}
  current = nil
  local nextEntry = table.remove(sendQueue, 1)
  if nextEntry then
    startCurrent(nextEntry)
  end
  if wasHello then
    for i = 1, #helloAckedHandlers do
      local ok, err = pcall(helloAckedHandlers[i])
      if not ok then
        print("WoW Companion: hello handler error: " .. tostring(err))
      end
    end
  end
end

function WoWCompanion_Deliver(deliverySession, msgs)
  if deliverySession ~= session then
    return
  end
  for i = 1, #msgs do
    local msg = msgs[i]
    if msg.t == "ack" then
      tryAck(msg.seq)
    end
  end
  for i = 1, #msgs do
    local msg = msgs[i]
    if msg.t ~= "ack" then
      local ok, err = pcall(fireOnMessage, msg)
      if not ok then
        print("WoW Companion: message handler error: " .. tostring(err))
      end
    end
  end
end

local function describeTooLarge(tbl)
  if tbl.t == "state" and type(tbl.delta) == "table" and ns.Codec.encodeJson then
    local worstKey
    local worstSize = -1
    for key, value in pairs(tbl.delta) do
      local ok, json = pcall(ns.Codec.encodeJson, value)
      if ok and #json > worstSize then
        worstKey = key
        worstSize = #json
      end
    end
    if worstKey ~= nil then
      return ("state (key %s)"):format(tostring(worstKey))
    end
  end
  return tostring(tbl.t)
end

local function mergeDeltas(older, newer)
  local merged = {}
  for key, value in pairs(older or {}) do
    merged[key] = value
  end
  for key, value in pairs(newer or {}) do
    merged[key] = value
  end
  return merged
end

local function mergeIntoQueuedState(tbl, seq)
  for i = #sendQueue, 1, -1 do
    local queued = sendQueue[i]
    if queued.t == "state" then
      local mergedMsg = {}
      for key, value in pairs(tbl) do
        mergedMsg[key] = value
      end
      mergedMsg.delta = mergeDeltas(queued.msg.delta, tbl.delta)
      local frames = ns.Codec.encode(mergedMsg, seq)
      if frames then
        sendQueue[i] = { seq = seq, frames = frames, t = "state", msg = mergedMsg }
        return true
      end
      return false
    end
  end
  return false
end

function ns.Transport.send(tbl)
  if tbl.t ~= "state" then
    local queued = #sendQueue + (current and 1 or 0)
    if queued >= QUEUE_CAP then
      return nil, "busy"
    end
  end
  local seq = nextSeq()
  if tbl.t == "state" and mergeIntoQueuedState(tbl, seq) then
    return seq
  end
  local frames, err = ns.Codec.encode(tbl, seq)
  if not frames then
    if err == "too_large" then
      local what = describeTooLarge(tbl)
      if not tooLargeWarned[what] then
        tooLargeWarned[what] = true
        print(("WoW Companion: %s not sent, too large for the transport"):format(what))
      end
    end
    return nil, err
  end
  local entry = { seq = seq, frames = frames, t = tbl.t, msg = tbl }
  if current then
    table.insert(sendQueue, entry)
  else
    startCurrent(entry)
  end
  return seq
end

function ns.Transport.onHelloAcked(fn)
  table.insert(helloAckedHandlers, fn)
end

function ns.Transport.onMessage(fn)
  table.insert(messageHandlers, fn)
end

local function advanceOrHandoff()
  local nextEntry = table.remove(sendQueue, 1)
  current = nil
  if nextEntry then
    startCurrent(nextEntry)
  end
end

local function repaintTick()
  if current then
    current.frameIndex = current.frameIndex + 1
    if current.frameIndex > #current.frames then
      current.frameIndex = 1
      if ACKED_TYPES[current.t] and not current.again then
        if current.neverGivesUp then
          if nextSlotIndex ~= current.slotAtSend then
            local entry = buildHelloEntry(false)
            if entry then
              registerHelloSeq(entry.seq)
              entry.frameIndex = 1
              current = entry
            end
          end
        else
          current.cyclesCompleted = current.cyclesCompleted + 1
          if current.cyclesCompleted >= HOLD_CYCLES then
            advanceOrHandoff()
            C_Timer.After(REPAINT_INTERVAL_SECONDS, repaintTick)
            return
          end
        end
      else
        advanceOrHandoff()
        C_Timer.After(REPAINT_INTERVAL_SECONDS, repaintTick)
        return
      end
    end
    paintCurrentFrame()
  end
  C_Timer.After(REPAINT_INTERVAL_SECONDS, repaintTick)
end

local function hasQueuedHello()
  if current and current.t == "hello" then
    return true
  end
  for i = 1, #sendQueue do
    if sendQueue[i].t == "hello" then
      return true
    end
  end
  return false
end

local function announceHello()
  if hasQueuedHello() then
    return
  end
  local entry, err = buildHelloEntry(true)
  if entry then
    if current then
      table.insert(sendQueue, entry)
    else
      startCurrent(entry)
    end
  else
    print("WoW Companion: failed to encode hello: " .. tostring(err))
  end
end

local function helloAnnounceTick()
  announceHello()
  C_Timer.After(HELLO_INTERVAL_SECONDS, helloAnnounceTick)
end

local function pollNextSlot()
  if not exhausted then
    if nextSlotIndex > SLOT_COUNT then
      exhausted = true
      print("WoW Companion: reply slots exhausted, type /reload to continue")
    else
      local ready = PlaySoundFile(slotSignalPath(nextSlotIndex))
      if ready then
        local name = slotAddonName(nextSlotIndex)
        C_AddOns.EnableAddOn(name)
        local loaded, reason = C_AddOns.LoadAddOn(name)
        if loaded then
          nextSlotIndex = nextSlotIndex + 1
          if not lowWarned and slotsLeft() <= SLOT_WARNING_THRESHOLD then
            lowWarned = true
            print(("WoW Companion: only %d reply slots left"):format(slotsLeft()))
          end
        elseif not slotFailWarned[nextSlotIndex] then
          slotFailWarned[nextSlotIndex] = true
          print(("WoW Companion: failed to load reply slot %d (%s)"):format(nextSlotIndex, tostring(reason)))
        end
      end
    end
  end
  C_Timer.After(REPAINT_INTERVAL_SECONDS, pollNextSlot)
end

do
  local entry, err = buildHelloEntry(false)
  if entry then
    registerHelloSeq(entry.seq)
    startCurrent(entry)
  else
    print("WoW Companion: failed to encode hello: " .. tostring(err))
  end
end

C_Timer.After(REPAINT_INTERVAL_SECONDS, repaintTick)
C_Timer.After(REPAINT_INTERVAL_SECONDS, pollNextSlot)
C_Timer.After(HELLO_INTERVAL_SECONDS, helloAnnounceTick)
