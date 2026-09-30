local absentSignals = {}
local nextSoundHandle = 100

_G.WOWC_TEST_ISSUED_SOUND_HANDLES = {}
_G.WOWC_TEST_STOPPED_SOUND_HANDLES = {}
_G.WOWC_TEST_SIGNAL_PROBES = {}

_G.WOWC_TEST_SET_SIGNAL_PRESENT = function(path, present)
  absentSignals[path] = (not present) or nil
end

_G.PlaySoundFile = function(path)
  _G.WOWC_TEST_SIGNAL_PROBES[path] = (_G.WOWC_TEST_SIGNAL_PROBES[path] or 0) + 1
  if absentSignals[path] then
    return
  end
  nextSoundHandle = nextSoundHandle + 1
  table.insert(_G.WOWC_TEST_ISSUED_SOUND_HANDLES, nextSoundHandle)
  return true, nextSoundHandle
end

_G.StopSound = function(handle)
  table.insert(_G.WOWC_TEST_STOPPED_SOUND_HANDLES, handle)
end

_G.C_AddOns = _G.C_AddOns or {}

_G.C_AddOns.EnableAddOn = function(name)
  _G.WOWC_TEST_ENABLED_ADDONS = _G.WOWC_TEST_ENABLED_ADDONS or {}
  table.insert(_G.WOWC_TEST_ENABLED_ADDONS, name)
end

_G.C_AddOns.LoadAddOn = function(name)
  local overrides = _G.WOWC_TEST_ADDON_LOAD_RESULTS
  local override = overrides and overrides[name]
  if override then
    return override[1], override[2]
  end
  _G.WOWC_TEST_LOADED_ADDONS = _G.WOWC_TEST_LOADED_ADDONS or {}
  table.insert(_G.WOWC_TEST_LOADED_ADDONS, name)
  local runners = _G.WOWC_TEST_ADDON_RUNNERS
  local runner = runners and runners[name]
  if runner then
    runner()
  end
  return true
end

_G.time = function()
  return _G.WOWC_TEST_TIME or 0
end

_G.GetBuildInfo = function()
  return "1.60.1", "70009", "Jan 1 2026", 16001
end

_G.GetServerTime = function()
  return _G.WOWC_TEST_SERVER_TIME or 0
end

_G.debugprofilestop = function()
  return _G.WOWC_TEST_PROFILE_STOP or 0
end

_G.GetTime = function()
  return _G.WOWC_TEST_GAME_TIME or 0
end

local function makeFakeTransport()
  local fake = { sent = {} }
  local handlers = {}

  fake.send = function(tbl)
    table.insert(fake.sent, tbl)
    return #fake.sent
  end

  fake.onMessage = function(fn)
    table.insert(handlers, fn)
  end

  fake.deliver = function(msg)
    for i = 1, #handlers do
      handlers[i](msg)
    end
  end

  return fake
end

_G.WOWC_TEST_INSTALL_TRANSPORT = function(ns)
  local fake = makeFakeTransport()
  ns.Transport = fake
  return fake
end

_G.GetPhysicalScreenSize = function()
  return _G.WOWC_TEST_PHYSICAL_WIDTH or 1920, _G.WOWC_TEST_PHYSICAL_HEIGHT or 1080
end

_G.PixelUtil = {
  GetPixelToUIUnitFactor = function()
    local _, physicalHeight = _G.GetPhysicalScreenSize()
    return 768.0 / physicalHeight
  end,
}
