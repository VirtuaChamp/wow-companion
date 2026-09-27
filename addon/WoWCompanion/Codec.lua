local _, ns = ...

local Codec = {}
ns.Codec = Codec

local MAGIC_1 = 0x57
local MAGIC_2 = 0x43
local VERSION = 1
local FRAME_PAYLOAD_MAX = 1024
local TOTAL_PAYLOAD_MAX = 16384
local CRC_INIT = 0xFFFF
local CRC_POLY = 0x1021
local CRC_MASK = 0xFFFF

local GRID_WIDTH = 128
local GRID_SYNC_PATTERN_CELLS = 126
local GRID_MAX_DATA_ROWS = 63

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

function Codec.toFrames(payload, seq)
  if #payload > TOTAL_PAYLOAD_MAX then
    return nil, "too_large"
  end
  local total = math.max(1, math.ceil(#payload / FRAME_PAYLOAD_MAX))
  local frames = {}
  for index = 0, total - 1 do
    local chunkStart = index * FRAME_PAYLOAD_MAX + 1
    local chunkEnd = math.min(#payload, chunkStart + FRAME_PAYLOAD_MAX - 1)
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

function Codec.layoutGrid(dataCells)
  local dataRows = math.max(1, math.ceil(#dataCells / GRID_WIDTH))
  if dataRows > GRID_MAX_DATA_ROWS then
    return nil, "too_large"
  end
  local grid = {}
  for i = 0, GRID_SYNC_PATTERN_CELLS - 1 do
    grid[#grid + 1] = i % 8
  end
  grid[#grid + 1] = math.floor(dataRows / 8) % 8
  grid[#grid + 1] = dataRows % 8
  for i = 1, dataRows * GRID_WIDTH do
    grid[#grid + 1] = dataCells[i] or 0
  end
  return grid
end

local paintState = {}

function Codec.paint(cells)
  local grid, err = Codec.layoutGrid(cells)
  if not grid then
    return nil, err
  end
  if not paintState.frame then
    paintState.frame = CreateFrame("Frame", nil, UIParent)
    paintState.frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
    paintState.frame:SetSize(GRID_WIDTH * 4, (GRID_MAX_DATA_ROWS + 1) * 4)
    paintState.frame:SetFrameStrata("TOOLTIP")
    paintState.textures = {}
  end
  local _, screenHeight = GetPhysicalScreenSize()
  local scale = 768 / (screenHeight * UIParent:GetEffectiveScale())
  paintState.frame:SetScale(scale)
  for i, cell in ipairs(grid) do
    local texture = paintState.textures[i]
    if not texture then
      texture = paintState.frame:CreateTexture(nil, "ARTWORK")
      texture:SetSize(4, 4)
      paintState.textures[i] = texture
    end
    local row = math.floor((i - 1) / GRID_WIDTH)
    local col = (i - 1) % GRID_WIDTH
    texture:SetPoint("TOPLEFT", paintState.frame, "TOPLEFT", col * 4, -row * 4)
    local color = COLOR_CHANNELS[cell + 1]
    texture:SetColorTexture(color[1], color[2], color[3])
    texture:Show()
  end
  for i = #grid + 1, #paintState.textures do
    paintState.textures[i]:Hide()
  end
  return true
end

Codec.TOTAL_PAYLOAD_MAX = TOTAL_PAYLOAD_MAX
