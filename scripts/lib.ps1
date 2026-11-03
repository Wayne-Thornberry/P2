#Requires -Version 5.1
<#
  The functions this project dot-sources. Nothing here is meant to be run directly: this
  is what start.ps1 uses to build the local database, and what .github\workflows\deploy.yml
  uses to bootstrap the database, publish the schema and explain what went wrong.

    . .\scripts\lib.ps1

  Database      Split-SqlScript, Invoke-SqlScript, Test-FolioDatabaseExists,
                New-FolioDatabase, Remove-FolioDatabase, Initialize-FolioDatabase,
                Invoke-FolioMigrations
  Deploy        New-DeployConnectionString, Set-IISPoolState
  Diagnostics   Show-SiteDiagnostics
#>

# ── database ─────────────────────────────────────────────────────────────────────
# Two ways to get a database, and they serve different places.
#
#   Initialize-FolioDatabase builds one from the model scripts (Schemas, Types, Tables,
#   PostDeployment): a fresh database exactly as the project describes it, which is what
#   a laptop and a test run need. -Rebuild drops what was there first, and nothing in a
#   deploy calls it.
#
#   Invoke-FolioMigrations applies the numbered scripts to a database that already exists.
#   A deploy runs those and then lets SqlPackage bring the schema into line.
#
# Neither ever creates or drops a database as part of a deploy: the bootstrap step in
# deploy.yml -- idempotent, and run on every deploy -- creates it if it is missing and
# grants the two Windows identities that use it.
function Split-SqlScript {
    param([Parameter(Mandatory = $true)][string]$Path)

    $raw = [System.IO.File]::ReadAllText($Path)
    $lines = $raw -split "`r?`n"

    $result = @()
    $current = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
        if ($line -match '^\s*GO\s*(?<count>\d+)?\s*$') {
            $batchText = ($current -join "`n")
            if ($batchText.Trim().Length -gt 0) {
                $count = 0
                if ($Matches['count']) { $count = [int]$Matches['count'] }
                if ($count -lt 1) { $count = 1 }
                for ($i = 0; $i -lt $count; $i++) { $result += $batchText }
            }
            $current = New-Object System.Collections.Generic.List[string]
        } else {
            [void]$current.Add($line)
        }
    }

    $batchText = ($current -join "`n")
    if ($batchText.Trim().Length -gt 0) { $result += $batchText }

    return $result
}

function Invoke-SqlScript {
    param(
        [Parameter(Mandatory = $true)][System.Data.SqlClient.SqlConnection]$Connection,
        [Parameter(Mandatory = $true)][string]$Path
    )

    # Batches are executed one at a time on the same connection, so an earlier batch is
    # visible to a later one -- which is what a script needs when it drops a column and
    # then the type that column used.
    foreach ($batch in (Split-SqlScript -Path $Path)) {
        $command = $Connection.CreateCommand()
        try {
            $command.CommandText = $batch
            $command.CommandTimeout = 600
            [void]$command.ExecuteNonQuery()
        } catch {
            throw "$(Split-Path $Path -Leaf) failed: $($_.Exception.Message)"
        } finally {
            $command.Dispose()
        }
    }
}

function Test-FolioDatabaseExists {
    param([Parameter(Mandatory = $true)][string]$ConnectionString)

    # Built from the constructor: assigning .ConnectionString directly binds to the
    # indexer in Windows PowerShell 5.1 and throws "Keyword not supported".
    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder($ConnectionString)
    $database = $builder['Initial Catalog']

    # Ask master, because opening the target connection fails if the database is not there.
    $builder['Initial Catalog'] = 'master'

    $connection = New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = 'SELECT CASE WHEN DB_ID(@name) IS NULL THEN 0 ELSE 1 END'
        [void]$command.Parameters.AddWithValue('@name', $database)
        return ([int]$command.ExecuteScalar() -eq 1)
    } finally {
        $connection.Dispose()
    }
}

function New-FolioDatabase {
    param([Parameter(Mandatory = $true)][string]$ConnectionString)

    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder($ConnectionString)
    $database = $builder['Initial Catalog']
    $quoted = '[' + $database.Replace(']', ']]') + ']'
    $builder['Initial Catalog'] = 'master'

    $connection = New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = "IF DB_ID(N'$($database.Replace("'", "''"))') IS NULL CREATE DATABASE $quoted;"
        $command.CommandTimeout = 300
        [void]$command.ExecuteNonQuery()
    } finally {
        $connection.Dispose()
    }
}

function Remove-FolioDatabase {
    param([Parameter(Mandatory = $true)][string]$ConnectionString)

    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder($ConnectionString)
    $database = $builder['Initial Catalog']
    $quoted = '[' + $database.Replace(']', ']]') + ']'
    $builder['Initial Catalog'] = 'master'

    # A pooled connection keeps a handle on the database, and it cannot be dropped while
    # one is open.
    [System.Data.SqlClient.SqlConnection]::ClearAllPools()

    $connection = New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = @"
IF DB_ID(N'$($database.Replace("'", "''"))') IS NOT NULL
BEGIN
    ALTER DATABASE $quoted SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE $quoted;
END
"@
        $command.CommandTimeout = 300
        [void]$command.ExecuteNonQuery()
    } finally {
        $connection.Dispose()
    }
}

