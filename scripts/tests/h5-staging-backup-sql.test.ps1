# Offline regression for case-sensitive SQL in Windows PowerShell + docker.exe.
# Never connects to Supabase; creates an isolated PostgreSQL 17 container.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$container = "nexpos-h5-sql-qa-" + [guid]::NewGuid().ToString("N").Substring(0,12)
$folder = Join-Path ([IO.Path]::GetTempPath()) ("nexpos-h5-sql-" + [guid]::NewGuid().ToString("N"))
$backupScript = Join-Path $PSScriptRoot "../h5-staging-backup-restore.ps1"
$utf8 = New-Object Text.UTF8Encoding($false)

function Check([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed (exit $LASTEXITCODE)." }
}
function Extract-Sql([string]$field, [string]$destination) {
    $source = [IO.File]::ReadAllText($backupScript)
    $pattern = '(?m)^\s+\$' + $field + " = '(.*)'\s*$"
    $match = [regex]::Match($source, $pattern)
    if (-not $match.Success) { throw "Could not find $field in backup script." }
    $sql = $match.Groups[1].Value.Replace("''","'")
    [IO.File]::WriteAllText($destination, $sql + [Environment]::NewLine, $utf8)
}

try {
    [void][IO.Directory]::CreateDirectory($folder)
    & docker.exe run --rm -d --name $container -e POSTGRES_USER=h5qa -e POSTGRES_PASSWORD=local-test-only -e POSTGRES_DB=h5qa postgres:17-alpine | Out-Null
    Check "Start offline PostgreSQL 17 QA"
    $ready = $false
    for ($i=0; $i -lt 30; $i++) {
        & docker.exe exec $container pg_isready -U h5qa -d h5qa 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready=$true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Local PostgreSQL 17 did not start." }

    $ddl = 'CREATE TABLE public._migrations (id INTEGER); CREATE TABLE public."Business" (id INTEGER); CREATE TABLE public."Product" (id INTEGER); INSERT INTO public._migrations VALUES (1); INSERT INTO public."Business" VALUES (1); INSERT INTO public."Product" VALUES (1);'
    $setup = Join-Path $folder "create-quoted.sql"
    [IO.File]::WriteAllText($setup, $ddl + [Environment]::NewLine, $utf8)
    & docker.exe cp $setup ($container + ":/tmp/create-quoted.sql") | Out-Null
    Check "Copy fixture"
    & docker.exe exec $container psql -X -U h5qa -d h5qa -v ON_ERROR_STOP=1 -f /tmp/create-quoted.sql | Out-Null
    Check "Seed case-sensitive tables"

    $countsPath = Join-Path $folder "h5-counts.sql"
    Extract-Sql "countSql" $countsPath
    & docker.exe cp $countsPath ($container + ":/tmp/h5-counts.sql") | Out-Null
    Check "Copy source counts statement"
    $countResult = & docker.exe exec $container psql -X -U h5qa -d h5qa -At -v ON_ERROR_STOP=1 -f /tmp/h5-counts.sql
    Check "Run counts SQL file"
    if (($countResult | Select-Object -Last 1) -ne "1|1|1|3") {
        throw "Incorrect case-sensitive counts: $countResult"
    }

    $extensionsPath = Join-Path $folder "extensions.sql"
    Extract-Sql "extensionSql" $extensionsPath
    & docker.exe cp $extensionsPath ($container + ":/tmp/extensions.sql") | Out-Null
    Check "Copy extension statement"
    & docker.exe exec $container psql -X -U h5qa -d h5qa -v ON_ERROR_STOP=1 -f /tmp/extensions.sql | Out-Null
    Check "Restore prerequisite extensions"

    Write-Output "PASS: H5 source/restore count SQL preserves quoted Business and Product names."
    Write-Output "PASS: H5 restore prerequisite SQL executes with quoted uuid-ossp."
    Write-Output "No remote database contacted."
} finally {
    & docker.exe rm -f $container 2>&1 | Out-Null
    if (Test-Path $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
}
