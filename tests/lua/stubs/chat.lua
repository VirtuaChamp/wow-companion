local mockMeta
local methods = {}

local function callScript(self, name, ...)
  local fn = self.scripts[name]
  if fn then
    return fn(self, ...)
  end
end

local function newRegion(kind)
  local obj = {
    kind = kind,
    scripts = {},
    shown = true,
    text = "",
    anchors = {},
    points = {},
    frameLevel = 1,
    scrollLog = {},
    fading = true,
    maxLines = 0,
    mouseWheelEnabled = false,
    hitRectInsets = { 0, 0, 0, 0 },
    justifyH = "CENTER",
    indentedWordWrap = false,
    children = {},
    messages = {},
    width = 0,
    height = 0,
    cursor = 0,
    focused = false,
    registeredEvents = {},
    texturePath = false,
    atlas = false,
  }
  return setmetatable(obj, mockMeta)
end

function methods:SetScript(scriptName, fn)
  self.scripts[scriptName] = fn
  if scriptName == "OnEvent" then
    self.onEvent = fn
    _G.WOWC_TEST_LAST_FRAME = self
  end
end

function methods:RegisterEvent(event)
  self.registeredEvents[event] = true
end

function methods:UnregisterEvent(event)
  self.registeredEvents[event] = nil
end

function methods:GetScript(scriptName)
  return self.scripts[scriptName]
end

function methods:HookScript(scriptName, fn)
  local previous = self.scripts[scriptName]
  self.scripts[scriptName] = function(frame, ...)
    if previous then
      previous(frame, ...)
    end
    return fn(frame, ...)
  end
end

function methods:Fire(scriptName, ...)
  return callScript(self, scriptName, ...)
end

function methods:SetPoint(point, a, b, c, d)
  local relativeTo, relativePoint, x, y
  if type(a) == "table" or a == nil then
    relativeTo, relativePoint, x, y = a, b, c, d
  else
    relativeTo, relativePoint, x, y = self.parent, point, a, b
  end
  local anchor = {
    point = point,
    relativeTo = relativeTo,
    relativePoint = relativePoint or point,
    x = x or 0,
    y = y or 0,
  }
  self.anchors[1] = anchor
  self.points[point] = anchor
end

function methods:ClearAllPoints()
  self.anchors = {}
  self.points = {}
end

function methods:GetPointByName(point)
  local p = self.points[point]
  if not p then
    return nil
  end
  return p.point, p.relativeTo, p.relativePoint, p.x, p.y
end

function methods:SetFrameLevel(level)
  self.frameLevel = level
end

function methods:GetFrameLevel()
  return self.frameLevel
end

function methods:GetPoint(index)
  local p = self.anchors[index or 1]
  if not p then
    return nil
  end
  return p.point, p.relativeTo, p.relativePoint, p.x, p.y
end

function methods:GetNumPoints()
  return #self.anchors
end

function methods:SetSize(w, h)
  self.width, self.height = w, h
end

function methods:SetWidth(w)
  self.width = w
end

function methods:SetHeight(h)
  self.height = h
end

local function anchoredSize(self)
  local topLeft = self.points.TOPLEFT
  local bottomRight = self.points.BOTTOMRIGHT
  if not topLeft or not bottomRight then
    return nil
  end
  local relative = topLeft.relativeTo
  if relative == nil or relative ~= bottomRight.relativeTo then
    return nil
  end
  if topLeft.relativePoint ~= "TOPLEFT" or bottomRight.relativePoint ~= "BOTTOMRIGHT" then
    return nil
  end
  local relativeWidth, relativeHeight = relative:GetSize()
  return relativeWidth + bottomRight.x - topLeft.x, relativeHeight + topLeft.y - bottomRight.y
end

function methods:GetWidth()
  if (self.width or 0) == 0 then
    local width = anchoredSize(self)
    if width then
      return width
    end
  end
  return self.width or 0
