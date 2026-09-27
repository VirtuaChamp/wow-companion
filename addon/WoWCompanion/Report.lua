local addonName, ns = ...

ns.Report = ns.Report or {}

local STRINGS = {
  title = "WoW Companion Report",
  issueUrl = "https://github.com/VirtuaChamp/wow-companion/issues/new/choose",
  clientBuildLabel = "Client build",
  addonVersionLabel = "Addon version",
  companionVersionLabel = "Companion version",
  providerLabel = "Provider",
  modelLabel = "Model",
  effortLabel = "Effort",
  unknown = "unknown",
}

local companionVersion

local function clientBuildText()
  local version, build = GetBuildInfo()
  return string.format("%s.%s", version or STRINGS.unknown, build or STRINGS.unknown)
end

local function addonVersionText()
  return C_AddOns.GetAddOnMetadata(addonName, "Version") or STRINGS.unknown
end

function ns.Report.setCompanionVersion(version)
  companionVersion = version
end

function ns.Report.buildText()
  local settings = ns.Settings.current()
  local lines = {
    STRINGS.issueUrl,
    STRINGS.clientBuildLabel .. ": " .. clientBuildText(),
    STRINGS.addonVersionLabel .. ": " .. addonVersionText(),
    STRINGS.companionVersionLabel .. ": " .. (companionVersion or STRINGS.unknown),
    STRINGS.providerLabel .. ": " .. (settings.provider or STRINGS.unknown),
    STRINGS.modelLabel .. ": " .. (settings.model or STRINGS.unknown),
    STRINGS.effortLabel .. ": " .. (settings.effort or STRINGS.unknown),
  }
  return table.concat(lines, "\n")
end

local frame

local function ensureFrame()
  if frame then
    return frame
  end

  local width, height = 420, 320
  frame = CreateFrame("Frame", "WoWCompanionReportFrame", UIParent, "BasicFrameTemplateWithInset")
  frame:SetSize(width, height)
  frame:SetPoint("CENTER")
  frame:Hide()

  frame.TitleText:SetText(STRINGS.title)
  frame.CloseButton:SetScript("OnClick", function()
    frame:Hide()
  end)

  frame.ScrollFrame = CreateFrame("ScrollFrame", nil, frame, "InputScrollFrameTemplate")
  frame.ScrollFrame:SetPoint("TOPLEFT", frame, "TOPLEFT", 12, -32)
  frame.ScrollFrame:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -34, 44)
  frame.ScrollFrame:SetSize(width - 46, height - 76)

  local editBox = frame.ScrollFrame.EditBox
  editBox:SetMultiLine(true)
  editBox:SetAutoFocus(false)
  editBox:SetWidth(frame.ScrollFrame:GetWidth())
  editBox:HookScript("OnTextChanged", function(box)
    if box.reportText and box:GetText() ~= box.reportText then
      box:SetText(box.reportText)
    end
  end)
  editBox:HookScript("OnEscapePressed", function()
    frame:Hide()
  end)
  frame.EditBox = editBox

  table.insert(UISpecialFrames, frame:GetName())

  return frame
end

function ns.Report.open()
  local reportFrame = ensureFrame()
  local text = ns.Report.buildText()
  reportFrame.EditBox.reportText = text
  reportFrame.EditBox:SetText(text)
  reportFrame.EditBox:HighlightText()
  reportFrame.EditBox:SetFocus()
  reportFrame:Show()
  return reportFrame
end
