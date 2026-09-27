local M = {}

M.NULL = setmetatable({}, {})

local function isArray(t)
  local count = 0
  for _ in pairs(t) do
    count = count + 1
  end
  return count == #t
end

local function encodeString(s)
  local out = s:gsub('[%c"\\]', function(c)
    if c == "\\" then
      return "\\\\"
    end
    if c == '"' then
      return '\\"'
    end
    if c == "\n" then
      return "\\n"
    end
    if c == "\r" then
      return "\\r"
    end
    if c == "\t" then
      return "\\t"
    end
    return string.format("\\u%04x", string.byte(c))
  end)
  return '"' .. out .. '"'
end

function M.encode(value)
  if value == M.NULL then
    return "null"
  end
  local t = type(value)
  if t == "nil" then
    return "null"
  end
  if t == "string" then
    return encodeString(value)
  end
  if t == "number" then
    return tostring(value)
  end
  if t == "boolean" then
    return value and "true" or "false"
  end
  if t == "table" then
    if isArray(value) then
      local parts = {}
      for i = 1, #value do
        parts[i] = M.encode(value[i])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for k in pairs(value) do
      keys[#keys + 1] = k
    end
    table.sort(keys, function(a, b)
      return tostring(a) < tostring(b)
    end)
    local parts = {}
    for _, k in ipairs(keys) do
      parts[#parts + 1] = encodeString(tostring(k)) .. ":" .. M.encode(value[k])
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  error("cannot encode value of type " .. t)
end

return M
