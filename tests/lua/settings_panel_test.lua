dofile("tests/lua/wow_stubs.lua")

local ns = {}
local linePosition = "top"
local linePositionCalls = {}
ns.Transport = { sent = {}, handlers = {} }
function ns.Transport.linePosition()
  return linePosition
end
function ns.Transport.setLinePosition(position)
  table.insert(linePositionCalls, position)
  linePosition = position
  return true
end
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end
function ns.Transport.onMessage(handler)
  table.insert(ns.Transport.handlers, handler)
end

local notices = {}
local textSizeCalls = {}
local minimapCalls = {}
local minimapShown = true
ns.AiWindow = {
  notice = function(text)
    table.insert(notices, text)
  end,
  textSize = function()
    return "normal"
  end,
  textSizeChoices = function()
    return {
      { key = "small", label = "Small" },
      { key = "normal", label = "Normal" },
      { key = "large", label = "Large" },
      { key = "larger", label = "Larger" },
    }
  end,
  setTextSize = function(key)
    table.insert(textSizeCalls, key)
  end,
}
ns.MinimapButton = {
  isShown = function()
    return minimapShown
  end,
  setShown = function(shown)
    minimapShown = shown
    table.insert(minimapCalls, shown)
  end,
}

local receivedCompanionVersion
ns.Report = { setCompanionVersion = function(version)
  receivedCompanionVersion = version
end }

local chunk = assert(loadfile("addon/WoWCompanion/Settings.lua"))
chunk("WoWCompanion", ns)

