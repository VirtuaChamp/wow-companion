local addonName, ns = ...

ns.AiWindow = ns.AiWindow or {}

local AiWindow = ns.AiWindow

local SUBCOMMANDS = { "new", "chat", "settings", "report", "reset", "cancel", "help", "context" }
local WINDOW_WIDTH_DEFAULT = 680
local WINDOW_HEIGHT_DEFAULT = 420
local POPUP_MAX_ROWS = 8
local POPUP_ROW_HEIGHT = 16
local MAX_SEEN_REPLY_IDS = 200
local ASK_ID_SESSION_MAX = 40
local COPY_BOX_WIDTH = 460
local COPY_BOX_HEIGHT = 360
local COPY_BOX_PADDING = 10
local COPY_BOX_SCROLLBAR_ALLOWANCE = 18
local COPY_BOX_LINE_PADDING = 4
local BULLET = "\226\128\162 "
local ELLIPSIS = "\226\128\166"
local SIDEBAR_REFRESH_SECONDS = 45
local EMPTY_HINT = "Ask anything about your game"
local DEFAULT_TEXT_SIZE = "normal"
local TEXT_SIZES = {
  {
    key = "small",
    label = "Small",
    body = "GameFontHighlightSmall",
    meta = "GameFontNormalSmall",
    bodyHeight = 10,
    metaHeight = 10,
  },
  {
    key = "normal",
    label = "Normal",
    body = "GameFontHighlight",
    meta = "GameFontNormal",
    bodyHeight = 12,
    metaHeight = 12,
  },
  {
    key = "large",
    label = "Large",
    body = "GameFontHighlightMedium",
    meta = "GameFontNormalMed3",
    bodyHeight = 14,
    metaHeight = 14,
  },
  {
    key = "larger",
    label = "Larger",
    body = "GameFontHighlightLarge",
    meta = "GameFontNormalLarge",
    bodyHeight = 16,
    metaHeight = 16,
  },
}
local SIDEBAR_MAX_WIDTH = 200
local CHAT_ROW_LINE_GAP = 4
local CHAT_ROW_VERTICAL_PADDING = 5
local NAME_MARGIN = 4
local MAX_CACHED_CHATS = 30
local MAX_WAYPOINT_OFFERS = 400
local MAX_CHAT_NOTICES = 20
local LOADING_TEXT = "loading" .. "\226\128\166"
local DIALOG_NAME_MAX = 28
local TOOL_PHRASES = {
  get_game_state = "reading your character",
  find_npc = "looking up an NPC",
  find_quest = "looking up a quest",
  find_object = "looking up an object",
  suggest_gear_upgrades = "checking gear upgrades",
  set_waypoint = "setting a waypoint",
}
local RESIZE_MIN_WIDTH = 480
local RESIZE_MIN_HEIGHT = 240
local RESIZE_MAX_WIDTH = 1100
local RESIZE_MAX_HEIGHT = 800
local POPUP_PADDING = 6
local POPUP_ICON_SIZE = 12
local QUEST_ICON_ATLAS = "QuestNormal"
local GEAR_ICON_ATLAS = "questlog-icon-setting"
local GEAR_GAP_FROM_CLOSE = 6
local GEAR_HIT_INSET = 4
local SIDEBAR_WIDTH = 140
local SIDEBAR_PADDING = 6
local SIDEBAR_BOTTOM_MARGIN = 4
local SIDEBAR_SCROLLBAR_ALLOWANCE = 14
local NEW_CHAT_HEIGHT = 22
local CHAT_ROW_PADDING = 6
local RUNNING_MARK = "\226\151\143 "
local LOG_PADDING_X = 8
local LOG_PADDING_Y = 6
local LOG_MAX_LINES = 200
local LIST_SCROLLBAR_ALLOWANCE = 16
local LIST_SCROLLBAR_GAP = 4
local LIST_PADDING_X = 6
local BUBBLE_MAX_FRACTION = 0.75
local BUBBLE_MIN_WIDTH = 60
local BUBBLE_PADDING_X = 8
local BUBBLE_PADDING_Y = 6
local BUBBLE_NAME_INDENT = 2
local LINE_MIN_HEIGHT = 12
local USER_TINT_ALPHA = 0.5
local INPUT_STRIP_HEIGHT = 26
local INPUT_BOTTOM = 5
local INPUT_HEIGHT = 20
local INPUT_CAP_OVERHANG = 5
local INPUT_TEXT_INSET = 10
local GRIP_SIZE = 16
local GRIP_MARGIN = 6
local GRIP_CLEARANCE = 4

local frame
local messageBox
local messageProvider
local sidebarBox
local sidebarProvider
local sidebarView
local sidebarFrame
local messageView
local newChatButton
local measureText
local emptyHint
local sidebarTicker
local inputBox
local popupFrame
local copyBox
local resizeGrip
local ghostText
local ghostMeasure
local copyBoxText = ""
local askCounter = 0
local chatsList = {}
local activeChat = "default"
local entries = {}
local statusEntries = {}
local pendingEntries = {}
local chatCaches = {}
local waypointOffers = {}
local chatNotices = {}
local waypointOfferOrder = {}
local waypointCounter = 0
local cacheOrder = {}
local shownChat
local switching
local loadingEntry
local bubbleEntries = setmetatable({}, { __mode = "k" })
local builtRows = setmetatable({}, { __mode = "k" })
local lastLayoutWidth
local relayoutPending = false

local function sanitize(text)
  if type(text) ~= "string" then
    return ""
  end
  return (text:gsub("|", "||"))
end
AiWindow.sanitize = sanitize

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

function AiWindow.sendCmd(fields)
  AiWindow.cmdCounter = (AiWindow.cmdCounter or 0) + 1
  local token = tostring(ns.Transport.session()):gsub("[^A-Za-z0-9_%-]", "_")
  fields.t = "cmd"
  fields.id = "cmd-" .. token:sub(-ASK_ID_SESSION_MAX) .. "-" .. AiWindow.cmdCounter
  return ns.Transport.send(fields)
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

local function colorWrap(color, text, plain)
  if plain then
    return text
  end
  return color:WrapTextInColorCode(text)
end

local function stripEmphasisUnderscores(text)
  text = text:gsub("^_+", "")
  text = text:gsub("_+$", "")
  text = text:gsub("(%s)_+", "%1")
  text = text:gsub("_+(%s)", "%1")
  return text
end

