param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function Test-OnPath([string]$Name) {
    return [bool](Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)
}

$minimumNode = [version]"24.2.0"
$requiredNodeMajor = 24
$nodeFix = "winget install --id OpenJS.NodeJS.LTS --exact --version 24.19.0"

function ConvertTo-VersionOrNull([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }
    $match = [regex]::Match($Text.Trim(), '^v?(\d+\.\d+\.\d+)')
    if (-not $match.Success) {
        return $null
    }
    return [version]$match.Groups[1].Value
}

function Get-CommandVersion([string]$Command) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $global:LASTEXITCODE = 0
        $text = (& $Command --version 2>$null | Out-String)
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return ConvertTo-VersionOrNull $text
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
}

function New-Problem([string]$What, [string[]]$Fix) {
    return [pscustomobject]@{ What = $What; Fix = $Fix }
}

function Get-Problems {
    $problems = @()

    if (-not (Test-OnPath "node")) {
        $problems += New-Problem "Node.js is not installed (Node.js 24, version $minimumNode or newer, is needed)." @($nodeFix)
    }
    else {
        $installedNode = Get-CommandVersion "node"
        if ($null -eq $installedNode) {
            $problems += New-Problem "Node.js is installed but its version could not be read (Node.js 24, version $minimumNode or newer, is needed)." @($nodeFix)
        }
        elseif ($installedNode.Major -ne $requiredNodeMajor) {
            $problems += New-Problem "Node.js $installedNode is installed, but this project needs Node.js $requiredNodeMajor (version $minimumNode or newer in the $requiredNodeMajor line). Other major versions are not supported." @(
                "Step 1: uninstall Node.js $installedNode first. Open Settings > Apps > Installed apps, find Node.js and choose Uninstall.",
                "        If you installed it with winget, find its id with: winget list node",
                "        then run: winget uninstall --id <that id> --exact",
                "Step 2: install Node.js 24 (a new window is needed afterwards):",
                "        $nodeFix"
            )
        }
        elseif ($installedNode -lt $minimumNode) {
            $problems += New-Problem "Node.js $installedNode is too old (version $minimumNode or newer is needed)." @($nodeFix)
        }
    }

    if (-not (Test-OnPath "pnpm")) {
        $problems += New-Problem "pnpm is not installed." @(
            "winget install --id pnpm.pnpm --exact"
        )
    }

    if (-not (Test-OnPath "git")) {
        $problems += New-Problem "git is not installed." @(
            "winget install --id Git.Git --exact"
        )
    }

    if (-not ((Test-OnPath "claude") -or (Test-OnPath "codex"))) {
        $problems += New-Problem "Neither the Claude Code CLI (claude) nor the Codex CLI (codex) is installed. You need at least one, and it must be logged in." @(
            "Claude Code:  winget install --id Anthropic.ClaudeCode --exact",
            "              then: claude auth login",
            "Codex:        winget install --id OpenAI.Codex --exact",
            "              then: codex login"
        )
    }

    return $problems
}

Write-Host "Checking what the installer needs..."
$problems = @(Get-Problems)

if ($problems.Count -gt 0) {
    Write-Host ""
    foreach ($problem in $problems) {
        Write-Host "MISSING: $($problem.What)" -ForegroundColor Red
        Write-Host "  Fix, in a terminal:"
        foreach ($line in $problem.Fix) {
            Write-Host "    $line"
        }
        Write-Host ""
    }
    Write-Host "After installing, close this window and run install.cmd again."
    Write-Host "A new window is needed so Windows picks up the new programs."
    exit 1
}

Write-Host "Node.js, pnpm, git and an AI CLI are all present."

if ($CheckOnly) {
    exit 0
}

Write-Host ""
Write-Host "Installing the project's packages (pnpm install --frozen-lockfile)."
Write-Host "pnpm may first download the pnpm version this project pins into its own cache."
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    Write-Host "pnpm install failed. Read its message above." -ForegroundColor Red
    exit 1
}

Write-Host ""
& node (Join-Path $PSScriptRoot "install.ts")
exit $LASTEXITCODE
