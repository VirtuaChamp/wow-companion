local _, ns = ...

ns.Waypoint = ns.Waypoint or {}

function ns.Waypoint.set(wp)
  if not wp then
    return "no_waypoint_map"
  end
  if type(wp.x) ~= "number" or type(wp.y) ~= "number" or type(wp.uiMapId) ~= "number" then
    return "no_waypoint_map"
  end
  if wp.x < 0 or wp.x > 100 or wp.y < 0 or wp.y > 100 then
    return "no_waypoint_map"
  end
  if not C_Map.CanSetUserWaypointOnMap(wp.uiMapId) then
    return "no_waypoint_map"
  end

  local uiMapPoint = UiMapPoint.CreateFromCoordinates(wp.uiMapId, wp.x / 100, wp.y / 100)
  if not C_Map.SetUserWaypoint(uiMapPoint) then
    return "no_waypoint_map"
  end
  C_SuperTrack.SetSuperTrackedUserWaypoint(true)
  return true
end
