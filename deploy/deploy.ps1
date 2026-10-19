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

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Remote = "server"
$RemotePath = "/opt/ai-notes-tg-bot"

Push-Location $Root
try {
  if (-not $SkipCommit) {
    git add -A
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      git commit -m $Message
      if ($LASTEXITCODE -ne 0) { throw "git commit не удался" }
    } else {
      Write-Host "Нет изменений — коммит пропущен" -ForegroundColor DarkGray
    }
  }

  if (-not $SkipPush -and -not $Rollback) {
    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "git push не удался" }
  }
}
finally {
  Pop-Location
}

if ($Rollback) {
  ssh $Remote "cd $RemotePath && bash deploy/deploy.sh --rollback"
} else {
  ssh $Remote "cd $RemotePath && bash deploy/deploy.sh"
}

if ($LASTEXITCODE -ne 0) { throw "Деплой на сервере завершился с ошибкой" }
