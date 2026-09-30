local _, ns = ...

ns.Transport = ns.Transport or {}

local REPAINT_INTERVAL_SECONDS = 0.25
local QUEUE_CAP = 8
local SLOT_COUNT = 200
local SLOT_WARNING_THRESHOLD = 20
local HELLO_INTERVAL_SECONDS = 10
local FRAME_HOLD_MIN_SECONDS = 0.2
local UNREADABLE_LINE_AFTER_SECONDS = 20
local STALLED_AFTER_SECONDS = 30
local CHAT_PREFIX = "WoW Companion: "
local STALLED_MESSAGE = "the companion isn't answering; your message is still waiting."
local BUSY_MESSAGE = "busy, not sent"
local UNREADABLE_LINE_MESSAGE = CHAT_PREFIX .. "can't read its signal line. Show the interface (Alt+Z) if it is hidden."
local UNREADABLE_LINE_HINT = CHAT_PREFIX
  .. "turn off anti-aliasing and screen overlays and set render scale to 100% in Options > Graphics, "
  .. "or move the line in Options > AddOns > WoW Companion."
local PLAIN_NAMES = {
  ask = "your question",
  cmd = "a chat command",
  items = "item details",
  state = "some game data",
}

local function plainName(kind)
  return PLAIN_NAMES[kind] or "a message"
end

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
local helloUnackedSince = GetTime()
local unreadableWarned = false
local companionSeenSince = nil
local lineShown = false
local helloPending = false

local function slotAddonName(index)
  return ("WoWCompanion_R%03d"):format(index)
end

local SIGNAL_DIR = "Interface\\AddOns\\WoWCompanion_Signals\\sig\\"
local CONTROL_PRESENT_PATH = SIGNAL_DIR .. "ctl-present.wav"
local CONTROL_GONE_PATH = SIGNAL_DIR .. "ctl-gone.wav"
local signalsTrusted = false
local controlWarned = false

local function slotSignalPath(index)
  return ("%s%03d.wav"):format(SIGNAL_DIR, index)
end

local function signalPresent(path)
  local present, handle = PlaySoundFile(path)
  if not present then
    return false
  end
  if handle then
    StopSound(handle)
  end
  return true
end

local function checkSignalsTrusted()
  if not signalPresent(CONTROL_PRESENT_PATH) then
    signalsTrusted = false
    if not controlWarned then
      controlWarned = true
      print("WoW Companion: reply signals not working on this client, restart the game after setup")
    end
    return
  end
  signalsTrusted = not signalPresent(CONTROL_GONE_PATH)
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

local function notify(text)
  if ns.AiWindow and ns.AiWindow.notice then
    ns.AiWindow.notice("[Claude] " .. text)
  else
    print(CHAT_PREFIX .. text)
  end
end

local function hideLine()
  lineShown = false
  ns.Codec.hide()
end

local startNextOrHide
local finishCurrent
local buildHelloEntry

local function nextSeq()
  local seq = nextFrameSeq
  nextFrameSeq = (nextFrameSeq + 1) % 0x10000
  return seq
end

local function paintFrame(entry)
  local ok, err = ns.Codec.paint(ns.Codec.render(entry.frames[entry.frameIndex]))
  if ok == nil and err ~= nil then
    return false, err
  end
  return true
end

local function reencodeCurrent()
  local seq = nextSeq()
  local frames = ns.Codec.encode(current.msg, seq)
  if not frames then
    return false
  end
  current.oldSeqs = current.oldSeqs or {}
  current.oldSeqs[current.seq] = true
  current.seq = seq
  current.frames = frames
  current.frameIndex = 1
  return true
end

local function paintCurrentFrame()
  if not current then
    return
  end
  if not signalsTrusted or current.dormant then
    hideLine()
    return
  end
  local shown, err = paintFrame(current)
  if not shown and err == "too_large" and current.msg and reencodeCurrent() then
    shown, err = paintFrame(current)
  end
  if not shown then
    hideLine()
    if err == "too_large" and not current.neverGivesUp then
      local what = "line:" .. tostring(current.t)
      if not tooLargeWarned[what] then
        tooLargeWarned[what] = true
        print(
          CHAT_PREFIX
            .. plainName(current.t)
            .. " was not sent, it is too large for the signal line at this screen size"
        )
      end
      finishCurrent()
    end
    return
  end
  lineShown = true
  current.paintedAt = GetTime()
end

local function startCurrent(entry)
  current = entry
  current.startedAt = GetTime()
  current.frameIndex = 1
  paintCurrentFrame()
end

function startNextOrHide()
  if helloPending then
    helloPending = false
    local hello = buildHelloEntry(true)
    if hello then
      startCurrent(hello)
      return
    end
  end
  local nextEntry = table.remove(sendQueue, 1)
  if nextEntry then
    startCurrent(nextEntry)
  else
    hideLine()
  end
end

function finishCurrent()
  local finished = current
  current = nil
  if finished and finished.resume then
    current = finished.resume
    current.frameIndex = 1
    paintCurrentFrame()
  else
    startNextOrHide()
  end
end

local function registerHelloSeq(seq)
  helloSeqsInFlight[seq] = true
end

