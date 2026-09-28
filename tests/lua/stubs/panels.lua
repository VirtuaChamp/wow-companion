local baseCreateFrame = _G.CreateFrame

local function ensureMethod(frame, name, fn)
  if frame[name] == nil then
    frame[name] = fn
  end
end

local closeButtonTemplates = {
  BaseBasicFrameTemplate = true,
  BasicFrameTemplate = true,
  BasicFrameTemplateWithInset = true,
}

_G.CreateFrame = function(frameType, name, parent, template)
  local frame = baseCreateFrame(frameType, name, parent, template)
  frame.frameType = frameType
  frame.name = name
  frame.parent = parent
  frame.template = template
  frame.children = frame.children or {}
  frame.scripts = frame.scripts or {}

  local baseSetScript = frame.SetScript
  frame.SetScript = function(self, scriptType, handler)
    if baseSetScript then
      baseSetScript(self, scriptType, handler)
    end
    self.scripts[scriptType] = handler
  end

  ensureMethod(frame, "GetScript", function(self, scriptType)
    return self.scripts[scriptType]
  end)
  ensureMethod(frame, "HookScript", function(self, scriptType, handler)
    local previous = self.scripts[scriptType]
    self:SetScript(scriptType, function(...)
      if previous then
        previous(...)
      end
      return handler(...)
    end)
  end)
  local baseSetPoint = frame.SetPoint
  frame.points = {}
  frame.SetPoint = function(self, point, ...)
    table.insert(self.points, point)
    if baseSetPoint then
      return baseSetPoint(self, point, ...)
    end
  end
  ensureMethod(frame, "SetJustifyH", function() end)
  ensureMethod(frame, "ClearAllPoints", function() end)
  ensureMethod(frame, "SetSize", function(self, width, height)
    self.width = width
    self.height = height
  end)
  ensureMethod(frame, "SetWidth", function(self, width)
    self.width = width
  end)
  ensureMethod(frame, "SetHeight", function(self, height)
    self.height = height
  end)
  ensureMethod(frame, "GetName", function(self)
    return self.name
  end)
  ensureMethod(frame, "GetWidth", function(self)
    return self.width
  end)
  ensureMethod(frame, "GetHeight", function(self)
    return self.height
  end)
  ensureMethod(frame, "Show", function(self)
    self.shown = true
  end)
  ensureMethod(frame, "Hide", function(self)
    self.shown = false
  end)
  ensureMethod(frame, "IsShown", function(self)
    return self.shown == true
  end)
  ensureMethod(frame, "SetShown", function(self, shown)
    if shown then
      self:Show()
    else
      self:Hide()
    end
  end)
  ensureMethod(frame, "SetMovable", function() end)
  ensureMethod(frame, "EnableMouse", function() end)
  ensureMethod(frame, "RegisterForDrag", function() end)
  ensureMethod(frame, "SetScale", function() end)
  ensureMethod(frame, "SetFrameStrata", function() end)
  ensureMethod(frame, "SetText", function(self, text)
    self.text = text
  end)
  ensureMethod(frame, "GetText", function(self)
    return self.text or ""
  end)
  ensureMethod(frame, "SetMultiLine", function(self, flag)
    self.multiLine = flag
  end)
  ensureMethod(frame, "SetAutoFocus", function(self, flag)
    self.autoFocus = flag
  end)
  ensureMethod(frame, "SetFocus", function(self)
    self.focused = true
  end)
  ensureMethod(frame, "ClearFocus", function(self)
    self.focused = false
  end)
  ensureMethod(frame, "HighlightText", function(self)
    self.highlighted = true
  end)
  ensureMethod(frame, "SetCursorPosition", function() end)
  ensureMethod(frame, "SetEnabled", function(self, enabled)
    self.enabled = enabled
  end)
  ensureMethod(frame, "IsEnabled", function(self)
    if self.enabled == nil then
      return true
    end
    return self.enabled
  end)
  ensureMethod(frame, "Enable", function(self)
    self.enabled = true
  end)
  ensureMethod(frame, "Disable", function(self)
    self.enabled = false
  end)
  ensureMethod(frame, "CreateFontString", function(self, fsName, _layer, fsTemplate)
    local fontString = _G.CreateFrame("FontString", fsName, self, fsTemplate)
    table.insert(self.children, fontString)
    return fontString
  end)
  ensureMethod(frame, "CreateTexture", function(self, texName, _layer, texTemplate)
    local texture = _G.CreateFrame("Texture", texName, self, texTemplate)
    table.insert(self.children, texture)
    return texture
  end)

  if template == "InputScrollFrameTemplate" then
    frame.EditBox = frame.EditBox or _G.CreateFrame("EditBox", nil, frame)
    if not frame.CharCount then
      frame.CharCount = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
      frame.CharCount:Show()
    end
  end

  if closeButtonTemplates[template] then
    frame.CloseButton = frame.CloseButton or _G.CreateFrame("Button", nil, frame, "UIPanelCloseButtonDefaultAnchors")
    frame.TitleText = frame.TitleText or frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  end

  return frame
