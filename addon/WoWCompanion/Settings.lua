local _, ns = ...

ns.Settings = ns.Settings or {}

local STRINGS = {
  categoryName = "WoW Companion",
  offline = "Companion offline",
  scopeThisChat = "This chat only",
  scopeThisChatTooltip = "Show and change the provider, model and effort for this chat only, instead of every chat.",
  providerLabel = "AI provider",
  providerTooltip = "Which AI answers questions asked in this chat window.",
  modelLabel = "Model",
  modelTooltip = "Which model the selected provider runs your questions through.",
  effortLabel = "Effort",
  effortTooltip = "How much the selected provider reasons before it answers.",
  notInstalledReason = "Not installed",
  disabledReason = "Disabled",
  noModelsReason = "No models listed",
}

local VARIABLES = {
  provider = "WOWC_PROVIDER",
  model = "WOWC_MODEL",
  effort = "WOWC_EFFORT",
  scope = "WOWC_SCOPE",
  hub = "WOWC_HUB",
}

local state = {
  online = false,
  providers = {},
  active = nil,
  chat = nil,
  activeChatId = nil,
  scopeChecked = false,
  pending = nil,
}

local lastNotified = { provider = nil, model = nil, effort = nil, scope = false }

local category

local function findProvider(id)
  for _, provider in ipairs(state.providers) do
    if provider.id == id then
      return provider
    end
  end
  return nil
end

local function isUsable(provider)
  return provider ~= nil and provider.installed and provider.enabled and #provider.models > 0
end

local function contains(list, value)
  for _, candidate in ipairs(list) do
    if candidate == value then
      return true
    end
  end
  return false
end

local function normalizeValue(value)
  if value == nil or value == "" then
    return nil
  end
  return value
end

local function listedValue(list, value)
  local normalized = normalizeValue(value)
  if normalized and contains(list, normalized) then
    return normalized
  end
  return nil
end

local function displayedChoice()
  if state.scopeChecked and state.chat then
    return state.chat
  end
  return state.active
end

local function activeProvider()
  local choice = displayedChoice()
  return choice and findProvider(choice.provider)
end

function ns.Settings.isOnline()
  return state.online
end

