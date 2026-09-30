local outDir = assert(arg[1], "usage: paint_to_pixels.lua <outDir> <payloadLen> <seq> <width> <height> <effScale> <position>")
local payloadLen = tonumber(assert(arg[2]))
local seq = tonumber(assert(arg[3]))
local width = tonumber(assert(arg[4]))
local height = tonumber(assert(arg[5]))
local effScale = tonumber(assert(arg[6]))
local position = assert(arg[7])

local loadCodec = dofile("tests/lua/codec/load_codec.lua")
local Codec = loadCodec()

local function newObject()
  local object = { shown = false, points = {}, textures = {}, scripts = {}, events = {} }
  function object:SetScale(scale)
    self.scale = scale
  end
  function object:SetSize(w, h)
    self.width = w
    self.height = h
  end
  function object:ClearAllPoints()
    self.points = {}
  end
  function object:SetPoint(point, relativeTo, relativePoint, x, y)
    self.points[#self.points + 1] = { point = point, relativeTo = relativeTo, relativePoint = relativePoint, x = x, y = y }
  end
  function object:SetFrameStrata() end
  function object:SetColorTexture(r, g, b)
    self.color = { r, g, b }
  end
  function object:Show()
    self.shown = true
  end
  function object:Hide()
    self.shown = false
  end
  function object:CreateTexture()
    local texture = newObject()
    self.textures[#self.textures + 1] = texture
    return texture
  end
  function object:RegisterEvent() end
  function object:SetScript() end
  return object
end

local frames = {}
_G.CreateFrame = function()
  local frame = newObject()
  frames[#frames + 1] = frame
  return frame
end
_G.UIParent = { GetEffectiveScale = function() return effScale end }
_G.WOWC_TEST_PHYSICAL_WIDTH = width
_G.WOWC_TEST_PHYSICAL_HEIGHT = height
_G.WoWCompanionDB = { linePosition = position }

local payloadBytes = {}
for i = 1, payloadLen do
  payloadBytes[i] = string.char((i - 1) % 256)
end

local frameList, err = Codec.toFrames(table.concat(payloadBytes), seq)
if not frameList then
  local file = assert(io.open(outDir .. "/error.txt", "w"))
  file:write(err)
  file:close()
  os.exit(0)
end

local pixelsPerUnit = height / 768

for index, frame in ipairs(frameList) do
  assert(Codec.paint(Codec.render(frame)), "paint refused frame " .. index)
  local root = frames[1]
  assert(root.shown, "the line is shown after paint")
  local scale = root.scale * effScale * pixelsPerUnit
  local file = assert(io.open(outDir .. "/frame-" .. (index - 1) .. ".rects", "w"))
  file:write(position, "\n")
  for _, texture in ipairs(root.textures) do
    if texture.shown and texture.color and (texture.color[1] + texture.color[2] + texture.color[3]) > 0 then
      local point = texture.points[1]
      local cell = texture.color[1] * 4 + texture.color[2] * 2 + texture.color[3]
      local top = point.point == "TOPLEFT"
      local x = point.x * scale
      local y = (top and -point.y or point.y) * scale
      file:write(string.format("%.9f %.9f %.9f %.9f %d\n", x, y, texture.width * scale, texture.height * scale, cell))
    end
  end
  file:close()
end

local meta = assert(io.open(outDir .. "/meta.txt", "w"))
meta:write(tostring(#frameList))
meta:close()
os.exit(0)
