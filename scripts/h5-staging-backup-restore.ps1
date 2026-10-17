# H5 STAGING ONLY. Public-schema logical export, isolated PG17 restore,
# and Windows DPAPI CurrentUser encryption. Never paste DB secrets into chat.
# Set H5_DATABASE_URL privately in a local PowerShell session to the
# Supabase H5 direct URL or port 5432 session-pooler connection URL.
# The backup is for the PUBLIC app schema only. It does not contain Storage
# object bytes or the Supabase-managed auth/storage service schemas.
[CmdletBinding()]
param(
    [switch]$PreflightOnly,
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
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker Desktop is required."
    }
    InvokeDockerCli @("run","--rm",$image,"pg_dump","--version") "pg_dump 17 preflight"
    InvokeDockerCli @("run","--rm",$image,"pg_restore","--version") "pg_restore 17 preflight"
    if ($PreflightOnly) {
        Write-Output "PASS: PG17 backup/restore tools available, no database contacted."
        return
    }

    $conn = [Environment]::GetEnvironmentVariable("H5_DATABASE_URL")
    if ([string]::IsNullOrWhiteSpace($conn)) {
        throw "H5_DATABASE_URL missing. Set it privately from H5 Supabase Connect. Do not put it in Git or chat."
    }
    try { $uri = [uri]$conn } catch { throw "Invalid H5 PostgreSQL connection URL." }
    if ($uri.Scheme -notin @("postgres","postgresql")) { throw "H5 target rejected: invalid scheme." }
    $hostName = $uri.DnsSafeHost.ToLowerInvariant()
    $parts = $uri.UserInfo.Split(":",2)
    if ($parts.Length -ne 2) { throw "H5 target rejected: missing credentials." }
    $pgUser = [uri]::UnescapeDataString($parts[0])
    $pgPassword = [uri]::UnescapeDataString($parts[1])
    $port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
    $direct = $hostName -eq "db.$ref.supabase.co" -and $pgUser -eq "postgres" -and $port -eq 5432
    $pooler = $hostName.EndsWith(".pooler.supabase.com") -and $pgUser -eq "postgres.$ref" -and $port -eq 5432
    if (-not ($direct -or $pooler) -or $uri.AbsolutePath -ne "/postgres" -or $uri.Query -or $uri.Fragment) {
        throw "H5 target rejected: only the approved H5 direct DB or 5432 session pooler is accepted."
    }
    if (-not $pgPassword -or $pgPassword.Contains([char]10) -or $pgPassword.Contains([char]13)) {
        throw "H5 target rejected: invalid password."
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
    InvokeDockerCli @("run","--rm","--env-file",$envFile,"-v",$mount,$image,
        "pg_dump","--format=custom","--schema=public","--no-owner","--no-privileges",
        "--file=/backup/h5-public.dump","postgres") "H5 public schema dump"
    $countSql = 'SELECT (SELECT count(*) FROM public._migrations), (SELECT count(*) FROM public."Business"), (SELECT count(*) FROM public."Product"), (SELECT count(*) FROM information_schema.tables WHERE table_schema = ''public'' AND table_type = ''BASE TABLE'');'
    $sourceCounts = & docker.exe run --rm --env-file $envFile $image psql -At -v ON_ERROR_STOP=1 -c $countSql postgres
    CheckExit "H5 source metadata read"
    $sourceCounts = ($sourceCounts | Select-Object -Last 1)
    if ($sourceCounts -notmatch '^\d+\|\d+\|\d+\|\d+$') {
        throw "H5 source metadata returned unexpected counters."
    }
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
    $sql = 'CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;'
    InvokeDockerCli @("exec",$container,"psql","-U","h5restore","-d","h5restore",
        "-v","ON_ERROR_STOP=1","-c",$sql) "Restore prerequisite extensions"
    InvokeDockerCli @("cp",$plain,($container + ":/tmp/h5-public.dump")) "Copy dump for restore"
    InvokeDockerCli @("exec",$container,"pg_restore","--exit-on-error","--no-owner",
        "--no-privileges","--clean","--if-exists","-U","h5restore",
        "-d","h5restore","/tmp/h5-public.dump") "H5 restore rehearsal"
    $restored = & docker.exe exec $container psql -U h5restore -d h5restore -At -v ON_ERROR_STOP=1 -c $countSql
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
