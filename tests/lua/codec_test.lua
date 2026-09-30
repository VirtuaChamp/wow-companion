local loadCodec = dofile("tests/lua/codec/load_codec.lua")
local Codec = loadCodec()

local function readU16(bytes, offset)
  return string.byte(bytes, offset) * 256 + string.byte(bytes, offset + 1)
end

local function assertHeader(frame, expectSeq, expectTotal, expectIndex, expectLength)
  assert(string.byte(frame, 1) == 0x57, "magic byte 1")
  assert(string.byte(frame, 2) == 0x43, "magic byte 2")
  assert(string.byte(frame, 3) == 2, "version")
  assert(readU16(frame, 4) == expectSeq, "seq")
  assert(string.byte(frame, 6) == expectTotal, "total")
  assert(string.byte(frame, 7) == expectIndex, "index")
  assert(readU16(frame, 8) == expectLength, "length")
  assert(#frame == 9 + expectLength + 2, "frame length")
end

do
  local frames, err = Codec.toFrames("", 7)
  assert(err == nil, "empty payload: no error")
  assert(#frames == 1, "empty payload: one frame")
  assertHeader(frames[1], 7, 1, 0, 0)
end

do
  local payload = string.rep("a", 500)
  local frames = Codec.toFrames(payload, 1)
  assert(#frames == 1, "500-byte payload: one frame")
  assertHeader(frames[1], 1, 1, 0, 500)
end

do
  local payload = string.rep("b", 2500)
  local frames = Codec.toFrames(payload, 42)
  assert(#frames == 3, "2500-byte payload: three frames")
  assertHeader(frames[1], 42, 3, 0, 1024)
  assertHeader(frames[2], 42, 3, 1, 1024)
  assertHeader(frames[3], 42, 3, 2, 452)
  local rebuilt = string.sub(frames[1], 10, 9 + 1024)
    .. string.sub(frames[2], 10, 9 + 1024)
    .. string.sub(frames[3], 10, 9 + 452)
  assert(rebuilt == payload, "2500-byte payload: chunks concatenate back to original")
end

do
  local oversized = string.rep("x", Codec.TOTAL_PAYLOAD_MAX + 1)
  local frames, err = Codec.toFrames(oversized, 1)
  assert(frames == nil, "16KB+1 payload: no frames")
  assert(err == "too_large", "16KB+1 payload: too_large")
end

do
  local frame = "\1\2\3\4\5\6\7\8"
  local cells = Codec.render(frame)
  assert(#cells == 22, "render: 8 bytes (64 bits) needs 22 cells")
  for _, cell in ipairs(cells) do
    assert(cell >= 0 and cell <= 7, "render: cell in 0..7")
  end
end

do
  local cells = Codec.render("")
  assert(#cells == 0, "render: empty frame has no cells")
end

do
  local json = Codec.encodeJson({})
  assert(json == "[]", "empty table encodes as []")
end

do
  local json = Codec.encodeJson({ 1, 2, 3 })
  assert(json == "[1,2,3]", "array table encodes as JSON array")
end

do
  local json = Codec.encodeJson({ a = 1, b = "two" })
  assert(json == '{"a":1,"b":"two"}', "object table encodes as JSON object, sorted keys")
end

do
  local json = Codec.encodeJson({ t = "ask", mentions = {} })
  assert(json == '{"mentions":[],"t":"ask"}', "empty nested table encodes as []")
end

do
  local json = Codec.encodeJson('quote:"\\back\nline')
  assert(json == '"quote:\\"\\\\back\\nline"', "string escaping")
end

do
  local json = Codec.encodeJson(true)
  assert(json == "true", "boolean true")
  json = Codec.encodeJson(false)
  assert(json == "false", "boolean false")
end

do
  local frames, err = Codec.encode({})
  assert(err == nil, "encode: no error")
  assert(#frames == 1, "encode: one frame for empty table")
  assertHeader(frames[1], 0, 1, 0, 2)
end

do
  local json = Codec.encodeJson(2147483648)
  assert(json == "2147483648", "integer beyond 2^31 encodes exactly, no Win64 %d truncation")
end

do
  local json = Codec.encodeJson(-2147483649)
  assert(json == "-2147483649", "negative integer beyond -2^31 encodes exactly")
end

do
  local ok = pcall(Codec.encodeJson, 0 / 0)
  assert(not ok, "NaN raises an error instead of encoding invalid JSON")
end

do
  local ok = pcall(Codec.encodeJson, 1 / 0)
  assert(not ok, "positive infinity raises an error instead of encoding invalid JSON")
end

do
  local ok = pcall(Codec.encodeJson, -1 / 0)
  assert(not ok, "negative infinity raises an error instead of encoding invalid JSON")
end

do
  local frames, err = Codec.encode({ money = 0 / 0 })
  assert(frames == nil, "encode: NaN in payload returns no frames")
  assert(type(err) == "string", "encode: NaN in payload returns an error string")
end

do
  local frames, err = Codec.encode({ nested = { deep = 1 / 0 } })
  assert(frames == nil, "encode: infinity nested in the payload returns no frames")
  assert(type(err) == "string", "encode: infinity nested in the payload returns an error string")
end

do
  local json = Codec.encodeJson({ [1] = "a", x = "b" })
  assert(json == '{"1":"a","x":"b"}', "mixed number/string keys sort without crashing table.sort")
end

local ANCHOR = { 7, 1, 6, 2, 5, 3, 7, 4, 6, 2, 5, 1 }
local OVERHEAD = 16

local function assertRowHead(grid, offset, perRow, label)
  for i = 1, #ANCHOR do
    assert(grid[offset + i] == ANCHOR[i], label .. ": anchor cell " .. i)
  end
  local counted = grid[offset + 13] * 512 + grid[offset + 14] * 64 + grid[offset + 15] * 8 + grid[offset + 16]
  assert(counted == perRow, label .. ": row cell count")
end

do
  local grid = Codec.layoutGrid({}, 100)
  assert(#grid == OVERHEAD + 100, "layoutGrid: empty data still emits one row")
  assertRowHead(grid, 0, 100, "empty")
  for i = OVERHEAD + 1, #grid do
    assert(grid[i] == 0, "layoutGrid: empty row data is zero padded")
  end
end

do
  local dataCells = {}
  for i = 1, 250 do
    dataCells[i] = i % 8
  end
  local grid = Codec.layoutGrid(dataCells, 100)
  assert(#grid == 3 * (OVERHEAD + 100), "layoutGrid: 250 cells at 100 per row make 3 rows")
  for k = 0, 2 do
    assertRowHead(grid, k * (OVERHEAD + 100), 100, "row " .. k)
  end
  for i = 1, 250 do
    local k = math.floor((i - 1) / 100)
    local within = (i - 1) % 100
    assert(grid[k * (OVERHEAD + 100) + OVERHEAD + within + 1] == dataCells[i], "layoutGrid: data cell " .. i)
  end
  for i = 251, 300 do
    local k = math.floor((i - 1) / 100)
    local within = (i - 1) % 100
    assert(grid[k * (OVERHEAD + 100) + OVERHEAD + within + 1] == 0, "layoutGrid: padding cell " .. i)
  end
end

do
  local exact = {}
  for i = 1, 300 do
    exact[i] = 1
  end
  local grid, err = Codec.layoutGrid(exact, 100)
  assert(grid ~= nil and err == nil, "layoutGrid: exactly three rows fit")
  local oversized = {}
  for i = 1, 301 do
    oversized[i] = 1
  end
  local none, tooLarge = Codec.layoutGrid(oversized, 100)
  assert(none == nil and tooLarge == "too_large", "layoutGrid: a fourth row is too_large")
end

do
  assert(Codec.dataCellsPerRow(1920) == 928, "1920 wide: 928 data cells per row")
  assert(Codec.dataCellsPerRow(2560) == 1248, "2560 wide: 1248 data cells per row")
  assert(Codec.dataCellsPerRow(1000) == 468, "1000 wide: 468 data cells per row")
  assert(math.floor(928 * 3 * 3 / 8) == 1044, "1920 wide: 1044 bytes per frame")
  assert(math.floor(1248 * 3 * 3 / 8) == 1404, "2560 wide: 1404 bytes per frame")
  assert(Codec.framePayloadMax(1920) == 1024, "1920 wide: payload capped at 1024")
  assert(Codec.framePayloadMax(2560) == 1024, "2560 wide: payload capped at 1024")
  assert(Codec.framePayloadMax(1000) == math.floor(468 * 9 / 8) - 11, "narrow screens shrink the payload")
end

do
  local payload = string.rep("x", 3000)
  local frames = Codec.toFrames(payload, 3, Codec.framePayloadMax(1280))
  local cap = Codec.framePayloadMax(1280)
  assert(cap < 1024, "1280 wide: payload below the hard cap")
  assert(#frames == math.ceil(3000 / cap), "toFrames honours the width-derived payload size")
  for _, frame in ipairs(frames) do
    local cells = Codec.render(frame)
    local grid = Codec.layoutGrid(cells, Codec.dataCellsPerRow(1280))
    assert(grid ~= nil, "every frame fits three rows at the width it was sized for")
  end
end

do
  local frames, err = Codec.toFrames(string.rep("x", 255), 1, 1)
  assert(err == nil and #frames == 255, "255 frames still fit the one byte frame count")
  local none, tooMany = Codec.toFrames(string.rep("x", 256), 1, 1)
  assert(none == nil and tooMany == "too_large", "256 frames do not fit the frame count byte and are refused, not raised")
end

print("codec: all assertions passed")
