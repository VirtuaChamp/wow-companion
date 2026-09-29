local _, ns = ...

ns.MinimapButton = ns.MinimapButton or {}

local MinimapButton = ns.MinimapButton

local BUTTON_SIZE = 32
local BORDER_SIZE = 54
local BACKGROUND_SIZE = 25
local BACKGROUND_X = 3
local BACKGROUND_Y = -4
local ICON_SIZE = 20
local ICON_X = 7
local ICON_Y = -6
local ICON_PRESSED_X = 8
local ICON_PRESSED_Y = -8
local BORDER_TEXTURE = "Interface/Minimap/MiniMap-TrackingBorder"
local BACKGROUND_TEXTURE = "Interface/Minimap/UI-Minimap-Background"
local HIGHLIGHT_TEXTURE = "Interface/Minimap/UI-Minimap-ZoomButton-Highlight"
local ICON_ATLAS = "Waypoint-MapPin-Untracked"
local DEFAULT_ANGLE = 225
local EDGE_PADDING = 5
local TITLE = "WoW Companion"

local button

local function store()
  WoWCompanionDB = WoWCompanionDB or {}
  WoWCompanionDB.minimap = WoWCompanionDB.minimap or {}
  return WoWCompanionDB.minimap
end

function MinimapButton.angle()
  return store().angle or DEFAULT_ANGLE
end

function MinimapButton.isShown()
  return store().hidden ~= true
end

local function place()
  local radians = math.rad(MinimapButton.angle())
  local radius = Minimap:GetWidth() / 2 + EDGE_PADDING
  button:ClearAllPoints()
  button:SetPoint("CENTER", Minimap, "CENTER", math.cos(radians) * radius, math.sin(radians) * radius)
end

local function angleToCursor()
  local centerX, centerY = Minimap:GetCenter()
  local cursorX, cursorY = GetCursorPosition()
  local scale = Minimap:GetEffectiveScale()
  return math.deg(math.atan2(cursorY / scale - centerY, cursorX / scale - centerX))
end

local function onDragUpdate()
  store().angle = angleToCursor()
  place()
end

local function onMouseUp(self)
  self.icon:SetPoint("TOPLEFT", self, "TOPLEFT", ICON_X, ICON_Y)
end

local function onDragStart(self)
  self:SetScript("OnUpdate", onDragUpdate)
end

local function onDragStop(self)
  self:SetScript("OnUpdate", nil)
  store().angle = angleToCursor()
  place()
  onMouseUp(self)
end

local function onClick(_, mouseButton)
  if mouseButton == "RightButton" then
    ns.Settings.open()
  else
    ns.AiWindow.toggle()
  end
end

local function onEnter(self)
  GameTooltip:SetOwner(self, "ANCHOR_LEFT")
  GameTooltip:SetText(TITLE)
  local r, g, b = GRAY_FONT_COLOR:GetRGB()
  GameTooltip:AddLine("Left-click: open or close", r, g, b)
  GameTooltip:AddLine("Right-click: settings", r, g, b)
  GameTooltip:Show()
end

local function onLeave()
  GameTooltip:Hide()
end

local function onMouseDown(self)
  self.icon:SetPoint("TOPLEFT", self, "TOPLEFT", ICON_PRESSED_X, ICON_PRESSED_Y)
end

local function build()
  button = CreateFrame("Button", "WoWCompanionMinimapButton", Minimap)
  button:SetSize(BUTTON_SIZE, BUTTON_SIZE)
  button:SetFrameStrata("MEDIUM")
  button:SetFrameLevel(Minimap:GetFrameLevel() + 8)
  button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  button:RegisterForDrag("LeftButton")

  local background = button:CreateTexture(nil, "BACKGROUND")
  background:SetTexture(BACKGROUND_TEXTURE)
  background:SetSize(BACKGROUND_SIZE, BACKGROUND_SIZE)
  background:SetPoint("TOPLEFT", button, "TOPLEFT", BACKGROUND_X, BACKGROUND_Y)

  local icon = button:CreateTexture(nil, "ARTWORK")
  icon:SetAtlas(ICON_ATLAS)
  icon:SetSize(ICON_SIZE, ICON_SIZE)
  icon:SetPoint("TOPLEFT", button, "TOPLEFT", ICON_X, ICON_Y)
  button.icon = icon

  local border = button:CreateTexture(nil, "OVERLAY")
  border:SetTexture(BORDER_TEXTURE)
  border:SetSize(BORDER_SIZE, BORDER_SIZE)
  border:SetPoint("TOPLEFT", button, "TOPLEFT", 0, 0)

  button:SetHighlightTexture(HIGHLIGHT_TEXTURE, "ADD")

  button:SetScript("OnClick", onClick)
  button:SetScript("OnEnter", onEnter)
  button:SetScript("OnLeave", onLeave)
  button:SetScript("OnMouseDown", onMouseDown)
  button:SetScript("OnMouseUp", onMouseUp)
  button:SetScript("OnHide", onMouseUp)
  button:SetScript("OnDragStart", onDragStart)
  button:SetScript("OnDragStop", onDragStop)
  return button
end

function MinimapButton.create()
  if button then
    return button
  end
  build()
  place()
  if MinimapButton.isShown() then
    button:Show()
  else
    button:Hide()
  end
  MinimapButton.button = button
  return button
end

function MinimapButton.setShown(shown)
  store().hidden = not shown
  if button then
    if shown then
      button:Show()
    else
      button:Hide()
    end
  end
end

function MinimapButton.registerCompartment()
  if not AddonCompartmentFrame or not AddonCompartmentFrame.RegisterAddon then
    return false
  end
  AddonCompartmentFrame:RegisterAddon({
    text = TITLE,
    icon = ICON_ATLAS,
    registerForAnyClick = true,
    notCheckable = true,
    func = function(_, menuInputData)
      onClick(nil, menuInputData and menuInputData.buttonName)
    end,
    funcOnEnter = function(owner)
      onEnter(owner)
    end,
    funcOnLeave = onLeave,
  })
  return true
end
