dofile("tests/lua/wow_stubs.lua")

local ns = {}
ns.Transport = { sent = {} }
ns.Transport.session = function()
  return "sessionA"
end
function ns.Transport.send(msg)
  table.insert(ns.Transport.sent, msg)
end
ns.Settings = { onChats = function() end, onError = function() end, onOptions = function() end }

assert(loadfile("addon/WoWCompanion/AiWindow.lua"))("WoWCompanion", ns)
assert(loadfile("addon/WoWCompanion/Core.lua"))("WoWCompanion", ns)
ns.AiWindow.create()

local chat = { id = "chat-7", name = "Gearing up" }
local function lastSent()
  return ns.Transport.sent[#ns.Transport.sent]
end

ns.AiWindow.showChatDialog("rename", chat)
local dialog = ns.AiWindow.chatDialog
assert(dialog ~= nil and dialog:IsShown() == true, "Rename shows the addon's own dialog")
assert(dialog.template == "BasicFrameTemplateWithInset", "the dialog is a Blizzard frame template")
assert(dialog.strata == "DIALOG", "the dialog sits above the Claude window")
assert(dialog.editBox.template == "InputBoxTemplate", "the name field is InputBoxTemplate")
assert(dialog.accept.template == "UIPanelButtonTemplate" and dialog.cancel.template == "UIPanelButtonTemplate", "the buttons are UIPanelButtonTemplate")
assert(dialog.TitleText:GetText() == "Rename chat", "the dialog is titled Rename chat")
assert(dialog.accept:GetText() == "Rename" and dialog.cancel:GetText() == "Cancel", "the buttons read Rename and Cancel")
assert(dialog.editBox:IsShown() == true, "the name field is visible when renaming")
assert(dialog.editBox:GetText() == "Gearing up", "the field starts with the current name")
assert(dialog.editBox.highlighted == true and dialog.editBox:HasFocus() == true, "the name is selected and focused")
local renameHeight = dialog:GetHeight()

local sentBefore = #ns.Transport.sent
dialog.editBox:SetText("   ")
dialog.editBox:Fire("OnEnterPressed")
assert(#ns.Transport.sent == sentBefore and dialog:IsShown() == true, "Enter with an empty name sends nothing and keeps the dialog open")

dialog.editBox:SetText("  Best gear  ")
dialog.editBox:Fire("OnEnterPressed")
assert(lastSent().t == "cmd" and lastSent().name == "rename" and lastSent().chat == "chat-7", "Enter confirms the rename for the right chat")
assert(lastSent().arg == "Best gear", "the name is trimmed")
assert(dialog:IsShown() == false, "the dialog closes after Enter")

ns.AiWindow.showChatDialog("rename", chat)
local afterOpen = #ns.Transport.sent
dialog.editBox:SetText("Something else")
dialog.editBox:Fire("OnEscapePressed")
assert(dialog:IsShown() == false and #ns.Transport.sent == afterOpen, "Escape in the name field cancels without sending")

ns.AiWindow.showChatDialog("rename", chat)
dialog.cancel:Fire("OnClick")
assert(dialog:IsShown() == false and #ns.Transport.sent == afterOpen, "Cancel closes without sending")
ns.AiWindow.showChatDialog("rename", chat)
dialog.CloseButton:Fire("OnClick")
assert(dialog:IsShown() == false and #ns.Transport.sent == afterOpen, "the close button cancels")
ns.AiWindow.showChatDialog("rename", chat)
dialog.editBox:SetText("Clicked")
dialog.accept:Fire("OnClick")
assert(lastSent().arg == "Clicked" and dialog:IsShown() == false, "the Rename button confirms too")

ns.AiWindow.showChatDialog("delete", { id = "chat-9", name = "|Hx|h Old" })
assert(ns.AiWindow.chatDialog == dialog, "one reusable dialog serves both actions")
assert(dialog.TitleText:GetText() == "Delete chat" and dialog.accept:GetText() == "Delete", "delete mode is titled and labelled Delete")
assert(dialog.message:GetText() == "This removes ||Hx||h Old and its history.", "the message does not repeat the title and shows the chat name escaped")
assert(dialog.editBox:IsShown() == false, "delete mode has no name field at all")
assert(dialog.editBox:HasFocus() == false, "and no hidden field holds the keyboard")
local beforeEnter = #ns.Transport.sent
dialog.editBox:Fire("OnEnterPressed")
assert(#ns.Transport.sent == beforeEnter and dialog:IsShown() == true, "Enter never confirms a delete: the Delete button must be clicked")
dialog.cancel:Fire("OnClick")
assert(dialog:IsShown() == false and #ns.Transport.sent == beforeEnter, "Cancel cancels a delete")

ns.AiWindow.showChatDialog("delete", { id = "chat-9", name = "Old" })
dialog.accept:Fire("OnClick")
assert(lastSent().name == "delete" and lastSent().chat == "chat-9", "the Delete button confirms a delete for the right chat")
assert(dialog:IsShown() == false, "the dialog closes after a delete")

local afterClose = #ns.Transport.sent
dialog.accept:Fire("OnClick")
assert(#ns.Transport.sent == afterClose, "a stale click after the dialog closed sends nothing")

local deleteHeight
ns.AiWindow.showChatDialog("delete", { id = "chat-9", name = "Short" })
deleteHeight = dialog:GetHeight()
assert(deleteHeight < renameHeight, "the delete dialog has no field, so it is shorter than the rename dialog")

local longName = string.rep("W", 60)
ns.AiWindow.showChatDialog("delete", { id = "chat-9", name = longName })
local message = dialog.message:GetText()
assert(message:find(longName, 1, true) == nil, "a long chat name is not shown in full")
assert(message:find(string.rep("W", 27) .. "\226\128\166", 1, true) ~= nil, "it is cut to 27 characters and an ellipsis")
assert(dialog:GetHeight() == 36 + math.ceil(dialog.message:GetStringHeight()) + 16 + 22 + 16, "the dialog height is the message height plus the fixed chrome")
local longMessageHeight = dialog:GetHeight()
ns.AiWindow.showChatDialog("delete", { id = "chat-9", name = "x" })
assert(dialog:GetHeight() <= longMessageHeight, "a shorter message never makes the dialog taller")

ns.AiWindow.showChatDialog("delete", { id = "chat-11", name = "Hidden by Escape" })
dialog:Hide()
local afterHide = #ns.Transport.sent
dialog.accept:Fire("OnClick")
assert(#ns.Transport.sent == afterHide, "closing the dialog any other way, such as Escape through UISpecialFrames, also forgets the chat")

local special = false
for _, name in ipairs(UISpecialFrames) do
  if name == "WoWCompanionChatDialog" then
    special = true
  end
end
assert(special, "Escape closes the dialog, also a delete with no field, through the same UISpecialFrames entry the report frame uses")

assert(_G.StaticPopupDialogs == nil, "the addon never creates or writes StaticPopupDialogs")
assert(_G.StaticPopup_Show == nil, "the stubs have no StaticPopup_Show any more")

print("chat.dialog: all assertions passed")
