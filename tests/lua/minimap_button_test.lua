dofile("tests/lua/wow_stubs.lua")

local function load()
  local ns = {}
  ns.calls = { toggle = 0, settings = 0 }
  ns.AiWindow = {
    toggle = function()
      ns.calls.toggle = ns.calls.toggle + 1
    end,
  }
  ns.Settings = {
    open = function()
      ns.calls.settings = ns.calls.settings + 1
    end,
  }
  assert(loadfile("addon/WoWCompanion/MinimapButton.lua"))("WoWCompanion", ns)
  return ns
end

local function near(a, b)
  return math.abs(a - b) < 0.001
end

local ns = load()
local button = ns.MinimapButton.create()
assert(ns.MinimapButton.create() == button, "create is idempotent")
assert(button.parent == Minimap, "the button hangs from the minimap")
assert(button.name == "WoWCompanionMinimapButton", "the button has a global name")
assert(button:GetWidth() == 32 and button:GetHeight() == 32, "the button is 32 x 32, the size of Blizzard's map tracking pin button")
assert(button:IsShown() == true, "the button is shown by default")

local textures = {}
for _, child in ipairs(button.children) do
  textures[#textures + 1] = child
end
local border, background, icon
for _, texture in ipairs(textures) do
  if texture.texturePath == "Interface/Minimap/MiniMap-TrackingBorder" then
    border = texture
  elseif texture.texturePath == "Interface/Minimap/UI-Minimap-Background" then
    background = texture
  elseif texture.atlas then
    icon = texture
  end
end
assert(border ~= nil and border:GetWidth() == 54 and border:GetHeight() == 54, "the border is Blizzard's minimap tracking border at 54 x 54")
assert(border.points.TOPLEFT ~= nil and border.points.TOPLEFT.x == 0 and border.points.TOPLEFT.y == 0, "the border sits at the button's top left")
assert(background ~= nil and background:GetWidth() == 25, "the background is Blizzard's minimap background at 25 x 25")
assert(background.points.TOPLEFT.x == 3 and background.points.TOPLEFT.y == -4, "the background is offset as in the map pin button")
assert(icon ~= nil and icon.atlas == "Waypoint-MapPin-Untracked", "the icon is a Blizzard atlas")
assert(icon:GetWidth() == 20 and icon.points.TOPLEFT.x == 7 and icon.points.TOPLEFT.y == -6, "the icon is 20 x 20 at 7,-6 as in the map pin button")
assert(button.highlightTexturePath == "Interface/Minimap/UI-Minimap-ZoomButton-Highlight", "the highlight is Blizzard's minimap highlight")
assert(button.highlightBlendMode == "ADD", "the highlight blends additively")
assert(button.dragButton == "LeftButton", "the button registers for left-button drags")
assert(button.clickRegistrations[1] == "LeftButtonUp" and button.clickRegistrations[2] == "RightButtonUp", "the button registers both click buttons")

local RADIUS = 198 / 2 + 5
local point, relativeTo, relativePoint, x, y = button:GetPoint(1)
assert(point == "CENTER" and relativeTo == Minimap and relativePoint == "CENTER", "the button is placed around the minimap centre")
assert(near(x, math.cos(math.rad(225)) * RADIUS) and near(y, math.sin(math.rad(225)) * RADIUS), "the default angle puts the button at the lower left edge")

button:Fire("OnClick", "LeftButton")
assert(ns.calls.toggle == 1 and ns.calls.settings == 0, "left-click toggles the Claude window")
button:Fire("OnClick", "RightButton")
assert(ns.calls.toggle == 1 and ns.calls.settings == 1, "right-click opens the settings category")

button:Fire("OnMouseDown", "LeftButton")
assert(icon.points.TOPLEFT.x == 8 and icon.points.TOPLEFT.y == -8, "pressing moves the icon down and right like Blizzard's button")
button:Fire("OnMouseUp", "LeftButton")
assert(icon.points.TOPLEFT.x == 7 and icon.points.TOPLEFT.y == -6, "releasing puts the icon back")

button:Fire("OnEnter")
assert(GameTooltip.owner == button and GameTooltip.shown == true, "hovering shows the tooltip at the button")
assert(GameTooltip.lines[1].text == "WoW Companion", "the tooltip is titled WoW Companion")
assert(GameTooltip.lines[2].text == "Left-click: open or close", "the tooltip explains the left click")
assert(GameTooltip.lines[3].text == "Right-click: settings", "the tooltip explains the right click")
button:Fire("OnLeave")
assert(GameTooltip.shown == false, "leaving hides the tooltip")

button:Fire("OnMouseDown", "LeftButton")
button:Fire("OnDragStart")
assert(button.scripts.OnUpdate ~= nil, "dragging follows the cursor every frame")
_G.WOWC_TEST_CURSOR_X = Minimap.centerX
_G.WOWC_TEST_CURSOR_Y = Minimap.centerY + 300
button:Fire("OnUpdate")
assert(near(ns.MinimapButton.angle(), 90), "a cursor straight above the minimap centre is 90 degrees")
local _, _, _, dragX, dragY = button:GetPoint(1)
assert(near(dragX, 0) and near(dragY, RADIUS), "the button snaps to the minimap edge under the cursor, at the edge radius")
_G.WOWC_TEST_CURSOR_X = Minimap.centerX - 50
_G.WOWC_TEST_CURSOR_Y = Minimap.centerY
button:Fire("OnDragStop")
assert(button.scripts.OnUpdate == nil, "releasing stops following the cursor")
assert(icon.points.TOPLEFT.x == 7 and icon.points.TOPLEFT.y == -6, "a drag release puts the icon back at rest even when no mouse-up arrives")
button:Fire("OnMouseDown", "LeftButton")
assert(icon.points.TOPLEFT.x == 8, "pressing again moves the icon")
button:Fire("OnHide")
assert(icon.points.TOPLEFT.x == 7 and icon.points.TOPLEFT.y == -6, "hiding the button while pressed resets the icon offset")
assert(near(WoWCompanionDB.minimap.angle, 180), "the final angle is saved in WoWCompanionDB")

local reloaded = load()
local restored = reloaded.MinimapButton.create()
local _, _, _, restoredX, restoredY = restored:GetPoint(1)
assert(near(restoredX, -RADIUS) and near(math.abs(restoredY), 0), "the saved angle is restored on load")
assert(near(reloaded.MinimapButton.angle(), 180), "the restored angle reads back")

assert(reloaded.MinimapButton.isShown() == true, "shown by default")
reloaded.MinimapButton.setShown(false)
assert(restored:IsShown() == false, "the setting hides the button at once")
assert(WoWCompanionDB.minimap.hidden == true, "the hidden setting is saved")

local hiddenAtLoad = load()
assert(hiddenAtLoad.MinimapButton.isShown() == false, "the saved setting reads as hidden")
assert(hiddenAtLoad.MinimapButton.create():IsShown() == false, "a hidden button stays hidden after a reload")
hiddenAtLoad.MinimapButton.setShown(true)
assert(hiddenAtLoad.MinimapButton.button:IsShown() == true, "showing it again works")
assert(WoWCompanionDB.minimap.hidden == false, "the shown state is saved")
assert(hiddenAtLoad.MinimapButton.angle() == 180, "the angle survives hiding and showing")

WoWCompanionDB = nil
local early = load()
early.MinimapButton.setShown(false)
assert(early.MinimapButton.isShown() == false, "the setting works before the button exists")
assert(early.MinimapButton.create():IsShown() == false, "and is honoured when the button is created")

assert(early.MinimapButton.registerCompartment() == false, "without an addon compartment the registration is skipped")

local registered
_G.AddonCompartmentFrame = {
  RegisterAddon = function(_, data)
    registered = data
  end,
}
local withCompartment = load()
assert(withCompartment.MinimapButton.registerCompartment() == true, "with an addon compartment the addon registers there")
assert(registered.text == "WoW Companion", "the compartment entry is named WoW Companion")
assert(registered.icon == "Waypoint-MapPin-Untracked", "the compartment entry uses the same Blizzard atlas")
assert(registered.registerForAnyClick == true and registered.notCheckable == true, "the entry takes any click and has no check box")
registered.func(nil, { buttonName = "LeftButton" })
assert(withCompartment.calls.toggle == 1, "a left click on the entry toggles the window")
registered.func(nil, { buttonName = "RightButton" })
assert(withCompartment.calls.settings == 1, "a right click on the entry opens the settings")
_G.AddonCompartmentFrame = nil

print("minimap.button: all assertions passed")
