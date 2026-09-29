dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {} }
ns.Transport.session = function()
  return "sessionA"
end
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end

local aiWindowChunk = assert(loadfile("addon/WoWCompanion/AiWindow.lua"))
aiWindowChunk("WoWCompanion", ns)

local first = ns.AiWindow.create()
assert(first ~= nil, "window frame created")
assert(first.TitleContainer.TitleText:GetText() == "Claude", "window titled Claude")
assert(first:IsShown() == false, "window starts hidden until shown")

local second = ns.AiWindow.create()
assert(second == first, "create is idempotent: no second window is created on reload")

first:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 55, -40)
first:SetSize(500, 360)
first:Fire("OnDragStop")

assert(WoWCompanionDB.window ~= nil, "window position is kept in WoWCompanionDB")
assert(WoWCompanionDB.window.point == "TOPLEFT", "saved anchor point")
assert(WoWCompanionDB.window.x == 55, "saved x position")
assert(WoWCompanionDB.window.width == 500, "saved width")
assert(WoWCompanionDB.window.height == 360, "saved height")

local ns2 = {}
ns2.Transport = { sent = {} }
function ns2.Transport.send(msg)
  table.insert(ns2.Transport.sent, msg)
end

local aiWindowChunk2 = assert(loadfile("addon/WoWCompanion/AiWindow.lua"))
aiWindowChunk2("WoWCompanion", ns2)

local reloaded = ns2.AiWindow.create()
local point, _, _, x, y = reloaded:GetPoint(1)
assert(point == "TOPLEFT", "reload restores the saved anchor point")
assert(x == 55, "reload restores the saved x position")
assert(y == -40, "reload restores the saved y position")
assert(reloaded:GetWidth() == 500, "reload restores the saved width")
assert(reloaded:GetHeight() == 360, "reload restores the saved height")

local gear = ns2.AiWindow.gearButton
assert(gear.normalAtlas == "questlog-icon-setting", "the gear button uses Blizzard's settings atlas, not a text glyph")
assert(gear.highlightAtlas == "questlog-icon-setting", "the gear highlight uses the same atlas")
assert(gear.highlightBlendMode == "ADD", "the gear highlight blends additively")

local grip = ns2.AiWindow.resizeGrip
assert(grip.template == "PanelResizeButtonTemplate", "the resize grip is Blizzard's PanelResizeButtonTemplate")
assert(grip.target == reloaded, "the grip resizes the window frame")
assert(grip.resizeLimits[1] == 280 and grip.resizeLimits[3] == 900, "the grip carries the window's size limits")
grip:Fire("OnMouseDown")
assert(reloaded.sizing == "BOTTOMRIGHT", "pressing the grip starts sizing the window from its bottom right")
reloaded:SetSize(610, 410)
grip:Fire("OnMouseUp")
assert(reloaded.sizing == false, "releasing the grip stops sizing")
assert(WoWCompanionDB.window.width == 610, "releasing the grip saves the new width")
assert(WoWCompanionDB.window.height == 410, "releasing the grip saves the new height")

assert(reloaded.portraitShown == false, "the empty portrait ring is hidden through ButtonFrameTemplate_HidePortrait")
assert(reloaded.border == "ButtonFrameTemplateNoPortrait", "the portrait-less border layout is applied")
local _, _, _, insetLeft = reloaded.Inset:GetPointByName("TOPLEFT")
assert(insetLeft == 9, "the inset takes the portrait-less left offset Blizzard sets")
local _, _, _, titleLeft = reloaded.TitleContainer:GetPointByName("TOPLEFT")
assert(titleLeft == 0, "the title container is re-anchored to the left edge, no portrait gap")

local INSET_TOP = -60
local TITLE_BOTTOM = -21

local log = ns2.AiWindow.scrollFrame
assert(log.justifyH == "LEFT", "the log is left-justified like a chat frame")
assert(log.indentedWordWrap == true, "wrapped log lines hang-indent like a chat frame")
local logTopLeft = { log:GetPointByName("TOPLEFT") }
local logBottomRight = { log:GetPointByName("BOTTOMRIGHT") }
assert(logTopLeft[2] == reloaded.Inset and logBottomRight[2] == reloaded.Inset, "the log is anchored inside the inset frame")
assert(logTopLeft[4] > 0 and logTopLeft[5] < 0, "the log is padded from the inset's left and top edges")
assert(logBottomRight[4] < 0 and logBottomRight[5] > 0, "the log is padded from the inset's right and bottom edges")

local dropdownPoint, dropdownTo, _, dropdownX, dropdownY = ns2.AiWindow.dropdown:GetPointByName("TOPLEFT")
assert(dropdownPoint == "TOPLEFT" and dropdownTo == reloaded, "the chats dropdown hangs from the window's top left")
assert(dropdownX > 0 and dropdownX <= 12, "the dropdown sits at the left edge, not pushed right of a portrait")
assert(dropdownY <= TITLE_BOTTOM and dropdownY > INSET_TOP, "the dropdown sits in the header band between the title bar and the inset")