end

function methods:GetHeight()
  if self.kind == "EditBox" and rawget(self, "multiLine") and (self.height or 0) == 0 then
    local perLine = math.max(math.floor(math.max(self.width or 0, 1) / 6), 1)
    return math.max(math.ceil(#(self.text or "") / perLine), 1) * 14
  end
  if (self.height or 0) == 0 then
    local _, height = anchoredSize(self)
    if height then
      return height
    end
  end
  return self.height or 0
end

function methods:GetSize()
  return self:GetWidth(), self:GetHeight()
end

function methods:SetHitRectInsets(left, right, top, bottom)
  self.hitRectInsets = { left, right, top, bottom }
end

function methods:SetFading(flag)
  self.fading = flag
end

function methods:SetMaxLines(maxLines)
  self.maxLines = maxLines
end

function methods:EnableMouseWheel(flag)
  self.mouseWheelEnabled = flag
end

function methods:ScrollUp()
  self.scrollLog[#self.scrollLog + 1] = "up"
end

function methods:ScrollDown()
  self.scrollLog[#self.scrollLog + 1] = "down"
end

function methods:PageUp()
  self.scrollLog[#self.scrollLog + 1] = "pageup"
end

function methods:PageDown()
  self.scrollLog[#self.scrollLog + 1] = "pagedown"
end

function methods:GetEffectiveScale()
  return 1
end

function methods:SetScale(scale)
  self.scale = scale
end

function methods:Show()
  self.shown = true
  callScript(self, "OnShow")
end

function methods:Hide()
  self.shown = false
  callScript(self, "OnHide")
end

function methods:IsShown()
  return self.shown
end

function methods:IsVisible()
  return self.shown
end

function methods:SetText(t)
  self.text = t or ""
end

function methods:GetText()
  return self.text or ""
end

function methods:SetTextColor(r, g, b, a)
  self.textColor = { r = r, g = g, b = b, a = a }
end

function methods:SetFontObject(fontObject)
  self.fontObject = fontObject
  self.justifyH = "CENTER"
end

function methods:SetJustifyH(justifyH)
  self.justifyH = justifyH
end

function methods:SetIndentedWordWrap(flag)
  self.indentedWordWrap = flag
end

function methods:SetTextInsets(left, right, top, bottom)
  self.textInsets = { left, right, top, bottom }
end

function methods:SetFocus()
  self.focused = true
end

function methods:ClearFocus()
  self.focused = false
end

function methods:HasFocus()
  return self.focused == true
end

function methods:SetCursorPosition(p)
  self.cursor = p
end

function methods:GetCursorPosition()
  return self.cursor or #(self.text or "")
end

function methods:SetAutoFocus(flag)
  self.autoFocus = flag
end

function methods:SetMultiLine(flag)
  self.multiLine = flag
end

function methods:HighlightText()
  self.highlighted = true
end

function methods:AddMessage(text, r, g, b, id)
  self.messages = self.messages or {}
  table.insert(self.messages, { text = text, r = r, g = g, b = b, id = id })
end

function methods:GetNumMessages()
  return #(self.messages or {})
end

function methods:Clear()
  self.messages = {}
end

function methods:SetHyperlinksEnabled(flag)
  self.hyperlinksEnabled = flag
end

function methods:CreateFontString(name, layer, template)
  local fs = newRegion("FontString")
  fs.parent = self
  fs.template = template
  table.insert(self.children, fs)
  if name then
    _G[name] = fs
  end
  return fs
end

function methods:CreateTexture(name, layer, template)
  local tex = newRegion("Texture")
  tex.parent = self
  tex.template = template
  table.insert(self.children, tex)
  if name then
    _G[name] = tex
  end
  return tex
end

function methods:SetColorTexture(r, g, b, a)
  self.color = { r = r, g = g, b = b, a = a }
end

function methods:SetNormalAtlas(atlas)
  self.normalAtlas = atlas
end

function methods:SetHighlightAtlas(atlas, blendMode)
  self.highlightAtlas = atlas
  self.highlightBlendMode = blendMode
end

function methods:SetAtlas(atlas)
  self.atlas = atlas
end

function methods:GetStringWidth()
  return #(self.text or "") * 6
end

function methods:GetStringHeight()
  local perLine = math.max(math.floor(math.max(self.width or 0, 1) / 6), 1)
  return math.max(math.ceil(#(self.text or "") / perLine), 1) * 14
end

function methods:GetTextInsets()
  local insets = rawget(self, "textInsets") or { 10, 10, 0, 5 }
  return insets[1], insets[2], insets[3], insets[4]
end

function methods:SetMovable(flag)
  self.movable = flag
end

function methods:SetResizable(flag)
  self.resizable = flag
end

function methods:SetClampedToScreen(flag)
  self.clamped = flag
end

function methods:SetResizeBounds(minW, minH, maxW, maxH)
  self.resizeBounds = { minW, minH, maxW, maxH }
end

function methods:EnableMouse(flag)
  self.mouseEnabled = flag
end

function methods:RegisterForDrag(button)
  self.dragButton = button
end

function methods:StartMoving()
  self.moving = true
end

function methods:StartSizing(point)
  self.sizing = point
end

function methods:StopMovingOrSizing()
  self.moving = false
  self.sizing = false
end

function methods:SetFrameStrata(strata)
  self.strata = strata
end

function methods:SetScrollChild(child)
  self.scrollChild = child
end

_G.WOWC_TEST_WIDGET_METHODS = methods

mockMeta = {
  __index = function(t, key)
    local method = methods[key]
    if not method then
      error("wow-stub: unknown widget method '" .. tostring(key) .. "' called on a mock frame", 2)
    end
    return method
  end,
}

local function newColor(r, g, b)
  local color = { r = r, g = g, b = b }
  function color:GetRGB()
    return self.r, self.g, self.b
  end
  function color:WrapTextInColorCode(text)
    local function byte(value)
      return math.floor(value * 255 + 0.5)
    end
    return ("|cff%02x%02x%02x%s|r"):format(byte(self.r), byte(self.g), byte(self.b), text)
  end
  return color
end

local function newDescription(owner, text, onClick)
  local description = { text = text, onClick = onClick, children = {} }
  function description:CreateButton(childText, childOnClick)
    local child = newDescription(owner, childText, childOnClick)
    table.insert(self.children, child)
    return child
  end
  function description:Pick()
    if self.onClick then
      self.onClick()
    end
    owner:CloseMenu()
  end
  return description
end

_G.WOWC_TEST_NEW_MENU_DESCRIPTION = newDescription

function methods:SetTexture(path)
  self.texturePath = path
end

function methods:SetHighlightTexture(path, blendMode)
  self.highlightTexturePath = path
  self.highlightBlendMode = blendMode
end

function methods:GetCenter()
  return self.centerX or 0, self.centerY or 0
end

function methods:SetShown(flag)
  if flag then
    self:Show()
  else
    self:Hide()
  end
end

function methods:SetAlpha(alpha)
  self.alpha = alpha
end

function methods:GetAlpha()
  return self.alpha or 1
end

function methods:SetWordWrap(flag)
  self.wordWrap = flag
end

function methods:RegisterForClicks(...)
  self.clickRegistrations = { ... }
end

function methods:SetBackdropColor(r, g, b, a)
  self.backdropColor = { r = r, g = g, b = b, a = a }
end

local function newDataProvider(initial)
  local provider = { collection = {}, listeners = {} }
  local function changed()
    for _, listener in ipairs(provider.listeners) do
      listener()
    end
  end
  function provider:Insert(...)
    for i = 1, select("#", ...) do
      table.insert(self.collection, (select(i, ...)))
    end
    changed()
  end
  function provider:InsertTable(tbl)
    for _, value in ipairs(tbl) do
      table.insert(self.collection, value)
    end
  end
  function provider:Remove(element)
    for index, value in ipairs(self.collection) do
      if value == element then
        table.remove(self.collection, index)
        changed()
        return index
      end
    end
  end
  function provider:RemoveIndex(index)
    table.remove(self.collection, index)
    changed()
  end
  function provider:Flush()
    self.collection = {}
    changed()
  end
  function provider:GetSize()
    return #self.collection
  end
  function provider:GetCollection()
    return self.collection
  end
  function provider:Find(index)
    return self.collection[index]
  end
  function provider:FindIndex(element)
    for index, value in ipairs(self.collection) do
      if value == element then
        return index
      end
    end
  end
  if initial then
    provider:InsertTable(initial)
  end
  return provider
end

_G.CreateDataProvider = function(initial)
  return newDataProvider(initial)
end

_G.ScrollBoxConstants = {
  NoScrollInterpolation = true,
  RetainScrollPosition = true,
  DiscardScrollPosition = false,
  ScrollEnd = 1 - 0.00001,
}

_G.BaseScrollBoxEvents = { OnSizeChanged = "OnSizeChanged", OnScroll = "OnScroll" }

_G.ScrollControllerMixin = { Directions = { Increase = 1, Decrease = -1 } }

_G.CreateScrollBoxListLinearView = function(top, bottom, left, right, spacing)
  local view = { top = top or 0, bottom = bottom or 0, left = left or 0, right = right or 0, spacing = spacing or 0 }
  function view:SetElementInitializer(template, initializer)
    self.elementFactory = function(factory)
      factory(template, initializer)
    end
  end
  function view:SetElementFactory(factory)
    self.elementFactory = factory
  end
  function view:SetElementExtent(extent)
    self.elementExtent = extent
  end
  function view:SetPadding(newTop, newBottom, newLeft, newRight, newSpacing)
    self.top, self.bottom, self.left, self.right, self.spacing = newTop, newBottom, newLeft, newRight, newSpacing
  end
  function view:SetElementExtentCalculator(calculator)
    self.extentCalculator = calculator
  end
  return view
end

local function frameTypeForTemplate(template)
  if template == "Frame" or template == "Button" then
    return template
  end
  return "Frame"
end

local function installScrollBox(box)
  box.frames = {}
  box.view = false
  box.provider = newDataProvider()
  box.callbacks = {}
  box.scrollPercentage = 0
  box.scrollEndCalls = 0
  box.rebuildCount = 0
  box.wheelLog = {}
  box.pageLog = {}
  box.ScrollTarget = newRegion("Frame")

  local function elementExtent(index, data)
    local view = box.view
    if view.elementExtent then
      return view.elementExtent
    end
    return view.extentCalculator(index, data)
  end

  local function totalExtent()
    local view = box.view
    if not view then
      return 0
    end
    local total = view.top + view.bottom
    for index, data in ipairs(box.provider.collection) do
      total = total + elementExtent(index, data)
      if index > 1 then
        total = total + view.spacing
      end
    end
    return total
  end

  local function acquire(index, data)
    local view = box.view
    local template, initializer
    view.elementFactory(function(factoryTemplate, factoryInitializer)
      template = factoryTemplate
      initializer = factoryInitializer
    end, data)
    local frame = box.frames[index]
    if frame == nil then
      frame = CreateFrame(frameTypeForTemplate(template), nil, box.ScrollTarget)
      box.frames[index] = frame
      frame.acquireCount = 0
    end
    frame.acquireCount = frame.acquireCount + 1
    frame.elementData = data
    frame.elementIndex = index
    frame.initializer = initializer
    frame:Show()
    return frame, initializer
  end

  local function layout()
    local view = box.view
    if not view or not box.provider then
      return
    end
    local offset = view.top
    local count = #box.provider.collection
    for index, data in ipairs(box.provider.collection) do
      local frame, initializer = acquire(index, data)
      local extent = elementExtent(index, data)
      frame:ClearAllPoints()
      frame:SetPoint("TOPLEFT", box.ScrollTarget, "TOPLEFT", 0, -offset)
      frame:SetPoint("TOPRIGHT", box.ScrollTarget, "TOPRIGHT", 0, -offset)
      frame:SetHeight(extent)
      frame.offset = offset
      initializer(frame, data)
      offset = offset + extent + view.spacing
    end
    box:TriggerEvent("OnLayout")
    for index = count + 1, #box.frames do
      box.frames[index]:Hide()
      box.frames[index].elementData = nil
    end
  end

  function box:SetDataProvider(provider, retain)
    self.setProviderCalls = (rawget(self, "setProviderCalls") or 0) + 1
    self.provider = provider
    provider.listeners = { layout }
    if not retain then
      self.scrollPercentage = 0
    end
    layout()
  end
  function box:Rebuild()
    self.rebuildCount = self.rebuildCount + 1
    layout()
  end
  function box:ReinitializeFrames()
    for index, data in ipairs(self.provider.collection) do
      local frame = self.frames[index]
      if frame and frame.initializer then
        frame.initializer(frame, data)
      end
    end
  end
  function box:GetVisibleFrames()
    local visible = {}
    for index = 1, #self.provider.collection do
      visible[#visible + 1] = self.frames[index]
    end
    return visible
  end
  function box:GetExtent()
    return totalExtent()
  end
  function box:HasScrollableExtent()
    return totalExtent() > self:GetHeight()
  end
  function box:GetVisibleExtentPercentage()
    local total = totalExtent()
    if total <= 0 then
      return 1
    end
    return math.min(1, self:GetHeight() / total)
  end
  function box:GetScrollPercentage()
    return self.scrollPercentage
  end
  function box:SetScrollPercentage(value)
    self.scrollPercentage = value
  end
  function box:ScrollToEnd()
    self.scrollEndCalls = self.scrollEndCalls + 1
    self.scrollPercentage = 1
  end
  function box:ScrollInDirection(percentage, direction)
    table.insert(self.pageLog, { percentage = percentage, direction = direction })
  end
  function box:OnMouseWheel(delta)
    table.insert(self.wheelLog, delta)
  end
  function box:RegisterCallback(event, fn, owner)
    self.callbacks[event] = self.callbacks[event] or {}
    table.insert(self.callbacks[event], { fn = fn, owner = owner })
  end
  function box:TriggerEvent(event, ...)
    for _, entry in ipairs(self.callbacks[event] or {}) do
      entry.fn(entry.owner, ...)
    end
  end
end

_G.CreateAnchor = function(point, relativeTo, relativePoint, x, y)
  local anchor = { point = point, relativeTo = relativeTo, relativePoint = relativePoint, x = x, y = y }
  function anchor:SetPoint(region, clearAllPoints)
    if clearAllPoints then
      region:ClearAllPoints()
    end
    region:SetPoint(self.point, self.relativeTo, self.relativePoint, self.x, self.y)
  end
  return anchor
end

_G.ScrollUtil = {
  InitScrollBoxListWithScrollBar = function(box, bar, view)
    box.view = view
    box.scrollBar = bar
  end,
  AddManagedScrollBarVisibilityBehavior = function(box, bar, anchorsWithBar, anchorsWithoutBar)
    local behavior = { appliedAnchors = nil }
    function behavior:Evaluate(force)
      local visible = box:HasScrollableExtent()
      if not force and visible == bar:IsShown() then
        return
      end
      bar:SetShown(visible)
      local anchors = visible and anchorsWithBar or anchorsWithoutBar
      if self.appliedAnchors == anchors then
        return
      end
      self.appliedAnchors = anchors
      box:ClearAllPoints()
      for _, anchor in ipairs(anchors) do
        anchor:SetPoint(box, false)
      end
    end
    box:RegisterCallback("OnLayout", behavior.Evaluate, behavior)
    box:RegisterCallback("OnSizeChanged", behavior.Evaluate, behavior)
    behavior:Evaluate(true)
    box.scrollBarBehavior = behavior
    return behavior
  end,
}

_G.TOOLTIP_DEFAULT_BACKGROUND_COLOR = newColor(0.1, 0.1, 0.1)

local function installResizeButton(button)
  function button:Init(target, minWidth, minHeight, maxWidth, maxHeight)
    self.target = target
    self.resizeLimits = { minWidth, minHeight, maxWidth, maxHeight }
  end
  function button:SetOnResizeStoppedCallback(callback)
    self.resizeStoppedCallback = callback
  end
  button.scripts.OnMouseDown = function(self)
    self.target:StartSizing("BOTTOMRIGHT")
  end
  button.scripts.OnMouseUp = function(self)
    self.target:StopMovingOrSizing()
    if self.resizeStoppedCallback then
      self.resizeStoppedCallback(self.target)
    end
  end
end

_G.CreateFrame = function(frameType, name, parent, template)
  local frame = newRegion(frameType or "Frame")
  frame.name = name
  frame.parent = parent
  frame.template = template
  if template == "ButtonFrameTemplate" then
    frame.TitleContainer = newRegion("Frame")
    frame.TitleContainer.TitleText = newRegion("FontString")
    frame.TitleContainer:SetPoint("TOPLEFT", frame, "TOPLEFT", 58, -1)
    frame.TitleContainer:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -24, -1)
    frame.Inset = newRegion("Frame")
    frame.Inset:SetPoint("TOPLEFT", frame, "TOPLEFT", 4, -60)
    frame.Inset:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -6, 26)
    frame.TopTileStreaks = newRegion("Texture")
    frame.CloseButton = newRegion("Button")
    frame.CloseButton:SetSize(24, 24)
    frame.CloseButton:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -2, 1)
    frame.CloseButton:SetFrameLevel(510)
    frame.portraitShown = true
    frame.border = "PortraitFrameTemplate"
  end
  if template == "PanelResizeButtonTemplate" then
    installResizeButton(frame)
  end
  if template == "WowScrollBoxList" then
    installScrollBox(frame)
  end
  if name then
    _G[name] = frame
  end
  return frame
end

_G.ButtonFrameTemplate_HidePortrait = function(self)
  self.border = "ButtonFrameTemplateNoPortrait"
  self.portraitShown = false
  local _, insetTo, insetRelative, _, insetY = self.Inset:GetPointByName("TOPLEFT")
  self.Inset:SetPoint("TOPLEFT", insetTo, insetRelative, 9, insetY)
  self.TitleContainer:SetPoint("TOPLEFT", self, "TOPLEFT", 0, -1)
  self.TitleContainer:SetPoint("TOPRIGHT", self, "TOPRIGHT", 0, -1)
end

_G.ButtonFrameTemplate_HideAttic = function(self)
  self.Inset:SetPoint("TOPLEFT", self, "TOPLEFT", 4, -24)
  self.TopTileStreaks:Hide()
end

_G.ButtonFrameTemplate_HideButtonBar = function(self)
  self.Inset:SetPoint("BOTTOMRIGHT", self, "BOTTOMRIGHT", -6, 4)
end

_G.IsShiftKeyDown = function()
  return _G.WOWC_TEST_SHIFT_DOWN == true
end

_G.UIParent = _G.UIParent or newRegion("Frame")

_G.Minimap = newRegion("Frame")
_G.Minimap:SetSize(198, 198)
_G.Minimap.centerX = 1000
_G.Minimap.centerY = 500

_G.GetCursorPosition = function()
  return _G.WOWC_TEST_CURSOR_X or 0, _G.WOWC_TEST_CURSOR_Y or 0
end

_G.SlashCmdList = _G.SlashCmdList or {}

_G.LinkTypes = { AddOn = "addon" }

_G.LinkUtil = {
  FormatLink = function(linkType, linkDisplayText, ...)
    local optionParts = { ... }
    local body = ("|H%s"):format(linkType)
    if #optionParts > 0 then
      body = body .. ":" .. table.concat(optionParts, ":")
    end
    if linkDisplayText then
      return body .. ("|h%s|h"):format(linkDisplayText)
    end
    return body .. "|h"
  end,
  SplitLinkData = function(linkData)
    local linkType, linkOptions = linkData:match("^([^:]+):?(.*)$")
    return linkType, linkOptions or ""
  end,
}

_G.strsplit = function(sep, str)
  local result = {}
  local start = 1
  local sepPos = str:find(sep, start, true)
  while sepPos do
    table.insert(result, str:sub(start, sepPos - 1))
    start = sepPos + #sep
    sepPos = str:find(sep, start, true)
  end
  table.insert(result, str:sub(start))
  return unpack(result)
end

_G.EventRegistry = {
  callbacks = {},
  RegisterCallback = function(self, event, fn, owner)
    self.callbacks[event] = self.callbacks[event] or {}
    table.insert(self.callbacks[event], { fn = fn, owner = owner })
  end,
  TriggerEvent = function(self, event, ...)
    for _, entry in ipairs(self.callbacks[event] or {}) do
      entry.fn(entry.owner, ...)
    end
  end,
}

_G.SetItemRef = function(link, text, button, frame)
  _G.EventRegistry:TriggerEvent("SetItemRef", link, text, button, frame)
end

_G.GameTooltip = {
  lines = {},
  shown = false,
  SetOwner = function(self, owner, anchor)
    self.owner = owner
    self.anchor = anchor
    self.lines = {}
  end,
  SetText = function(self, text)
    self.lines = { { text = text } }
  end,
  AddLine = function(self, text, r, g, b)
    table.insert(self.lines, { text = text, r = r, g = g, b = b })
  end,
  Show = function(self)
    self.shown = true
  end,
  Hide = function(self)
    self.shown = false
  end,
}

_G.GetServerTime = function()
  return _G.WOWC_TEST_SERVER_TIME or os.time()
end

_G.NORMAL_FONT_COLOR = newColor(1, 0.82, 0)
_G.GRAY_FONT_COLOR = newColor(0.5, 0.5, 0.5)
_G.YELLOW_FONT_COLOR = newColor(1, 1, 0)

_G.ITEM_QUALITY_COLORS = {}
for i = 0, 7 do
  local color = newColor(0.1 * i, 0.5, 0.25)
  _G.ITEM_QUALITY_COLORS[i] = { r = color.r, g = color.g, b = color.b, hex = "|cff", color = color }
end

for _, fontName in ipairs({
  "GameFontHighlightSmall",
  "GameFontHighlight",
  "GameFontHighlightMedium",
  "GameFontHighlightLarge",
  "GameFontNormalSmall",
  "GameFontNormal",
  "GameFontNormalMed3",
  "GameFontNormalLarge",
}) do
  local heights = {
    GameFontHighlightSmall = 10,
    GameFontNormalSmall = 10,
    GameFontHighlight = 12,
    GameFontNormal = 12,
    GameFontHighlightMedium = 14,
    GameFontNormalMed3 = 14,
    GameFontHighlightLarge = 16,
    GameFontNormalLarge = 16,
  }
  _G[fontName] = _G[fontName]
    or {
      fontName = fontName,
      GetFont = function()
        return "Fonts/FRIZQT__.TTF", heights[fontName], ""
      end,
    }
end

_G.C_Item = _G.C_Item or {}
_G.C_Item.GetItemQualityByID = function(itemId)
  local _, _, quality = _G.C_Item.GetItemInfo(itemId)
  return quality
end