function buildHelloEntry(again)
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
  local resumed = current.resume
  if resumed and (resumed.seq == seq or (resumed.oldSeqs and resumed.oldSeqs[seq])) then
    current.resume = nil
    return
  end
  if current.t == "hello" then
    if current.again or not helloSeqsInFlight[seq] then
      return
    end
  elseif current.seq ~= seq and not (current.oldSeqs and current.oldSeqs[seq]) then
    return
  end
  local wasHello = current.t == "hello"
  helloSeqsInFlight = {}
  current = nil
  startNextOrHide()
  if wasHello then
    helloUnackedSince = nil
    unreadableWarned = false
    checkSignalsTrusted()
    for i = 1, #helloAckedHandlers do
      local ok, err = pcall(helloAckedHandlers[i])
      if not ok then
        print(CHAT_PREFIX .. "a connection setup step failed: " .. tostring(err))
      end
    end
  end
end

function WoWCompanion_Deliver(deliverySession, msgs)
  if deliverySession == nil or deliverySession ~= session or type(msgs) ~= "table" then
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
        print(CHAT_PREFIX .. "a message from the companion could not be handled: " .. tostring(err))
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
      if tbl.t == "cmd" or tbl.t == "items" then
        notify(BUSY_MESSAGE)
      end
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
        print(CHAT_PREFIX .. plainName(tbl.t) .. " was not sent, it is too large for the signal line")
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

function ns.Transport.setLinePosition(position)
  return ns.Codec.setPosition(position)
end

function ns.Transport.linePosition()
  return ns.Codec.position()
end

function ns.Transport.onMessage(fn)
  table.insert(messageHandlers, fn)
end

local function advanceOrHandoff()
  finishCurrent()
end

local function repaintTick()
  local held = current and current.paintedAt and GetTime() - current.paintedAt or math.huge
  if current and (not signalsTrusted or current.dormant) then
    if lineShown then
      hideLine()
    end
  elseif current and not lineShown then
    paintCurrentFrame()
  elseif current and current.blink and held >= FRAME_HOLD_MIN_SECONDS then
    current.blink = false
    current.dormant = true
    hideLine()
  elseif current and held >= FRAME_HOLD_MIN_SECONDS then
    current.frameIndex = current.frameIndex + 1
    if current.frameIndex > #current.frames then
      current.frameIndex = 1
      if ACKED_TYPES[current.t] and not current.again then
        if helloPending and current.t ~= "hello" then
          helloPending = false
          local hello = buildHelloEntry(true)
          if hello then
            hello.resume = current
            startCurrent(hello)
            C_Timer.After(REPAINT_INTERVAL_SECONDS, repaintTick)
            return
          end
        elseif current.neverGivesUp then
          if nextSlotIndex ~= current.slotAtSend then
            local entry = buildHelloEntry(false)
            if entry then
              registerHelloSeq(entry.seq)
              entry.frameIndex = 1
              current = entry
            end
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

local function announceHello()
  if current and current.t == "hello" then
    return
  end
  if current then
    helloPending = true
    return
  end
  local entry, err = buildHelloEntry(true)
  if entry then
    startCurrent(entry)
  else
    print(CHAT_PREFIX .. "could not prepare the connection message: " .. tostring(err))
  end
end

local function helloAnnounceTick()
  if current and current.dormant and signalsTrusted then
    current.dormant = false
    current.blink = true
    paintCurrentFrame()
  end
  announceHello()
  C_Timer.After(HELLO_INTERVAL_SECONDS, helloAnnounceTick)
end

local function warnWhenLineUnreadable()
  if not signalsTrusted then
    companionSeenSince = nil
    return
  end
  local now = GetTime()
  companionSeenSince = companionSeenSince or now
  if helloUnackedSince == nil or unreadableWarned then
    return
  end
  if
    now - helloUnackedSince >= UNREADABLE_LINE_AFTER_SECONDS
    and now - companionSeenSince >= UNREADABLE_LINE_AFTER_SECONDS
  then
    unreadableWarned = true
    print(UNREADABLE_LINE_MESSAGE)
    print(UNREADABLE_LINE_HINT)
    if current and current.neverGivesUp then
      current.dormant = true
      hideLine()
    end
  end
end

local function warnWhenStalled()
  if
    current
    and ACKED_TYPES[current.t]
    and current.t ~= "hello"
    and not current.stallNoticed
    and current.startedAt
    and GetTime() - current.startedAt >= STALLED_AFTER_SECONDS
  then
    current.stallNoticed = true
    notify(STALLED_MESSAGE)
  end
end

local function pollNextSlot()
  if not exhausted then
    if nextSlotIndex > SLOT_COUNT then
      exhausted = true
      print(
        "WoW Companion: reply slots exhausted, close start.cmd, run install.cmd "
          .. "(or pnpm run addon:setup), then restart the game"
      )
    else
      checkSignalsTrusted()
      if signalsTrusted and not signalPresent(slotSignalPath(nextSlotIndex)) then
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
  warnWhenLineUnreadable()
  warnWhenStalled()
  if current and signalsTrusted and not lineShown and not current.dormant then
    paintCurrentFrame()
  end
  C_Timer.After(REPAINT_INTERVAL_SECONDS, pollNextSlot)
end

checkSignalsTrusted()

do
  local entry, err = buildHelloEntry(false)
  if entry then
    registerHelloSeq(entry.seq)
    startCurrent(entry)
  else
    print(CHAT_PREFIX .. "could not prepare the connection message: " .. tostring(err))
  end
end

C_Timer.After(REPAINT_INTERVAL_SECONDS, repaintTick)
C_Timer.After(REPAINT_INTERVAL_SECONDS, pollNextSlot)
C_Timer.After(HELLO_INTERVAL_SECONDS, helloAnnounceTick)
