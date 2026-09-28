local addonName, ns = ...

ns.AiWindow = ns.AiWindow or {}

local AiWindow = ns.AiWindow

local SUBCOMMANDS = { "new", "chat", "settings", "report", "reset", "cancel", "help", "context" }
local WINDOW_WIDTH_DEFAULT = 420
local WINDOW_HEIGHT_DEFAULT = 320
local POPUP_MAX_ROWS = 8
local POPUP_ROW_HEIGHT = 16
local MAX_REPLIES = 200
local MAX_SEEN_REPLY_IDS = 200
local ASK_ID_SESSION_MAX = 40
local MORE_BOX_WIDTH = 460
local MORE_BOX_HEIGHT = 360
local MORE_BOX_MARGIN_LEFT = 12
local MORE_BOX_MARGIN_RIGHT = 30
local MORE_BOX_MARGIN_TOP = 70
local MORE_BOX_MARGIN_BOTTOM = 40
local MORE_BOX_SCROLLBAR_ALLOWANCE = 18
local MORE_BOX_LINE_PADDING = 4
local RESIZE_MIN_WIDTH = 280
local RESIZE_MIN_HEIGHT = 180
local RESIZE_MAX_WIDTH = 900
local RESIZE_MAX_HEIGHT = 700
local POPUP_PADDING = 6
local POPUP_ICON_SIZE = 12
local QUEST_ICON_ATLAS = "QuestNormal"
local GEAR_ICON_ATLAS = "questlog-icon-setting"

local frame
local scrollFrame
local inputBox
local dropdown
local popupFrame
local moreBox
local resizeGrip
local ghostText
local ghostMeasure
local moreBoxText = ""
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

local function seenStore()
  WoWCompanionDB = WoWCompanionDB or {}
  local store = WoWCompanionDB.seenReplies
  if not store then
    store = { order = {}, set = {} }
    WoWCompanionDB.seenReplies = store
  end
  return store
end

local function replySeen(id)
  return seenStore().set[id] == true
end

local function markReplySeen(id)
  local store = seenStore()
  store.set[id] = true
  table.insert(store.order, id)
  if #store.order > MAX_SEEN_REPLY_IDS then
    local oldest = table.remove(store.order, 1)
    store.set[oldest] = nil
  end
end

local function nextAskId()
  askCounter = askCounter + 1
  local token = tostring(ns.Transport.session()):gsub("[^A-Za-z0-9_%-]", "_")
  return "ask-" .. token:sub(-ASK_ID_SESSION_MAX) .. "-" .. askCounter
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

local function itemRowColor(item)
  local mention = item.mention
  if mention and mention.kind == "item" and mention.itemId then
    local quality = C_Item.GetItemQualityByID(mention.itemId)
    local entry = quality and ITEM_QUALITY_COLORS[quality]
    if entry then
      return entry.color:GetRGB()
    end
  end
  return NORMAL_FONT_COLOR:GetRGB()
end

