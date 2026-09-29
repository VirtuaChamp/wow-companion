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
assert(grip.resizeLimits[1] == 480 and grip.resizeLimits[3] == 1100, "the grip carries the window's size limits")
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

assert(reloaded.TopTileStreaks:IsShown() == false, "the empty header band is hidden: no dropdown sits in it any more")
local _, _, _, atticInsetTop = reloaded.Inset:GetPointByName("TOPLEFT")
assert(atticInsetTop == 9, "the inset keeps the portrait-less left offset after the attic is hidden first")
local _, _, _, _, insetTopY = reloaded.Inset:GetPointByName("TOPLEFT")
assert(insetTopY == -24, "the inset starts right under the title bar once the attic is hidden")
assert(_G.WoWCompanionAiWindowChats == nil, "the chats dropdown is gone")

local sidebar = ns2.AiWindow.sidebar
assert(sidebar.template == "InsetFrameTemplate", "the chat sidebar sits in a Blizzard inset")
assert(sidebar:GetWidth() == 168, "the sidebar is 140 px at Small and 168 px at the default Normal size")
local sideTopLeft = { sidebar:GetPointByName("TOPLEFT") }
local sideBottomLeft = { sidebar:GetPointByName("BOTTOMLEFT") }
assert(sideTopLeft[2] == reloaded.Inset and sideBottomLeft[2] == reloaded.Inset, "the sidebar hangs from the window inset")
assert(sideTopLeft[4] == 0 and sideTopLeft[5] == 0, "the sidebar starts at the inset's top left corner")
local newChat = ns2.AiWindow.newChatButton
assert(newChat.template == "UIPanelButtonTemplate", "New chat is a Blizzard button template")
assert(newChat:GetText() == "New chat", "the button reads New chat")
assert(newChat.parent == sidebar, "New chat sits at the top of the sidebar")
local chatList = ns2.AiWindow.sidebarBox
assert(chatList.template == "WowScrollBoxList", "the chat list is a Blizzard ScrollBox list")
local listTop = { chatList:GetPointByName("TOPLEFT") }
assert(listTop[2] == newChat, "the chat list starts under the New chat button")

local box = ns2.AiWindow.messageBox
assert(box.template == "WowScrollBoxList", "the message list is a Blizzard ScrollBox list")
assert(box.view.extentCalculator ~= nil, "bubble heights come from the view's element extent calculator")
assert(box.view.elementExtent == nil, "bubbles have no fixed extent")
local boxTopLeft = { box:GetPointByName("TOPLEFT") }
local boxBottomRight = { box:GetPointByName("BOTTOMRIGHT") }
assert(boxTopLeft[2] == sidebar and boxTopLeft[3] == "TOPRIGHT", "the message list starts right of the sidebar")
assert(boxBottomRight[2] == reloaded.Inset, "the message list ends at the window inset")
assert(boxTopLeft[4] > 0 and boxTopLeft[5] < 0, "the message list is padded from the sidebar and the top")
assert(boxBottomRight[4] < 0 and boxBottomRight[5] > 0, "the message list is padded from the right and the bottom")

local INSET_TOP = -24
local TITLE_BOTTOM = -21

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
assert(inputLeft[2] == sidebar and inputLeft[3] == "BOTTOMRIGHT", "the input line starts right of the sidebar")
assert(inputRight[2] == reloaded.Inset, "the input line ends at the inset, like the message list")
local sidebarBottomFromWindow = insetBottomOffset + sideBottomLeft[5]
local inputBottomFromWindow = sidebarBottomFromWindow + inputLeft[5]
assert(
  inputBottomFromWindow >= 0 and inputBottomFromWindow + input:GetHeight() <= insetBottomOffset,
  "the input line fits the strip below the inset"
)
assert(inputLeft[4] - CAP_OVERHANG == boxTopLeft[4], "the input's visible left cap lines up with the message list")
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
box:SetSize(500, 300)
ns2.AiWindow.onProgress({ id = "ask-1", chat = "default", status = "thinking" })
local entries = ns2.AiWindow.entries()
local thinking = entries[#entries]
assert(thinking.kind == "status", "the progress line is a status line, not a bubble")
assert(thinking.display == "Claude \194\183 thinking\226\128\166", "the status line names the provider and says thinking")
local statusRow = box:GetVisibleFrames()[#entries]
assert(statusRow.bubble:IsShown() == false, "a status line draws no bubble")
local grayR, grayG, grayB = GRAY_FONT_COLOR:GetRGB()
local lineColor = statusRow.line.textColor
assert(lineColor.r == grayR and lineColor.g == grayG and lineColor.b == grayB, "the status line uses Blizzard's GRAY_FONT_COLOR")
local textLuminance = relativeLuminance(lineColor.r, lineColor.g, lineColor.b)
local backgroundLuminance = relativeLuminance(INSET_BRIGHTEST[1], INSET_BRIGHTEST[2], INSET_BRIGHTEST[3])
assert((textLuminance + 0.05) / (backgroundLuminance + 0.05) >= 4.5, "the status line reads at 4.5:1 on the brightest inset sample")

assert(box.wheelLog ~= nil and box.scripts.OnMouseWheel ~= nil, "the message list takes the mouse wheel")
box:Fire("OnMouseWheel", 1)
box:Fire("OnMouseWheel", -1)
assert(box.wheelLog[1] == 1 and box.wheelLog[2] == -1, "the wheel scrolls the list through the ScrollBox's own handler")
_G.WOWC_TEST_SHIFT_DOWN = true
box:Fire("OnMouseWheel", 1)
box:Fire("OnMouseWheel", -1)
_G.WOWC_TEST_SHIFT_DOWN = false
assert(#box.wheelLog == 2, "shift with the wheel does not use the single-step handler")
assert(box.pageLog[1].direction == ScrollControllerMixin.Directions.Decrease, "shift and wheel up pages up")
assert(box.pageLog[2].direction == ScrollControllerMixin.Directions.Increase, "shift and wheel down pages down")
assert(box.pageLog[1].percentage == box:GetVisibleExtentPercentage(), "a page is one visible extent")

local narrow = {}
narrow.Transport = { sent = {} }
function narrow.Transport.send() end
WoWCompanionDB.window = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0, width = 300, height = 100 }
assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", narrow)
local clamped = narrow.AiWindow.create()
assert(clamped:GetWidth() == 480 and clamped:GetHeight() == 240, "a saved size below the new bounds is clamped up to them")
WoWCompanionDB.window = { point = "CENTER", relativePoint = "CENTER", x = 0, y = 0, width = 5000, height = 5000 }
local wide = {}
wide.Transport = { sent = {} }
function wide.Transport.send() end
assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", wide)
local clampedWide = wide.AiWindow.create()
assert(clampedWide:GetWidth() == 1100 and clampedWide:GetHeight() == 800, "a saved size above the bounds is clamped down")
local fresh = {}
fresh.Transport = { sent = {} }
function fresh.Transport.send() end
WoWCompanionDB.window = nil
assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", fresh)
assert(fresh.AiWindow.create():GetWidth() == 680, "the default window is about 680 px wide")

ns2.AiWindow.openCopyBox("full reply text")
local more = ns2.AiWindow.copyBox
assert(more.portraitShown == false, "the full-reply box hides the empty portrait ring too")
assert(more.border == "ButtonFrameTemplateNoPortrait", "the full-reply box uses the portrait-less border layout")

print("aiwindow.create: all assertions passed")
