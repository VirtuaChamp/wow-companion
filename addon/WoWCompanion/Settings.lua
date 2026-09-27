local _, ns = ...

ns.Settings = ns.Settings or {}

local STRINGS = {
  categoryName = "WoW Companion",
  offline = "Companion offline",
  scopeThisChat = "This chat only",
  providerLabel = "AI provider",
  modelLabel = "Model",
  effortLabel = "Effort",
  notInstalledReason = "Not installed",
  disabledReason = "Disabled",
}

local VARIABLES = {
  provider = "WOWC_PROVIDER",
  model = "WOWC_MODEL",
  effort = "WOWC_EFFORT",
  scope = "WOWC_SCOPE",
}

local state = {
  online = false,
  providers = {},
  defaultProvider = nil,
  activeChat = nil,
  current = { provider = nil, model = nil, effort = nil, scope = "global" },
}

local category

local function findProvider(id)
  for _, provider in ipairs(state.providers) do
    if provider.id == id then
      return provider
    end
  end
  return nil
end

local function activeProvider()
  return findProvider(state.current.provider)
end

local function isUsable(provider)
  return provider ~= nil and provider.installed and provider.enabled
end

local function normalizeValue(value)
  if value == nil or value == "" then
    return nil
  end
  return value
end

local function firstUsableProvider()
  for _, provider in ipairs(state.providers) do
    if isUsable(provider) then
      return provider
    end
  end
  return nil
end

local function contains(list, value)
  for _, candidate in ipairs(list) do
    if candidate == value then
      return true
    end
  end
  return false
end

local function listedValue(list, value)
  local normalized = normalizeValue(value)
  if normalized and contains(list, normalized) then
    return normalized
  end
  return nil
end

local function applyProviderCurrent(provider)
  state.current.provider = provider.id
  local current = provider.current or {}
  state.current.model = listedValue(provider.models, current.model) or provider.models[1]
  state.current.effort = listedValue(provider.efforts, current.effort) or provider.efforts[1]
end

local function notifyPanel()
  Settings.NotifyUpdate(VARIABLES.provider)
  Settings.NotifyUpdate(VARIABLES.model)
  Settings.NotifyUpdate(VARIABLES.effort)
  Settings.NotifyUpdate(VARIABLES.scope)
end

local function sendSettings()
  local provider = state.current.provider
  local model = state.current.model
  if not provider or not model then
    return
  end
  local message = { t = "settings", provider = provider, model = model }
  if state.current.effort then
    message.effort = state.current.effort
  end
  if state.current.scope == "chat" then
    message.chat = state.activeChat
  end
  ns.Transport.send(message)
end

function ns.Settings.isOnline()
  return state.online
end

function ns.Settings.current()
  return {
    provider = state.current.provider,
    model = state.current.model,
    effort = state.current.effort,
    scope = state.current.scope,
  }
end

local function textOptions(entries)
  local container = Settings.CreateControlTextContainer()
  for _, entry in ipairs(entries) do
    local option = container:Add(entry.value, entry.label, entry.tooltip)
    if entry.reason then
      option.tooltip = entry.reason
      option.disabled = entry.reason
    end
  end
  return container:GetData()
end

function ns.Settings.providerOptions()
  if not state.online then
    return textOptions({ { value = "", label = STRINGS.offline, reason = STRINGS.offline } })
  end
  local entries = {}
  for _, provider in ipairs(state.providers) do
    local entry = { value = provider.id, label = provider.id }
    if not provider.installed then
      entry.reason = provider.reason or STRINGS.notInstalledReason
    elseif not provider.enabled then
      entry.reason = provider.reason or STRINGS.disabledReason
    end
    table.insert(entries, entry)
  end
  return textOptions(entries)
end

function ns.Settings.modelOptions()
  local provider = activeProvider()
  if not provider then
    return {}
  end
  local entries = {}
  for _, model in ipairs(provider.models) do
    table.insert(entries, { value = model, label = model })
  end
  return textOptions(entries)
end

function ns.Settings.effortOptions()
  local provider = activeProvider()
  if not provider then
    return {}
  end
  local entries = {}
  for _, effort in ipairs(provider.efforts) do
    table.insert(entries, { value = effort, label = effort })
  end
  return textOptions(entries)
end

