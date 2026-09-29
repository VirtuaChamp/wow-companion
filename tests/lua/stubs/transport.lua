local signalContents = {}
local playedOnce = {}

_G.WOWC_TEST_SET_SIGNAL = function(path, content)
  signalContents[path] = content
end

_G.PlaySoundFile = function(path)
  if playedOnce[path] then
    return true
  end
  local content = signalContents[path]
  if content == nil or content == "" then
    return false
  end
  playedOnce[path] = true
  return true
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