assert(#_G.WOWC_TEST_REGISTERED_CATEGORIES == 1, "settings category registered at load, before open()")
assert(_G.WOWC_TEST_REGISTERED_CATEGORIES[1] == "WoW Companion", "category name matches")
assert(#ns.Transport.handlers == 0, "Settings.lua never subscribes itself to transport messages")

local registeredCategory = _G.WOWC_TEST_LAST_REGISTERED_CATEGORY
assert(registeredCategory ~= nil, "category recorded")

local providerInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_PROVIDER"]
local modelInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_MODEL"]
local effortInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_EFFORT"]
local scopeInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_SCOPE"]
local hubSetting = _G.WOWC_TEST_REGISTERED_SETTINGS["WOWC_HUB"]
assert(providerInitializer ~= nil, "provider dropdown initializer registered")
assert(modelInitializer ~= nil, "model dropdown initializer registered")
assert(effortInitializer ~= nil, "effort dropdown initializer registered")
assert(scopeInitializer ~= nil, "scope checkbox initializer registered")
assert(hubSetting ~= nil, "hidden hub setting registered")
assert(_G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_HUB"] == nil, "the hub setting has no control, so it never renders in the panel")
assert(scopeInitializer.kind == "checkbox", "\"This chat only\" is a checkbox, per the parent spec's UX Settings bullet")

local function assertEveryDropdownOptionIsRadio()
  for _, initializer in pairs(_G.WOWC_TEST_REGISTERED_INITIALIZERS) do
    if initializer.kind == "dropdown" then
      for _, option in ipairs(initializer:GetOptions()) do
        assert(option.controlType == Settings.ControlType.Radio, "every registered dropdown option is a Radio control")
      end
    end
  end
end

assertEveryDropdownOptionIsRadio()

for _, initializer in ipairs({ providerInitializer, modelInitializer, effortInitializer, scopeInitializer }) do
  assert(initializer.tooltip ~= nil and initializer.tooltip ~= "", "every control carries a tooltip")
  assert(initializer.tooltip ~= initializer.setting.name, "a tooltip is never just its own control's registered label")
end

local offlineOptions = ns.Settings.providerOptions()
assert(#offlineOptions == 1, "one placeholder option before options arrives")
assert(offlineOptions[1].label == "Companion offline", "placeholder reads Companion offline")
assert(offlineOptions[1].disabled ~= nil and offlineOptions[1].disabled ~= offlineOptions[1].label, "placeholder option carries a reason distinct from its label as disabled (ui-r3-2)")
assert(offlineOptions[1].tooltip == offlineOptions[1].disabled, "placeholder option carries the same reason as tooltip")
assert(ns.Settings.isOnline() == false, "offline before the first options message")

ns.Settings.open()
assert(
  _G.WOWC_TEST_LAST_OPENED_CATEGORY == registeredCategory:GetID(),
  "open() opens the numeric category id, not the category table"
)

assert(_G.WOWC_TEST_IsEnabled("WOWC_PROVIDER") == false, "provider dropdown reads disabled before options")
assert(_G.WOWC_TEST_IsEnabled("WOWC_MODEL") == false, "model dropdown reads disabled before options")
assert(_G.WOWC_TEST_IsEnabled("WOWC_SCOPE") == false, "scope checkbox reads disabled before options")

local optionsMessage = {
  t = "options",
  companionVersion = "0.4.2",
  providers = {
    {
      id = "claude",
      installed = true,
      enabled = true,
      models = { "sonnet", "opus" },
      efforts = { "medium", "high" },
      current = { model = "sonnet", effort = "medium" },
    },
    {
      id = "codex",
      installed = true,
      enabled = true,
      models = { "gpt-5" },
      efforts = { "low", "high" },
      current = { model = "gpt-5" },
    },
    {
      id = "cursor",
      installed = false,
      enabled = false,
      reason = "headless MCP not loaded",
      models = {},
      efforts = {},
      current = { model = "" },
    },
    {
      id = "solo",
      installed = true,
      enabled = true,
      models = {},
      efforts = {},
      current = { model = "" },
    },
  },
  active = { provider = "claude", model = "sonnet", effort = "medium" },
}

ns.Settings.onOptions(optionsMessage)

assert(receivedCompanionVersion == "0.4.2", "onOptions hands the companion version to ns.Report")
assert(ns.Settings.isOnline() == true, "online after the first options message")

assert(_G.WOWC_TEST_IsEnabled("WOWC_PROVIDER") == true, "provider dropdown control refreshed to enabled after options")
assert(_G.WOWC_TEST_IsEnabled("WOWC_MODEL") == true, "model dropdown control refreshed to enabled after options")
assert(_G.WOWC_TEST_IsEnabled("WOWC_EFFORT") == true, "claude has efforts: effort dropdown control refreshed to enabled")

local filledOptions = providerInitializer:GetOptions()
assert(#filledOptions == 4, "one dropdown entry per provider (claude, codex, cursor, solo)")
assert(filledOptions[1].label == "Claude", "provider dropdown shows the display name Claude (ui-r3-1)")
assert(filledOptions[2].label == "Codex", "provider dropdown shows the display name Codex (ui-r3-1)")
assert(filledOptions[3].label == "Cursor", "provider dropdown shows the display name Cursor (ui-r3-1)")

local byId = {}
for _, option in ipairs(filledOptions) do
  byId[option.value] = option
end
assert(byId.cursor.disabled == "headless MCP not loaded", "disabled provider carries the reason as disabled")
assert(byId.cursor.tooltip == "headless MCP not loaded", "disabled reason shown as the option's tooltip")

local current = ns.Settings.current()
assert(current.provider == "claude", "active provider from the options message")
assert(current.model == "sonnet", "active model from the options message")
assert(current.effort == "medium", "active effort from the options message")
assert(current.scope == "global", "scope defaults to global")

local filledModelOptions = modelInitializer:GetOptions()
assert(#filledModelOptions == 2, "model dropdown lists claude's models")

local menuEntries = {}
for _, description in ipairs(providerInitializer:BuildMenu().descriptions) do
  menuEntries[description.data.value] = description
end
assert(menuEntries.claude.enabled == true, "an available provider's menu entry stays enabled (wowc10-1)")
assert(menuEntries.codex.enabled == true, "a second available provider's menu entry stays enabled")
assert(menuEntries.cursor.enabled == false, "an uninstalled provider's menu entry is genuinely disabled, not just flagged (wowc10-1)")
assert(menuEntries.solo.enabled == false, "a provider with no models has a disabled menu entry (wowc10-1)")
assert(providerInitializer:PickMenuEntry("cursor") == false, "picking a disabled menu entry is refused by the menu")
assert(providerInitializer:PickMenuEntry("solo") == false, "picking the modelless provider's entry is refused by the menu")
assert(#ns.Transport.sent == 0, "a refused menu pick sends nothing")
local cursorTooltip = providerInitializer:HoverMenuEntry("cursor")
assert(cursorTooltip[1] == "title:Cursor", "a disabled entry's tooltip is titled with its label")
assert(cursorTooltip[2] == "line:headless MCP not loaded", "a disabled entry keeps its reason in the tooltip (wowc10-1)")
assert(#providerInitializer:HoverMenuEntry("claude") == 0, "an enabled entry gets no reason tooltip")
assert(#modelInitializer:BuildMenu().descriptions == 2, "the model menu is untouched")

ns.Settings.setProvider("solo")
assert(ns.Settings.current().provider == "claude", "a provider with no models cannot be selected (aca-r2-4)")
assert(#ns.Transport.sent == 0, "no settings message sent for a provider with no models")

local soloOption
for _, option in ipairs(providerInitializer:GetOptions()) do
  if option.value == "solo" then
    soloOption = option
  end
end
assert(soloOption ~= nil, "solo listed")
assert(soloOption.disabled == "No models listed", "a usable-but-modelless provider is shown disabled with a reason")

local soundCountBeforeSwitch = scopeInitializer.soundCount or 0

ns.Settings.setProvider("codex")
assert(
  ns.Settings.current().provider == "claude",
  "current() still shows the last confirmed options, not an optimistic pick (spec: never an unconfirmed value)"
)
local pendingMessage = ns.Transport.sent[#ns.Transport.sent]
assert(pendingMessage.t == "settings", "message type is settings")
assert(pendingMessage.provider == "codex", "message carries the new provider")
assert(pendingMessage.model == "gpt-5", "message carries codex's own last-known model")
assert(pendingMessage.effort == nil, "no effort defaulted to the lowest listed value; codex's current has none")
assert(pendingMessage.chat == nil, "no chat field while scope is global")

ns.Settings.onOptions({
  t = "options",
  providers = optionsMessage.providers,
  active = { provider = "codex", model = "gpt-5" },
})
assert(#notices == 1, "confirmed change prints exactly one notice")
assert(notices[1] == "[Claude] now using Codex · gpt-5 · unknown", "notice format matches the spec, with 'unknown' standing in for an absent effort, matching the report box's own placeholder")
assert(ns.Settings.current().provider == "codex", "current() now reflects the confirmed provider")
assert(ns.Settings.current().model == "gpt-5", "current() now reflects the confirmed model")
assert(
  (scopeInitializer.soundCount or 0) == soundCountBeforeSwitch,
  "aca-r2-11: switching provider never plays the scope checkbox's own click sound"
)

ns.Settings.onOptions({
  t = "options",
  providers = optionsMessage.providers,
  active = { provider = "codex", model = "gpt-5" },
})
assert(#notices == 1, "an options message that matches nothing pending prints no notice")
assert(ns.Settings.current().provider == "codex", "still-usable current provider is kept across a second options message")

ns.Settings.setModel("not-a-real-model")
assert(ns.Settings.current().model == "gpt-5", "unlisted model never applied")
assert(#ns.Transport.sent == 1, "no settings message sent for a refused model")

ns.Settings.setEffort("not-a-real-effort")
assert(#ns.Transport.sent == 1, "no settings message sent for a refused effort")

ns.Settings.setEffort("high")
assert(#ns.Transport.sent == 2, "a listed effort sends a settings message")

ns.Settings.onOptions({
  t = "options",
  providers = optionsMessage.providers,
  active = { provider = "codex", model = "gpt-5" },
})
assert(#notices == 1, "a non-matching options message prints no notice")
assert(ns.Settings.current().provider == "codex", "a non-matching options message still updates the displayed provider")
assert(ns.Settings.current().model == "gpt-5", "a non-matching options message still updates the displayed model")
assert(
  ns.Settings.current().effort == nil,
  "a non-matching options message still updates the displayed effort, even though it does not match the pending change"
)

ns.Settings.onOptions({
  t = "options",
  providers = optionsMessage.providers,
  active = { provider = "codex", model = "gpt-5", effort = "high" },
})
assert(
  #notices == 2,
  "a later options message that matches the still-pending change confirms it with exactly one notice"
)
assert(
  notices[2] == "[Claude] now using Codex · gpt-5 · high",
  "the pending change survived the earlier non-matching options message"
)
assert(ns.Settings.current().effort == "high", "current() now reflects the confirmed effort")

local codexOptions = function(effort)
  return {
    t = "options",
    providers = optionsMessage.providers,
    active = { provider = "codex", model = "gpt-5", effort = effort },
  }
end

ns.Settings.setEffort("low")
local sentBeforeUnrelatedError = #ns.Transport.sent
ns.Settings.onError({ t = "error", id = "ask-1", code = "busy", message = "the companion is busy" })
assert(#notices == 2, "an error that is not bad_settings leaves the pending change and prints nothing (aca-r3-4)")
ns.Settings.onError({ t = "error", code = "provider_missing", message = "codex is not installed anymore" })
assert(#notices == 2, "provider_missing is not a settings refusal: the pending change is untouched")
ns.Settings.onOptions(codexOptions("low"))
assert(#notices == 3, "the pending change survived the unrelated errors and is now confirmed")
assert(notices[3] == "[Claude] now using Codex · gpt-5 · low", "confirmed notice names the display name and the confirmed effort")

ns.Settings.setEffort("high")
assert(#ns.Transport.sent == sentBeforeUnrelatedError + 1, "a listed effort sends a settings message")
ns.Settings.onError({ t = "error", code = "bad_settings", message = "settings refused: model not offered" })
assert(#notices == 4, "bad_settings while a change is pending prints one notice")
assert(notices[4] == "settings refused: model not offered", "bad_settings forwards the companion's own message verbatim")

ns.Settings.onOptions(codexOptions("high"))
assert(#notices == 4, "the cleared pending change is not re-confirmed by a later matching options message")

ns.Settings.onError({ t = "error", code = "bad_settings", message = "nothing pending" })
assert(#notices == 4, "bad_settings with no pending change prints nothing")

ns.Settings.setEffort("low")
ns.Settings.onOptions(codexOptions("high"))
assert(#notices == 4, "a pending change that set an effort is not confirmed by a different effort")
ns.Settings.onOptions(codexOptions("low"))
assert(#notices == 5, "a pending change that set an effort is confirmed by that effort")
ns.Settings.setEffort("high")
ns.Settings.onOptions(codexOptions("high"))
assert(#notices == 6, "back to the effort the later chat-scope tests expect")

assert(_G.WOWC_TEST_IsEnabled("WOWC_SCOPE") == false, "\"This chat only\" checkbox disabled before an active chat is known")

local beforeChatSentCount = #ns.Transport.sent
ns.Settings.setScope(true)
assert(ns.Settings.current().scope == "global", "chat scope refused without a known active chat")
assert(#ns.Transport.sent == beforeChatSentCount, "no settings message sent for a refused scope switch")

ns.Settings.onChats({ t = "chats", active = "chat-9", list = {} })

assert(_G.WOWC_TEST_IsEnabled("WOWC_SCOPE") == true, "\"This chat only\" checkbox control refreshed to enabled once an active chat is known")

ns.Settings.onOptions({
  t = "options",
  providers = optionsMessage.providers,
  active = { provider = "codex", model = "gpt-5", effort = "high" },
  chat = { id = "chat-9", provider = "claude", model = "opus", effort = "high" },
})

ns.Settings.setScope(true)
assert(#ns.Transport.sent == beforeChatSentCount, "checking \"This chat only\" sends no settings message")
assert(ns.Settings.current().provider == "claude", "checked scope shows the chat's own choice")
assert(ns.Settings.current().model == "opus", "checked scope shows the chat's own model")

ns.Settings.setScope(false)
assert(#ns.Transport.sent == beforeChatSentCount, "unchecking \"This chat only\" sends no settings message")
assert(ns.Settings.current().provider == "codex", "unchecked scope falls back to the global active choice")

ns.Settings.setScope(true)
ns.Settings.setModel("sonnet")
local chatScopedMessage = ns.Transport.sent[#ns.Transport.sent]
assert(chatScopedMessage.provider == "claude", "chat-scoped change keeps the chat's own provider")
assert(chatScopedMessage.chat == "chat-9", "chat-scoped change carries the active chat id")

ns.Settings.setScope(false)
local extendedProviders = {}
for _, provider in ipairs(optionsMessage.providers) do
  table.insert(extendedProviders, provider)
end
table.insert(extendedProviders, {
  id = "stale",
  installed = true,
  enabled = true,
  models = { "auto", "fast" },
  efforts = {},
  current = { model = "gone" },
})
table.insert(extendedProviders, {
  id = "blank",
  installed = true,
  enabled = true,
  models = { "only" },
  efforts = {},
  current = { model = "" },
})
ns.Settings.onOptions({
  t = "options",
  providers = extendedProviders,
  active = { provider = "codex", model = "gpt-5", effort = "high" },
})

local sentBeforeUnlisted = #ns.Transport.sent
ns.Settings.setProvider("stale")
assert(#ns.Transport.sent == sentBeforeUnlisted + 1, "a usable provider whose current model is unlisted still sends")
assert(ns.Transport.sent[#ns.Transport.sent].model == "auto", "an unlisted current model is replaced by the first listed model (aca-r3-1)")
ns.Settings.setProvider("blank")
assert(ns.Transport.sent[#ns.Transport.sent].model == "only", "an empty current model is replaced by the first listed model (aca-r3-1)")

ns.Settings.onOptions({
  t = "options",
  providers = extendedProviders,
  active = { provider = "blank", model = "only", effort = "medium" },
})
assert(#notices == 7, "a pending change that set no effort is confirmed on provider and model alone")
assert(notices[7] == "[Claude] now using blank · only · medium", "the notice carries the confirmed effort the companion reported")

ns.Settings.onOptions({
  t = "options",
  providers = extendedProviders,
  active = { provider = "codex", model = "gpt-5", effort = "high" },
  chat = { id = "chat-9", provider = "claude", model = "opus", effort = "high" },
})
ns.Settings.setScope(true)
assert(ns.Settings.current().provider == "claude", "checked scope shows the active chat's own choice")
ns.Settings.onChats({ t = "chats", active = "chat-10", list = {} })
assert(ns.Settings.current().provider == "codex", "after the active chat changes, a stale other-chat choice is not shown (aca-r3-5)")

ns.Settings.setEffort("low")
local staleChatMessage = ns.Transport.sent[#ns.Transport.sent]
assert(staleChatMessage.chat == "chat-10", "the change goes to the new active chat")
assert(staleChatMessage.provider == "codex", "the change is seeded from the global choice, not the previous chat's (aca-r3-5)")

ns.Settings.onOptions({
  t = "options",
  providers = extendedProviders,
  active = { provider = "codex", model = "gpt-5", effort = "high" },
  chat = { id = "chat-9", provider = "codex", model = "gpt-5", effort = "low" },
})
assert(#notices == 7, "an options message carrying another chat's matching choice does not confirm the pending change (aca-r3-5)")

ns.Settings.onOptions({
  t = "options",
  providers = extendedProviders,
  active = { provider = "codex", model = "gpt-5", effort = "high" },
  chat = { id = "chat-10", provider = "codex", model = "gpt-5", effort = "low" },
})
assert(#notices == 8, "the active chat's own matching choice confirms the pending change")

ns.Settings.setScope(false)
local staleProviders = {
  {
    id = "claude",
    installed = true,
    enabled = true,
    models = { "sonnet", "opus" },
    efforts = { "medium", "high" },
    current = { model = "sonnet", effort = "medium" },
  },
  {
    id = "codex",
    installed = true,
    enabled = true,
    models = { "gpt-5" },
    efforts = {},
    current = { model = "gpt-5" },
  },
}

ns.Settings.onOptions({
  t = "options",
  providers = staleProviders,
  active = { provider = "claude", model = "retired", effort = "medium" },
})
ns.Settings.setEffort("high")
local staleModelMessage = ns.Transport.sent[#ns.Transport.sent]
assert(staleModelMessage.model == "sonnet", "a stale model is repaired to the provider's first listed model, never sent (wowc10-2)")
assert(staleModelMessage.effort == "high", "the effort the user picked is kept")

ns.Settings.onOptions({
  t = "options",
  providers = staleProviders,
  active = { provider = "claude", model = "sonnet", effort = "ultra" },
})
ns.Settings.setModel("opus")
local staleEffortMessage = ns.Transport.sent[#ns.Transport.sent]
assert(staleEffortMessage.model == "opus", "the model the user picked is kept")
assert(staleEffortMessage.effort == nil, "a stale effort is dropped, never sent (wowc10-2)")

ns.Settings.onOptions({
  t = "options",
  providers = staleProviders,
  active = { provider = "codex", model = "gpt-5", effort = "high" },
})
local sentBeforeNoEfforts = #ns.Transport.sent
ns.Settings.setModel("gpt-5")
assert(#ns.Transport.sent == sentBeforeNoEfforts + 1, "a listed model of a provider with no efforts still sends")
assert(ns.Transport.sent[#ns.Transport.sent].effort == nil, "an effort is dropped for a provider that lists none (wowc10-2)")

ns.Settings.onOptions({
  t = "options",
  providers = { { id = "claude", installed = true, enabled = false, reason = "off", models = { "sonnet" }, efforts = {}, current = { model = "sonnet" } } },
  active = { provider = "claude", model = "sonnet" },
})
local sentBeforeDisabled = #ns.Transport.sent
ns.Settings.setModel("sonnet")
assert(#ns.Transport.sent == sentBeforeDisabled, "a model change on a provider that is no longer usable sends nothing (wowc10-2)")

local textSizeInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_TEXT_SIZE"]
assert(textSizeInitializer ~= nil and textSizeInitializer.kind == "dropdown", "Text size is a dropdown in the settings category")
assert(textSizeInitializer.setting.name == "Text size", "the dropdown is labelled Text size")
assert(textSizeInitializer.tooltip ~= nil and textSizeInitializer.tooltip ~= "", "Text size carries a tooltip")
local sizeLabels = {}
for _, option in ipairs(textSizeInitializer:GetOptions()) do
  table.insert(sizeLabels, option.label)
  assert(option.controlType == Settings.ControlType.Radio, "text size options are radio entries")
end
assert(table.concat(sizeLabels, ",") == "Small,Normal,Large,Larger", "the choices are Small, Normal, Large, Larger in that order")
assert(textSizeInitializer.setting:GetValue() == "normal", "the dropdown shows the size in use, Normal by default")
assert(textSizeInitializer.setting.defaultValue == "normal", "Normal is the registered default")
assert(textSizeInitializer:PickMenuEntry("large") == true, "a size can be picked")
assert(textSizeCalls[#textSizeCalls] == "large", "picking a size applies it through ns.AiWindow.setTextSize")

local lineInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_LINE_POSITION"]
assert(lineInitializer ~= nil and lineInitializer.kind == "dropdown", "Signal line position is a dropdown in the settings category")
assert(lineInitializer.setting.name == "Signal line position", "the dropdown is labelled Signal line position")
assert(lineInitializer.tooltip ~= nil and lineInitializer.tooltip ~= "", "Signal line position carries a tooltip")
assert(lineInitializer.tooltip == "The thin line that sends game data to the companion is normally invisible. It blinks briefly every few seconds while the companion runs, and when you send a question. Move it if another addon or overlay covers it.", "the tooltip is written from the player's view")
local lineLabels = {}
for _, option in ipairs(lineInitializer:GetOptions()) do
  table.insert(lineLabels, option.label)
  assert(option.controlType == Settings.ControlType.Radio, "line position options are radio entries")
end
assert(table.concat(lineLabels, ",") == "Top edge,Bottom edge", "the choices are Top edge, Bottom edge in that order")
assert(lineInitializer.setting.defaultValue == "top", "Top is the registered default")
assert(lineInitializer.setting:GetValue() == "top", "the dropdown shows the position in use")
assert(lineInitializer:PickMenuEntry("bottom") == true, "a position can be picked")
assert(linePositionCalls[#linePositionCalls] == "bottom", "picking a position applies it through ns.Transport.setLinePosition")
assert(lineInitializer.setting:GetValue() == "bottom", "the dropdown follows the position the transport now holds")
lineInitializer:PickMenuEntry("top")
assert(linePosition == "top" and lineInitializer.setting:GetValue() == "top", "and back to Top")

local minimapInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_MINIMAP"]
assert(minimapInitializer ~= nil and minimapInitializer.kind == "checkbox", "Show minimap button is a checkbox in the settings category")
assert(minimapInitializer.setting.name == "Show minimap button", "the checkbox is labelled Show minimap button")
assert(minimapInitializer.setting.defaultValue == true, "the button is shown by default")
assert(minimapInitializer.setting:GetValue() == true, "the checkbox reads the current shown state")
minimapInitializer.setting:SetValue(false)
assert(minimapCalls[#minimapCalls] == false, "unchecking hides the button through ns.MinimapButton.setShown")
assert(minimapInitializer.setting:GetValue() == false, "the checkbox follows the hidden state")

print("settings.panel: all assertions passed")
