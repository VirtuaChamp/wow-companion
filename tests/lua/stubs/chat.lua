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
    children = {},
    messages = {},
    width = 0,
    height = 0,
    cursor = 0,
    focused = false,
    registeredEvents = {},
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
  self.anchors[1] = {
    point = point,
    relativeTo = relativeTo,
    relativePoint = relativePoint or point,
    x = x or 0,
    y = y or 0,
  }
end

function methods:ClearAllPoints()
  self.anchors = {}
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

function methods:GetWidth()
  return self.width or 0
end

function methods:GetHeight()
  if self.kind == "EditBox" and self.multiLine and (self.height or 0) == 0 then
    local perLine = math.max(math.floor(math.max(self.width or 0, 1) / 6), 1)
    return math.max(math.ceil(#(self.text or "") / perLine), 1) * 14
  end
  return self.height or 0
end

function methods:GetSize()
  return self.width or 0, self.height or 0
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
  return 10, 10, 0, 5
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

local function installDropdown(dropdown)
  function dropdown:SetupMenu(generator)
    self.menuGenerator = generator
    local root = newDescription(self, nil, nil)
    function root:CreateTitle(text)
      table.insert(self.children, { title = text })
    end
    function root:CreateDivider()
      table.insert(self.children, { divider = true })
    end
    generator(self, root)
    self.menuButtons = root.children
  end
  function dropdown:OverrideText(text)
    if not text then
      return
    end
    self.disableSelectionText = true
    self:SetText(text)
  end
  function dropdown:UpdateToMenuSelections()
    if self.disableSelectionText then
      return
    end
    self:SetText(self.defaultText)
  end
  function dropdown:CloseMenu()
    self:UpdateToMenuSelections()
  end
end

local function installPopupDialog(dialog)
  dialog.EditBox = newRegion("EditBox")
  function dialog:GetEditBox()
    return self.EditBox
  end
end

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
    frame.Inset = newRegion("Frame")
  end
  if template == "WowStyle1DropdownTemplate" then
    installDropdown(frame)
  end
  if template == "PanelResizeButtonTemplate" then
    installResizeButton(frame)
  end
  if name then
    _G[name] = frame
  end
  return frame
end

_G.UIParent = _G.UIParent or newRegion("Frame")

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
  SetOwner = function() end,
  SetText = function() end,
  AddLine = function() end,
  Show = function() end,
  Hide = function() end,
}

_G.StaticPopupDialogs = _G.StaticPopupDialogs or {}

_G.StaticPopup_Show = function(which, textArg1, textArg2, data)
  local dialog = newRegion("Frame")
  installPopupDialog(dialog)
  _G.WOWC_TEST_LAST_STATIC_POPUP = {
    which = which,
    textArg1 = textArg1,
    textArg2 = textArg2,
    data = data,
    info = _G.StaticPopupDialogs[which],
    dialog = dialog,
  }
  return dialog
end

_G.GetServerTime = function()
  return _G.WOWC_TEST_SERVER_TIME or os.time()
end

_G.NORMAL_FONT_COLOR = newColor(1, 1, 1)
_G.GRAY_FONT_COLOR = newColor(0.5, 0.5, 0.5)
_G.YELLOW_FONT_COLOR = newColor(1, 1, 0)

_G.ITEM_QUALITY_COLORS = {}
for i = 0, 7 do
  local color = newColor(0.1 * i, 0.5, 0.25)
  _G.ITEM_QUALITY_COLORS[i] = { r = color.r, g = color.g, b = color.b, hex = "|cff", color = color }
end

_G.GameFontHighlightSmall = _G.GameFontHighlightSmall or {}

_G.C_Item = _G.C_Item or {}
_G.C_Item.GetItemQualityByID = function(itemId)
  local _, _, quality = _G.C_Item.GetItemInfo(itemId)
  return quality
end