function ns.Settings.isEffortEnabled()
  local provider = activeProvider()
  return state.online and provider ~= nil and #provider.efforts > 0
end

function ns.Settings.isScopeEnabled()
  return state.online and state.activeChat ~= nil
end

function ns.Settings.setProvider(id)
  local provider = findProvider(id)
  if isUsable(provider) then
    applyProviderCurrent(provider)
    notifyPanel()
    sendSettings()
    return
  end
  notifyPanel()
end

function ns.Settings.setModel(model)
  local provider = activeProvider()
  if provider and contains(provider.models, model) then
    state.current.model = model
    notifyPanel()
    sendSettings()
    return
  end
  notifyPanel()
end

function ns.Settings.setEffort(effort)
  local provider = activeProvider()
  if provider and contains(provider.efforts, effort) then
    state.current.effort = effort
    notifyPanel()
    sendSettings()
    return
  end
  notifyPanel()
end

function ns.Settings.setScope(scope)
  local isValidScope = scope == "chat" or scope == "global"
  if isValidScope and (scope ~= "chat" or state.activeChat) then
    state.current.scope = scope
    notifyPanel()
    sendSettings()
    return
  end
  notifyPanel()
end

function ns.Settings.onOptions(msg)
  state.online = true
  state.providers = msg.providers
  state.defaultProvider = msg.defaultProvider

  local provider = activeProvider()
  if not isUsable(provider) then
    provider = findProvider(state.defaultProvider)
  end
  if not isUsable(provider) then
    provider = firstUsableProvider()
  end

  if provider then
    applyProviderCurrent(provider)
  else
    state.current.provider = nil
    state.current.model = nil
    state.current.effort = nil
  end

  if msg.companionVersion then
    ns.Report.setCompanionVersion(msg.companionVersion)
  end

  notifyPanel()
end

function ns.Settings.onChats(msg)
  state.activeChat = msg.active
  notifyPanel()
end

local function ensureCategory()
  if category then
    return category
  end

  category = Settings.RegisterVerticalLayoutCategory(STRINGS.categoryName)

  local providerSetting = Settings.RegisterProxySetting(
    category,
    VARIABLES.provider,
    Settings.VarType.String,
    STRINGS.providerLabel,
    "",
    function()
      return state.current.provider or ""
    end,
    function(value)
      ns.Settings.setProvider(value)
    end
  )
  local providerInitializer =
    Settings.CreateDropdown(category, providerSetting, ns.Settings.providerOptions, STRINGS.providerLabel)
  providerInitializer:AddModifyPredicate(ns.Settings.isOnline)

  local modelSetting = Settings.RegisterProxySetting(
    category,
    VARIABLES.model,
    Settings.VarType.String,
    STRINGS.modelLabel,
    "",
    function()
      return state.current.model or ""
    end,
    function(value)
      ns.Settings.setModel(value)
    end
  )
  local modelInitializer =
    Settings.CreateDropdown(category, modelSetting, ns.Settings.modelOptions, STRINGS.modelLabel)
  modelInitializer:AddModifyPredicate(ns.Settings.isOnline)

  local effortSetting = Settings.RegisterProxySetting(
    category,
    VARIABLES.effort,
    Settings.VarType.String,
    STRINGS.effortLabel,
    "",
    function()
      return state.current.effort or ""
    end,
    function(value)
      ns.Settings.setEffort(value)
    end
  )
  local effortInitializer =
    Settings.CreateDropdown(category, effortSetting, ns.Settings.effortOptions, STRINGS.effortLabel)
  effortInitializer:AddModifyPredicate(ns.Settings.isEffortEnabled)

  local scopeSetting = Settings.RegisterProxySetting(
    category,
    VARIABLES.scope,
    Settings.VarType.Boolean,
    STRINGS.scopeThisChat,
    false,
    function()
      return state.current.scope == "chat"
    end,
    function(value)
      ns.Settings.setScope(value and "chat" or "global")
    end
  )
  local scopeInitializer = Settings.CreateCheckbox(category, scopeSetting, STRINGS.scopeThisChat)
  scopeInitializer:AddModifyPredicate(ns.Settings.isScopeEnabled)

  Settings.RegisterAddOnCategory(category)

  return category
end

function ns.Settings.open()
  local registeredCategory = ensureCategory()
  Settings.OpenToCategory(registeredCategory:GetID())
end

ensureCategory()