function Initialize-FolioDatabase {
    param(
        [Parameter(Mandatory = $true)][string]$ConnectionString,
        [Parameter(Mandatory = $true)][string]$ScriptsRoot,
        [switch]$Rebuild
    )

    if ($Rebuild) {
        Write-Host '  Dropping the database. Its data is discarded.' -ForegroundColor Yellow
        Remove-FolioDatabase -ConnectionString $ConnectionString
    }

    New-FolioDatabase -ConnectionString $ConnectionString

    $connection = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
    try {
        $connection.Open()

        # In dependency order: a schema must exist before anything lives in it, and a
        # type before a table is declared in terms of it.
        foreach ($file in Get-ChildItem -Path (Join-Path $ScriptsRoot 'Schemas') -Filter *.sql | Sort-Object Name) {
            Write-Host "  $($file.Name)" -ForegroundColor DarkGray
            Invoke-SqlScript -Connection $connection -Path $file.FullName
        }

        # A project may have no user-defined types, and a folder with nothing in it is not
        # an error -- the model simply has none.
        $types = Join-Path $ScriptsRoot 'Types'
        if (Test-Path $types) {
            foreach ($file in Get-ChildItem -Path $types -Filter *.sql | Sort-Object Name) {
                Write-Host "  $($file.Name)" -ForegroundColor DarkGray
                Invoke-SqlScript -Connection $connection -Path $file.FullName
            }
        }

        # Tables are named after what they hold, not the order they can be created in,
        # and every foreign key needs the table it points at to exist first. Anything
        # that fails waits for the next pass, so a table that is merely early sorts
        # itself out; a pass where nothing succeeds means the failure is real.
        $pending = @(Get-ChildItem -Path (Join-Path $ScriptsRoot 'Tables') -Filter *.sql | Sort-Object Name)

        while ($pending.Count -gt 0) {
            $deferred = @()
            $failure = $null

            foreach ($file in $pending) {
                try {
                    Write-Host "  $($file.Name)" -ForegroundColor DarkGray
                    Invoke-SqlScript -Connection $connection -Path $file.FullName
                } catch {
                    $deferred += $file
                    $failure = $_
                }
            }

            if ($deferred.Count -eq $pending.Count) { throw $failure }
            $pending = $deferred
        }

        # The reference data a deployment writes, so a fresh database starts with the
        # same rows the app ships with.
        Invoke-SqlScript -Connection $connection -Path (Join-Path $ScriptsRoot 'Scripts\PostDeployment.sql')
    } finally {
        $connection.Dispose()
    }

    # The migrations are idempotent, so running them here proves they apply to a
    # database built from the model -- that is, that the model and the scripts agree.
    Invoke-FolioMigrations -ConnectionString $ConnectionString -MigrationsDir (Join-Path $ScriptsRoot 'Scripts\Migrations')
}

function Invoke-FolioMigrations {
    param(
        [Parameter(Mandatory = $true)][string]$ConnectionString,
        [Parameter(Mandatory = $true)][string]$MigrationsDir
    )

    if (-not (Test-Path $MigrationsDir)) {
        Write-Host '  No migrations directory; nothing to run.' -ForegroundColor Gray
        return
    }

    $files = @(Get-ChildItem -Path $MigrationsDir -Filter *.sql | Sort-Object Name)
    if ($files.Count -eq 0) {
        Write-Host '  No migration scripts; nothing to run.' -ForegroundColor Gray
        return
    }

    if (-not (Test-FolioDatabaseExists -ConnectionString $ConnectionString)) {
        Write-Host '  The database does not exist yet; run Initialize-FolioDatabase instead.' -ForegroundColor Gray
        return
    }

    $connection = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
    try {
        $connection.Open()
        foreach ($file in $files) {
            Write-Host "  Applying $($file.Name)..." -ForegroundColor Cyan
            Invoke-SqlScript -Connection $connection -Path $file.FullName
            Write-Host "    [OK] $($file.Name)" -ForegroundColor Green
        }
    } finally {
        $connection.Dispose()
    }
}

# ── deploy ───────────────────────────────────────────────────────────────────────
# No credentials: the runner runs as NT AUTHORITY\SYSTEM and the bootstrap step granted it
# db_owner on the database. A password is only needed when the database is somewhere this
# box cannot reach as itself. Built with SqlConnectionStringBuilder, because a password
# containing ; or " would otherwise split the connection string, and the resulting
# "keyword not supported" says nothing about the password being the cause.
function New-DeployConnectionString {
    param(
        [Parameter(Mandatory = $true)][string]$Server,
        [Parameter(Mandatory = $true)][string]$Database,
        [string]$User = "",
        [string]$Password = ""
    )

    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $builder['Data Source'] = $Server
    $builder['Initial Catalog'] = $Database
    $builder['TrustServerCertificate'] = $true

    if ($User -and $Password) {
        $builder['User ID'] = $User
        $builder['Password'] = $Password
    } else {
        # Windows authentication: SQL Server sees whatever the caller runs as.
        $builder['Integrated Security'] = $true
    }

    return $builder.ConnectionString
}

