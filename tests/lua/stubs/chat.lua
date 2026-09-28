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
    points = {},
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
  self.points[1] = {
    point = point,
    relativeTo = relativeTo,
    relativePoint = relativePoint or point,
    x = x or 0,
    y = y or 0,
  }
end

function methods:ClearAllPoints()
  self.points = {}
end

function methods:GetPoint(index)
  local p = self.points[index or 1]
  if not p then
    return nil
  end
  return p.point, p.relativeTo, p.relativePoint, p.x, p.y
end

function methods:GetNumPoints()
  return #self.points
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

function methods:SetupMenu(generator)
  self.menuGenerator = generator
  local buttons = {}
  local rootDescription = {}
  function rootDescription:CreateButton(text, onClick, data)
    local button = { text = text, onClick = onClick, data = data }
    table.insert(buttons, button)
    return button
  end
  function rootDescription:CreateTitle(text)
    table.insert(buttons, { title = text })
  end
  function rootDescription:CreateDivider()
    table.insert(buttons, { divider = true })
  end
  generator(self, rootDescription)
  self.menuButtons = buttons
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
  self.sizing = nil
end

function methods:SetFrameStrata(strata)
  self.strata = strata
end

function methods:SetScrollChild(child)
  self.scrollChild = child
end

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
  local dialog = { editBox = newRegion("EditBox") }
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

_G.time = os.time

_G.NORMAL_FONT_COLOR = newColor(1, 1, 1)
_G.GRAY_FONT_COLOR = newColor(0.5, 0.5, 0.5)
_G.HIGHLIGHT_FONT_COLOR = newColor(1, 1, 0.6)
_G.YELLOW_FONT_COLOR = newColor(1, 1, 0)

_G.ITEM_QUALITY_COLORS = {}
for i = 0, 7 do
  _G.ITEM_QUALITY_COLORS[i] = newColor(1, 1, 1)
end

_G.GameFontHighlightSmall = _G.GameFontHighlightSmall or {}

_G.SOUNDKIT = { IG_MAINMENU_OPEN = 1, IG_MAINMENU_OPTION_CHECKBOX_ON = 2 }
_G.PlaySound = function() end
