dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {}, handlers = {} }
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end
function ns.Transport.onMessage(handler)
  table.insert(ns.Transport.handlers, handler)
end

local notices = {}
ns.AiWindow = { notice = function(text)
  table.insert(notices, text)
end }

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

assert(providerInitializer.tooltip ~= "AI provider", "provider tooltip is not just its own label")
assert(modelInitializer.tooltip ~= "Model", "model tooltip is not just its own label")
assert(effortInitializer.tooltip ~= "Effort", "effort tooltip is not just its own label")
assert(scopeInitializer.tooltip ~= "This chat only", "scope tooltip is not just its own label")

local offlineOptions = ns.Settings.providerOptions()
assert(#offlineOptions == 1, "one placeholder option before options arrives")
assert(offlineOptions[1].label == "Companion offline", "placeholder reads Companion offline")
assert(offlineOptions[1].disabled == "Companion offline", "placeholder option carries the reason as disabled")
assert(offlineOptions[1].tooltip == "Companion offline", "placeholder option carries the reason as tooltip")
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
assert(notices[1] == "[Claude] now using codex · gpt-5 · unknown", "notice format matches the spec, with 'unknown' standing in for an absent effort, matching the report box's own placeholder")
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
  notices[2] == "[Claude] now using codex · gpt-5 · high",
  "the pending change survived the earlier non-matching options message"
)
assert(ns.Settings.current().effort == "high", "current() now reflects the confirmed effort")

ns.Settings.setEffort("low")
assert(#ns.Transport.sent == 3, "a listed effort sends a settings message")
ns.Settings.onError({ t = "error", code = "provider_missing", message = "codex is not installed anymore" })
assert(#notices == 3, "onError notices while a change was pending")
assert(notices[3] == "codex is not installed anymore", "onError forwards the companion's own message verbatim")

ns.Settings.onOptions({
  t = "options",
  providers = optionsMessage.providers,
  active = { provider = "codex", model = "gpt-5", effort = "high" },
})
assert(#notices == 3, "the cleared pending change is not re-confirmed by a later options message")

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

print("settings.panel: all assertions passed")
