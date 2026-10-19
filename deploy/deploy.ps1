<#
  Локальный помощник для деплоя на VDS.

    .\deploy\deploy.ps1                      — закоммитить, запушить и задеплоить
    .\deploy\deploy.ps1 -Message "feat: x"  — с кастомным сообщением коммита
    .\deploy\deploy.ps1 -SkipCommit         — только push + деплой
    .\deploy\deploy.ps1 -Rollback           — откат на предыдущую версию на сервере
#>
param(
  [string]$Message = "chore: deploy",
  [switch]$SkipCommit,
  [switch]$SkipPush,
  [switch]$Rollback
)

# Native-команды (git/ssh) пишут предупреждения в stderr, а Windows PowerShell
# 5.1 при ErrorActionPreference=Stop превращает их в terminating error.
# Поэтому коды возврата проверяем вручную, а stderr глушим.
$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$Remote = "server"
$RemotePath = "/opt/ai-notes-tg-bot"

function Invoke-Native {
  # $Args зарезервирован в PowerShell, поэтому параметр называем $CmdArgs.
  param([string]$Exe, [string[]]$CmdArgs)
  $output = & $Exe @CmdArgs 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Host ($output | Out-String) -ForegroundColor DarkGray
    throw "$Exe завершился с кодом $code"
  }
}

Push-Location $Root
try {
  if (-not $SkipCommit) {
    Invoke-Native "git" @("add", "-A")
    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      Invoke-Native "git" @("commit", "-m", $Message)
      Write-Host "Коммит создан" -ForegroundColor Green
    } else {
      Write-Host "Нет изменений — коммит пропущен" -ForegroundColor DarkGray
    }
  }

  if (-not $SkipPush -and -not $Rollback) {
    Invoke-Native "git" @("push", "origin", "main")
    Write-Host "Запушено в origin/main" -ForegroundColor Green
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
  throw "Деплой на сервере завершился с кодом $code"
}

Write-Host "Деплой завершён" -ForegroundColor Green
