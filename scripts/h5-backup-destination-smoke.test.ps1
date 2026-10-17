# Offline-only path-guard regression. No database connection, Docker or
# credentials are required, and no backup files are created or modified.
param()
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).ProviderPath
$backup = Join-Path $env:USERPROFILE "Documents\NexPOS\H5-Backups"
$usb = "G:\NexPOS-H5-Recovery"
$script = Join-Path $PSScriptRoot "h5-create-fresh-encrypted-backup.ps1"
if (-not (Test-Path -LiteralPath $backup -PathType Container)) {
  throw "Expected existing H5 backup destination missing"
}
if (-not (Test-Path -LiteralPath $usb -PathType Container)) {
  throw "Expected existing H5 portable destination missing"
}

$previousLocation = (Get-Location).Path
try {
  foreach ($caller in @($env:USERPROFILE, $repo)) {
    Set-Location -LiteralPath $caller
    # Dot-source only the exporter's SAFE preflight (without -Execute).
    # This imports its destination guard without attempting any backup.
    $preflight = (. $script | Out-String)
    if ($preflight -notmatch "MODE=SAFE_PREFLIGHT_ONLY" -or
        $preflight -notmatch "ACTION=NONE") {
      throw "Exporter preflight did not stay read-only"
    }
    Assert-BackupDestinationOutsideRepo $backup
    Assert-BackupDestinationOutsideRepo $usb
    foreach ($forbidden in @($repo, (Join-Path $repo "scripts"))) {
      $rejected = $false
      try {
        Assert-BackupDestinationOutsideRepo $forbidden
      } catch {
        if ($_.Exception.Message -match "Backup destination inside the source repository is forbidden") {
          $rejected = $true
        } else { throw }
      }
      if (-not $rejected) { throw "Destination guard accepted a repository path" }
    }
    Write-Output "CALLER=$caller"
    Write-Output "DOCUMENTS_BACKUP_DESTINATION=ALLOWED"
    Write-Output "USB_BACKUP_DESTINATION=ALLOWED"
    Write-Output "REPOSITORY_DESTINATIONS=BLOCKED"
  }
  Write-Output "RESULT=PASS"
  Write-Output "REAL_DATABASE_ACCESSED=FALSE"
} finally {
  Set-Location -LiteralPath $previousLocation
}
