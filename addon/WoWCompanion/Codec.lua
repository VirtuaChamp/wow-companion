local _, ns = ...

local Codec = {}
ns.Codec = Codec

local MAGIC_1 = 0x57
local MAGIC_2 = 0x43
local VERSION = 2
local FRAME_PAYLOAD_MAX = 1024
local TOTAL_PAYLOAD_MAX = 16384
local CRC_INIT = 0xFFFF
local CRC_POLY = 0x1021
local CRC_MASK = 0xFFFF

local FRAME_OVERHEAD_BYTES = 11
local PITCH_PX = 2
local ROW_HEIGHT_PX = 2
local MAX_ROWS = 3
local MARGIN_PX = 16
local ANCHOR = { 7, 1, 6, 2, 5, 3, 7, 4, 6, 2, 5, 1 }
local COUNT_CELLS = 4
local ROW_OVERHEAD_CELLS = #ANCHOR + COUNT_CELLS
local MAX_CELLS_PER_ROW = 4095
local GEOMETRY_EVENTS = { "UI_SCALE_CHANGED", "DISPLAY_SIZE_CHANGED" }

local COLOR_CHANNELS = {
  { 0, 0, 0 },
  { 0, 0, 1 },
  { 0, 1, 0 },
  { 0, 1, 1 },
  { 1, 0, 0 },
  { 1, 0, 1 },
  { 1, 1, 0 },
  { 1, 1, 1 },
}

local function u16be(n)
  local hi = math.floor(n / 256) % 256
  local lo = n % 256
  return string.char(hi, lo)
end

local function crc16(bytes)
  local crc = CRC_INIT
  for i = 1, #bytes do
    local b = string.byte(bytes, i)
    crc = bit.bxor(crc, bit.lshift(b, 8))
    for _ = 1, 8 do
      if bit.band(crc, 0x8000) ~= 0 then
        crc = bit.band(bit.bxor(bit.lshift(crc, 1), CRC_POLY), CRC_MASK)
      else
        crc = bit.band(bit.lshift(crc, 1), CRC_MASK)
      end
    end
  end
  return crc
end

local function isArrayTable(t)
  local count = 0
  for _ in pairs(t) do
    count = count + 1
  end
  if count == 0 then
    return true
  end
  for i = 1, count do
    if t[i] == nil then
      return false
    end
  end
  return true
end

local function escapeJsonString(s)
  local out = s:gsub('[%c"\\]', function(c)
    if c == '"' then
      return '\\"'
    elseif c == "\\" then
      return "\\\\"
    elseif c == "\n" then
      return "\\n"
    elseif c == "\r" then
      return "\\r"
    elseif c == "\t" then
      return "\\t"
    else
      return string.format("\\u%04x", string.byte(c))
    end
  end)
  return '"' .. out .. '"'
end