end

_G.UIParent = _G.UIParent or _G.CreateFrame("Frame", "UIParent")
_G.UISpecialFrames = _G.UISpecialFrames or {}

_G.GetBuildInfo = function()
  return "1.60.1", "70009", "Sep 26 2026", 16001
end

_G.C_AddOns = _G.C_AddOns or {}
_G.C_AddOns.GetAddOnMetadata = function(_addonName, field)
  if field == "Version" then
    return "0.1.0"
  end
  return nil
end

_G.Settings = _G.Settings or {}
_G.Settings.VarType = {
  Boolean = "boolean",
  String = "string",
  Number = "number",
}
_G.Settings.ControlType = {
  Radio = "radio",
  Checkbox = "checkbox",
}

function _G.Settings.CreateControlTextContainer()
  local container = { data = {} }
  function container:Add(value, label, tooltip)
    local entry = {
      value = value,
      label = label,
      text = label,
      tooltip = tooltip,
      controlType = _G.Settings.ControlType.Radio,
    }
    table.insert(self.data, entry)
    return entry
  end
  function container:GetData()
    return self.data
  end
  return container
end

_G.WOWC_TEST_REGISTERED_CATEGORIES = {}
_G.WOWC_TEST_REGISTERED_SETTINGS = {}
_G.WOWC_TEST_CATEGORIES_BY_ID = {}

local refreshEnabledState

local nextCategoryID = 1

function _G.Settings.RegisterVerticalLayoutCategory(name)
  local category = { name = name, initializers = {}, id = nextCategoryID }
  nextCategoryID = nextCategoryID + 1
  function category:GetID()
    return self.id
  end
  _G.WOWC_TEST_LAST_REGISTERED_CATEGORY = category
  _G.WOWC_TEST_CATEGORIES_BY_ID[category.id] = category
  return category
end

function _G.Settings.RegisterAddOnCategory(category)
  category.registered = true
  table.insert(_G.WOWC_TEST_REGISTERED_CATEGORIES, category.name)
end

function _G.Settings.OpenToCategory(categoryID, scrollToElementName)
  assert(type(categoryID) == "number", "OpenToCategory expects a category id (number), got " .. type(categoryID))
  _G.WOWC_TEST_LAST_OPENED_CATEGORY = categoryID
  _G.WOWC_TEST_LAST_OPENED_ELEMENT = scrollToElementName

  local category = _G.WOWC_TEST_CATEGORIES_BY_ID[categoryID]
  if category then
    for _, initializer in ipairs(category.initializers) do
      refreshEnabledState(initializer)
    end
  end
end

function _G.Settings.GetSetting(variable)
  return _G.WOWC_TEST_REGISTERED_SETTINGS[variable]
end

function _G.Settings.NotifyUpdate(variable)
  local setting = _G.Settings.GetSetting(variable)
  if not setting then
    return
  end
  setting.notifyCount = (setting.notifyCount or 0) + 1

  local initializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS[variable]
  if initializer and initializer.kind == "checkbox" then
    initializer.soundCount = (initializer.soundCount or 0) + 1
  end

  for _, candidate in pairs(_G.WOWC_TEST_REGISTERED_INITIALIZERS) do
    for _, cvar in ipairs(candidate.evaluateStateCVars) do
      if cvar == variable then
        refreshEnabledState(candidate)
      end
    end
  end
end

function _G.Settings.RegisterProxySetting(_category, variable, varType, name, defaultValue, getValue, setValue)
  local setting = {
    variable = variable,
    varType = varType,
    name = name,
    defaultValue = defaultValue,
    getValue = getValue,
    setValue = setValue,
    notifyCount = 0,
  }
  function setting:GetValue()
    return self.getValue()
  end
  function setting:SetValue(value)
    self.setValue(value)
  end
  function setting:GetVariableType()
    return self.varType
  end
  _G.WOWC_TEST_REGISTERED_SETTINGS[variable] = setting
  return setting