local function stripMarkers(text)
  text = text:gsub("[%*`]", "")
  return stripEmphasisUnderscores(text)
end

local function renderInline(line, plain)
  local out = {}
  local i = 1
  local length = #line
  while i <= length do
    local character = line:sub(i, i)
    if line:sub(i, i + 1) == "**" then
      local close = line:find("**", i + 2, true)
      if close and close > i + 2 then
        out[#out + 1] = colorWrap(NORMAL_FONT_COLOR, stripMarkers(line:sub(i + 2, close - 1)), plain)
        i = close + 2
      else
        i = i + 2
      end
    elseif character == "`" then
      local close = line:find("`", i + 1, true)
      if close and close > i + 1 then
        out[#out + 1] = colorWrap(GRAY_FONT_COLOR, line:sub(i + 1, close - 1), plain)
        i = close + 1
      else
        i = i + 1
      end
    elseif character == "*" then
      i = i + 1
    else
      local stop = line:find("[%*`]", i + 1) or (length + 1)
      out[#out + 1] = stripEmphasisUnderscores(line:sub(i, stop - 1))
      i = stop
    end
  end
  return table.concat(out)
end

local function renderLine(line, plain)
  local heading = line:match("^%s*#+%s+(.*)$")
  if heading then
    return colorWrap(NORMAL_FONT_COLOR, stripMarkers(heading), plain)
  end
  local indent, item = line:match("^(%s*)[%-%*]%s+(.*)$")
  if item then
    return indent .. BULLET .. renderInline(item, plain)
  end
  return renderInline((line:gsub("^%s*#+", "")), plain)
end

local function renderText(text, plain)
  local lines = {}
  for line in (text .. "\n"):gmatch("(.-)\n") do
    lines[#lines + 1] = renderLine(line, plain)
  end
  return table.concat(lines, "\n")
end

local function renderMarkdown(text)
  return renderText(text, false)
end
AiWindow.renderMarkdown = renderMarkdown

local function stripMarkdown(text)
  return renderText(text, true)
end
AiWindow.stripMarkdown = stripMarkdown

local function currentSize()
  WoWCompanionDB = WoWCompanionDB or {}
  local wanted = WoWCompanionDB.textSize or DEFAULT_TEXT_SIZE
  for _, size in ipairs(TEXT_SIZES) do
    if size.key == wanted then
      return size
    end
  end
  for _, size in ipairs(TEXT_SIZES) do
    if size.key == DEFAULT_TEXT_SIZE then
      return size
    end
  end
end

local function bodyFont()
  return _G[currentSize().body]
end

local function metaFont()
  return _G[currentSize().meta]
end

local function fontHeight(font, fallback)
  local _, height = font:GetFont()
  return height or fallback
end

local function sizeMetrics()
  local size = currentSize()
  local body = fontHeight(_G[size.body], size.bodyHeight)
  local meta = fontHeight(_G[size.meta], size.metaHeight)
  local reference = fontHeight(_G[TEXT_SIZES[1].body], TEXT_SIZES[1].bodyHeight)
  return {
    nameRoom = math.ceil(meta) + NAME_MARGIN,
    rowHeight = math.ceil(body) + math.ceil(meta) + CHAT_ROW_LINE_GAP + 2 * CHAT_ROW_VERTICAL_PADDING,
    sidebarWidth = math.min(SIDEBAR_MAX_WIDTH, math.floor(SIDEBAR_WIDTH * body / reference)),
  }
end

function AiWindow.textSize()
  return currentSize().key
end

function AiWindow.textSizeChoices()
  local choices = {}
  for i, size in ipairs(TEXT_SIZES) do
    choices[i] = { key = size.key, label = size.label }
  end
  return choices
end

local function isAtEnd()
  if not messageBox:HasScrollableExtent() then
    return true
  end
  return messageBox:GetScrollPercentage() >= ScrollBoxConstants.ScrollEnd
end

local function scrollToEnd()
  messageBox:ScrollToEnd(ScrollBoxConstants.NoScrollInterpolation)
end

local function textLayout(entry)
  local listWidth = messageBox:GetWidth()
  if entry.kind == "line" or entry.kind == "status" then
    local width = math.max(1, listWidth - 2 * LIST_PADDING_X)
    measureText:SetWidth(width)
    measureText:SetText(entry.display)
    return { textWidth = width, height = math.max(LINE_MIN_HEIGHT, math.ceil(measureText:GetStringHeight())) }
  end
  local maxBubble = math.max(BUBBLE_MIN_WIDTH, math.floor(listWidth * BUBBLE_MAX_FRACTION))
  local maxText = maxBubble - 2 * BUBBLE_PADDING_X
  measureText:SetWidth(0)
  measureText:SetText(entry.display)
  local textWidth = math.min(math.ceil(measureText:GetStringWidth()) + 1, maxText)
  measureText:SetWidth(textWidth)
  local textHeight = math.ceil(measureText:GetStringHeight())
  return {
    textWidth = textWidth,
    width = textWidth + 2 * BUBBLE_PADDING_X,
    height = textHeight + 2 * BUBBLE_PADDING_Y,
  }
end

local function entryExtent(_, entry)
  return textLayout(entry).height
end

local function onRowLinkClick(_, link, text, button)
  SetItemRef(link, text, button, messageBox)
end

local function onBubbleMouseUp(bubble, button)
  local entry = bubbleEntries[bubble]
  if button ~= "RightButton" or not entry then
    return
  end
  MenuUtil.CreateContextMenu(bubble, function(_, root)
    root:CreateButton("Copy text", function()
      AiWindow.openCopyBox(entry.full, entry.kind == "user")
    end)
  end)
end

local function onBubbleEnter(bubble)
  GameTooltip:SetOwner(bubble, "ANCHOR_RIGHT")
  GameTooltip:SetText("Right-click: copy text")
  GameTooltip:Show()
end

local function onBubbleLeave()
  GameTooltip:Hide()
end

local function buildRow(row)
  builtRows[row] = true
  local bubble = CreateFrame("Frame", nil, row, "TooltipBackdropTemplate")
  bubble.text = bubble:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  bubble:EnableMouse(true)
  bubble:SetScript("OnMouseUp", onBubbleMouseUp)
  bubble:SetScript("OnEnter", onBubbleEnter)
  bubble:SetScript("OnLeave", onBubbleLeave)
  row.bubble = bubble
  row.who = row:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  row.line = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  row:SetHyperlinksEnabled(true)
  row:SetScript("OnHyperlinkClick", onRowLinkClick)
end

local function initBubble(row, entry, layout)
  local bubble = row.bubble
  bubbleEntries[bubble] = entry
  row.line:Hide()
  bubble:ClearAllPoints()
  bubble:SetSize(layout.width, layout.height)
  bubble.text:SetFontObject(bodyFont())
  bubble.text:SetJustifyH("LEFT")
  bubble.text:ClearAllPoints()
  bubble.text:SetPoint("TOPLEFT", bubble, "TOPLEFT", BUBBLE_PADDING_X, -BUBBLE_PADDING_Y)
  bubble.text:SetWidth(layout.textWidth)
  bubble.text:SetText(entry.display)
  local r, g, b
  if entry.kind == "user" then
    bubble:SetPoint("TOPRIGHT", row, "TOPRIGHT", -LIST_PADDING_X, 0)
    r, g, b = GRAY_FONT_COLOR:GetRGB()
    bubble:SetBackdropColor(r, g, b, USER_TINT_ALPHA)
    row.who:Hide()
  else
    bubble:SetPoint("TOPLEFT", row, "TOPLEFT", LIST_PADDING_X, 0)
    r, g, b = TOOLTIP_DEFAULT_BACKGROUND_COLOR:GetRGB()
    bubble:SetBackdropColor(r, g, b, 1)
    row.who:SetFontObject(metaFont())
    row.who:SetTextColor(GRAY_FONT_COLOR:GetRGB())
    row.who:ClearAllPoints()
    row.who:SetPoint("TOPLEFT", bubble, "BOTTOMLEFT", BUBBLE_NAME_INDENT, -1)
    row.who:SetText(sanitize(providerLabel(entry.provider)))
    row.who:Show()
  end
  bubble:Show()
end

local function initLine(row, entry, layout)
  row.bubble:Hide()
  row.who:Hide()
  row.line:SetFontObject(bodyFont())
  row.line:SetJustifyH("LEFT")
  row.line:ClearAllPoints()
  row.line:SetPoint("TOPLEFT", row, "TOPLEFT", LIST_PADDING_X, 0)
  row.line:SetWidth(layout.textWidth)
  if entry.tone == "yellow" then
    row.line:SetTextColor(YELLOW_FONT_COLOR:GetRGB())
  else
    row.line:SetTextColor(GRAY_FONT_COLOR:GetRGB())
  end
  row.line:SetText(entry.display)
  row.line:Show()
end

local function initRow(row, entry)
  if not builtRows[row] then
    buildRow(row)
  end
  local layout = textLayout(entry)
  if entry.kind == "line" or entry.kind == "status" then
    initLine(row, entry, layout)
  else
    initBubble(row, entry, layout)
  end
end

local function updateEmptyHint()
  if emptyHint then
    if #entries == 0 then
      emptyHint:Show()
    else
      emptyHint:Hide()
    end
  end
end

local function addEntry(entry)
  if not messageProvider then
    pendingEntries[#pendingEntries + 1] = entry
    if #pendingEntries > LOG_MAX_LINES then
      table.remove(pendingEntries, 1)
    end
    return
  end
  local wasAtEnd = isAtEnd()
  table.insert(entries, entry)
  messageProvider:Insert(entry)
  if #entries > LOG_MAX_LINES then
    messageProvider:Remove(table.remove(entries, 1))
  end
  updateEmptyHint()
  if wasAtEnd then
    scrollToEnd()
  end
end

local function removeEntry(entry)
  for index, candidate in ipairs(entries) do
    if candidate == entry then
      table.remove(entries, index)
      messageProvider:Remove(entry)
      updateEmptyHint()
      return
    end
  end
end

local function clearStatus(askId)
  local entry = statusEntries[askId]
  if entry then
    statusEntries[askId] = nil
    removeEntry(entry)
  end
end

local function replaceEntries(list)
  entries = list
  statusEntries = {}
  messageProvider = CreateDataProvider()
  messageProvider:InsertTable(list)
  messageBox:SetDataProvider(messageProvider)
  updateEmptyHint()
  scrollToEnd()
end

local function greyLine(text)
  addEntry({ kind = "line", tone = "grey", display = text })
end

function AiWindow.notice(text)
  addEntry({ kind = "line", tone = "yellow", display = sanitize(text) })
end

function AiWindow.entries()
  return entries
end

local function relayoutMessages()
  relayoutPending = false
  if not messageBox then
    return
  end
  local width = messageBox:GetWidth()
  if width == lastLayoutWidth then
    return
  end
  lastLayoutWidth = width
  local wasAtEnd = isAtEnd()
  messageBox:Rebuild(ScrollBoxConstants.RetainScrollPosition)
  if wasAtEnd then
    scrollToEnd()
  end
end

local function scheduleRelayout()
  if relayoutPending then
    return
  end
  relayoutPending = true
  C_Timer.After(0, relayoutMessages)
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
    frame:SetSize(
      math.min(RESIZE_MAX_WIDTH, math.max(RESIZE_MIN_WIDTH, saved.width)),
      math.min(RESIZE_MAX_HEIGHT, math.max(RESIZE_MIN_HEIGHT, saved.height))
    )
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
      AiWindow.switchToChat(pick.chatId)
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

local function messageEntry(who, text, providerId, waypoint)
  if who == "you" then
    return { kind = "user", display = sanitize(text), full = text }
  end
  return {
    kind = "ai",
    provider = providerId or who,
    display = renderMarkdown(sanitize(text)),
    full = text,
    waypoint = waypoint,
  }
end

local function offerLine(entry)
  local waypoint = entry.waypoint
  if not entry.waypointId then
    waypointCounter = waypointCounter + 1
    entry.waypointId = "wp-" .. waypointCounter
    waypointOffers[entry.waypointId] = waypoint
    waypointOfferOrder[#waypointOfferOrder + 1] = entry.waypointId
    if #waypointOfferOrder > MAX_WAYPOINT_OFFERS then
      waypointOffers[table.remove(waypointOfferOrder, 1)] = nil
    end
  end
  local link = LinkUtil.FormatLink(LinkTypes.AddOn, "[Set waypoint]", addonName, "waypoint", entry.waypointId)
  local coords = "(" .. tostring(waypoint.x) .. ", " .. tostring(waypoint.y) .. ")"
  return {
    kind = "line",
    tone = "grey",
    display = "waypoint: " .. sanitize(waypoint.label or "") .. " " .. coords .. " " .. link,
  }
end

local function expandOffers(list)
  local expanded = {}
  for _, entry in ipairs(list) do
    expanded[#expanded + 1] = entry
    if entry.waypoint then
      expanded[#expanded + 1] = offerLine(entry)
    end
  end
  return expanded
end

local function withNotices(chatId, list)
  for _, notice in ipairs(chatNotices[chatId] or {}) do
    list[#list + 1] = notice
  end
  return list
end

local function carryWaypoints(list, previous)
  if not previous then
    return
  end
  for index, entry in ipairs(list) do
    local old = previous[index]
    if entry.kind == "ai" and old and old.kind == "ai" and old.full == entry.full and old.waypoint then
      entry.waypoint = old.waypoint
      entry.waypointId = old.waypointId
    end
  end
end

local function touchCache(chatId)
  for index, id in ipairs(cacheOrder) do
    if id == chatId then
      table.remove(cacheOrder, index)
      break
    end
  end
  cacheOrder[#cacheOrder + 1] = chatId
  while #cacheOrder > MAX_CACHED_CHATS do
    local dropped
    for index, id in ipairs(cacheOrder) do
      if id ~= shownChat then
        dropped = table.remove(cacheOrder, index)
        break
      end
    end
    if not dropped then
      break
    end
    chatCaches[dropped] = nil
  end
end

local function cacheAppend(chatId, entry, create)
  local cache = chatCaches[chatId]
  if not cache then
    if not create then
      return
    end
    cache = {}
    chatCaches[chatId] = cache
  end
  cache[#cache + 1] = entry
  if #cache > LOG_MAX_LINES then
    table.remove(cache, 1)
  end
  touchCache(chatId)
end

local function dropCache(chatId)
  chatCaches[chatId] = nil
  chatNotices[chatId] = nil
  for index, id in ipairs(cacheOrder) do
    if id == chatId then
      table.remove(cacheOrder, index)
      break
    end
  end
end

local function sameMessages(a, b)
  if #a ~= #b then
    return false
  end
  for index, entry in ipairs(a) do
    local other = b[index]
    if entry.kind ~= other.kind or entry.provider ~= other.provider or entry.full ~= other.full then
      return false
    end
  end
  return true
end

function AiWindow.printLine(who, text, providerId, waypoint)
  local entry = messageEntry(who, text, providerId, waypoint)
  addEntry(entry)
  if waypoint then
    addEntry(offerLine(entry))
  end
  cacheAppend(activeChat, entry, true)
end

function AiWindow.submitAsk(text)
  AiWindow.show()
  chatNotices[activeChat] = nil
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
  AiWindow.printLine("you", text)
  return askId
end

function AiWindow.newChat(name)
  AiWindow.sendCmd({ chat = activeChat, name = "new", arg = (name ~= "" and name) or nil })
end

function AiWindow.openChatByName(name)
  if name == "" then
    AiWindow.sendCmd({ chat = activeChat, name = "open" })
    return
  end
  for _, entry in ipairs(chatsList) do
    if entry.name == name then
      AiWindow.switchToChat(entry.id)
      return
    end
  end
  greyLine(sanitize("[Claude] no chat named " .. name))
end

function AiWindow.sendCommand(name)
  AiWindow.sendCmd({ chat = activeChat, name = name })
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

local DIALOG_WIDTH = 320
local DIALOG_TOP = 36
local DIALOG_PADDING = 16
local DIALOG_BUTTON_WIDTH = 110
local DIALOG_BUTTON_HEIGHT = 22
local DIALOG_INPUT_HEIGHT = 22
local DIALOG_INPUT_GAP = 8

local chatDialog
local dialogMode
local dialogChatId

local function closeChatDialog()
  dialogChatId = nil
  dialogMode = nil
  if chatDialog then
    chatDialog:Hide()
  end
end

local function acceptChatDialog()
  if not dialogChatId then
    return
  end
  if dialogMode == "rename" then
    local newName = chatDialog.editBox:GetText():match("^%s*(.-)%s*$")
    if newName == "" then
      return
    end
    AiWindow.sendCmd({ chat = dialogChatId, name = "rename", arg = newName })
  elseif dialogMode == "delete" then
    AiWindow.sendCmd({ chat = dialogChatId, name = "delete" })
  end
  closeChatDialog()
end

local function truncateName(name)
  if #name <= DIALOG_NAME_MAX then
    return name
  end
  local cut = name:sub(1, DIALOG_NAME_MAX - 1):gsub("[\192-\255][\128-\191]*$", "")
  return cut .. ELLIPSIS
end

local function buildChatDialog()
  local dialog = CreateFrame("Frame", "WoWCompanionChatDialog", UIParent, "BasicFrameTemplateWithInset")
  dialog:SetSize(DIALOG_WIDTH, DIALOG_TOP + DIALOG_PADDING)
  dialog:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
  dialog:SetFrameStrata("DIALOG")
  dialog:EnableMouse(true)
  dialog:Hide()
  dialog.CloseButton:SetScript("OnClick", closeChatDialog)
  dialog:SetScript("OnHide", function()
    dialogChatId = nil
    dialogMode = nil
  end)

  dialog.message = dialog:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  dialog.message:SetJustifyH("LEFT")
  dialog.message:SetWidth(DIALOG_WIDTH - 2 * DIALOG_PADDING)
  dialog.message:SetPoint("TOPLEFT", dialog, "TOPLEFT", DIALOG_PADDING, -DIALOG_TOP)

  local editBox = CreateFrame("EditBox", "WoWCompanionChatDialogInput", dialog, "InputBoxTemplate")
  editBox:SetAutoFocus(false)
  editBox:SetHeight(DIALOG_INPUT_HEIGHT)
  editBox:SetPoint("TOPLEFT", dialog.message, "BOTTOMLEFT", 6, -DIALOG_INPUT_GAP)
  editBox:SetPoint("TOPRIGHT", dialog.message, "BOTTOMRIGHT", -6, -DIALOG_INPUT_GAP)
  editBox:SetScript("OnEnterPressed", function()
    if dialogMode == "rename" then
      acceptChatDialog()
    end
  end)
  editBox:SetScript("OnEscapePressed", closeChatDialog)
  dialog.editBox = editBox

  local accept = CreateFrame("Button", "WoWCompanionChatDialogAccept", dialog, "UIPanelButtonTemplate")
  accept:SetSize(DIALOG_BUTTON_WIDTH, DIALOG_BUTTON_HEIGHT)
  accept:SetPoint("BOTTOMRIGHT", dialog, "BOTTOM", -4, DIALOG_PADDING)
  accept:SetScript("OnClick", acceptChatDialog)
  dialog.accept = accept

  local cancel = CreateFrame("Button", "WoWCompanionChatDialogCancel", dialog, "UIPanelButtonTemplate")
  cancel:SetSize(DIALOG_BUTTON_WIDTH, DIALOG_BUTTON_HEIGHT)
  cancel:SetPoint("BOTTOMLEFT", dialog, "BOTTOM", 4, DIALOG_PADDING)
  cancel:SetText("Cancel")
  cancel:SetScript("OnClick", closeChatDialog)
  dialog.cancel = cancel

  table.insert(UISpecialFrames, dialog:GetName())
  return dialog
end

function AiWindow.showChatDialog(mode, chat)
  if not chatDialog then
    chatDialog = buildChatDialog()
    AiWindow.chatDialog = chatDialog
  end
  dialogMode = mode
  dialogChatId = chat.id
  local withField = mode == "rename"
  if withField then
    chatDialog.TitleText:SetText("Rename chat")
    chatDialog.message:SetText("New name for this chat:")
    chatDialog.accept:SetText("Rename")
    chatDialog.editBox:Show()
    chatDialog.editBox:SetText(chat.name)
  else
    chatDialog.TitleText:SetText("Delete chat")
    chatDialog.message:SetText("This removes " .. sanitize(truncateName(chat.name)) .. " and its history.")
    chatDialog.accept:SetText("Delete")
    chatDialog.editBox:ClearFocus()
    chatDialog.editBox:Hide()
  end
  local messageHeight = math.ceil(chatDialog.message:GetStringHeight())
  local fieldHeight = withField and (DIALOG_INPUT_GAP + DIALOG_INPUT_HEIGHT) or 0
  local chrome = DIALOG_TOP + DIALOG_PADDING + DIALOG_BUTTON_HEIGHT + DIALOG_PADDING
  chatDialog:SetHeight(chrome + messageHeight + fieldHeight)
  chatDialog:Show()
  if withField then
    chatDialog.editBox:HighlightText()
    chatDialog.editBox:SetFocus()
  end
end

local function showChatMenu(row, chat)
  MenuUtil.CreateContextMenu(row, function(_, root)
    root:CreateButton("Rename", function()
      AiWindow.showChatDialog("rename", chat)
    end)
    root:CreateButton("Delete", function()
      AiWindow.showChatDialog("delete", chat)
    end)
  end)
end

local function onChatRowClick(row, button)
  local chat = row.chat
  if not chat then
    return
  end
  if button == "RightButton" then
    showChatMenu(row, chat)
  else
    AiWindow.switchToChat(chat.id)
  end
end

local function showChatTooltip(row)
  local chat = row.chat
  if not chat then
    return
  end
  GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
  GameTooltip:SetText(sanitize(chat.name))
  local r, g, b = GRAY_FONT_COLOR:GetRGB()
  GameTooltip:AddLine(
    sanitize(providerLabel(chat.provider)) .. " \194\183 " .. relativeLabel(GetServerTime(), chat.lastAt),
    r,
    g,
    b
  )
  GameTooltip:AddLine("Right-click: rename or delete", r, g, b)
  GameTooltip:Show()
end

local function buildChatRow(row)
  builtRows[row] = true
  row:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  row:SetHighlightAtlas("Options_List_Hover", "ADD")
  row.selection = row:CreateTexture(nil, "BACKGROUND")
  row.selection:SetAtlas("Options_List_Active")
  row.selection:SetPoint("TOPLEFT", row, "TOPLEFT", 0, 0)
  row.selection:SetPoint("BOTTOMRIGHT", row, "BOTTOMRIGHT", 0, 0)
  row.title = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  row.title:SetJustifyH("LEFT")
  row.title:SetWordWrap(false)
  row.title:SetPoint("TOPLEFT", row, "TOPLEFT", CHAT_ROW_PADDING, -5)
  row.title:SetPoint("TOPRIGHT", row, "TOPRIGHT", -CHAT_ROW_PADDING, -5)
  row.unread = row:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  row.unread:SetPoint("BOTTOMRIGHT", row, "BOTTOMRIGHT", -CHAT_ROW_PADDING, 5)
  row.sub = row:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  row.sub:SetJustifyH("LEFT")
  row.sub:SetWordWrap(false)
  row.sub:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT", CHAT_ROW_PADDING, 5)
  row.sub:SetPoint("BOTTOMRIGHT", row.unread, "BOTTOMLEFT", -CHAT_ROW_PADDING, 0)
  row:SetScript("OnClick", onChatRowClick)
  row:SetScript("OnEnter", showChatTooltip)
  row:SetScript("OnLeave", function()
    GameTooltip:Hide()
  end)
end

local function initChatRow(row, chat)
  if not builtRows[row] then
    buildChatRow(row)
  end
  row.chat = chat
  row.title:SetFontObject(bodyFont())
  row.title:SetJustifyH("LEFT")
  row.sub:SetFontObject(metaFont())
  row.sub:SetJustifyH("LEFT")
  row.sub:SetTextColor(GRAY_FONT_COLOR:GetRGB())
  row.unread:SetFontObject(metaFont())
  row.title:SetText((chat.running and RUNNING_MARK or "") .. sanitize(chat.name))
  row.sub:SetText(sanitize(providerLabel(chat.provider)) .. " \194\183 " .. relativeLabel(GetServerTime(), chat.lastAt))
  row.unread:SetText((chat.unread and chat.unread > 0) and tostring(chat.unread) or "")
  if chat.id == activeChat then
    row.selection:Show()
  else
    row.selection:Hide()
  end
end

local function refreshSidebar()
  if not sidebarBox then
    return
  end
  sidebarProvider = CreateDataProvider(sortedChatsList())
  sidebarBox:SetDataProvider(sidebarProvider, ScrollBoxConstants.RetainScrollPosition)
end

local function refreshSidebarRows()
  if sidebarBox then
    sidebarBox:ReinitializeFrames()
  end
end

function AiWindow.switchToChat(chatId)
  AiWindow.sendCmd({ chat = chatId, name = "open" })
  if not messageBox or chatId == shownChat then
    return
  end
  switching = chatId
  activeChat = chatId
  shownChat = chatId
  local cached = chatCaches[chatId]
  if cached then
    touchCache(chatId)
    loadingEntry = nil
    replaceEntries(withNotices(chatId, expandOffers(cached)))
  else
    loadingEntry = { kind = "line", tone = "grey", display = LOADING_TEXT }
    replaceEntries(withNotices(chatId, { loadingEntry }))
  end
  refreshSidebarRows()
end

function AiWindow.onChats(msg)
  chatsList = msg.list or {}
  if not switching then
    activeChat = msg.active or activeChat
  end
  if msg.list then
    local present = {}
    for _, entry in ipairs(chatsList) do
      present[entry.id] = true
    end
    local stale = {}
    for id in pairs(chatCaches) do
      if not present[id] then
        stale[#stale + 1] = id
      end
    end
    for _, id in ipairs(stale) do
      dropCache(id)
    end
    for id in pairs(chatNotices) do
      if not present[id] then
        chatNotices[id] = nil
      end
    end
  end
  refreshSidebar()
end

function AiWindow.onHistory(msg)
  switching = nil
  activeChat = msg.chat
  local list = {}
  for _, line in ipairs(msg.lines or {}) do
    list[#list + 1] = messageEntry(line.who, line.text, line.who)
  end
  local cached = chatCaches[msg.chat]
  local unchanged = cached ~= nil and shownChat == msg.chat and loadingEntry == nil and sameMessages(cached, list)
  if unchanged then
    refreshSidebarRows()
    return
  end
  carryWaypoints(list, cached)
  chatCaches[msg.chat] = list
  touchCache(msg.chat)
  shownChat = msg.chat
  loadingEntry = nil
  replaceEntries(withNotices(msg.chat, expandOffers(list)))
  refreshSidebarRows()
end

function AiWindow.onReply(msg)
  if msg.id then
    clearStatus(msg.id)
    if replySeen(msg.id) then
      return
    end
    markReplySeen(msg.id)
  end
  if msg.chat == activeChat then
    AiWindow.printLine(msg.provider, msg.full, msg.provider, msg.waypoint)
  else
    cacheAppend(msg.chat, messageEntry(msg.provider, msg.full, msg.provider, msg.waypoint), false)
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
end

local function chatProvider(chatId)
  for _, entry in ipairs(chatsList) do
    if entry.id == chatId then
      return entry.provider
    end
  end
  return "claude"
end

function AiWindow.onProgress(msg)
  if replySeen(msg.id) or msg.chat ~= activeChat then
    return
  end
  local what
  if msg.status == "tool" then
    local tool = (msg.detail or ""):gsub("^mcp__wowc__", "")
    what = (TOOL_PHRASES[tool] or ("using " .. sanitize(tool))) .. ELLIPSIS
  elseif msg.status == "queued" then
    what = "queued" .. ELLIPSIS
  else
    what = "thinking" .. ELLIPSIS
  end
  clearStatus(msg.id)
  local entry = {
    kind = "status",
    display = sanitize(providerLabel(chatProvider(msg.chat))) .. " \194\183 " .. what,
  }
  statusEntries[msg.id] = entry
  addEntry(entry)
end

local ERROR_LINES = {
  busy = "[Claude] busy \226\128\148 still answering the last question.",
  provider_missing = "[Claude] provider not installed.",
  provider_auth = "[Claude] provider needs sign-in.",
  provider_disabled = "[Claude] provider disabled in settings.",
  session_unknown = "[Claude] chat session was reset.",
  daemon_error = "[Claude] the companion could not handle that message; try again.",
}

function AiWindow.onError(msg)
  if msg.id then
    clearStatus(msg.id)
  end
  local detail = type(msg.message) == "string" and msg.message ~= "" and msg.message or msg.code
  local line = ERROR_LINES[msg.code] or ("[Claude] error: " .. sanitize(tostring(detail)))
  if msg.chat and msg.chat ~= activeChat then
    local notices = chatNotices[msg.chat] or {}
    chatNotices[msg.chat] = notices
    notices[#notices + 1] = { kind = "line", tone = "grey", display = line }
    if #notices > MAX_CHAT_NOTICES then
      table.remove(notices, 1)
    end
    return
  end
  greyLine(line)
end

local function layoutCopyBoxText()
  local scroll = copyBox.scrollFrame
  local textWidth = scroll:GetWidth() - COPY_BOX_SCROLLBAR_ALLOWANCE
  copyBox.editBox:SetWidth(textWidth)
  copyBox.measure:SetWidth(textWidth)
  local textHeight = math.ceil(copyBox.measure:GetStringHeight()) + COPY_BOX_LINE_PADDING
  copyBox.editBox:SetHeight(math.max(scroll:GetHeight(), textHeight))
end

function AiWindow.openCopyBox(fullText, literal)
  if not copyBox then
    copyBox = CreateFrame("Frame", "WoWCompanionCopyBox", UIParent, "ButtonFrameTemplate")
    ButtonFrameTemplate_HideAttic(copyBox)
    ButtonFrameTemplate_HideButtonBar(copyBox)
    ButtonFrameTemplate_HidePortrait(copyBox)
    copyBox:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
    copyBox:SetSize(COPY_BOX_WIDTH, COPY_BOX_HEIGHT)
    copyBox:SetFrameStrata("DIALOG")
    if copyBox.TitleContainer and copyBox.TitleContainer.TitleText then
      copyBox.TitleContainer.TitleText:SetText("Copy text")
    end
    local scroll = CreateFrame("ScrollFrame", "WoWCompanionCopyBoxScroll", copyBox, "InputScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", copyBox.Inset, "TOPLEFT", COPY_BOX_PADDING, -COPY_BOX_PADDING)
    scroll:SetPoint("BOTTOMRIGHT", copyBox.Inset, "BOTTOMRIGHT", -COPY_BOX_PADDING, COPY_BOX_PADDING)
    scroll.CharCount:Hide()
    local editBox = scroll.EditBox
    editBox:SetMultiLine(true)
    editBox:SetAutoFocus(true)
    copyBox.measure = copyBox:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    copyBox.measure:Hide()
    editBox:HookScript("OnTextChanged", function(box, isUserInput)
      if isUserInput then
        box:SetText(copyBoxText)
        box:HighlightText()
      end
    end)
    copyBox.editBox = editBox
    copyBox.scrollFrame = scroll
    scroll:HookScript("OnSizeChanged", layoutCopyBoxText)
  end
  copyBoxText = literal and sanitize(fullText) or stripMarkdown(sanitize(fullText))
  copyBox:Show()
  copyBox.measure:SetText(copyBoxText)
  layoutCopyBoxText()
  copyBox.editBox:SetText(copyBoxText)
  copyBox.editBox:HighlightText()
  copyBox.editBox:SetFocus()
  AiWindow.copyBox = copyBox
  AiWindow.copyBoxEditBox = copyBox.editBox
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
  if kind == "open" then
    AiWindow.sendCmd({ chat = id, name = "open" })
  elseif kind == "waypoint" then
    local waypoint = waypointOffers[id]
    if not waypoint then
      return
    end
    local result = ns.Waypoint and ns.Waypoint.set and ns.Waypoint.set(waypoint)
    if result == true then
      greyLine("[Claude] waypoint set: " .. sanitize(waypoint.label or ""))
    elseif result then
      greyLine(sanitize("[Claude] waypoint: " .. tostring(result)))
    end
  end
end

EventRegistry:RegisterCallback("SetItemRef", function(_, link)
  AiWindow.handleAddonLink(link)
end, AiWindow)

function AiWindow.onLogWheel(box, delta)
  if IsShiftKeyDown() then
    local directions = ScrollControllerMixin.Directions
    local direction = delta < 0 and directions.Increase or directions.Decrease
    box:ScrollInDirection(box:GetVisibleExtentPercentage(), direction)
  else
    box:OnMouseWheel(delta)
  end
end

local function buildSidebar(parent)
  local sidebar = CreateFrame("Frame", "WoWCompanionAiWindowSidebar", parent, "InsetFrameTemplate")
  sidebarFrame = sidebar
  sidebar:SetWidth(sizeMetrics().sidebarWidth)
  sidebar:SetPoint("TOPLEFT", parent.Inset, "TOPLEFT", 0, 0)
  sidebar:SetPoint("BOTTOMLEFT", parent.Inset, "BOTTOMLEFT", 0, -(INPUT_STRIP_HEIGHT - SIDEBAR_BOTTOM_MARGIN))

  newChatButton = CreateFrame("Button", "WoWCompanionAiWindowNewChat", sidebar, "UIPanelButtonTemplate")
  newChatButton:SetHeight(NEW_CHAT_HEIGHT)
  newChatButton:SetText("New chat")
  newChatButton:SetPoint("TOPLEFT", sidebar, "TOPLEFT", SIDEBAR_PADDING, -SIDEBAR_PADDING)
  newChatButton:SetPoint("TOPRIGHT", sidebar, "TOPRIGHT", -SIDEBAR_PADDING, -SIDEBAR_PADDING)
  newChatButton:SetScript("OnClick", function()
    AiWindow.sendCmd({ chat = activeChat, name = "new" })
  end)

  sidebarBox = CreateFrame("Frame", "WoWCompanionAiWindowChatList", sidebar, "WowScrollBoxList")
  sidebarBox:SetPoint("TOPLEFT", newChatButton, "BOTTOMLEFT", 0, -SIDEBAR_PADDING)
  sidebarBox:SetPoint("BOTTOMRIGHT", sidebar, "BOTTOMRIGHT", -SIDEBAR_SCROLLBAR_ALLOWANCE, SIDEBAR_PADDING)
  local scrollBar = CreateFrame("EventFrame", "WoWCompanionAiWindowChatListBar", sidebar, "MinimalScrollBar")
  scrollBar:SetPoint("TOPLEFT", sidebarBox, "TOPRIGHT", LIST_SCROLLBAR_GAP, -3)
  scrollBar:SetPoint("BOTTOMLEFT", sidebarBox, "BOTTOMRIGHT", LIST_SCROLLBAR_GAP, 2)
  local view = CreateScrollBoxListLinearView()
  view:SetElementInitializer("Button", initChatRow)
  view:SetElementExtent(sizeMetrics().rowHeight)
  sidebarView = view
  ScrollUtil.InitScrollBoxListWithScrollBar(sidebarBox, scrollBar, view)
  local anchorsWithBar = {
    CreateAnchor("TOPLEFT", newChatButton, "BOTTOMLEFT", 0, -SIDEBAR_PADDING),
    CreateAnchor("BOTTOMRIGHT", sidebar, "BOTTOMRIGHT", -SIDEBAR_SCROLLBAR_ALLOWANCE, SIDEBAR_PADDING),
  }
  local anchorsWithoutBar = {
    anchorsWithBar[1],
    CreateAnchor("BOTTOMRIGHT", sidebar, "BOTTOMRIGHT", -SIDEBAR_PADDING, SIDEBAR_PADDING),
  }
  ScrollUtil.AddManagedScrollBarVisibilityBehavior(sidebarBox, scrollBar, anchorsWithBar, anchorsWithoutBar)
  sidebarProvider = CreateDataProvider()
  sidebarBox:SetDataProvider(sidebarProvider)

  AiWindow.sidebar = sidebar
  AiWindow.sidebarBox = sidebarBox
  AiWindow.newChatButton = newChatButton
  return sidebar
end

local function buildMessageList(parent, sidebar)
  messageBox = CreateFrame("Frame", "WoWCompanionAiWindowMessages", parent, "WowScrollBoxList")
  messageBox:SetPoint("TOPLEFT", sidebar, "TOPRIGHT", LOG_PADDING_X, -LOG_PADDING_Y)
  messageBox:SetPoint("BOTTOMRIGHT", parent.Inset, "BOTTOMRIGHT", -LIST_SCROLLBAR_ALLOWANCE, LOG_PADDING_Y)
  local scrollBar = CreateFrame("EventFrame", "WoWCompanionAiWindowMessagesBar", parent, "MinimalScrollBar")
  scrollBar:SetPoint("TOPLEFT", messageBox, "TOPRIGHT", LIST_SCROLLBAR_GAP, -3)
  scrollBar:SetPoint("BOTTOMLEFT", messageBox, "BOTTOMRIGHT", LIST_SCROLLBAR_GAP, 2)

  measureText = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  measureText:SetJustifyH("LEFT")
  measureText:Hide()

  emptyHint = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  emptyHint:SetTextColor(GRAY_FONT_COLOR:GetRGB())
  emptyHint:SetPoint("TOP", messageBox, "TOP", 0, -LOG_PADDING_Y * 2)
  emptyHint:SetText(EMPTY_HINT)

  local room = sizeMetrics().nameRoom
  local view = CreateScrollBoxListLinearView(LOG_PADDING_Y, room, 0, 0, room)
  messageView = view
  view:SetElementInitializer("Frame", initRow)
  view:SetElementExtentCalculator(entryExtent)
  ScrollUtil.InitScrollBoxListWithScrollBar(messageBox, scrollBar, view)
  local anchorsWithBar = {
    CreateAnchor("TOPLEFT", sidebar, "TOPRIGHT", LOG_PADDING_X, -LOG_PADDING_Y),
    CreateAnchor("BOTTOMRIGHT", parent.Inset, "BOTTOMRIGHT", -LIST_SCROLLBAR_ALLOWANCE, LOG_PADDING_Y),
  }
  local anchorsWithoutBar = {
    anchorsWithBar[1],
    CreateAnchor("BOTTOMRIGHT", parent.Inset, "BOTTOMRIGHT", -LOG_PADDING_X, LOG_PADDING_Y),
  }
  ScrollUtil.AddManagedScrollBarVisibilityBehavior(messageBox, scrollBar, anchorsWithBar, anchorsWithoutBar)
  messageProvider = CreateDataProvider()
  messageBox:SetDataProvider(messageProvider)
  messageBox:EnableMouseWheel(true)
  messageBox:SetScript("OnMouseWheel", AiWindow.onLogWheel)
  messageBox:RegisterCallback(BaseScrollBoxEvents.OnSizeChanged, scheduleRelayout, AiWindow)

  AiWindow.messageBox = messageBox
  AiWindow.emptyHint = emptyHint
end

local function applyTextSize()
  if not frame then
    return
  end
  local size = currentSize()
  local body = _G[size.body]
  measureText:SetFontObject(body)
  emptyHint:SetFontObject(body)
  emptyHint:SetTextColor(GRAY_FONT_COLOR:GetRGB())
  inputBox:SetFontObject(body)
  ghostText:SetFontObject(body)
  ghostText:SetTextColor(GRAY_FONT_COLOR:GetRGB())
  ghostMeasure:SetFontObject(body)
  local metrics = sizeMetrics()
  sidebarFrame:SetWidth(metrics.sidebarWidth)
  sidebarView:SetElementExtent(metrics.rowHeight)
  sidebarBox:Rebuild(ScrollBoxConstants.RetainScrollPosition)
  messageView:SetPadding(LOG_PADDING_Y, metrics.nameRoom, 0, 0, metrics.nameRoom)
  lastLayoutWidth = messageBox:GetWidth()
  local wasAtEnd = isAtEnd()
  messageBox:Rebuild(ScrollBoxConstants.RetainScrollPosition)
  if wasAtEnd then
    scrollToEnd()
  end
end

function AiWindow.setTextSize(key)
  for _, size in ipairs(TEXT_SIZES) do
    if size.key == key then
      WoWCompanionDB = WoWCompanionDB or {}
      WoWCompanionDB.textSize = key
      applyTextSize()
      return true
    end
  end
  return false
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

local function buildInputBox(parent, sidebar)
  inputBox = CreateFrame("EditBox", "WoWCompanionAiWindowInput", parent, "InputBoxTemplate")
  inputBox:SetAutoFocus(false)
  inputBox:SetHeight(INPUT_HEIGHT)
  local belowInset = INPUT_BOTTOM - INPUT_STRIP_HEIGHT
  inputBox:SetPoint(
    "BOTTOMLEFT",
    sidebar,
    "BOTTOMRIGHT",
    LOG_PADDING_X + INPUT_CAP_OVERHANG,
    INPUT_BOTTOM - SIDEBAR_BOTTOM_MARGIN
  )
  inputBox:SetPoint("BOTTOMRIGHT", parent.Inset, "BOTTOMRIGHT", -(GRIP_SIZE + GRIP_CLEARANCE), belowInset)
  inputBox:SetTextInsets(INPUT_TEXT_INSET, INPUT_TEXT_INSET, 0, 0)
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

local function buildGearButton(parent)
  local gearButton = CreateFrame("Button", "WoWCompanionAiWindowGear", parent)
  gearButton:SetSize(15, 16)
  gearButton:SetPoint("RIGHT", parent.CloseButton, "LEFT", -GEAR_GAP_FROM_CLOSE, 0)
  gearButton:SetFrameLevel(parent.CloseButton:GetFrameLevel())
  gearButton:SetHitRectInsets(-GEAR_HIT_INSET, -GEAR_HIT_INSET, -GEAR_HIT_INSET, -GEAR_HIT_INSET)
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
  resizeGrip:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -GRIP_MARGIN, GRIP_MARGIN)
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
  ButtonFrameTemplate_HideAttic(frame)
  ButtonFrameTemplate_HidePortrait(frame)
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
  frame:SetScript("OnHide", function()
    saveGeometry()
    if sidebarTicker then
      sidebarTicker:Cancel()
      sidebarTicker = nil
    end
  end)
  frame:SetScript("OnShow", function()
    scheduleRelayout()
    refreshSidebarRows()
    if not sidebarTicker then
      sidebarTicker = C_Timer.NewTicker(SIDEBAR_REFRESH_SECONDS, refreshSidebarRows)
    end
  end)
  restoreGeometry()

  if frame.TitleContainer and frame.TitleContainer.TitleText then
    frame.TitleContainer.TitleText:SetText("Claude")
  end

  local sidebar = buildSidebar(frame)
  buildGearButton(frame)
  buildMessageList(frame, sidebar)
  buildInputBox(frame, sidebar)
  buildPopup(frame)
  buildResizeGrip(frame)
  refreshSidebar()
  applyTextSize()
  local buffered = pendingEntries
  pendingEntries = {}
  for _, entry in ipairs(buffered) do
    addEntry(entry)
  end
  updateEmptyHint()
  frame:Hide()

  AiWindow.frame = frame
  return frame
end

function AiWindow.show()
  AiWindow.create()
  frame:Show()
end

function AiWindow.toggle()
  AiWindow.create()
  if frame:IsShown() then
    frame:Hide()
  else
    frame:Show()
  end
end

function AiWindow.hide()
  if frame then
    frame:Hide()
  end
end

function AiWindow.isShown()
  return frame ~= nil and frame:IsShown()
end
