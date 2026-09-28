local addonName, ns = ...

ns.AiWindow = ns.AiWindow or {}

local AiWindow = ns.AiWindow

local SUBCOMMANDS = { "new", "chat", "settings", "report", "reset", "cancel", "help", "context" }
local WINDOW_WIDTH_DEFAULT = 420
local WINDOW_HEIGHT_DEFAULT = 320
local POPUP_MAX_ROWS = 8
local POPUP_ROW_HEIGHT = 16
local MAX_REPLIES = 200

local frame
local scrollFrame
local inputBox
local dropdown
local popupFrame
local moreBox
local resizeGrip
local askCounter = 0
local moreCounter = 0
local replies = {}
local replyOrder = {}
local chatsList = {}
local activeChat = "default"

local function sanitize(text)
  if type(text) ~= "string" then
    return ""
  end
  return (text:gsub("|", "||"))
end
AiWindow.sanitize = sanitize

local function rememberReply(id, entry)
  replies[id] = entry
  table.insert(replyOrder, id)
  if #replyOrder > MAX_REPLIES then
    local oldest = table.remove(replyOrder, 1)
    replies[oldest] = nil
  end
end

local function nextAskId()
  askCounter = askCounter + 1
  return "ask-" .. askCounter
end

local function nextMoreId()
  moreCounter = moreCounter + 1
  return "more-" .. moreCounter
end

local function providerLabel(providerId)
  if not providerId or providerId == "claude" then
    return "Claude"
  end
  if providerId == "codex" then
    return "Codex"
  end
  if providerId == "cursor" then
    return "Cursor"
  end
  return providerId
end

local function greyLine(text)
  local r, g, b = GRAY_FONT_COLOR:GetRGB()
  scrollFrame:AddMessage(text, r, g, b)
end

function AiWindow.notice(text)
  local r, g, b = YELLOW_FONT_COLOR:GetRGB()
  scrollFrame:AddMessage(sanitize(text), r, g, b)
end

local function relativeLabel(now, lastAt)
  if type(lastAt) ~= "number" or type(now) ~= "number" then
    return ""
  end
  local delta = now - lastAt
  if delta < 0 then
    delta = 0
  end
  if delta < 60 then
    return delta .. "s"
  elseif delta < 3600 then
    return math.floor(delta / 60) .. "m"
  elseif delta < 86400 then
    return math.floor(delta / 3600) .. "h"
  end
  return math.floor(delta / 86400) .. "d"
end
AiWindow.relativeLabel = relativeLabel

function AiWindow.chatName(chatId)
  for _, entry in ipairs(chatsList) do
    if entry.id == chatId then
      return entry.name
    end
  end
  return chatId
end

local function sortedChatsList()
  local sorted = {}
  for i, entry in ipairs(chatsList) do
    sorted[i] = entry
  end
  table.sort(sorted, function(a, b)
    return (a.lastAt or 0) > (b.lastAt or 0)
  end)
  return sorted
end

local function saveGeometry()
  if not frame then
    return
  end
  local point, _, relativePoint, x, y = frame:GetPoint(1)
  WoWCompanionDB.window = {
    point = point or "CENTER",
    relativePoint = relativePoint or "CENTER",
    x = x or 0,
    y = y or 0,
    width = frame:GetWidth(),
    height = frame:GetHeight(),
  }
end

local function restoreGeometry()
  local saved = WoWCompanionDB.window
  frame:ClearAllPoints()
  if saved then
    frame:SetPoint(saved.point, UIParent, saved.relativePoint, saved.x, saved.y)
    frame:SetSize(saved.width, saved.height)
  else
    frame:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
    frame:SetSize(WINDOW_WIDTH_DEFAULT, WINDOW_HEIGHT_DEFAULT)
  end
end

