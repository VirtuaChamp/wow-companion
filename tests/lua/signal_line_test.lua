dofile("tests/lua/wow_stubs.lua")

local frames = {}

local function newObject(kind)
  local object = { kind = kind, shown = false, points = {}, textures = {}, events = {}, scripts = {} }
  function object:SetScale(scale)
    self.scale = scale
  end
  function object:SetSize(width, height)
    self.width = width
    self.height = height
  end
  function object:ClearAllPoints()
    self.points = {}
  end
  function object:SetPoint(point, relativeTo, relativePoint, x, y)
    self.points[#self.points + 1] = { point = point, relativeTo = relativeTo, relativePoint = relativePoint, x = x, y = y }
  end
  function object:SetFrameStrata(strata)
    self.strata = strata
  end
  function object:SetColorTexture(r, g, b)
    self.color = { r, g, b }
  end
  function object:Show()
    self.shown = true
  end
  function object:Hide()
    self.shown = false
  end
  function object:CreateTexture(_, layer)
    local texture = newObject("Texture")
    texture.layer = layer
    self.textures[#self.textures + 1] = texture
    return texture
  end
  function object:RegisterEvent(event)
    self.events[event] = true
  end
  function object:SetScript(name, fn)
    self.scripts[name] = fn
  end
  return object
end

_G.CreateFrame = function()
  local frame = newObject("Frame")
  frames[#frames + 1] = frame
  return frame
end

local effectiveScale = 1
_G.UIParent = { GetEffectiveScale = function() return effectiveScale end }
_G.WoWCompanionDB = nil

local ns = {}
assert(loadfile("addon/WoWCompanion/Codec.lua"))("WoWCompanion", ns)
local Codec = ns.Codec

local ANCHOR = { 7, 1, 6, 2, 5, 3, 7, 4, 6, 2, 5, 1 }

local function approx(a, b)
  return math.abs(a - b) < 1e-9
end

local function cellsOf(count)
  local cells = {}
  for i = 1, count do
    cells[i] = (i % 7) + 1
  end
  return cells
end

do
  Codec.hide()
  assert(#frames == 0, "hide before any paint creates nothing")
end

do
  effectiveScale = 0.75
  local cells = cellsOf(1000)
  assert(Codec.paint(cells) == true, "paint: 1000 cells fit at 1920 wide")
  local frame = frames[1]
  assert(frame.shown, "paint shows the line")
  assert(frame.strata == "TOOLTIP", "the line sits on the tooltip strata")
  assert(approx(frame.scale, 1 / 0.75), "frame scale is 1 / UIParent effective scale")
  local px = 768 / 1080
  local backing = frame.textures[1]
  assert(backing.layer == "BACKGROUND", "the first texture is the backing")
  assert(backing.color[1] == 0 and backing.color[2] == 0 and backing.color[3] == 0, "backing is solid black")
  assert(backing.shown, "backing shows with the line")
  assert(approx(backing.height, 2 * 2 * px), "backing covers the two painted rows")
  local first = frame.textures[2]
  assert(approx(first.width, px) and approx(first.height, 2 * px), "a cell is one pixel wide and two pixels tall in UI units")
  assert(first.points[1].point == "TOPLEFT" and first.points[1].x == 0 and first.points[1].y == 0, "the first cell sits at the top left")
  local second = frame.textures[3]
  assert(approx(second.points[1].x, 2 * px), "cells sit on a two pixel pitch (one pixel gap)")
  assert(first.color[1] == 1 and first.color[2] == 1 and first.color[3] == 1, "anchor cell 1 is white (colour 7)")
  assert(frame.points[1].point == "TOPLEFT" and frame.points[1].relativeTo == UIParent, "frame anchors to the top left of UIParent")
  local rowLength = 16 + 928
  local rowTwo = frame.textures[1 + rowLength + 1]
  assert(approx(rowTwo.points[1].y, -2 * px), "the second row sits two pixels below the first")
  local anchored = {}
  for i = 1, #ANCHOR do
    anchored[i] = frame.textures[1 + i].color
  end
  assert(anchored[2][3] == 1 and anchored[2][1] == 0, "anchor cell 2 is blue (colour 1)")
end

do
  local frame = frames[1]
  assert(frame.events.UI_SCALE_CHANGED and frame.events.DISPLAY_SIZE_CHANGED, "both geometry events are registered")
  effectiveScale = 0.5
  frame.scripts.OnEvent(frame, "UI_SCALE_CHANGED")
  assert(approx(frame.scale, 2), "UI_SCALE_CHANGED re-applies the counter scale")
  _G.WOWC_TEST_PHYSICAL_WIDTH = 2560
  _G.WOWC_TEST_PHYSICAL_HEIGHT = 1440
  effectiveScale = 0.6
  frame.scripts.OnEvent(frame, "DISPLAY_SIZE_CHANGED")
  assert(approx(frame.scale, 1 / 0.6), "DISPLAY_SIZE_CHANGED re-applies the counter scale")
  local px = 768 / 1440
  assert(approx(frame.textures[2].width, px), "DISPLAY_SIZE_CHANGED re-sizes the cells for the new screen")
  _G.WOWC_TEST_PHYSICAL_WIDTH = nil
  _G.WOWC_TEST_PHYSICAL_HEIGHT = nil
  effectiveScale = 1
  frame.scripts.OnEvent(frame, "DISPLAY_SIZE_CHANGED")
end

do
  local frame = frames[1]
  Codec.hide()
  assert(not frame.shown, "hide removes the line and its backing")
  local ok, err = Codec.paint(cellsOf(10))
  assert(ok == true and err == nil and frame.shown, "paint shows the line again")
  Codec.hide()
  frame.scripts.OnEvent(frame, "UI_SCALE_CHANGED")
  assert(not frame.shown, "a scale event while hidden keeps the line hidden")
end

do
  local frame = frames[1]
  assert(Codec.position() == "top", "the default line position is top")
  Codec.paint(cellsOf(10))
  assert(frame.points[1].point == "TOPLEFT", "top position anchors the top left")
  assert(Codec.setPosition("sideways") == nil, "an unknown position is refused")
  assert(Codec.setPosition("bottom") == true, "bottom is accepted")
  assert(WoWCompanionDB.linePosition == "bottom", "the choice is saved in WoWCompanionDB")
  assert(frame.shown, "switching at runtime keeps the line showing")
  assert(frame.points[1].point == "BOTTOMLEFT" and frame.points[1].relativePoint == "BOTTOMLEFT", "bottom position anchors the bottom left")
  local px = 768 / 1080
  assert(approx(frame.textures[2].points[1].y, 0), "the first row sits on the bottom edge")
  Codec.hide()
  Codec.paint(cellsOf(1000))
  local second = frame.textures[1 + 16 + 928 + 1]
  assert(approx(second.points[1].y, 2 * px), "the second row sits two pixels above the first")
  assert(Codec.setPosition("top") == true, "top is accepted")
  assert(frame.points[1].point == "TOPLEFT", "switching back moves the line to the top")
end

do
  WoWCompanionDB = { linePosition = "bottom" }
  assert(Codec.position() == "bottom", "the saved position is read when the line is next painted")
  WoWCompanionDB = nil
end

do
  local frame = frames[1]
  local ok, err = Codec.paint(cellsOf(928 * 3 + 1))
  assert(ok == nil and err == "too_large", "a payload above three rows is refused")
  assert(not frame.shown, "a refused paint leaves the line hidden")
end

do
  local function assertPixelExact(width, height, eff, position)
    _G.WOWC_TEST_PHYSICAL_WIDTH = width
    _G.WOWC_TEST_PHYSICAL_HEIGHT = height
    effectiveScale = eff
    WoWCompanionDB = { linePosition = position }
    local frame = frames[1]
    Codec.hide()
    local perRow = Codec.dataCellsPerRow(width)
    assert(Codec.paint(cellsOf(perRow + 200)) == true, "paint at " .. width .. "x" .. height)
    local rowLength = 16 + perRow
    local scale = frame.scale * eff * height / 768
    assert(approx(frame.scale, 1 / eff), "counter scale at " .. height)
    local checked = 0
    for k = 0, 1 do
      for i = 0, rowLength - 1 do
        local texture = frame.textures[2 + k * rowLength + i]
        local point = texture.points[1]
        local x = point.x * scale
        local y = (position == "top" and -point.y or point.y) * scale
        assert(math.abs(x - 2 * i) < 1e-6, ("cell x is a whole 2 px pitch at %dx%d: %f vs %d"):format(width, height, x, 2 * i))
        assert(math.abs(texture.width * scale - 1) < 1e-6, "a cell is one pixel wide at " .. height)
        assert(math.abs(y - 2 * k) < 1e-6, ("row %d starts %d px from the edge at %d: %f"):format(k, 2 * k, height, y))
        assert(math.abs(texture.height * scale - 2) < 1e-6, "a row is two pixels tall at " .. height)
        checked = checked + 1
      end
    end
    assert(checked == 2 * rowLength, "every cell of both rows was checked")
  end
  for _, size in ipairs({ { 1920, 1080 }, { 2560, 1440 }, { 1680, 1050 }, { 1920, 1200 }, { 1366, 768 }, { 3440, 1440 } }) do
    for _, position in ipairs({ "top", "bottom" }) do
      assertPixelExact(size[1], size[2], 0.7111, position)
      assertPixelExact(size[1], size[2], 1, position)
    end
  end
  _G.WOWC_TEST_PHYSICAL_WIDTH = nil
  _G.WOWC_TEST_PHYSICAL_HEIGHT = nil
  effectiveScale = 1
  WoWCompanionDB = nil
end

do
  local original = PixelUtil.GetPixelToUIUnitFactor
  local calls = 0
  PixelUtil.GetPixelToUIUnitFactor = function()
    calls = calls + 1
    return 0.5
  end
  Codec.hide()
  assert(Codec.paint(cellsOf(10)) == true, "paint with a stubbed pixel factor")
  assert(calls > 0, "the cell size comes from PixelUtil.GetPixelToUIUnitFactor")
  assert(approx(frames[1].textures[2].width, 0.5), "a cell is one pixel factor wide")
  assert(approx(frames[1].textures[2].height, 1.0), "a row is two pixel factors tall")
  PixelUtil.GetPixelToUIUnitFactor = original
  Codec.hide()
end

print("signal_line: all assertions passed")
