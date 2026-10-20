# SYNTHETIC / OFFLINE rehearsal ONLY.
# Starts with an existing DPAPI H5 archive; makes one disposable PG17 database
# look like the 42-migration/93-table H5 baseline and tests the complete local
# pg_dump -> DPAPI encryption -> manifest -> isolated restore verification.
# No network, no live H5 source, no H5 backup folder writes, no real backup.
param(
  [switch]$Execute,
  [Parameter(Mandatory = $true)]
  [string]$ExistingEncryptedArchive,
  [string]$ExpectedProjectId = "yslpoerviixlbeicbptp"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$container = "nexpos-h5-synthetic-" + [guid]::NewGuid().ToString("N").Substring(0, 12)
$workingDir = Join-Path $env:TEMP ("nexpos-h5-synthetic-" + [guid]::NewGuid().ToString("N"))
$started = $false
function Require-DockerSuccess([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "Synthetic rehearsal failed at: $step (exit $LASTEXITCODE)" }
}

try {
  if (-not $Execute) {
    Write-Output "MODE=SYNTHETIC_PREFLIGHT_ONLY"
    Write-Output "ACTION=NONE"
    return
  }
  $archive = (Resolve-Path -LiteralPath $ExistingEncryptedArchive).ProviderPath
  $originalManifest = Get-Content -LiteralPath "$archive.manifest.json" -Raw | ConvertFrom-Json
  if ([string]$originalManifest.project -ne $ExpectedProjectId -or
      [string]$originalManifest.sourceCounts -ne "41|1|0|92") {
    throw "Synthetic fixture needs the known original 41/92 H5 archive"
  }
  $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne [string]$originalManifest.encryptedSha256.ToUpperInvariant()) {
    throw "Original archive failed integrity check"
  }
  docker image inspect postgres:17-alpine --format '{{.Id}}' | Out-Null
  Require-DockerSuccess "find local PostgreSQL 17 image"
  New-Item -ItemType Directory -Path $workingDir -ErrorAction Stop | Out-Null

  Add-Type -AssemblyName System.Security
  $archiveBytes = [IO.File]::ReadAllBytes($archive)
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $archiveBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  if ($plainBytes.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($plainBytes,0,5) -ne "PGDMP") {
    throw "Original encrypted bytes do not decrypt to a PGDMP archive"
  }
  $sourceDump = Join-Path $workingDir "original.dump"
  [IO.File]::WriteAllBytes($sourceDump, $plainBytes)
  [Array]::Clear($plainBytes,0,$plainBytes.Length)
  docker run --rm -d --name $container --network none `
    -e POSTGRES_USER=pos -e POSTGRES_DB=pos `
    -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine | Out-Null
  Require-DockerSuccess "start network-disabled synthetic container"
  $started = $true
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker exec $container pg_isready -U pos -d pos | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Synthetic PG17 container was not ready" }
  docker cp $sourceDump "$($container):/tmp/original.dump" | Out-Null
  Require-DockerSuccess "copy original fixture into synthetic container"
  foreach ($role in @("anon","authenticated","service_role")) {
    docker exec $container psql -X -U pos -d pos -v ON_ERROR_STOP=1 -q -c "CREATE ROLE $role NOLOGIN;" | Out-Null
    Require-DockerSuccess "initialize synthetic local roles"
  }
  docker exec $container psql -X -U pos -d pos -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA public CASCADE;" | Out-Null
  Require-DockerSuccess "clear synthetic target schema"
  docker exec $container pg_restore -U pos -d pos --no-owner --no-privileges --exit-on-error /tmp/original.dump | Out-Null
  Require-DockerSuccess "restore original archive into synthetic container"

  # The new table and migration marker below are synthetic placeholders
  # used ONLY for count/identity gate testing; not the real 0040 DDL.
  $sqlFile = Join-Path $workingDir "synthetic.sql"
  $sql = @'
INSERT INTO public._migrations(name) VALUES ('0040_product_media');
CREATE TABLE public."ProductMediaAsset" (
  id text PRIMARY KEY,
  note text
);
'@
  [IO.File]::WriteAllText($sqlFile, $sql, (New-Object Text.UTF8Encoding($false)))
  docker cp $sqlFile "$($container):/tmp/synthetic.sql" | Out-Null
  Require-DockerSuccess "copy synthetic fixture SQL"
  docker exec $container psql -X -U pos -d pos -v ON_ERROR_STOP=1 -f /tmp/synthetic.sql | Out-Null
  Require-DockerSuccess "construct synthetic current-schema fixture"

  $countSql = @'
SELECT (SELECT count(*) FROM public._migrations),
       (SELECT count(*) FROM public."Business"),
       (SELECT count(*) FROM public."Sale"),
       (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public');
'@
  $countFile = Join-Path $workingDir "counts.sql"
  [IO.File]::WriteAllText($countFile, $countSql, (New-Object Text.UTF8Encoding($false)))
  docker cp $countFile "$($container):/tmp/counts.sql" | Out-Null
  Require-DockerSuccess "copy synthetic count SQL"
  $counts = (docker exec $container psql -X -U pos -d pos -v ON_ERROR_STOP=1 -A -t -F '|' -f /tmp/counts.sql | Out-String).Trim()
  Require-DockerSuccess "read synthetic baseline counts"
  if ($counts -ne "42|1|0|93") {
    throw "Synthetic fixture did not match expected 42|1|0|93: $counts"
  }

  docker exec $container pg_dump -U pos -d pos --schema=public --format=custom --no-owner --no-privileges --serializable-deferrable --file=/tmp/synthetic-fresh.dump | Out-Null
  Require-DockerSuccess "create synthetic PG17 custom-format dump"
  $plainPath = Join-Path $workingDir "fresh-plaintext.dump"
  docker cp "$($container):/tmp/synthetic-fresh.dump" $plainPath | Out-Null
  Require-DockerSuccess "copy synthetic fresh plaintext dump to TEMP"
  $bytes = [IO.File]::ReadAllBytes($plainPath)
  if ($bytes.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($bytes,0,5) -ne "PGDMP") {
    throw "Synthetic custom-format dump has wrong header"
  }
  $encrypted = [Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Array]::Clear($bytes,0,$bytes.Length)
  $staged = Join-Path $workingDir "SYNTHETIC-NOT-A-H5-BACKUP.pgdump.dpapi"
  [IO.File]::WriteAllBytes($staged,$encrypted)
  [Array]::Clear($encrypted,0,$encrypted.Length)
  $hash = (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToUpperInvariant()
  $manifest = [ordered]@{
    project = $ExpectedProjectId
    backupScope = "public schema only"
    encryption = "Windows DPAPI CurrentUser"
    postgresClient = "17"
    sourceCounts = $counts
    restoredCounts = $counts
    encryptedSha256 = $hash
    testFixture = "SYNTHETIC OFFLINE TEST ONLY - NOT A REAL H5 BACKUP"
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath "$staged.manifest.json" -Encoding UTF8
  $verifier = Join-Path $PSScriptRoot "h5-verify-encrypted-restore.ps1"
  $result = (& $verifier -EncryptedArchivePath $staged -ExpectedProjectId $ExpectedProjectId `
    -RequiredMigrations @("0040_product_media","0048_h4r9_tenant_integrity") | Out-String)
  if ($result -notmatch '(?m)^RESULT=PASS\r?$' -or
      $result -notmatch 'REQUIRED_MIGRATIONS=PASS' -or
      $result -notmatch 'RESTORED_COUNTS=42\|1\|0\|93') {
    throw "Synthetic encrypted backup failed independent PG17 restore"
  }
  Write-Output "RESULT=PASS"
  Write-Output "MODE=OFFLINE_SYNTHETIC_REHEARSAL"
  Write-Output "NETWORK=NONE"
  Write-Output "SOURCE=OLD_ARCHIVE_PLUS_SYNTHETIC_TEST_FIXTURE"
  Write-Output "SYNTHETIC_COUNTS=$counts"
  Write-Output "SYNTHETIC_RESTORE=PASS"
  Write-Output "REQUIRED_MIGRATIONS=PASS"
  Write-Output "WARNING=NOT_A_CURRENT_H5_BACKUP"
}
finally {
  if ($started) { docker stop $container 2>$null | Out-Null }
  if (Test-Path -LiteralPath $workingDir) {
    Remove-Item -LiteralPath $workingDir -Recurse -Force
  }
}
