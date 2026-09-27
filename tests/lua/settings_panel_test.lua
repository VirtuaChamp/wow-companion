dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {}, handlers = {} }
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end
function ns.Transport.onMessage(handler)
  table.insert(ns.Transport.handlers, handler)
end

local chunk = assert(loadfile("addon/WoWCompanion/Settings.lua"))
chunk("WoWCompanion", ns)

assert(#_G.WOWC_TEST_REGISTERED_CATEGORIES == 1, "settings category registered at load, before open()")
assert(_G.WOWC_TEST_REGISTERED_CATEGORIES[1] == "WoW Companion", "category name matches")
assert(#ns.Transport.handlers == 0, "Settings.lua never subscribes itself to transport messages")

local registeredCategory = _G.WOWC_TEST_LAST_REGISTERED_CATEGORY
assert(registeredCategory ~= nil, "category recorded")

local providerSetting = _G.WOWC_TEST_REGISTERED_SETTINGS["WOWC_PROVIDER"]
assert(providerSetting ~= nil, "provider setting registered")
local providerInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_PROVIDER"]
local modelInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_MODEL"]
local effortInitializerAtLoad = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_EFFORT"]
local scopeInitializer = _G.WOWC_TEST_REGISTERED_INITIALIZERS["WOWC_SCOPE"]
assert(providerInitializer ~= nil, "provider dropdown initializer registered")
assert(modelInitializer ~= nil, "model dropdown initializer registered")
assert(effortInitializerAtLoad ~= nil, "effort dropdown initializer registered")
assert(scopeInitializer ~= nil, "scope checkbox initializer registered")
assert(scopeInitializer.kind == "checkbox", "\"This chat only\" is a checkbox, per the parent spec's UX Settings bullet")

local function assertEveryInitializerOptionIsRadio()
  for _, initializer in pairs(_G.WOWC_TEST_REGISTERED_INITIALIZERS) do
    for _, option in ipairs(initializer:GetOptions()) do
      assert(option.controlType == Settings.ControlType.Radio, "every registered option is a Radio control")
    end
  end
end

assertEveryInitializerOptionIsRadio()

local offlineOptions = ns.Settings.providerOptions()
assert(#offlineOptions == 1, "one placeholder option before options arrives")
assert(offlineOptions[1].label == "Companion offline", "placeholder reads Companion offline")
assert(offlineOptions[1].controlType == Settings.ControlType.Radio, "placeholder option is a Radio control")
assert(offlineOptions[1].disabled == "Companion offline", "placeholder option carries the reason as disabled")
assert(offlineOptions[1].tooltip == "Companion offline", "placeholder option carries the reason as tooltip")
assert(ns.Settings.isOnline() == false, "offline before the first options message")

ns.Settings.open()
assert(
  _G.WOWC_TEST_LAST_OPENED_CATEGORY == registeredCategory:GetID(),
  "open() opens the numeric category id, not the category table"
)

local optionsMessage = {
  t = "options",
  defaultProvider = "claude",
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
      efforts = {},
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
  },
}

local receivedCompanionVersion
ns.Report = { setCompanionVersion = function(version)
  receivedCompanionVersion = version
end }

ns.Settings.onOptions(optionsMessage)

assert(receivedCompanionVersion == "0.4.2", "onOptions hands the companion version to ns.Report")
assert(ns.Settings.isOnline() == true, "online after the first options message")
assert(providerInitializer:EvaluateModifyPredicates() == true, "provider dropdown enabled after options")

local filledOptions = providerInitializer:GetOptions()
assert(#filledOptions == 3, "one dropdown entry per provider")
for _, option in ipairs(filledOptions) do
  assert(option.controlType == Settings.ControlType.Radio, "every provider option is a Radio control")
end

local cursorOption
for _, option in ipairs(filledOptions) do
  if option.value == "cursor" then
    cursorOption = option
  end
end
assert(cursorOption ~= nil, "cursor listed")
assert(cursorOption.disabled == "headless MCP not loaded", "disabled provider carries the reason as disabled")
assert(cursorOption.tooltip == "headless MCP not loaded", "disabled reason shown as the option's tooltip")

local current = ns.Settings.current()
assert(current.provider == "claude", "default provider selected")
assert(current.model == "sonnet", "default model taken from provider.current")
assert(current.effort == "medium", "default effort taken from provider.current")

local filledModelOptions = modelInitializer:GetOptions()
assert(#filledModelOptions == 2, "model dropdown lists claude's models")

assert(effortInitializerAtLoad:EvaluateModifyPredicates() == true, "claude has efforts, effort dropdown enabled")
assertEveryInitializerOptionIsRadio()

assert(providerSetting.notifyCount > 0, "onOptions notifies the provider control to refresh")

ns.Settings.setProvider("codex")
assert(ns.Settings.current().provider == "codex", "provider switched")
assert(effortInitializerAtLoad:EvaluateModifyPredicates() == false, "codex lists no efforts, effort dropdown disabled")
assert(#effortInitializerAtLoad:GetOptions() == 0, "no effort options for a provider without any")

local sentCount = #ns.Transport.sent
local notifyCountBeforeRefusal = providerSetting.notifyCount
ns.Settings.setProvider("cursor")
assert(ns.Settings.current().provider == "codex", "disabled provider cannot be selected")
assert(#ns.Transport.sent == sentCount, "no settings message sent for a refused provider switch")
assert(providerSetting.notifyCount > notifyCountBeforeRefusal, "a refused provider switch still notifies the control to revert")

ns.Settings.setModel("not-a-real-model")
assert(ns.Settings.current().model == "gpt-5", "unlisted model never applied")
assert(#ns.Transport.sent == sentCount, "no settings message sent for a refused model")

ns.Settings.setProvider("claude")
assert(#ns.Transport.sent == sentCount + 1, "switching to an enabled provider sends settings")
local lastMessage = ns.Transport.sent[#ns.Transport.sent]
assert(lastMessage.t == "settings", "message type is settings")
assert(lastMessage.provider == "claude", "message carries the new provider")

ns.Settings.setEffort("not-a-real-effort")
assert(ns.Settings.current().effort == "medium", "unlisted effort never applied")

assert(scopeInitializer:EvaluateModifyPredicates() == false, "\"This chat only\" checkbox refused before an active chat is known")

local beforeChatSentCount = #ns.Transport.sent
ns.Settings.setScope("chat")
assert(ns.Settings.current().scope == "global", "chat scope refused without a known active chat")
assert(#ns.Transport.sent == beforeChatSentCount, "no settings message sent for a refused scope switch")

ns.Settings.onChats({ t = "chats", active = "chat-9", list = {} })

assert(scopeInitializer:EvaluateModifyPredicates() == true, "\"This chat only\" checkbox enabled once an active chat is known")

ns.Settings.setScope("chat")
assert(ns.Settings.current().scope == "chat", "scope switched to chat")
local chatMessage = ns.Transport.sent[#ns.Transport.sent]
assert(chatMessage.chat == "chat-9", "scope-to-chat sends the active chat id from the last chats message")

ns.Settings.setScope("global")
local globalMessage = ns.Transport.sent[#ns.Transport.sent]
assert(globalMessage.chat == nil, "scope-to-global carries no chat field")

print("settings.panel: all assertions passed")
