local loadCodec = dofile("tests/lua/codec/load_codec.lua")
local Codec = loadCodec()

local function readU16(bytes, offset)
  return string.byte(bytes, offset) * 256 + string.byte(bytes, offset + 1)
end

local function assertHeader(frame, expectSeq, expectTotal, expectIndex, expectLength)
  assert(string.byte(frame, 1) == 0x57, "magic byte 1")
  assert(string.byte(frame, 2) == 0x43, "magic byte 2")
  assert(string.byte(frame, 3) == 1, "version")
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

do
  local grid = Codec.layoutGrid({})
  assert(#grid == 256, "layoutGrid: empty data still emits the sync row plus one data row")
  for i = 0, 125 do
    assert(grid[i + 1] == i % 8, "layoutGrid: sync pattern cell " .. i)
  end
  assert(grid[127] == 0, "layoutGrid: row count high cell for 1 row")
  assert(grid[128] == 1, "layoutGrid: row count low cell for 1 row")
end

do
  local dataCells = {}
  for i = 1, 300 do
    dataCells[i] = i % 8
  end
  local grid = Codec.layoutGrid(dataCells)
  local expectedRows = math.ceil(300 / 128)
  assert(#grid == 128 + expectedRows * 128, "layoutGrid: total cells for 300 data cells")
  assert(grid[127] == math.floor(expectedRows / 8) % 8, "layoutGrid: row count high cell")
  assert(grid[128] == expectedRows % 8, "layoutGrid: row count low cell")
  for i = 1, 300 do
    assert(grid[128 + i] == dataCells[i], "layoutGrid: data cell " .. i .. " preserved")
  end
  for i = 301, expectedRows * 128 do
    assert(grid[128 + i] == 0, "layoutGrid: padding cell " .. i .. " is zero")
  end
end

do
  local exactData = {}
  for i = 1, 63 * 128 do
    exactData[i] = 1
  end
  local grid, err = Codec.layoutGrid(exactData)
  assert(grid ~= nil, "layoutGrid: exactly 63 data rows produces a grid")
  assert(err == nil, "layoutGrid: exactly 63 data rows reports no error")
  assert(#grid == 128 + 63 * 128, "layoutGrid: exactly 63 data rows sizes the grid correctly")
end

do
  local oversizedData = {}
  for i = 1, 63 * 128 + 1 do
    oversizedData[i] = 1
  end
  local grid, err = Codec.layoutGrid(oversizedData)
  assert(grid == nil, "layoutGrid: 64 data rows produces no grid")
  assert(err == "too_large", "layoutGrid: 64 data rows reports too_large")
end

print("codec: all assertions passed")
