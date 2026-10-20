<#
  Local helper for the deployment on the VDS.

    .\deploy\deploy.ps1                      - commit, push and deploy
    .\deploy\deploy.ps1 -Message "feat: x"  - with a custom commit message
    .\deploy\deploy.ps1 -SkipCommit         - only push and deploy
    .\deploy\deploy.ps1 -Rollback           - roll back on the server
#>
param(
  [string]$Message = "chore: deploy",
  [switch]$SkipCommit,
  [switch]$SkipPush,
  [switch]$Rollback,
  # The ssh target of the server: an alias from ~/.ssh/config or user@host.
  # It can also be set with the environment variable VDS_SSH_HOST.
  [string]$Remote = $(if ($env:VDS_SSH_HOST) { $env:VDS_SSH_HOST } else { "server" })
)

# Native commands (git, ssh) write warnings to stderr, and Windows PowerShell
# 5.1 turns them into a terminating error when ErrorActionPreference is Stop.
# So the exit codes are checked by hand and stderr is not treated as a failure.
$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$RemotePath = "/opt/telegram-to-obsidian-ai-agent"

function Invoke-Native {
  # $Args is reserved in PowerShell, so the parameter is called $CmdArgs.
  param([string]$Exe, [string[]]$CmdArgs)
  $output = & $Exe @CmdArgs 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Host ($output | Out-String) -ForegroundColor DarkGray
    throw "$Exe finished with the code $code"
  }
}

Push-Location $Root
try {
  if (-not $SkipCommit) {
    Invoke-Native "git" @("add", "-A")
    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      Invoke-Native "git" @("commit", "-m", $Message)
      Write-Host "The commit is created" -ForegroundColor Green
    } else {
      Write-Host "There are no changes, the commit is skipped" -ForegroundColor DarkGray
    }
  }

  if (-not $SkipPush -and -not $Rollback) {
    Invoke-Native "git" @("push", "origin", "main")
    Write-Host "Pushed to origin/main" -ForegroundColor Green
  }
}
finally {
  Pop-Location
}

if ($Rollback) {
  $out = & ssh $Remote "cd $RemotePath && bash deploy/deploy.sh --rollback" 2>&1
} else {
  $out = & ssh $Remote "cd $RemotePath && bash deploy/deploy.sh" 2>&1
}
$code = $LASTEXITCODE
Write-Host ($out | Out-String)
if ($code -ne 0) {
  throw "The deployment on the server finished with the code $code"
}

Write-Host "The deployment is done" -ForegroundColor Green