function ns.Settings.current()
  local choice = displayedChoice() or {}
  return {
    provider = choice.provider,
    model = choice.model,
    effort = choice.effort,
    scope = state.scopeChecked and "chat" or "global",
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
    elseif #provider.models == 0 then
      entry.reason = provider.reason or STRINGS.noModelsReason
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
  return state.online and state.activeChatId ~= nil
end

local function currentDisplay()
  local choice = displayedChoice() or {}
  return { provider = choice.provider, model = choice.model, effort = choice.effort, scope = state.scopeChecked }
end

local function notifyPanel()
  Settings.NotifyUpdate(VARIABLES.hub)

  local display = currentDisplay()
  if display.provider ~= lastNotified.provider then
    Settings.NotifyUpdate(VARIABLES.provider)
  end
  if display.model ~= lastNotified.model then
    Settings.NotifyUpdate(VARIABLES.model)
  end
  if display.effort ~= lastNotified.effort then
    Settings.NotifyUpdate(VARIABLES.effort)
  end
  if display.scope ~= lastNotified.scope then
    Settings.NotifyUpdate(VARIABLES.scope)
  end
  lastNotified = display
end

local function sendChoice(choice)
  local message = { t = "settings", provider = choice.provider, model = choice.model }
  local includesChat = state.scopeChecked and state.activeChatId ~= nil
  if choice.effort then
    message.effort = choice.effort
  end
  if includesChat then
    message.chat = state.activeChatId
  end
  state.pending = { provider = choice.provider, model = choice.model, effort = choice.effort, chat = includesChat }
  ns.Transport.send(message)
end

function ns.Settings.setProvider(id)
  local provider = findProvider(id)
  if not isUsable(provider) then
    Settings.NotifyUpdate(VARIABLES.provider)
    return
  end
  local current = provider.current or {}
  sendChoice({
    provider = provider.id,
    model = current.model,
    effort = listedValue(provider.efforts, current.effort),
  })
  notifyPanel()
end

function ns.Settings.setModel(model)
  local choice = displayedChoice()
  local provider = choice and findProvider(choice.provider)
  if not provider or not contains(provider.models, model) then
    Settings.NotifyUpdate(VARIABLES.model)
    return
  end
  sendChoice({ provider = provider.id, model = model, effort = choice.effort })
  notifyPanel()
end

function ns.Settings.setEffort(effort)
  local choice = displayedChoice()
  local provider = choice and findProvider(choice.provider)
  if not provider or not contains(provider.efforts, effort) then
    Settings.NotifyUpdate(VARIABLES.effort)
    return
  end
  sendChoice({ provider = provider.id, model = choice.model, effort = effort })
  notifyPanel()
end

function ns.Settings.setScope(checked)
  if checked and not ns.Settings.isScopeEnabled() then
    Settings.NotifyUpdate(VARIABLES.scope)
    return
  end
  state.scopeChecked = checked
  notifyPanel()
end

local function noticeText(choice)
  return string.format("[Claude] now using %s · %s · %s", choice.provider, choice.model, choice.effort or "unknown")
end

local function pendingConfirmedBy(msg)
  if not state.pending then
    return nil
  end
  local target = state.pending.chat and msg.chat or msg.active
  if not target then
    return nil
  end
  if
    target.provider == state.pending.provider
    and target.model == state.pending.model
    and target.effort == state.pending.effort
  then
    return state.pending
  end
  return nil
end

function ns.Settings.onOptions(msg)
  state.online = true
  state.providers = msg.providers
  local confirmed = pendingConfirmedBy(msg)
  state.active = msg.active
  state.chat = msg.chat
  if confirmed then
    state.pending = nil
  end

  if msg.companionVersion then
    ns.Report.setCompanionVersion(msg.companionVersion)
  end

  notifyPanel()

  if confirmed then
    ns.AiWindow.notice(noticeText(confirmed))
  end
end

function ns.Settings.onChats(msg)
  state.activeChatId = msg.active
  notifyPanel()
end

function ns.Settings.onError(msg)
  if not state.pending then
    return
  end
  state.pending = nil
  notifyPanel()
  ns.AiWindow.notice(msg.message)
end

local function ensureCategory()
  if category then
    return category
  end

  category = Settings.RegisterVerticalLayoutCategory(STRINGS.categoryName)

  Settings.RegisterProxySetting(
    category,
    VARIABLES.hub,
    Settings.VarType.String,
    "",
    "",
    function()
      return ""
    end,
    function() end
  )

  local providerSetting = Settings.RegisterProxySetting(
    category,
    VARIABLES.provider,
    Settings.VarType.String,
    STRINGS.providerLabel,
    "",
    function()
      local choice = displayedChoice()
      return (choice and choice.provider) or ""
    end,
    function(value)
      ns.Settings.setProvider(value)
    end
  )
  local providerInitializer =
    Settings.CreateDropdown(category, providerSetting, ns.Settings.providerOptions, STRINGS.providerTooltip)
  providerInitializer:AddModifyPredicate(ns.Settings.isOnline)
  providerInitializer:AddEvaluateStateCVar(VARIABLES.hub)

  local modelSetting = Settings.RegisterProxySetting(
    category,
    VARIABLES.model,
    Settings.VarType.String,
    STRINGS.modelLabel,
    "",
    function()
      local choice = displayedChoice()
      return (choice and choice.model) or ""
    end,
    function(value)
      ns.Settings.setModel(value)
    end
  )
  local modelInitializer =
    Settings.CreateDropdown(category, modelSetting, ns.Settings.modelOptions, STRINGS.modelTooltip)
  modelInitializer:AddModifyPredicate(ns.Settings.isOnline)
  modelInitializer:AddEvaluateStateCVar(VARIABLES.hub)

  local effortSetting = Settings.RegisterProxySetting(
    category,
    VARIABLES.effort,
    Settings.VarType.String,
    STRINGS.effortLabel,
    "",
    function()
      local choice = displayedChoice()
      return (choice and choice.effort) or ""
    end,
    function(value)
      ns.Settings.setEffort(value)
    end
  )
  local effortInitializer =
    Settings.CreateDropdown(category, effortSetting, ns.Settings.effortOptions, STRINGS.effortTooltip)
  effortInitializer:AddModifyPredicate(ns.Settings.isEffortEnabled)
  effortInitializer:AddEvaluateStateCVar(VARIABLES.hub)

  local scopeSetting = Settings.RegisterProxySetting(
    category,
    VARIABLES.scope,
    Settings.VarType.Boolean,
    STRINGS.scopeThisChat,
    false,
    function()
      return state.scopeChecked
    end,
    function(value)
      ns.Settings.setScope(value)
    end
  )
  local scopeInitializer = Settings.CreateCheckbox(category, scopeSetting, STRINGS.scopeThisChatTooltip)
  scopeInitializer:AddModifyPredicate(ns.Settings.isScopeEnabled)
  scopeInitializer:AddEvaluateStateCVar(VARIABLES.hub)

  Settings.RegisterAddOnCategory(category)

  return category
end

function ns.Settings.open()
  local registeredCategory = ensureCategory()
  Settings.OpenToCategory(registeredCategory:GetID())
end

ensureCategory()
