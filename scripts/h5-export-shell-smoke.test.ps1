# Offline regression for Windows PowerShell -> Docker -> PostgreSQL quoting.
# No H5 network access, credentials, published ports, or staging/production data.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/h5-export-shell-smoke.test.ps1
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$container = "nexpos-h5-shell-qa-" + [Guid]::NewGuid().ToString("N").Substring(0, 10)
$temp = Join-Path $env:TEMP ("nexpos-h5-shell-qa-" + [Guid]::NewGuid().ToString("N"))
$started = $false

function Assert-Docker([string]$action) {
  if ($LASTEXITCODE -ne 0) { throw "Offline shell regression failed at $action" }
}

try {
  New-Item -ItemType Directory -Path $temp | Out-Null
  $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "h5-create-fresh-encrypted-backup.ps1"))
  foreach ($name in @("metaScript", "dumpScript")) {
    $marker = '$' + $name + ' = @' + [char]39
    $start = $source.IndexOf($marker, [StringComparison]::Ordinal)
    if ($start -lt 0) { throw "Missing $name in reviewed exporter" }
    $begin = $source.IndexOf([char]10, $start) + 1
    $end = $source.IndexOf(([string][char]39 + '@'), $begin, [StringComparison]::Ordinal)
    if ($begin -le 0 -or $end -lt $begin) { throw "Invalid $name wrapper" }
    $script = $source.Substring($begin, $end - $begin).Replace([string][char]13, "").TrimEnd() + [char]10
    if ($script -match 'postgresql://|secret|password') {
      throw "A shell wrapper may not include a database credential"
    }
    [IO.File]::WriteAllText((Join-Path $temp "$name.sh"), $script, (New-Object Text.UTF8Encoding($false)))
  }
  $schema = @'
CREATE TABLE public._migrations (name text PRIMARY KEY);
CREATE TABLE public."Business" (id text PRIMARY KEY);
CREATE TABLE public."Sale" (id text PRIMARY KEY);
INSERT INTO public._migrations(name) VALUES ('0040_product_media'), ('0048_h4r9_tenant_integrity'), ('0049_order_notification_outbox');
'@
  [IO.File]::WriteAllText((Join-Path $temp "setup.sql"), $schema, (New-Object Text.UTF8Encoding($false)))
  $query = @'
SELECT (SELECT count(*) FROM public._migrations), (SELECT count(*) FROM public."Business"), (SELECT count(*) FROM public."Sale"), (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public');
SELECT name FROM public._migrations WHERE name IN ('0040_product_media','0048_h4r9_tenant_integrity','0049_order_notification_outbox') ORDER BY name;
SELECT current_setting('server_version_num');
'@
  [IO.File]::WriteAllText((Join-Path $temp "source-counts.sql"), $query, (New-Object Text.UTF8Encoding($false)))

  docker run --rm -d --name $container --network none -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=pos -e POSTGRES_DB=pos -e H5_DATABASE_URL=postgresql://pos:pos@localhost:5432/pos postgres:17-alpine | Out-Null
  Assert-Docker "launch private PostgreSQL 17 fixture"
  $started = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    docker exec $container pg_isready -U pos -d pos *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Disposable PostgreSQL 17 was not ready" }

  docker cp (Join-Path $temp "setup.sql") "$($container):/tmp/h5-setup.sql" | Out-Null
  Assert-Docker "copy fixture SQL"
  docker exec $container psql -X -v ON_ERROR_STOP=1 -U pos -d pos -f /tmp/h5-setup.sql | Out-Null
  Assert-Docker "initialize synthetic schema"
  docker cp (Join-Path $temp "source-counts.sql") "$($container):/tmp/h5-source-counts.sql" | Out-Null
  Assert-Docker "copy metadata SQL"
  docker cp (Join-Path $temp "metaScript.sh") "$($container):/tmp/h5-meta.sh" | Out-Null
  Assert-Docker "copy production metadata wrapper"
  docker cp (Join-Path $temp "dumpScript.sh") "$($container):/tmp/h5-dump.sh" | Out-Null
  Assert-Docker "copy production dump wrapper"

  $results = @((docker exec -e "PGOPTIONS=-c default_transaction_read_only=on" $container sh /tmp/h5-meta.sh | Out-String).Trim() -split '\r?\n')
  Assert-Docker "execute production metadata wrapper"
  if ($results.Count -ne 5 -or $results[0] -ne "3|0|0|3" -or
      $results[1] -ne "0040_product_media" -or
      $results[2] -ne "0048_h4r9_tenant_integrity" -or
      $results[3] -ne "0049_order_notification_outbox" -or
      [int]$results[4] -lt 170000 -or [int]$results[4] -ge 180000) {
    throw "Quoted pipe separator or metadata results are incorrect"
  }
  docker exec -e "PGOPTIONS=-c default_transaction_read_only=on" $container sh /tmp/h5-dump.sh | Out-Null
  Assert-Docker "execute production dump wrapper"
  $dump = Join-Path $temp "roundtrip.dump"
  docker cp "$($container):/tmp/h5-fresh.dump" $dump | Out-Null
  Assert-Docker "copy synthetic dump"
  $bytes = [IO.File]::ReadAllBytes($dump)
  if ($bytes.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($bytes, 0, 5) -ne "PGDMP") {
    throw "Dump wrapper did not generate a PostgreSQL custom-format archive"
  }
  Write-Output "RESULT=PASS"
  Write-Output "MODE=DISPOSABLE_NO_NETWORK_PG17"
  Write-Output "METADATA_WRAPPER=PASS"
  Write-Output "DUMP_WRAPPER=PASS"
  Write-Output "SOURCE_COUNTS=3|0|0|3"
  Write-Output "REAL_H5_DATABASE=NOT_TOUCHED"
}
finally {
  if ($started) { docker stop $container 2>$null | Out-Null }
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
