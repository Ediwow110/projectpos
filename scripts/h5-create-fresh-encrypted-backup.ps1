# H5 public-schema backup. Defaults to safe preflight, NEVER backup on import.
# Execution requires explicit -Execute AND an already configured H5_DATABASE_URL
# in the Windows process environment. NEVER paste that value into chat/args.
# Reads the configured H5 database; does not mutate its data or schema.
param(
  [switch]$Execute,
  [string]$ExpectedProjectId = "yslpoerviixlbeicbptp",
  [int]$ExpectedMigrationCount = 42,
  [int]$ExpectedPublicTables = 93,
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$container = "nexpos-h5-export-" + [guid]::NewGuid().ToString("N").Substring(0, 12)
$sqlFile = Join-Path $env:TEMP ("nexpos-h5-export-counts-" + [guid]::NewGuid().ToString("N") + ".sql")
$plainDump = Join-Path $env:TEMP ("nexpos-h5-export-plaintext-" + [guid]::NewGuid().ToString("N") + ".dump")
$stage = $null
$running = $false

function Assert-DockerExit([string]$action) {
  if ($LASTEXITCODE -ne 0) { throw "H5 backup aborted at '$action' (Docker exit $LASTEXITCODE)" }
}

function Assert-ArchiveSource([string]$databaseUrl, [string]$project) {
  $uri = $null
  if (-not [uri]::TryCreate($databaseUrl, [UriKind]::Absolute, [ref]$uri) -or
      $uri.Scheme -notin @("postgresql", "postgres") -or
      -not $uri.UserInfo.Contains(":")) {
    throw "H5_DATABASE_URL must be a password-protected PostgreSQL URI"
  }
  if ($project -notmatch '^[a-z0-9]{15,30}$') {
    throw "Invalid expected project ID; refusing database access"
  }
  $hostName = $uri.Host.ToLowerInvariant()
  $username = [Uri]::UnescapeDataString($uri.UserInfo.Split(":")[0])
  $direct = $hostName -eq "db.$project.supabase.co" -and $username -eq "postgres"
  $pooler = $hostName.EndsWith(".pooler.supabase.com", [StringComparison]::Ordinal) -and
    $username -eq "postgres.$project"
  if (-not ($direct -or $pooler)) {
    throw "Source hostname or username does not match H5; refusing database access"
  }
  if ($uri.Query -match '(?i)(?:^|[?&])sslmode=(?:disable|allow|prefer)(?:&|$)') {
    throw "Insecure SSL mode specified; refusing database access"
  }
  if ($uri.AbsolutePath.Trim("/") -ne "postgres") {
    throw "Unexpected source database name; refusing database access"
  }
}

try {
  if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $env:USERPROFILE "Documents\NexPOS\H5-Backups"
  }
  $connectionConfigured = -not [string]::IsNullOrWhiteSpace($env:H5_DATABASE_URL)
  if (-not $Execute) {
    Write-Output "MODE=SAFE_PREFLIGHT_ONLY"
    Write-Output "SOURCE_ENV_SET=$connectionConfigured"
    Write-Output "TARGET_PROJECT=$ExpectedProjectId"
    Write-Output "EXPECTED_MIGRATIONS=$ExpectedMigrationCount"
    Write-Output "EXPECTED_PUBLIC_TABLES=$ExpectedPublicTables"
    Write-Output "ACTION=NONE"
    return
  }
  if (-not $connectionConfigured) {
    throw "H5_DATABASE_URL is not configured in this process. No export was attempted."
  }
  if ($ExpectedProjectId -ne "yslpoerviixlbeicbptp") {
    throw "This backup command is restricted to the designated H5 staging project"
  }
  Assert-ArchiveSource $env:H5_DATABASE_URL $ExpectedProjectId
  if ($ExpectedMigrationCount -lt 1 -or $ExpectedPublicTables -lt 1) {
    throw "Expected counts must be positive; refusing export"
  }
  if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    throw "Backup destination must already exist; refusing to create a new destination"
  }
  $dest = (Resolve-Path -LiteralPath $OutputDirectory).ProviderPath
  if ($dest.StartsWith((Resolve-Path ".").ProviderPath + "\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup destination inside the source repository is forbidden"
  }
  docker image inspect postgres:17-alpine --format '{{.Id}}' | Out-Null
  Assert-DockerExit "check installed PostgreSQL 17 image"
  $name = "NexPOS-H5-public-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
  $archiveName = "$name.pgdump.dpapi"
  $archivePath = Join-Path $dest $archiveName
  if (Test-Path -LiteralPath $archivePath) { throw "Backup filename already exists; refusing overwrite" }
  $stage = Join-Path $dest (".h5-backup-incomplete-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $stage -ErrorAction Stop | Out-Null

  # These bytes are NEVER written to the repository and are not sent to logs.
  # The DB URI passes by ENVIRONMENT KEY NAME only, not as a command argument.
  # Docker administrators could inspect container ENV while it exists; use
  # only a trusted local host and remove the container after the export.
  docker run --rm -d --name $container --network bridge `
    -e H5_DATABASE_URL -e PGSSLMODE=require `
    -e "PGOPTIONS=-c default_transaction_read_only=on" `
    postgres:17-alpine sh -c "sleep 900" | Out-Null
  Assert-DockerExit "start short-lived PostgreSQL client"
  $running = $true

  $requiredNames = @("0040_product_media", "0048_h4r9_tenant_integrity")
  $sql = 'SELECT (SELECT count(*) FROM public._migrations), (SELECT count(*) FROM public."Business"), (SELECT count(*) FROM public."Sale"), (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = ''public'');' +
    "`nSELECT name FROM public._migrations WHERE name IN ('0040_product_media','0048_h4r9_tenant_integrity') ORDER BY name;" +
    "`nSELECT current_setting('server_version_num');"
  [IO.File]::WriteAllText($sqlFile, $sql, (New-Object Text.UTF8Encoding($false)))
  docker cp $sqlFile "$($container):/tmp/h5-source-counts.sql" | Out-Null
  Assert-DockerExit "copy metadata count query"
  $metaCommand = 'exec psql -X -v ON_ERROR_STOP=1 -A -t -F "|" -d "$H5_DATABASE_URL" -f /tmp/h5-source-counts.sql'
  $preLines = @((docker exec $container sh -c $metaCommand | Out-String).Trim() -split '\r?\n')
  Assert-DockerExit "read authorized H5 metadata"
  $pre = $preLines[0]
  if ($preLines.Count -ne 4 -or
      $preLines[1] -ne $requiredNames[0] -or $preLines[2] -ne $requiredNames[1]) {
    throw "Current H5 source is missing a required release migration"
  }
  $serverVersion = $preLines[3]
  if ($serverVersion -notmatch '^\d+$' -or [int]$serverVersion -lt 170000 -or [int]$serverVersion -ge 180000) {
    throw "H5 PostgreSQL server major is not 17; stop and review before exporting"
  }
  if ($pre -notmatch '^\d+\|\d+\|\d+\|\d+$') {
    throw "Unexpected H5 count format; refusing backup"
  }
  $countFields = $pre.Split("|")
  if ([int]$countFields[0] -ne $ExpectedMigrationCount -or
      [int]$countFields[3] -ne $ExpectedPublicTables) {
    throw "H5 migrations/tables differ from required release baseline; no backup accepted"
  }
  $dumpCommand = 'exec pg_dump -d "$H5_DATABASE_URL" --schema=public --format=custom --no-owner --no-privileges --serializable-deferrable --file=/tmp/h5-fresh.dump'
  docker exec $container sh -c $dumpCommand | Out-Null
  Assert-DockerExit "create consistent read-only public-schema dump"
  $postLines = @((docker exec $container sh -c $metaCommand | Out-String).Trim() -split '\r?\n')
  Assert-DockerExit "recheck H5 metadata after dump"
  if (($postLines -join '|') -ne ($preLines -join '|')) {
    throw "H5 metadata changed during export; refusing inconsistent evidence"
  }
  docker cp "$($container):/tmp/h5-fresh.dump" $plainDump | Out-Null
  Assert-DockerExit "copy plaintext into temporary local staging"
  $dumpBytes = [IO.File]::ReadAllBytes($plainDump)
  if ($dumpBytes.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($dumpBytes, 0, 5) -ne "PGDMP") {
    throw "Export was not a PostgreSQL custom-format archive"
  }
  Add-Type -AssemblyName System.Security
  $encryptedBytes = [Security.Cryptography.ProtectedData]::Protect(
    $dumpBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [Array]::Clear($dumpBytes, 0, $dumpBytes.Length)
  $stagedArchive = Join-Path $stage $archiveName
  [IO.File]::WriteAllBytes($stagedArchive, $encryptedBytes)
  [Array]::Clear($encryptedBytes, 0, $encryptedBytes.Length)
  $hash = (Get-FileHash -LiteralPath $stagedArchive -Algorithm SHA256).Hash.ToUpperInvariant()
  $manifest = [ordered]@{
    project = $ExpectedProjectId
    backupScope = "public schema only"
    encryption = "Windows DPAPI CurrentUser"
    postgresClient = "17"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    file = $archiveName
    encryptedSha256 = $hash
    restore = "PENDING"
    sourceCounts = $pre
    restoredCounts = $pre
    exclusions = "Storage object bytes; Supabase platform-managed schemas"
  }
  $stagedManifest = "$stagedArchive.manifest.json"
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stagedManifest -Encoding UTF8
  $verifier = Join-Path $PSScriptRoot "h5-verify-encrypted-restore.ps1"
  $verifyResult = (& $verifier -EncryptedArchivePath $stagedArchive -ManifestPath $stagedManifest -ExpectedProjectId $ExpectedProjectId -RequiredMigrations $requiredNames | Out-String)
  if ($verifyResult -notmatch "(?m)^RESULT=PASS\r?$" -or
      $verifyResult -notmatch "RESTORED_COUNTS=$([regex]::Escape($pre))" -or
      $verifyResult -notmatch "REQUIRED_MIGRATIONS=PASS") {
    throw "PG17 offline restore did not match the freshly exported H5 schema"
  }
  $manifest.restore = "PASS"
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stagedManifest -Encoding UTF8
  Move-Item -LiteralPath $stagedArchive -Destination $archivePath -ErrorAction Stop
  Move-Item -LiteralPath $stagedManifest -Destination "$archivePath.manifest.json" -ErrorAction Stop
  Write-Output "RESULT=PASS"
  Write-Output "MODE=FRESH_H5_PUBLIC_SCHEMA"
  Write-Output "POSTGRES_CLIENT=17"
  Write-Output "SOURCE_COUNTS=$pre"
  Write-Output "RESTORE_COUNTS=$pre"
  Write-Output "ARCHIVE_SHA256=$hash"
  Write-Output "ARCHIVE_FILE=$archiveName"
  Write-Output "SCOPE=PUBLIC_SCHEMA_ONLY"
  Write-Output "NOTE=Offsite recovery and Supabase-managed schemas are separate release gates"
}
finally {
  if ($running) { docker stop $container 2>$null | Out-Null }
  if (Test-Path -LiteralPath $plainDump) { Remove-Item -LiteralPath $plainDump -Force }
  if (Test-Path -LiteralPath $sqlFile) { Remove-Item -LiteralPath $sqlFile -Force }
  if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Force -Recurse }
}
