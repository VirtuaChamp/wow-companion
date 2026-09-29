local MOD = 2 ^ 32
local THRESHOLD = 2 ^ 31

local function normalize(n)
  return n % MOD
end

local function assertBelowThreshold(n, label)
  if n >= THRESHOLD then
    error("bit_shim: " .. label .. " out of range (>= 2^31), unverified above threshold", 0)
  end
end

local function tobits(n)
  n = normalize(n)
  local bits = {}
  for i = 1, 32 do
    bits[i] = n % 2
    n = (n - bits[i]) / 2
  end
  return bits
end

local function frombits(bits)
  local n = 0
  for i = 32, 1, -1 do
    n = n * 2 + bits[i]
  end
  return n
end

local function bitop(a, b, combine)
  assertBelowThreshold(a, "operand")
  assertBelowThreshold(b, "operand")
  local ba, bb = tobits(a), tobits(b)
  local result = {}
  for i = 1, 32 do
    result[i] = combine(ba[i], bb[i])
  end
  local n = frombits(result)
  assertBelowThreshold(n, "result")
  return n
end

local M = {}

function M.band(a, b)
  return bitop(a, b, function(x, y)
    return (x == 1 and y == 1) and 1 or 0
  end)
end

function M.bor(a, b)
  return bitop(a, b, function(x, y)
    return (x == 1 or y == 1) and 1 or 0
  end)
end

function M.bxor(a, b)
  return bitop(a, b, function(x, y)
    return (x ~= y) and 1 or 0
  end)
end

function M.lshift(a, n)
  assertBelowThreshold(a, "operand")
  local result = normalize(a * (2 ^ n))
  assertBelowThreshold(result, "result")
  return result
end

function M.rshift(a, n)
  assertBelowThreshold(a, "operand")
  local result = math.floor(normalize(a) / (2 ^ n))
  assertBelowThreshold(result, "result")
  return result
end

return M