local function refreshPopupFrame()
  if not popupFrame then
    return
  end
  local popup = AiWindow.popup
  if not popup or not popup.items or #popup.items == 0 then
    popupFrame:Hide()
    return
  end
  for i, row in ipairs(popupFrame.rows) do
    local item = popup.items[i]
    if item then
      row:SetText(item.name or item)
      if popup.selected == i then
        row:SetTextColor(HIGHLIGHT_FONT_COLOR:GetRGB())
      else
        row:SetTextColor(NORMAL_FONT_COLOR:GetRGB())
      end
      row:Show()
    else
      row:Hide()
    end
  end
  if popupFrame.ghost then
    popupFrame.ghost:SetText(popup.ghost or "")
  end
  popupFrame:Show()
end

local function findMentionQuery(text)
  local atPos
  for i = #text, 1, -1 do
    local c = text:sub(i, i)
    if c == "@" then
      atPos = i
      break
    end
    if c == " " then
      return nil
    end
  end
  if not atPos then
    return nil
  end
  return text:sub(atPos + 1), atPos
end

local function findSubCommandQuery(text)
  return text:match("^/ai%s+(%S*)$")
end

function AiWindow.updatePopup(text)
  local subQuery = findSubCommandQuery(text)
  if subQuery then
    local matches = {}
    for _, name in ipairs(SUBCOMMANDS) do
      if name:find(subQuery, 1, true) == 1 then
        matches[#matches + 1] = { name = name }
      end
    end
    if #matches == 0 then
      AiWindow.popup = nil
    else
      AiWindow.popup = { kind = "sub", items = matches, ghost = matches[1].name }
    end
    refreshPopupFrame()
    return AiWindow.popup
  end
  local query = findMentionQuery(text)
  if query and #query >= 2 then
    local result = ns.Mention.match(query, ns.Mention.candidates())
    if not result.items or #result.items == 0 then
      AiWindow.popup = nil
    else
      AiWindow.popup = { kind = "mention", items = result.items, ghost = result.ghost }
    end
    refreshPopupFrame()
    return AiWindow.popup
  end
  AiWindow.popup = nil
  refreshPopupFrame()
  return nil
end

function AiWindow.acceptPopup(box)
  local popup = AiWindow.popup
  if not popup or not popup.items or #popup.items == 0 then
    return false
  end
  local pick = popup.items[popup.selected or 1]
  if popup.kind == "sub" then
    if pick then
      box:SetText("/ai " .. pick.name .. " ")
      box:SetCursorPosition(#box:GetText())
    end
  elseif popup.kind == "mention" then
    if pick then
      local text = box:GetText()
      local query, atPos = findMentionQuery(text)
      if query then
        local before = text:sub(1, atPos - 1)
        local after = text:sub(atPos + #query + 1)
        box:SetText(before .. "@[" .. pick.name .. "]" .. after)
        box:SetCursorPosition(#box:GetText())
      end
    end
  end
  AiWindow.popup = nil
  refreshPopupFrame()
  return true
end

local function resolveMentions(text)
  local mentions = {}
  local candidates
  for token in text:gmatch("@%[([^%]]+)%]") do
    candidates = candidates or ns.Mention.candidates()
    for _, candidate in ipairs(candidates) do
      if candidate.name == token then
        mentions[#mentions + 1] = candidate.mention
        break
      end
    end
  end
  return mentions
end

function AiWindow.printLine(who, summary, full, providerId)
  local clean = sanitize(summary)
  local text
  if who == "you" then
    text = "[You] " .. clean
  else
    text = "[" .. providerLabel(providerId) .. "] whispers: " .. clean
  end
  if full and full ~= summary then
    local moreId = nextMoreId()
    rememberReply(moreId, { summary = summary, full = full })
    text = text .. " " .. LinkUtil.FormatLink(LinkTypes.AddOn, "[more]", addonName, "more", moreId)
  end
  local r, g, b = NORMAL_FONT_COLOR:GetRGB()
  scrollFrame:AddMessage(text, r, g, b)
end

function AiWindow.submitAsk(text)
  AiWindow.show()
  AiWindow.printLine("you", text, nil, nil)
  local askId = nextAskId()
  ns.Transport.send({
    t = "ask",
    id = askId,
    chat = activeChat,
    text = text,
    mentions = resolveMentions(text),
  })
  return askId
end

function AiWindow.newChat(name)
  ns.Transport.send({ t = "cmd", chat = activeChat, name = "new", arg = (name ~= "" and name) or nil })
end

function AiWindow.openChatByName(name)
  if name == "" then
    ns.Transport.send({ t = "cmd", chat = activeChat, name = "open" })
    return
  end
  for _, entry in ipairs(chatsList) do
    if entry.name == name then
      ns.Transport.send({ t = "cmd", chat = entry.id, name = "open" })
      return
    end
  end
  greyLine(sanitize("[Claude] no chat named " .. name))
end

function AiWindow.sendCommand(name)
  ns.Transport.send({ t = "cmd", chat = activeChat, name = name })
end

function AiWindow.printHelp()
  greyLine("[Claude] /ai <text>, new, chat <name>, settings, report, reset, cancel, help, context")
end

function AiWindow.printContext()
  local snapshot = ns.State and ns.State.snapshot and ns.State.snapshot()
  if not snapshot then
    return
  end
  greyLine("[Claude] equipped " .. #(snapshot.equipped or {}) .. ", bags " .. #(snapshot.bags or {}))
end

_G.StaticPopupDialogs = _G.StaticPopupDialogs or {}
_G.StaticPopupDialogs["WOWCOMPANION_RENAME_CHAT"] = {
  text = "Rename this chat:",
  button1 = "Rename",
  button2 = "Cancel",
  hasEditBox = true,
  timeout = 0,
  whileDead = true,
  hideOnEscape = true,
  OnAccept = function(dialog, chatId)
    local newName = dialog and dialog.editBox and dialog.editBox:GetText()
    if newName and newName ~= "" and chatId then
      ns.Transport.send({ t = "cmd", chat = chatId, name = "rename", arg = newName })
    end
  end,
}
_G.StaticPopupDialogs["WOWCOMPANION_DELETE_CHAT"] = {
  text = "Delete this chat?",
  button1 = "Delete",
  button2 = "Cancel",
  timeout = 0,
  whileDead = true,
  hideOnEscape = true,
  OnAccept = function(_, chatId)
    if chatId then
      ns.Transport.send({ t = "cmd", chat = chatId, name = "delete" })
    end
  end,
}

function AiWindow.rebuildDropdown()
  if not dropdown then
    return
  end
  local now = time()
  dropdown:SetupMenu(function(_, root)
    root:CreateButton("New chat", function()
      ns.Transport.send({ t = "cmd", chat = activeChat, name = "new" })
    end)
    for _, entry in ipairs(sortedChatsList()) do
      local marker = entry.running and "\226\151\143 " or ""
      local unread = (entry.unread and entry.unread > 0) and (" (" .. entry.unread .. ")") or ""
      local label = marker
        .. sanitize(entry.name)
        .. " \194\183 "
        .. sanitize(providerLabel(entry.provider))
        .. " \194\183 "
        .. relativeLabel(now, entry.lastAt)
        .. unread
      root:CreateButton(label, function()
        ns.Transport.send({ t = "cmd", chat = entry.id, name = "open" })
      end)
      root:CreateButton("  Rename \226\128\148 " .. sanitize(entry.name), function()
        StaticPopup_Show("WOWCOMPANION_RENAME_CHAT", entry.name, nil, entry.id)
      end)
      root:CreateButton("  Delete \226\128\148 " .. sanitize(entry.name), function()
        StaticPopup_Show("WOWCOMPANION_DELETE_CHAT", entry.name, nil, entry.id)
      end)
    end
  end)
  dropdown:SetText(sanitize(AiWindow.chatName(activeChat)))
end

function AiWindow.onChats(msg)
  chatsList = msg.list or {}
  activeChat = msg.active or activeChat
  AiWindow.rebuildDropdown()
end

function AiWindow.onHistory(msg)
  activeChat = msg.chat
  scrollFrame:Clear()
  for _, line in ipairs(msg.lines or {}) do
    AiWindow.printLine(line.who, line.text, nil, line.who)
  end
  if dropdown then
    dropdown:SetText(sanitize(AiWindow.chatName(activeChat)))
  end
end

function AiWindow.onReply(msg)
  if msg.chat == activeChat then
    AiWindow.printLine(msg.provider, msg.summary, msg.full, msg.provider)
  else
    local openLink = LinkUtil.FormatLink(LinkTypes.AddOn, "[open]", addonName, "open", msg.chat)
    greyLine(
      "["
        .. sanitize(providerLabel(msg.provider))
        .. " \194\183 "
        .. sanitize(AiWindow.chatName(msg.chat))
        .. "] replied \226\128\148 "
        .. openLink
    )
  end
  if msg.waypoint then
    local result = ns.Waypoint and ns.Waypoint.set and ns.Waypoint.set(msg.waypoint)
    if result == true then
      local label = sanitize(msg.waypoint.label or "")
      local coords = "(" .. tostring(msg.waypoint.x) .. ", " .. tostring(msg.waypoint.y) .. ")"
      greyLine("[Claude] waypoint: " .. label .. " " .. coords)
    elseif result then
      greyLine(sanitize("[Claude] waypoint: " .. tostring(result)))
    end
  end
end

function AiWindow.onProgress(msg)
  greyLine("[Claude] " .. sanitize(msg.detail or msg.status or ""))
end

local ERROR_LINES = {
  busy = "[Claude] busy \226\128\148 still answering the last question.",
  provider_missing = "[Claude] provider not installed.",
  provider_auth = "[Claude] provider needs sign-in.",
  provider_disabled = "[Claude] provider disabled in settings.",
  session_unknown = "[Claude] chat session was reset.",
}

function AiWindow.onError(msg)
  local line = ERROR_LINES[msg.code] or ("[Claude] error: " .. sanitize(tostring(msg.code)))
  greyLine(line)
end

function AiWindow.openMoreBox(fullText)
  if not moreBox then
    moreBox = CreateFrame("Frame", "WoWCompanionMoreBox", UIParent, "ButtonFrameTemplate")
    moreBox:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
    moreBox:SetSize(460, 360)
    moreBox:SetFrameStrata("DIALOG")
    if moreBox.TitleContainer and moreBox.TitleContainer.TitleText then
      moreBox.TitleContainer.TitleText:SetText("Claude \226\128\148 full reply")
    end
    local scroll = CreateFrame("ScrollFrame", "WoWCompanionMoreBoxScroll", moreBox, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", moreBox, "TOPLEFT", 12, -70)
    scroll:SetPoint("BOTTOMRIGHT", moreBox, "BOTTOMRIGHT", -30, 40)
    moreBox.editBox = CreateFrame("EditBox", "WoWCompanionMoreBoxEditBox", scroll, "InputBoxTemplate")
    moreBox.editBox:SetMultiLine(true)
    moreBox.editBox:SetAutoFocus(true)
    moreBox.editBox:SetWidth(400)
    scroll:SetScrollChild(moreBox.editBox)
    moreBox.scrollFrame = scroll
  end
  moreBox.editBox:SetText(sanitize(fullText))
  moreBox.editBox:HighlightText()
  moreBox.editBox:SetFocus()
  moreBox:Show()
  AiWindow.moreBox = moreBox
  AiWindow.moreBoxEditBox = moreBox.editBox
end

local function parseAddonLink(link)
  if type(link) ~= "string" then
    return nil
  end
  local linkType, linkOptions = LinkUtil.SplitLinkData(link)
  if linkType ~= LinkTypes.AddOn then
    return nil
  end
  local ownerName, kind, id = strsplit(":", linkOptions)
  if ownerName ~= addonName then
    return nil
  end
  return kind, id
end

function AiWindow.handleAddonLink(link)
  local kind, id = parseAddonLink(link)
  if not kind then
    return
  end
  if kind == "more" then
    local reply = replies[id]
    if reply then
      AiWindow.openMoreBox(reply.full)
    end
  elseif kind == "open" then
    ns.Transport.send({ t = "cmd", chat = id, name = "open" })
  end
end

EventRegistry:RegisterCallback("SetItemRef", function(_, link)
  AiWindow.handleAddonLink(link)
end, AiWindow)

local function buildScrollFrame(parent)
  scrollFrame = CreateFrame("ScrollingMessageFrame", "WoWCompanionAiWindowScroll", parent)
  scrollFrame:SetPoint("TOPLEFT", parent, "TOPLEFT", 12, -60)
  scrollFrame:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -28, 44)
  scrollFrame:SetFontObject(GameFontHighlightSmall)
  scrollFrame:SetHyperlinksEnabled(true)
  scrollFrame:SetScript("OnHyperlinkClick", function(_, link, text, button)
    SetItemRef(link, text, button, scrollFrame)
  end)
  AiWindow.scrollFrame = scrollFrame
end

function AiWindow.onInputTextChanged(box, isUserInput)
  if not isUserInput then
    return
  end
  AiWindow.updatePopup(box:GetText())
end

function AiWindow.onInputArrow(_, key)
  local popup = AiWindow.popup
  if not popup or not popup.items or #popup.items == 0 then
    return
  end
  popup.selected = popup.selected or 1
  if key == "UP" then
    popup.selected = math.max(1, popup.selected - 1)
  elseif key == "DOWN" then
    popup.selected = math.min(#popup.items, popup.selected + 1)
  end
  refreshPopupFrame()
end

function AiWindow.onInputTab(box)
  AiWindow.acceptPopup(box)
end

function AiWindow.onInputEscape(box)
  if AiWindow.popup then
    AiWindow.popup = nil
    refreshPopupFrame()
    return
  end
  box:ClearFocus()
end

function AiWindow.onInputEnter(box)
  if AiWindow.popup and AiWindow.popup.items and #AiWindow.popup.items > 0 then
    AiWindow.acceptPopup(box)
    return
  end
  local text = box:GetText()
  if text == "" then
    return
  end
  box:SetText("")
  if text:match("^/ai%s") or text == "/ai" then
    if ns.Core and ns.Core.handleAi then
      ns.Core.handleAi(text:match("^/ai%s*(.-)$") or "")
    end
    return
  end
  AiWindow.submitAsk(text)
end

local function buildInputBox(parent)
  inputBox = CreateFrame("EditBox", "WoWCompanionAiWindowInput", parent, "InputBoxTemplate")
  inputBox:SetAutoFocus(false)
  inputBox:SetHeight(20)
  inputBox:SetPoint("BOTTOMLEFT", parent, "BOTTOMLEFT", 12, 12)
  inputBox:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -12, 12)
  inputBox:SetScript("OnEnterPressed", AiWindow.onInputEnter)
  inputBox:SetScript("OnTabPressed", AiWindow.onInputTab)
  inputBox:SetScript("OnEscapePressed", AiWindow.onInputEscape)
  inputBox:SetScript("OnArrowPressed", AiWindow.onInputArrow)
  inputBox:SetScript("OnTextChanged", AiWindow.onInputTextChanged)
  AiWindow.inputBox = inputBox
end

local function buildPopup(parent)
  popupFrame = CreateFrame("Frame", "WoWCompanionAiWindowPopup", parent, "TooltipBackdropTemplate")
  popupFrame:SetPoint("BOTTOMLEFT", inputBox, "TOPLEFT", 0, 4)
  popupFrame:SetPoint("RIGHT", inputBox, "RIGHT", 0, 0)
  popupFrame:SetHeight(POPUP_MAX_ROWS * POPUP_ROW_HEIGHT + 8)
  popupFrame:Hide()
  popupFrame.rows = {}
  local previous
  for i = 1, POPUP_MAX_ROWS do
    local row = popupFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    if previous then
      row:SetPoint("TOPLEFT", previous, "BOTTOMLEFT", 0, -2)
    else
      row:SetPoint("TOPLEFT", popupFrame, "TOPLEFT", 6, -6)
    end
    row:SetPoint("RIGHT", popupFrame, "RIGHT", -6, 0)
    popupFrame.rows[i] = row
    previous = row
  end
  popupFrame.ghost = popupFrame:CreateFontString(nil, "OVERLAY", "GameFontDisable")
  popupFrame.ghost:SetPoint("BOTTOMLEFT", popupFrame, "TOPLEFT", 6, 2)
  popupFrame.ghost:SetPoint("BOTTOMRIGHT", popupFrame, "TOPRIGHT", -6, 2)
  AiWindow.popupFrame = popupFrame
end

local function buildDropdown(parent)
  dropdown = CreateFrame("DropdownButton", "WoWCompanionAiWindowChats", parent, "WowStyle1DropdownTemplate")
  dropdown:SetPoint("TOPLEFT", parent, "TOPLEFT", 12, -30)
  AiWindow.dropdown = dropdown
end

local function buildGearButton(parent)
  local gearButton = CreateFrame("Button", "WoWCompanionAiWindowGear", parent)
  gearButton:SetSize(20, 20)
  gearButton:SetPoint("TOPRIGHT", parent, "TOPRIGHT", -28, -6)
  local label = gearButton:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  label:SetPoint("CENTER", gearButton, "CENTER", 0, 0)
  label:SetText("\226\154\153")
  gearButton.label = label
  gearButton:SetScript("OnClick", function()
    if ns.Settings and ns.Settings.open then
      ns.Settings.open()
    end
  end)
  gearButton:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:SetText("Settings")
    GameTooltip:Show()
  end)
  gearButton:SetScript("OnLeave", function()
    GameTooltip:Hide()
  end)
  AiWindow.gearButton = gearButton
end

local function buildResizeGrip(parent)
  resizeGrip = CreateFrame("Button", "WoWCompanionAiWindowResizeGrip", parent)
  resizeGrip:SetSize(16, 16)
  resizeGrip:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -6, 6)
  resizeGrip:EnableMouse(true)
  resizeGrip:SetScript("OnMouseDown", function()
    parent:StartSizing("BOTTOMRIGHT")
  end)
  resizeGrip:SetScript("OnMouseUp", function()
    parent:StopMovingOrSizing()
    saveGeometry()
  end)
  AiWindow.resizeGrip = resizeGrip
end

function AiWindow.create()
  if frame then
    return frame
  end

  WoWCompanionDB = WoWCompanionDB or {}

  frame = CreateFrame("Frame", "WoWCompanionClaudeWindow", UIParent, "ButtonFrameTemplate")
  frame:SetMovable(true)
  frame:SetResizable(true)
  frame:SetClampedToScreen(true)
  frame:SetResizeBounds(280, 180, 900, 700)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", function(f)
    f:StopMovingOrSizing()
    saveGeometry()
  end)
  frame:SetScript("OnHide", saveGeometry)
  restoreGeometry()

  if frame.TitleContainer and frame.TitleContainer.TitleText then
    frame.TitleContainer.TitleText:SetText("Claude")
  end

  buildDropdown(frame)
  buildGearButton(frame)
  buildScrollFrame(frame)
  buildInputBox(frame)
  buildPopup(frame)
  buildResizeGrip(frame)
  AiWindow.rebuildDropdown()
  frame:Hide()

  AiWindow.frame = frame
  return frame
end

function AiWindow.show()
  AiWindow.create()
  frame:Show()
end

function AiWindow.hide()
  if frame then
    frame:Hide()
  end
end

function AiWindow.isShown()
  return frame ~= nil and frame:IsShown()
end