local gearPoint, gearTo, gearRelative, gearX, gearY = gear:GetPointByName("RIGHT")
assert(gearPoint == "RIGHT" and gearTo == reloaded.CloseButton, "the gear is anchored to the close button")
assert(gearRelative == "LEFT" and gearX < 0 and gearY == 0, "the gear sits left of the close button with a gap, never over it")
assert(gear:GetFrameLevel() >= reloaded.CloseButton:GetFrameLevel(), "the gear is raised above the frame border art")

local input = ns2.AiWindow.inputBox
local inputLeft = { input:GetPointByName("BOTTOMLEFT") }
local inputRight = { input:GetPointByName("BOTTOMRIGHT") }
local GRIP_SIZE = 16
local CAP_OVERHANG = 5
local MIN_GRIP_CLEARANCE = 4
local _, _, _, insetBottomRightX, insetBottomOffset = reloaded.Inset:GetPointByName("BOTTOMRIGHT")
assert(inputLeft[2] == reloaded.Inset and inputRight[2] == reloaded.Inset, "the input line is anchored to the inset, like the log")
local inputBottomFromWindow = insetBottomOffset + inputLeft[5]
assert(
  inputBottomFromWindow >= 0 and inputBottomFromWindow + input:GetHeight() <= insetBottomOffset,
  "the input line fits the strip below the inset"
)
assert(inputLeft[4] - CAP_OVERHANG == logTopLeft[4], "the input's visible left cap lines up with the log text")
local gripPoint, _, _, gripX = grip:GetPointByName("BOTTOMRIGHT")
assert(gripPoint == "BOTTOMRIGHT", "the resize grip sits at the window's bottom right")
local gripLeftEdge = gripX - GRIP_SIZE
local inputRightEdge = insetBottomRightX + inputRight[4]
assert(gripLeftEdge - inputRightEdge >= MIN_GRIP_CLEARANCE, "the input's right cap stays clear of the resize grip")
assert(input:GetTextInsets() >= 10, "the input text is inset from the field's rounded cap")

local gearInsets = gear.hitRectInsets
assert(
  gearInsets[1] <= -4 and gearInsets[2] <= -4 and gearInsets[3] <= -4 and gearInsets[4] <= -4,
  "the gear's hit area grows by at least 4 px on every side, close to the close button's"
)
assert(gear:GetWidth() - gearInsets[1] - gearInsets[2] >= 23, "the gear's hit width approaches the close button's 24")
assert(-gearX >= -gearInsets[2], "the gear's widened hit area never reaches into the close button's")

local function relativeLuminance(r, g, b)
  local function channel(c)
    if c <= 0.03928 then
      return c / 12.92
    end
    return ((c + 0.055) / 1.055) ^ 2.4
  end
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
end
local INSET_BRIGHTEST = { 24 / 255, 21 / 255, 24 / 255 }
ns2.AiWindow.onProgress({ status = "thinking" })
local thinking = ns2.AiWindow.scrollFrame.messages[#ns2.AiWindow.scrollFrame.messages]
local grayR, grayG, grayB = GRAY_FONT_COLOR:GetRGB()
assert(thinking.text == "[Claude] thinking", "the progress line is the thinking status")
assert(thinking.r == grayR and thinking.g == grayG and thinking.b == grayB, "the status line uses Blizzard's GRAY_FONT_COLOR")
local textLuminance = relativeLuminance(thinking.r, thinking.g, thinking.b)
local backgroundLuminance = relativeLuminance(INSET_BRIGHTEST[1], INSET_BRIGHTEST[2], INSET_BRIGHTEST[3])
assert((textLuminance + 0.05) / (backgroundLuminance + 0.05) >= 4.5, "the status line reads at 4.5:1 on the brightest inset sample")

assert(log.fading == false, "the log never fades its lines out")
assert(log.maxLines == 200, "the log keeps as many lines as the companion's per-chat history")
assert(log.mouseWheelEnabled == true, "the log takes the mouse wheel")
log.scrollLog = {}
log:Fire("OnMouseWheel", 1)
log:Fire("OnMouseWheel", -1)
assert(log.scrollLog[1] == "up" and log.scrollLog[2] == "down", "the wheel scrolls the log one line up and down")
_G.WOWC_TEST_SHIFT_DOWN = true
log:Fire("OnMouseWheel", 1)
log:Fire("OnMouseWheel", -1)
_G.WOWC_TEST_SHIFT_DOWN = false
assert(log.scrollLog[3] == "pageup" and log.scrollLog[4] == "pagedown", "shift with the wheel pages the log")

ns2.AiWindow.openMoreBox("full reply text")
local more = ns2.AiWindow.moreBox
assert(more.portraitShown == false, "the full-reply box hides the empty portrait ring too")
assert(more.border == "ButtonFrameTemplateNoPortrait", "the full-reply box uses the portrait-less border layout")

print("aiwindow.create: all assertions passed")