local function formatInteger(n)
  if n == 0 then
    return "0"
  end
  local sign = ""
  local magnitude = n
  if magnitude < 0 then
    sign = "-"
    magnitude = -magnitude
  end
  local digits = {}
  while magnitude > 0 do
    local d = magnitude % 10
    digits[#digits + 1] = string.char(48 + d)
    magnitude = math.floor(magnitude / 10)
  end
  local reversed = {}
  for i = #digits, 1, -1 do
    reversed[#reversed + 1] = digits[i]
  end
  return sign .. table.concat(reversed)
end

local function encodeJsonNumber(n)
  if n ~= n or n == math.huge or n == -math.huge then
    error("Codec.encode: number must be finite", 0)
  end
  if n == math.floor(n) and math.abs(n) < 1e15 then
    return formatInteger(n)
  end
  return string.format("%.17g", n)
end

local encodeJsonValue

local function encodeJsonArray(t)
  local parts = {}
  local count = 0
  for _ in pairs(t) do
    count = count + 1
  end
  for i = 1, count do
    parts[i] = encodeJsonValue(t[i])
  end
  return "[" .. table.concat(parts, ",") .. "]"
end

local function encodeJsonObject(t)
  local keys = {}
  for k in pairs(t) do
    keys[#keys + 1] = k
  end
  table.sort(keys, function(a, b)
    return tostring(a) < tostring(b)
  end)
  local parts = {}
  for i, k in ipairs(keys) do
    parts[i] = escapeJsonString(tostring(k)) .. ":" .. encodeJsonValue(t[k])
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

encodeJsonValue = function(value)
  local valueType = type(value)
  if valueType == "table" then
    if isArrayTable(value) then
      return encodeJsonArray(value)
    end
    return encodeJsonObject(value)
  elseif valueType == "string" then
    return escapeJsonString(value)
  elseif valueType == "number" then
    return encodeJsonNumber(value)
  elseif valueType == "boolean" then
    return value and "true" or "false"
  elseif value == nil then
    return "null"
  end
  error("Codec.encode: unsupported value type " .. valueType, 0)
end

function Codec.encodeJson(value)
  return encodeJsonValue(value)
end

local function physicalSize()
  local width, height = GetPhysicalScreenSize()
  return width, height
end

function Codec.dataCellsPerRow(physicalWidth)
  local rowCells = math.floor((physicalWidth - 2 * MARGIN_PX) / PITCH_PX)
  return math.max(0, math.min(MAX_CELLS_PER_ROW, rowCells - ROW_OVERHEAD_CELLS))
end

function Codec.framePayloadMax(physicalWidth)
  local width = physicalWidth or physicalSize()
  local cells = Codec.dataCellsPerRow(width) * MAX_ROWS
  local bytes = math.floor(cells * 3 / 8)
  return math.max(1, math.min(FRAME_PAYLOAD_MAX, bytes - FRAME_OVERHEAD_BYTES))
end

function Codec.toFrames(payload, seq, maxPayload)
  if #payload > TOTAL_PAYLOAD_MAX then
    return nil, "too_large"
  end
  local chunkMax = maxPayload or Codec.framePayloadMax()
  local total = math.max(1, math.ceil(#payload / chunkMax))
  if total > 255 then
    return nil, "too_large"
  end
  local frames = {}
  for index = 0, total - 1 do
    local chunkStart = index * chunkMax + 1
    local chunkEnd = math.min(#payload, chunkStart + chunkMax - 1)
    local chunk = ""
    if chunkEnd >= chunkStart then
      chunk = string.sub(payload, chunkStart, chunkEnd)
    end
    local header = string.char(MAGIC_1, MAGIC_2, VERSION)
      .. u16be(seq)
      .. string.char(total, index)
      .. u16be(#chunk)
    local body = header .. chunk
    local crc = crc16(body)
    frames[#frames + 1] = body .. u16be(crc)
  end
  return frames
end

function Codec.encode(tbl, seq)
  local ok, jsonOrErr = pcall(encodeJsonValue, tbl)
  if not ok then
    return nil, jsonOrErr
  end
  return Codec.toFrames(jsonOrErr, seq or 0)
end

function Codec.render(frame)
  local cells = {}
  local carryBits = 0
  local carryValue = 0
  for i = 1, #frame do
    local byte = string.byte(frame, i)
    local totalBits = carryBits + 8
    local value = carryValue * 256 + byte
    local remaining = totalBits
    while remaining >= 3 do
      local shift = remaining - 3
      local cell = math.floor(value / (2 ^ shift)) % 8
      cells[#cells + 1] = cell
      remaining = remaining - 3
    end
    carryBits = remaining
    carryValue = value % (2 ^ remaining)
  end
  if carryBits > 0 then
    cells[#cells + 1] = carryValue * (2 ^ (3 - carryBits))
  end
  return cells
end

local function countCells(perRow)
  local cells = {}
  local rest = perRow
  for i = COUNT_CELLS, 1, -1 do
    cells[i] = rest % 8
    rest = math.floor(rest / 8)
  end
  return cells
end

function Codec.layoutRows(dataCells, perRow)
  if perRow == nil then
    perRow = Codec.dataCellsPerRow((physicalSize()))
  end
  if perRow < 1 or perRow > MAX_CELLS_PER_ROW then
    return nil, "too_large"
  end
  local rowCount = math.max(1, math.ceil(#dataCells / perRow))
  if rowCount > MAX_ROWS then
    return nil, "too_large"
  end
  local counted = countCells(perRow)
  local rows = {}
  for k = 0, rowCount - 1 do
    local row = {}
    for i = 1, #ANCHOR do
      row[#row + 1] = ANCHOR[i]
    end
    for i = 1, COUNT_CELLS do
      row[#row + 1] = counted[i]
    end
    for i = 1, perRow do
      row[#row + 1] = dataCells[k * perRow + i] or 0
    end
    rows[#rows + 1] = row
  end
  return rows
end

function Codec.layoutGrid(dataCells, perRow)
  local rows, err = Codec.layoutRows(dataCells, perRow)
  if not rows then
    return nil, err
  end
  local grid = {}
  for _, row in ipairs(rows) do
    for _, cell in ipairs(row) do
      grid[#grid + 1] = cell
    end
  end
  return grid
end

local paintState = { textures = {} }

local function savedPosition()
  local saved = WoWCompanionDB and WoWCompanionDB.linePosition
  if saved == "bottom" then
    return "bottom"
  end
  return "top"
end

function Codec.position()
  return savedPosition()
end

local function placeTextures(rows, px, corner)
  local rowLength = #rows[1]
  local cellWidth = px
  local cellHeight = ROW_HEIGHT_PX * px
  local sign = corner == "BOTTOMLEFT" and 1 or -1
  local frame = paintState.frame
  for k, row in ipairs(rows) do
    for i = 1, #row do
      local n = (k - 1) * rowLength + i
      local texture = paintState.textures[n]
      if not texture then
        texture = frame:CreateTexture(nil, "ARTWORK")
        paintState.textures[n] = texture
      end
      texture:ClearAllPoints()
      texture:SetSize(cellWidth, cellHeight)
      texture:SetPoint(corner, frame, corner, (i - 1) * PITCH_PX * px, sign * (k - 1) * cellHeight)
    end
  end
end

local function colorTextures(rows)
  local rowLength = #rows[1]
  local shown = 0
  for k, row in ipairs(rows) do
    for i = 1, #row do
      local n = (k - 1) * rowLength + i
      local texture = paintState.textures[n]
      local cell = row[i]
      if cell == 0 then
        texture:Hide()
      else
        local color = COLOR_CHANNELS[cell + 1]
        texture:SetColorTexture(color[1], color[2], color[3])
        texture:Show()
      end
      shown = n
    end
  end
  for n = shown + 1, #paintState.textures do
    paintState.textures[n]:Hide()
  end
end

local function applyLayout()
  local frame = paintState.frame
  if not frame or not paintState.cells then
    return nil, "nothing_to_paint"
  end
  local width, height = physicalSize()
  local rows, err = Codec.layoutRows(paintState.cells, Codec.dataCellsPerRow(width))
  if not rows then
    frame:Hide()
    return nil, err
  end
  local px = PixelUtil.GetPixelToUIUnitFactor()
  local corner = savedPosition() == "bottom" and "BOTTOMLEFT" or "TOPLEFT"
  frame:SetScale(1 / UIParent:GetEffectiveScale())
  local key = table.concat({ width, height, corner, #rows, #rows[1], px }, ":")
  if paintState.geometryKey ~= key then
    paintState.geometryKey = key
    frame:ClearAllPoints()
    frame:SetPoint(corner, UIParent, corner, 0, 0)
    frame:SetSize(#rows[1] * PITCH_PX * px, MAX_ROWS * ROW_HEIGHT_PX * px)
    paintState.backing:ClearAllPoints()
    paintState.backing:SetPoint(corner, frame, corner, 0, 0)
    paintState.backing:SetSize(#rows[1] * PITCH_PX * px, #rows * ROW_HEIGHT_PX * px)
    placeTextures(rows, px, corner)
  end
  colorTextures(rows)
  paintState.backing:Show()
  frame:Show()
  return true
end

local function ensureFrame()
  if paintState.frame then
    return
  end
  local frame = CreateFrame("Frame", nil, UIParent)
  frame:SetFrameStrata("TOOLTIP")
  local backing = frame:CreateTexture(nil, "BACKGROUND")
  backing:SetColorTexture(0, 0, 0)
  for _, event in ipairs(GEOMETRY_EVENTS) do
    frame:RegisterEvent(event)
  end
  frame:SetScript("OnEvent", function()
    paintState.geometryKey = nil
    applyLayout()
  end)
  paintState.frame = frame
  paintState.backing = backing
end

function Codec.paint(cells)
  local width = physicalSize()
  local rows, err = Codec.layoutRows(cells, Codec.dataCellsPerRow(width))
  if not rows then
    Codec.hide()
    return nil, err
  end
  ensureFrame()
  paintState.cells = cells
  return applyLayout()
end

function Codec.hide()
  paintState.cells = nil
  if paintState.frame then
    paintState.frame:Hide()
  end
end

function Codec.setPosition(position)
  if position ~= "top" and position ~= "bottom" then
    return nil, "bad_position"
  end
  WoWCompanionDB = WoWCompanionDB or {}
  WoWCompanionDB.linePosition = position
  paintState.geometryKey = nil
  if paintState.frame and paintState.cells then
    applyLayout()
  end
  return true
end

Codec.TOTAL_PAYLOAD_MAX = TOTAL_PAYLOAD_MAX
