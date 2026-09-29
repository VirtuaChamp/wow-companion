local addonName, ns = ...

local function dispatchTransport(msg)
  if not msg or not msg.t then
    return
  end
  if msg.t == "chats" then
    ns.AiWindow.onChats(msg)
    ns.Settings.onChats(msg)
  elseif msg.t == "history" then
    ns.AiWindow.onHistory(msg)
  elseif msg.t == "reply" then
    ns.AiWindow.onReply(msg)
  elseif msg.t == "progress" then
    ns.AiWindow.onProgress(msg)
  elseif msg.t == "error" then
    ns.AiWindow.onError(msg)
    ns.Settings.onError(msg)
  elseif msg.t == "itemreq" then
    if ns.Items and ns.Items.details then
      ns.Items.details(msg.ids, function(items)
        ns.Transport.send({ t = "items", req = msg.req, items = items })
      end)
    end
  elseif msg.t == "options" then
    ns.Settings.onOptions(msg)
  end
end

ns.Transport = ns.Transport or {}
ns.Core = ns.Core or {}
ns.Core.dispatch = dispatchTransport

local function handleAi(rawMsg)
  local trimmed = (rawMsg or ""):match("^%s*(.-)%s*$")
  ns.AiWindow.show()
  if trimmed == "" then
    return
  end
  local cmd, rest = trimmed:match("^(%S+)%s*(.-)$")
  if cmd == "new" then
    ns.AiWindow.newChat(rest)
    return
  end
  if cmd == "chat" then
    ns.AiWindow.openChatByName(rest)
    return
  end
  if rest == "" then
    if cmd == "settings" then
      if ns.Settings and ns.Settings.open then
        ns.Settings.open()
      end
      return
    end
    if cmd == "report" then
      if ns.Report and ns.Report.open then
        ns.Report.open()
      end
      return
    end
    if cmd == "reset" or cmd == "cancel" then
      ns.AiWindow.sendCommand(cmd)
      return
    end
    if cmd == "help" then
      ns.AiWindow.printHelp()
      return
    end
    if cmd == "context" then
      ns.AiWindow.printContext()
      return
    end
  end
  ns.AiWindow.submitAsk(trimmed)
end

ns.Core.handleAi = handleAi

_G.SLASH_AI1 = "/ai"
_G.SlashCmdList["AI"] = handleAi

local loaderFrame = CreateFrame("Frame")
loaderFrame:RegisterEvent("ADDON_LOADED")
loaderFrame:SetScript("OnEvent", function(_, event, loadedAddonName)
  if event == "ADDON_LOADED" and loadedAddonName == addonName then
    WoWCompanionDB = WoWCompanionDB or {}
    ns.AiWindow.create()
    ns.Transport.onMessage(dispatchTransport)
  end
end)
