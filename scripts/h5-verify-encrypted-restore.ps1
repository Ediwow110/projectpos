# Read-only verification of an EXISTING H5 Windows DPAPI archive.
# This script NEVER contacts Supabase, creates a remote dump, or restores to a
# configured database. It starts an isolated, disposable PostgreSQL 17 Docker
# container with no network/ports, imports only the supplied archived bytes,
# verifies snapshot counts, then removes the container and temporary plaintext.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/h5-verify-encrypted-restore.ps1 `
#     -EncryptedArchivePath "$env:USERPROFILE\Documents\NexPOS\H5-Backups\<file>.pgdump.dpapi"
#
# All output is metadata only. Do not record database rows or credentials.
param(
  [Parameter(Mandatory = $true)]
  [string]$EncryptedArchivePath,
  [string]$ManifestPath = "",
  [string]$ExpectedProjectId = "",
  [string[]]$RequiredMigrations = @()
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$container = "nexpos-h5-drill-" + [Guid]::NewGuid().ToString("N").Substring(0, 12)
$plaintext = Join-Path $env:TEMP ("nexpos-h5-recovery-" + [Guid]::NewGuid().ToString("N") + ".dump")
$countsQueryFile = Join-Path $env:TEMP ("nexpos-h5-counts-" + [Guid]::NewGuid().ToString("N") + ".sql")
$containerStarted = $false

function Assert-DockerExit([string]$operation) {
  if ($LASTEXITCODE -ne 0) { throw "Offline Docker operation failed: $operation (exit $LASTEXITCODE)" }
}

try {
  $archive = (Resolve-Path -LiteralPath $EncryptedArchivePath).ProviderPath
  if (-not $ManifestPath) { $ManifestPath = "$archive.manifest.json" }
  $manifestPathResolved = (Resolve-Path -LiteralPath $ManifestPath).ProviderPath
  $manifest = Get-Content -LiteralPath $manifestPathResolved -Raw | ConvertFrom-Json
  if ($manifest.encryption -ne "Windows DPAPI CurrentUser" -or $manifest.backupScope -ne "public schema only") {
    throw "Unsupported encrypted archive / backup scope; refusing restore"
  }
  if ($ExpectedProjectId -and [string]$manifest.project -ne $ExpectedProjectId) {
    throw "Archive manifest does not match the explicitly expected project"
  }
  if ([string]$manifest.postgresClient -ne "17") {
    throw "Manifest does not identify PostgreSQL 17; refusing restore"
  }
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($hash -ne [string]$manifest.encryptedSha256.ToUpperInvariant()) {
    throw "Encrypted backup SHA-256 does not match manifest; refusing decryption"
  }
  $sourceCounts = [string]$manifest.sourceCounts
  $manifestRestoreCounts = [string]$manifest.restoredCounts
  if ($sourceCounts -notmatch '^\d+\|\d+\|\d+\|\d+$' -or $sourceCounts -ne $manifestRestoreCounts) {
    throw "Manifest snapshot counts are missing or internally inconsistent"
  }

  docker image inspect postgres:17-alpine --format '{{.Id}}' | Out-Null
  Assert-DockerExit "find locally installed PostgreSQL 17 image"

  Add-Type -AssemblyName System.Security
  $encrypted = [IO.File]::ReadAllBytes($archive)
  $decrypted = [Security.Cryptography.ProtectedData]::Unprotect(
    $encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  if ($decrypted.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($decrypted, 0, 5) -ne "PGDMP") {
    throw "Decrypted bytes are not a PostgreSQL custom-format archive"
  }
  [IO.File]::WriteAllBytes($plaintext, $decrypted)
  [Array]::Clear($decrypted, 0, $decrypted.Length)

  # --network none, no published port, random name, no host data mounts.
  docker run --rm -d --name $container --network none `
    -e POSTGRES_USER=pos -e POSTGRES_DB=pos `
    -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine | Out-Null
  Assert-DockerExit "start isolated PostgreSQL 17 container"
  $containerStarted = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $container pg_isready -U pos -d pos | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Isolated PostgreSQL 17 was not ready after 30 seconds" }
  $serverVersion = (docker exec $container psql -X -U pos -d pos -v ON_ERROR_STOP=1 -A -t -c "SHOW server_version_num;" | Out-String).Trim()
  Assert-DockerExit "read isolated server version"
  if ([int]$serverVersion -lt 170000 -or [int]$serverVersion -ge 180000) {
    throw "Isolated server is not PostgreSQL 17; refusing restore"
  }

  docker cp $plaintext "$($container):/tmp/h5-recovery.dump" | Out-Null
  Assert-DockerExit "copy plaintext archive to isolated container"
  # Supabase policy objects may refer to these database roles; they are dummy
  # NOLOGIN roles in this isolated, network-disabled container only.
  foreach ($role in @("anon", "authenticated", "service_role")) {
    docker exec $container psql -X -U pos -d pos -v ON_ERROR_STOP=1 -q -c "CREATE ROLE $role NOLOGIN;" | Out-Null
    Assert-DockerExit "create offline compatibility role"
  }
  # PostgreSQL 17's freshly initialized database includes a public schema.
  # This custom-format dump also creates public; drop ONLY the schema in our
  # newly created, network-disabled drill container to avoid an object clash.
  docker exec $container psql -X -U pos -d pos -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA public CASCADE;" | Out-Null
  Assert-DockerExit "clear disposable database default public schema"
  docker exec $container pg_restore -U pos -d pos --no-owner --no-privileges --exit-on-error /tmp/h5-recovery.dump | Out-Null
  Assert-DockerExit "restore supplied backup to offline database"

  $sql = 'SELECT (SELECT count(*) FROM public._migrations), (SELECT count(*) FROM public."Business"), (SELECT count(*) FROM public."Sale"), (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = ''public'');'
  if ($RequiredMigrations.Count -gt 0) {
    foreach ($name in $RequiredMigrations) {
      if ($name -notmatch '^[a-z0-9_]+$') { throw "Invalid required migration name" }
    }
    $names = ($RequiredMigrations | ForEach-Object { "'$_'" }) -join ","
    $sql += "`nSELECT name FROM public._migrations WHERE name IN ($names) ORDER BY name;"
  }
  # A copied query file preserves PostgreSQL's quoted mixed-case identifiers
  # across Windows PowerShell -> docker exec argument parsing.
  [IO.File]::WriteAllText($countsQueryFile, $sql, (New-Object Text.UTF8Encoding($false)))
  docker cp $countsQueryFile "$($container):/tmp/h5-counts.sql" | Out-Null
  Assert-DockerExit "copy metadata-only verification SQL to offline container"
  $lines = ((docker exec $container psql -X -U pos -d pos -v ON_ERROR_STOP=1 -A -t -F '|' -f /tmp/h5-counts.sql | Out-String).Trim() -split '\r?\n')
  Assert-DockerExit "verify offline restored row/table counts"
  $counts = $lines[0]
  if ($counts -ne $sourceCounts) {
    throw "Restored counts do not match manifest; expected $sourceCounts, got $counts"
  }
  if ($RequiredMigrations.Count -gt 0) {
    $expectedNames = @($RequiredMigrations | Sort-Object -Unique)
    $restoredNames = @($lines | Select-Object -Skip 1)
    if ($expectedNames.Count -ne $restoredNames.Count -or
        (($expectedNames -join '|') -ne ($restoredNames -join '|'))) {
      throw "Restored snapshot is missing one or more required migrations"
    }
    Write-Output "REQUIRED_MIGRATIONS=PASS"
  }
  Write-Output "RESULT=PASS"
  Write-Output "MODE=OFFLINE_EXISTING_SNAPSHOT"
  Write-Output "NETWORK=NONE"
  Write-Output "POSTGRES_MAJOR=17"
  Write-Output "ARCHIVE_SHA256=$hash"
  Write-Output "MANIFEST_COUNTS=$sourceCounts"
  Write-Output "RESTORED_COUNTS=$counts"
  Write-Output "NOTE=Validates only the old archive; does NOT attest to current H5 schema, offsite recovery, or platform schemas"
}
finally {
  if ($containerStarted) {
    docker stop $container 2>$null | Out-Null
  }
  if (Test-Path -LiteralPath $plaintext) {
    Remove-Item -LiteralPath $plaintext -Force
  }
  if (Test-Path -LiteralPath $countsQueryFile) {
    Remove-Item -LiteralPath $countsQueryFile -Force
  }
}
