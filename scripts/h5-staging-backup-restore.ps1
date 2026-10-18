# H5 STAGING ONLY. Public-schema logical export, isolated PG17 restore,
# and Windows DPAPI CurrentUser encryption. Never paste DB secrets into chat.
# Set H5_DATABASE_URL privately in a local PowerShell session to the
# Supabase H5 direct URL or port 5432 session-pooler connection URL.
# The backup is for the PUBLIC app schema only. It does not contain Storage
# object bytes or the Supabase-managed auth/storage service schemas.
[CmdletBinding()]
param(
    [switch]$PreflightOnly,
    [switch]$ValidateTargetOnly,
    [string]$BackupDirectory = "$env:USERPROFILE\Documents\NexPOS\H5-Backups"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$ref = "yslpoerviixlbeicbptp"
$image = "postgres:17-alpine"
$temp = $null
$container = $null

function CheckExit([string]$title) {
    if ($LASTEXITCODE -ne 0) { throw "$title failed (exit $LASTEXITCODE)." }
}
function InvokeDockerCli([string[]]$command, [string]$title) {
    & docker.exe @command
    CheckExit $title
}

try {
    if (-not $ValidateTargetOnly) {
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
            throw "Docker Desktop is required."
        }
        InvokeDockerCli @("run","--rm",$image,"pg_dump","--version") "pg_dump 17 preflight"
        InvokeDockerCli @("run","--rm",$image,"pg_restore","--version") "pg_restore 17 preflight"
    }
    if ($PreflightOnly) {
        Write-Output "PASS: PG17 backup/restore tools available, no database contacted."
        return
    }

    $conn = [Environment]::GetEnvironmentVariable("H5_DATABASE_URL")
    if ([string]::IsNullOrWhiteSpace($conn)) {
        throw "H5_DATABASE_URL missing. Set it privately from H5 Supabase Connect. Do not put it in Git or chat."
    }
    # The copied Supabase URI may have whitespace around it or an optional
    # ?sslmode=require suffix. Do not print its value or password on error.
    try { $uri = [uri]$conn.Trim() } catch { throw "H5 target rejected: invalid PostgreSQL URI. Check percent-encoding of password punctuation." }
    if ($uri.Scheme -notin @("postgres","postgresql")) { throw "H5 target rejected: invalid scheme." }
    $hostName = $uri.DnsSafeHost.ToLowerInvariant()
    $parts = $uri.UserInfo.Split(":",2)
    if ($parts.Length -ne 2) { throw "H5 target rejected: missing username or password in the URI." }
    $pgUser = [uri]::UnescapeDataString($parts[0])
    $pgPassword = [uri]::UnescapeDataString($parts[1])
    $port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
    $directHost = $hostName -eq "db.$ref.supabase.co"
    $poolerHost = $hostName -match '^[a-z0-9.-]+\.pooler\.supabase\.com$'
    if (-not ($directHost -or $poolerHost)) {
        throw "H5 target rejected: host is not an approved Supabase H5 direct/session-pooler hostname. Check project selection and percent-encode password special characters."
    }
    if ($port -ne 5432) {
        throw "H5 target rejected: expected port 5432 (Session pooler). Transaction pooler port 6543 cannot be used here."
    }
    if (($directHost -and $pgUser -ne "postgres") -or
        ($poolerHost -and $pgUser -ne "postgres.$ref")) {
        throw "H5 target rejected: username does not identify H5 staging. Select H5 in Supabase Connect, Session pooler, Type URI."
    }
    if ($uri.AbsolutePath -ne "/postgres") {
        throw "H5 target rejected: database path must be /postgres."
    }
    if ($uri.Fragment -or ($uri.Query -and $uri.Query -ne "?sslmode=require")) {
        throw "H5 target rejected: unsupported URI options. Only ?sslmode=require is allowed; percent-encode special characters in the password."
    }
    if (-not $pgPassword -or $pgPassword.Contains([char]10) -or $pgPassword.Contains([char]13)) {
        throw "H5 target rejected: invalid password."
    }
    if ($pgPassword -eq "[YOUR-PASSWORD]" -or $pgPassword -eq "YOUR-PASSWORD") {
        throw "H5 target rejected: [YOUR-PASSWORD] is still a placeholder. Enter the actual H5 database password privately."
    }
    if ($ValidateTargetOnly) {
        Write-Output "PASS: URI identifies approved H5 staging, port 5432 and database postgres. No database connection attempted."
        return
    }

    $backupDir = [IO.Path]::GetFullPath($BackupDirectory)
    [void][IO.Directory]::CreateDirectory($backupDir)
    $temp = Join-Path ([IO.Path]::GetTempPath()) ("nexpos-h5-" + [guid]::NewGuid().ToString("N"))
    [void][IO.Directory]::CreateDirectory($temp)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $temp /inheritance:r /grant:r "$($identity):(OI)(CI)F" | Out-Null
    CheckExit "Restrict temporary folder"

    $envFile = Join-Path $temp "source.env"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($envFile, @(
        "PGHOST=$hostName", "PGPORT=$port", "PGUSER=$pgUser",
        "PGPASSWORD=$pgPassword", "PGDATABASE=postgres",
        "PGSSLMODE=require", "PGCONNECT_TIMEOUT=20"
    ), $utf8)
    Remove-Variable pgPassword -ErrorAction SilentlyContinue
    $mount = $temp + ":/backup"
    # Windows PowerShell's native argument conversion can strip double
    # quotes from -c statements, turning public."Business" into public.business.
    # A mounted SQL file preserves the quoted PostgreSQL identifiers.
    $countSql = 'SELECT (SELECT count(*) FROM public._migrations), (SELECT count(*) FROM public."Business"), (SELECT count(*) FROM public."Product"), (SELECT count(*) FROM information_schema.tables WHERE table_schema = ''public'' AND table_type = ''BASE TABLE'');'
    $countSqlPath = Join-Path $temp "h5-counts.sql"
    [IO.File]::WriteAllText($countSqlPath, ($countSql + [Environment]::NewLine), $utf8)
    $sourceCounts = & docker.exe run --rm --env-file $envFile -v $mount $image psql -X -At -v ON_ERROR_STOP=1 -f /backup/h5-counts.sql postgres
    CheckExit "H5 source metadata read"
    $sourceCounts = ($sourceCounts | Select-Object -Last 1)
    if ($sourceCounts -notmatch '^\d+\|\d+\|\d+\|\d+$') {
        throw "H5 source metadata returned unexpected counters."
    }
    # Only start the dump after we have proved that this statement can
    # query the case-sensitive NexPOS schema on the source.
    InvokeDockerCli @("run","--rm","--env-file",$envFile,"-v",$mount,$image,
        "pg_dump","--format=custom","--schema=public","--no-owner","--no-privileges",
        "--file=/backup/h5-public.dump","postgres") "H5 public schema dump"
    Remove-Item -LiteralPath $envFile -Force
    $plain = Join-Path $temp "h5-public.dump"
    if ((Get-Item -LiteralPath $plain).Length -lt 1000) { throw "Backup unexpectedly small." }
    $list = & docker.exe run --rm -v $mount $image pg_restore --list /backup/h5-public.dump
    CheckExit "Verify archive TOC"
    if (-not ($list -match "TABLE public")) { throw "Archive missing public tables." }

    $container = "nexpos-h5-restore-" + [guid]::NewGuid().ToString("N").Substring(0,12)
    InvokeDockerCli @("run","-d","--rm","--name",$container,
        "-e","POSTGRES_USER=h5restore","-e","POSTGRES_PASSWORD=local-test-only",
        "-e","POSTGRES_DB=h5restore",$image) "Start isolated restore container"
    $ready = $false
    for ($i=0; $i -lt 35; $i++) {
        & docker.exe exec $container pg_isready -U h5restore -d h5restore 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready=$true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Isolated restore database did not start." }
    # Also send extension names as SQL files: "uuid-ossp" must retain quotes
    # when passed through Windows PowerShell to docker.exe.
    $extensionSqlPath = Join-Path $temp "h5-restore-extensions.sql"
    $extensionSql = 'CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;'
    [IO.File]::WriteAllText($extensionSqlPath, ($extensionSql + [Environment]::NewLine), $utf8)
    InvokeDockerCli @("cp",$extensionSqlPath,($container + ":/tmp/h5-restore-extensions.sql")) "Copy restore prerequisites"
    InvokeDockerCli @("exec",$container,"psql","-X","-U","h5restore","-d","h5restore",
        "-v","ON_ERROR_STOP=1","-f","/tmp/h5-restore-extensions.sql") "Restore prerequisite extensions"
    InvokeDockerCli @("cp",$plain,($container + ":/tmp/h5-public.dump")) "Copy dump for restore"
    InvokeDockerCli @("exec",$container,"pg_restore","--exit-on-error","--no-owner",
        "--no-privileges","--clean","--if-exists","-U","h5restore",
        "-d","h5restore","/tmp/h5-public.dump") "H5 restore rehearsal"
    InvokeDockerCli @("cp",$countSqlPath,($container + ":/tmp/h5-counts.sql")) "Copy count SQL into isolated restore"
    $restored = & docker.exe exec $container psql -X -U h5restore -d h5restore -At -v ON_ERROR_STOP=1 -f /tmp/h5-counts.sql
    CheckExit "Verify H5 restored counts"
    $restored = ($restored | Select-Object -Last 1)
    if ($restored -ne $sourceCounts) {
        throw "RESTORE_MISMATCH: H5 source and restored migration, business, product, or table counts differ."
    }

    $bytes = [IO.File]::ReadAllBytes($plain)
    $sealed = [Security.Cryptography.ProtectedData]::Protect(
        $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $name = "NexPOS-H5-public-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".pgdump.dpapi"
    $destination = Join-Path $backupDir $name
    [IO.File]::WriteAllBytes($destination, $sealed)
    $verifiedBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes($destination), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$bytes, [byte[]]$verifiedBytes)) {
        Remove-Item -LiteralPath $destination -Force
        throw "BACKUP_ENCRYPTION_MISMATCH: archive failed a DPAPI roundtrip check."
    }
    $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    $manifest = [ordered]@{
        project=$ref; backupScope="public schema only"
        encryption="Windows DPAPI CurrentUser"; postgresClient="17"
        createdAt=(Get-Date).ToUniversalTime().ToString("o")
        file=$name; encryptedSha256=$hash; restore="PASS"
        sourceCounts=$sourceCounts; restoredCounts=$restored
        exclusions="Storage object bytes; Supabase platform-managed schemas"
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath ($destination + ".manifest.json") -Encoding UTF8
    Write-Output "H5 PUBLIC BACKUP AND LOCAL RESTORE PASS"
    Write-Output "Encrypted backup: $destination"
    Write-Output "Manifest: $($destination).manifest.json"
    Write-Output "Matching source/restore counters (migrations|businesses|products|tables): $restored"
    Write-Output "Encrypted SHA256: $hash"
} finally {
    if ($container) { & docker.exe rm -f $container 2>&1 | Out-Null }
    if ($temp -and (Test-Path -LiteralPath $temp)) {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