# IIS provider cmdlets raise "Object on target path is already stopped" as an error and
# ignore -ErrorAction, so a deploy that failed after stopping the pools could not start
# them again. Checking the state first means the cmdlet is only called when it is needed.
function Set-IISPoolState {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][ValidateSet("Started", "Stopped")][string]$State
    )

    if (-not (Test-Path "IIS:\AppPools\$Name")) {
        Write-Host "[WARN] App pool $Name not found - create it first" -ForegroundColor Yellow
        return
    }

    if ((Get-WebAppPoolState -Name $Name).Value -eq $State) {
        Write-Host "[OK] $Name is already $($State.ToLower())" -ForegroundColor Green
        return
    }

    if ($State -eq "Started") {
        Start-WebAppPool -Name $Name
    } else {
        Stop-WebAppPool -Name $Name
    }

    # The cmdlet returns as soon as the request is queued, before the worker process has
    # actually gone. Waiting here means a following robocopy is not fighting files the
    # site still has open.
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-WebAppPoolState -Name $Name).Value -ne $State -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }

    Write-Host "[OK] $Name is $($State.ToLower())" -ForegroundColor Green
}

# ── diagnostics ──────────────────────────────────────────────────────────────────
# Printed after a smoke test has failed, for whoever is reading a red build log: what is
# bound, whether the pool is running and as what, and what is actually in the folder.
function Show-SiteDiagnostics {
    param(
        [Parameter(Mandatory = $true)][string]$SiteName,
        [Parameter(Mandatory = $true)][string]$PoolName,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$SitePath
    )

    Write-Host ''
    Write-Host "=== Diagnostics for $SiteName ===" -ForegroundColor Yellow

    Import-Module WebAdministration -ErrorAction SilentlyContinue

    Write-Host "App pool '$PoolName':"
    if (Test-Path "IIS:\AppPools\$PoolName") {
        $state = (Get-WebAppPoolState -Name $PoolName).Value
        $identity = (Get-ItemProperty "IIS:\AppPools\$PoolName" -Name processModel -ErrorAction SilentlyContinue).identityType
        $user = (Get-ItemProperty "IIS:\AppPools\$PoolName" -Name processModel -ErrorAction SilentlyContinue).userName
        Write-Host "  state:    $state"
        Write-Host "  identity: $identity $user"
    } else {
        Write-Host '  [missing]' -ForegroundColor Red
    }

    Write-Host "Site '$SiteName':"
    if (Test-Path "IIS:\Sites\$SiteName") {
        $site = Get-Item "IIS:\Sites\$SiteName"
        Write-Host "  physical path: $($site.physicalPath)"
        Write-Host "  app pool:      $($site.applicationPool)"
        Write-Host "  bindings:"
        foreach ($binding in $site.bindings.Collection) {
            Write-Host "    $($binding.protocol) $($binding.bindingInformation)"
        }
    } else {
        Write-Host '  [missing]' -ForegroundColor Red
    }

    Write-Host "Listening on port $Port :"
    $listening = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listening.Count -eq 0) {
        Write-Host '  nothing is listening' -ForegroundColor Red
    } else {
        foreach ($connection in $listening) {
            $owner = (Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            Write-Host "  $($connection.LocalAddress):$($connection.LocalPort) ($owner)"
        }
    }

    Write-Host "Contents of $SitePath :"
    if (Test-Path $SitePath) {
        Get-ChildItem -Path $SitePath -Force | Select-Object -First 20 | ForEach-Object { Write-Host "  $($_.Name)" }
    } else {
        Write-Host '  [missing]' -ForegroundColor Red
    }

    # AspNetCoreModuleV2 writes its failures here, and they are the ones that explain a
    # site that is up but answers 500.3.
    $logs = Join-Path $env:ProgramData 'Microsoft\IIS\AspNetCoreModuleV2'
    $harvest = Join-Path $env:ProgramFiles 'IIS Express\Logs'
    foreach ($folder in @($logs, $harvest)) {
        if (-not (Test-Path $folder)) { continue }

        $latest = Get-ChildItem -Path $folder -Filter *.log -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime | Select-Object -Last 1

        if ($latest) {
            Write-Host "Last 20 lines of $($latest.FullName):"
            Get-Content -Path $latest.FullName -Tail 20 | ForEach-Object { Write-Host "  $_" }
        }
    }

    Write-Host '=== End of diagnostics ===' -ForegroundColor Yellow
    Write-Host ''
}
