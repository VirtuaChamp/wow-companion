dofile("tests/lua/wow_stubs.lua")

local ns = {}
local chunk = assert(loadfile("addon/WoWCompanion/Waypoint.lua"))
chunk("WoWCompanion", ns)

_G.WOWC_TEST_LAST_WAYPOINT = nil
_G.WOWC_TEST_SUPER_TRACKED = nil
local ok = ns.Waypoint.set({ uiMapId = 84, x = 42, y = 58, label = "Somewhere" })
assert(ok == true, "valid waypoint sets")
assert(_G.WOWC_TEST_LAST_WAYPOINT ~= nil, "SetUserWaypoint called on valid input")
assert(_G.WOWC_TEST_LAST_WAYPOINT.x == 0.42, "x converted from 0-100 to 0-1, got " .. tostring(_G.WOWC_TEST_LAST_WAYPOINT.x))
assert(_G.WOWC_TEST_LAST_WAYPOINT.y == 0.58, "y converted from 0-100 to 0-1, got " .. tostring(_G.WOWC_TEST_LAST_WAYPOINT.y))
assert(_G.WOWC_TEST_SUPER_TRACKED == true, "super-track enabled after a valid set")

_G.WOWC_TEST_LAST_WAYPOINT = nil
local refusedMap = ns.Waypoint.set({ uiMapId = 999, x = 10, y = 10, label = "Refused map" })
assert(refusedMap == "no_waypoint_map", "map refusal returns no_waypoint_map")
assert(_G.WOWC_TEST_LAST_WAYPOINT == nil, "no SetUserWaypoint call when the map refuses")

_G.WOWC_TEST_LAST_WAYPOINT = nil
local xTooHigh = ns.Waypoint.set({ uiMapId = 84, x = 101, y = 50, label = "Out of range" })
assert(xTooHigh == "no_waypoint_map", "x above 100 refused")
assert(_G.WOWC_TEST_LAST_WAYPOINT == nil, "no SetUserWaypoint call when x is above 100")

_G.WOWC_TEST_LAST_WAYPOINT = nil
local yTooLow = ns.Waypoint.set({ uiMapId = 84, x = 50, y = -1, label = "Out of range" })
assert(yTooLow == "no_waypoint_map", "y below 0 refused")
assert(_G.WOWC_TEST_LAST_WAYPOINT == nil, "no SetUserWaypoint call when y is below 0")

_G.WOWC_TEST_LAST_WAYPOINT = nil
local xTooLow = ns.Waypoint.set({ uiMapId = 84, x = -1, y = 50, label = "Out of range" })
assert(xTooLow == "no_waypoint_map", "x below 0 refused")
assert(_G.WOWC_TEST_LAST_WAYPOINT == nil, "no SetUserWaypoint call when x is below 0")

_G.WOWC_TEST_LAST_WAYPOINT = nil
local yTooHigh = ns.Waypoint.set({ uiMapId = 84, x = 50, y = 101, label = "Out of range" })
assert(yTooHigh == "no_waypoint_map", "y above 100 refused")
assert(_G.WOWC_TEST_LAST_WAYPOINT == nil, "no SetUserWaypoint call when y is above 100")

_G.WOWC_TEST_LAST_WAYPOINT = nil
local bounds = ns.Waypoint.set({ uiMapId = 84, x = 0, y = 100, label = "Inclusive bounds" })
assert(bounds == true, "x=0 and y=100 are accepted (inclusive bounds)")
assert(_G.WOWC_TEST_LAST_WAYPOINT ~= nil, "SetUserWaypoint called on inclusive bounds")

_G.WOWC_TEST_LAST_WAYPOINT = nil
_G.WOWC_TEST_SUPER_TRACKED = nil
local originalSetUserWaypoint = _G.C_Map.SetUserWaypoint
_G.C_Map.SetUserWaypoint = function(point)
  _G.WOWC_TEST_LAST_WAYPOINT = point
  return false
end
local clientRefused = ns.Waypoint.set({ uiMapId = 84, x = 42, y = 58, label = "Refused by client" })
assert(clientRefused == "no_waypoint_map", "no_waypoint_map when SetUserWaypoint returns false")
assert(_G.WOWC_TEST_SUPER_TRACKED == nil, "no super-track call when SetUserWaypoint returns false")
_G.C_Map.SetUserWaypoint = originalSetUserWaypoint

print("waypoint.guard: all assertions passed")