end

local function newInitializer(kind, setting, options, tooltip)
  local initializer = {
    kind = kind,
    setting = setting,
    options = options,
    tooltip = tooltip,
    modifyPredicates = {},
    evaluateStateCVars = {},
  }
  function initializer:AddModifyPredicate(fn)
    table.insert(self.modifyPredicates, fn)
  end
  function initializer:EvaluateModifyPredicates()
    for _, fn in ipairs(self.modifyPredicates) do
      if not fn() then
        return false
      end
    end
    return true
  end
  function initializer:GetOptions()
    local resolved = self.options
    if type(resolved) == "function" then
      resolved = resolved()
    end
    resolved = resolved or {}
    if self.kind == "dropdown" then
      for _, option in ipairs(resolved) do
        assert(
          option.controlType == _G.Settings.ControlType.Radio
            or option.controlType == _G.Settings.ControlType.Checkbox,
          "dropdown option missing controlType"
        )
      end
    end
    return resolved
  end
  function initializer:AddEvaluateStateCVar(cvar)
    table.insert(self.evaluateStateCVars, cvar)
  end
  function initializer:BuildMenu()
    local root = { descriptions = {} }
    function root:EnumerateElementDescriptions()
      return ipairs(self.descriptions)
    end
    for _, option in ipairs(self:GetOptions()) do
      local description = { data = option, enabled = true, enterHooks = {} }
      function description:GetData()
        return self.data
      end
      function description:SetEnabled(enabled)
        self.enabled = enabled
      end
      function description:IsEnabled()
        return self.enabled
      end
      function description:HookOnEnter(callback)
        table.insert(self.enterHooks, callback)
      end
      function description:GetTooltipFrame()
        return _G.WOWC_TEST_MENU_TOOLTIP
      end
      table.insert(root.descriptions, description)
    end
    if self.customOptionHandler then
      self.customOptionHandler(root)
    end
    return root
  end
  function initializer:PickMenuEntry(value)
    for _, description in ipairs(self:BuildMenu().descriptions) do
      if description.data.value == value then
        if not description.enabled then
          return false
        end
        self.setting:SetValue(value)
        return true
      end
    end
    return false
  end
  function initializer:HoverMenuEntry(value)
    _G.WOWC_TEST_MENU_TOOLTIP.lines = {}
    for _, description in ipairs(self:BuildMenu().descriptions) do
      if description.data.value == value then
        for _, callback in ipairs(description.enterHooks) do
          callback({})
        end
      end
    end
    return _G.WOWC_TEST_MENU_TOOLTIP.lines
  end
  return initializer
end

refreshEnabledState = function(initializer)
  initializer.enabledState = initializer:EvaluateModifyPredicates()
end

function _G.WOWC_TEST_IsEnabled(variable)
  local initializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS[variable]
  return initializer and initializer.enabledState
end

_G.WOWC_TEST_REGISTERED_INITIALIZERS = {}

_G.WOWC_TEST_MENU_TOOLTIP = { lines = {} }
_G.MenuUtil = {
  ShowTooltipEx = function(owner, tooltip, func)
    func(tooltip)
  end,
}
_G.GameTooltip_SetTitle = function(tooltip, text)
  table.insert(tooltip.lines, "title:" .. text)
end
_G.GameTooltip_AddNormalLine = function(tooltip, text)
  table.insert(tooltip.lines, "line:" .. text)
end

function _G.Settings.CreateDropdown(category, setting, options, tooltip)
  local initializer = newInitializer("dropdown", setting, options, tooltip)
  _G.WOWC_TEST_REGISTERED_INITIALIZERS[setting.variable] = initializer
  table.insert(category.initializers, initializer)
  return initializer
end

function _G.Settings.CreateCheckbox(category, setting, tooltip)
  assert(setting:GetVariableType() == _G.Settings.VarType.Boolean, "CreateCheckbox requires a boolean setting")
  local initializer = newInitializer("checkbox", setting, nil, tooltip)
  _G.WOWC_TEST_REGISTERED_INITIALIZERS[setting.variable] = initializer
  table.insert(category.initializers, initializer)
  return initializer
end