local function ghostRemainder(query, name)
  if not query or not name or #query > #name then
    return ""
  end
  if name:sub(1, #query):lower() ~= query:lower() then
    return ""
  end
  return name:sub(#query + 1)
end

local function refreshGhost(remainder)
  if not ghostText then
    return
  end
  if not remainder or remainder == "" then
    ghostText:SetText("")
    return
  end
  ghostMeasure:SetText(inputBox:GetText())
  local insetLeft = inputBox:GetTextInsets()
  ghostText:ClearAllPoints()
  ghostText:SetPoint("LEFT", inputBox, "LEFT", insetLeft + ghostMeasure:GetStringWidth(), 0)
  ghostText:SetText(sanitize(remainder))
end

local function refreshPopupFrame()
  if not popupFrame then
    return
  end
  local popup = AiWindow.popup
  if not popup or not popup.items or #popup.items == 0 then
    popupFrame:Hide()
    refreshGhost("")
    return
  end
  popupFrame:SetHeight(#popup.items * POPUP_ROW_HEIGHT + 2 * POPUP_PADDING)
  for i, row in ipairs(popupFrame.rows) do
    local item = popup.items[i]
    if item then
      row.text:SetText(sanitize(item.name))
      row.text:SetTextColor(itemRowColor(item))
      if item.mention and item.mention.kind == "quest" then
        row.icon:SetAtlas(QUEST_ICON_ATLAS)
        row.icon:Show()
      else
        row.icon:Hide()
      end
      if (popup.selected or 1) == i then
        row.highlight:Show()
      else
        row.highlight:Hide()
      end
      row.text:Show()
    else
      row.text:Hide()
      row.icon:Hide()
      row.highlight:Hide()
    end
  end
  refreshGhost(ghostRemainder(popup.query, popup.ghost))
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

local function findChatQuery(text)
  return text:match("^/ai%s+chat%s+(.*)$")
end

local function chatNameMatches(query)
  local lowered = query:lower()
  local prefix = {}
  local inside = {}
  for _, entry in ipairs(sortedChatsList()) do
    local name = entry.name
    if type(name) == "string" then
      local at = name:lower():find(lowered, 1, true)
      if lowered == "" or at == 1 then
        prefix[#prefix + 1] = { name = name, chatId = entry.id }
      elseif at then
        inside[#inside + 1] = { name = name, chatId = entry.id }
      end
    end
  end
  local matches = {}
  for _, list in ipairs({ prefix, inside }) do
    for _, match in ipairs(list) do
      if #matches < POPUP_MAX_ROWS then
        matches[#matches + 1] = match
      end
    end
  end
  return matches
end

function AiWindow.updatePopup(text)
  local chatQuery = findChatQuery(text)
  if chatQuery then
    local matches = chatNameMatches(chatQuery)
    if #matches == 0 then
      AiWindow.popup = nil
    else
      AiWindow.popup = { kind = "chat", items = matches, ghost = matches[1].name, query = chatQuery }
    end
    refreshPopupFrame()
    return AiWindow.popup
  end
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
      AiWindow.popup = { kind = "sub", items = matches, ghost = matches[1].name, query = subQuery }
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
      AiWindow.popup = { kind = "mention", items = result.items, ghost = result.ghost, query = query }
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
      if pick.name == "chat" then
        AiWindow.updatePopup(box:GetText())
        return true
      end
    end
  elseif popup.kind == "chat" then
    if pick then
      box:SetText("")
      ns.Transport.send({ t = "cmd", chat = pick.chatId, name = "open" })
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
  local askId = nextAskId()
  local seq, err = ns.Transport.send({
    t = "ask",
    id = askId,
    chat = activeChat,
    text = text,
    mentions = resolveMentions(text),
  })
  if seq == nil and err ~= nil then
    if err == "busy" then
      AiWindow.notice("[Claude] busy, not sent")
    else
      AiWindow.notice("[Claude] not sent (" .. tostring(err) .. ")")
    end
    return nil, err
  end
  AiWindow.printLine("you", text, nil, nil)
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
    local newName = dialog:GetEditBox():GetText()
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
  local now = GetServerTime()
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
      local row = root:CreateButton(label, function()
        ns.Transport.send({ t = "cmd", chat = entry.id, name = "open" })
      end)
      row:CreateButton("Rename", function()
        StaticPopup_Show("WOWCOMPANION_RENAME_CHAT", entry.name, nil, entry.id)
      end)
      row:CreateButton("Delete", function()
        StaticPopup_Show("WOWCOMPANION_DELETE_CHAT", entry.name, nil, entry.id)
      end)
    end
  end)
  dropdown:OverrideText(sanitize(AiWindow.chatName(activeChat)))
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
    dropdown:OverrideText(sanitize(AiWindow.chatName(activeChat)))
  end
end

function AiWindow.onReply(msg)
  if msg.id then
    if replySeen(msg.id) then
      return
    end
    markReplySeen(msg.id)
  end
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
    moreBox:SetSize(MORE_BOX_WIDTH, MORE_BOX_HEIGHT)
    moreBox:SetFrameStrata("DIALOG")
    if moreBox.TitleContainer and moreBox.TitleContainer.TitleText then
      moreBox.TitleContainer.TitleText:SetText("Claude \226\128\148 full reply")
    end
    local scroll = CreateFrame("ScrollFrame", "WoWCompanionMoreBoxScroll", moreBox, "InputScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", moreBox, "TOPLEFT", MORE_BOX_MARGIN_LEFT, -MORE_BOX_MARGIN_TOP)
    local viewportWidth = MORE_BOX_WIDTH - MORE_BOX_MARGIN_LEFT - MORE_BOX_MARGIN_RIGHT
    local viewportHeight = MORE_BOX_HEIGHT - MORE_BOX_MARGIN_TOP - MORE_BOX_MARGIN_BOTTOM
    scroll:SetSize(viewportWidth, viewportHeight)
    scroll.CharCount:Hide()
    local editBox = scroll.EditBox
    editBox:SetMultiLine(true)
    editBox:SetAutoFocus(true)
    editBox:SetWidth(scroll:GetWidth() - MORE_BOX_SCROLLBAR_ALLOWANCE)
    moreBox.measure = moreBox:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    moreBox.measure:SetWidth(editBox:GetWidth())
    moreBox.measure:Hide()
    editBox:HookScript("OnTextChanged", function(box, isUserInput)
      if isUserInput then
        box:SetText(moreBoxText)
        box:HighlightText()
      end
    end)
    moreBox.editBox = editBox
    moreBox.scrollFrame = scroll
  end
  moreBoxText = sanitize(fullText)
  moreBox.measure:SetText(moreBoxText)
  local textHeight = math.ceil(moreBox.measure:GetStringHeight()) + MORE_BOX_LINE_PADDING
  moreBox.editBox:SetHeight(math.max(moreBox.scrollFrame:GetHeight(), textHeight))
  moreBox.editBox:SetText(moreBoxText)
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
  local askId = AiWindow.submitAsk(text)
  if not askId then
    box:SetText(text)
  end
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
  popupFrame:SetHeight(POPUP_MAX_ROWS * POPUP_ROW_HEIGHT + 2 * POPUP_PADDING)
  popupFrame:Hide()
  popupFrame.rows = {}
  for i = 1, POPUP_MAX_ROWS do
    local top = -(POPUP_PADDING + (i - 1) * POPUP_ROW_HEIGHT)
    local highlight = popupFrame:CreateTexture(nil, "BACKGROUND", "UIPanelButtonHighlightTexture")
    highlight:SetPoint("TOPLEFT", popupFrame, "TOPLEFT", POPUP_PADDING - 2, top)
    highlight:SetPoint("RIGHT", popupFrame, "RIGHT", -(POPUP_PADDING - 2), 0)
    highlight:SetHeight(POPUP_ROW_HEIGHT)
    highlight:Hide()
    local icon = popupFrame:CreateTexture(nil, "ARTWORK")
    icon:SetSize(POPUP_ICON_SIZE, POPUP_ICON_SIZE)
    icon:SetPoint("TOPLEFT", popupFrame, "TOPLEFT", POPUP_PADDING, top - 2)
    icon:Hide()
    local text = popupFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    text:SetPoint("TOPLEFT", popupFrame, "TOPLEFT", POPUP_PADDING + POPUP_ICON_SIZE + 4, top - 2)
    text:SetPoint("RIGHT", popupFrame, "RIGHT", -POPUP_PADDING, 0)
    popupFrame.rows[i] = { text = text, icon = icon, highlight = highlight }
  end
  ghostText = inputBox:CreateFontString(nil, "OVERLAY", "ChatFontNormal")
  ghostText:SetTextColor(GRAY_FONT_COLOR:GetRGB())
  ghostMeasure = inputBox:CreateFontString(nil, "OVERLAY", "ChatFontNormal")
  ghostMeasure:Hide()
  AiWindow.popupFrame = popupFrame
  AiWindow.ghostText = ghostText
end

local function buildDropdown(parent)
  dropdown = CreateFrame("DropdownButton", "WoWCompanionAiWindowChats", parent, "WowStyle1DropdownTemplate")
  dropdown:SetPoint("TOPLEFT", parent, "TOPLEFT", 12, -30)
  AiWindow.dropdown = dropdown
end

local function buildGearButton(parent)
  local gearButton = CreateFrame("Button", "WoWCompanionAiWindowGear", parent)
  gearButton:SetSize(15, 16)
  gearButton:SetPoint("TOPRIGHT", parent, "TOPRIGHT", -28, -6)
  gearButton:SetNormalAtlas(GEAR_ICON_ATLAS)
  gearButton:SetHighlightAtlas(GEAR_ICON_ATLAS, "ADD")
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
  resizeGrip = CreateFrame("Button", "WoWCompanionAiWindowResizeGrip", parent, "PanelResizeButtonTemplate")
  resizeGrip:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -6, 6)
  resizeGrip:Init(parent, RESIZE_MIN_WIDTH, RESIZE_MIN_HEIGHT, RESIZE_MAX_WIDTH, RESIZE_MAX_HEIGHT)
  resizeGrip:SetOnResizeStoppedCallback(saveGeometry)
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
