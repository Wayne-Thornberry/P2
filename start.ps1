#Requires -Version 5.1
<#
.SYNOPSIS
  Builds and starts the site for local development in one window.

.DESCRIPTION
  Starts the API and the site's dev server together, waits until both answer, and opens
  the browser. Press Ctrl+C to stop everything.

    .\start.ps1            LocalDB, migrated, with the real API
    .\start.ps1 -Rebuild   the same, but the database is dropped and rebuilt first
    .\start.ps1 -Dev       a shared database, read and written as it is
    .\start.ps1 -Mock      no API and no database: the site's own fake API

  Two processes, whatever the number of apps: the API and the site. Every app is a
  route inside the one site, so adding one costs nothing here.

.PARAMETER Rebuild
  Drop the LocalDB database and build it again from Folio.Database's model scripts.
  Discards whatever was in it, which is the point. Not valid with -Dev or -Mock.

.PARAMETER Dev
  Use ConnectionStrings:Default from Folio.Api\appsettings.Development.json -- the
  shared box, read and written as it is. That file is gitignored because the box needs
  a login; copy appsettings.Development.example.json to it and fill it in.

.PARAMETER Mock
  Run against the site's fake API (Folio.Web\mocks\server.mjs): no database work, no API
  build, and nothing the browser does is saved.

.PARAMETER SkipInstall
  Do not run npm install when Folio.Web\node_modules is missing.

.PARAMETER NoBrowser
  Do not open the browser once everything is answering.

.EXAMPLE
  .\start.ps1

.EXAMPLE
  .\start.ps1 -Rebuild

.EXAMPLE
  .\start.ps1 -Mock
#>
[CmdletBinding()]
param(
    [switch]$Rebuild,
    [switch]$Dev,
    [switch]$Mock,
    [switch]$SkipInstall,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

if ($Rebuild -and ($Dev -or $Mock)) {
    throw '-Rebuild only applies to the LocalDB database, so it cannot be combined with -Dev or -Mock.'
}

$root = $PSScriptRoot

$apiProject   = Join-Path $root 'Folio.Api\Folio.Api.csproj'
$databaseDir  = Join-Path $root 'Folio.Database'
$webDir       = Join-Path $root 'Folio.Web'
$baseSettings = Join-Path $root 'Folio.Api\appsettings.json'
$devSettings  = Join-Path $root 'Folio.Api\appsettings.Development.json'

$siteUrl      = 'http://127.0.0.1:5420'
$apiUrl       = 'http://127.0.0.1:5421'

foreach ($path in @($apiProject, $webDir, $baseSettings)) {
    if (-not (Test-Path $path)) { throw "Not found: $path" }
}

<#
  The API's configuration reader allows // comments, so its settings files use them to
  say what each value is for. PowerShell's JSON reader does not, so whole-line comments
  are dropped before the file is read. Comments must therefore be on their own line.
#>
function Read-JsonSettings {
    param([Parameter(Mandatory = $true)][string]$Path)

    $lines = Get-Content $Path | Where-Object { $_ -notmatch '^\s*//' }
    return ($lines -join "`n" | ConvertFrom-Json)
}

# ── which database ────────────────────────────────────────────────────────────────
$connectionString = $null

if (-not $Mock) {
    $settingsFile = if ($Dev) { $devSettings } else { $baseSettings }

    if (-not (Test-Path $settingsFile)) {
        throw "Not found: $settingsFile`nCopy appsettings.Development.example.json to appsettings.Development.json and fill in the connection string."
    }

    $connectionString = (Read-JsonSettings -Path $settingsFile).ConnectionStrings.Default
    if (-not $connectionString) { throw "No ConnectionStrings:Default in $settingsFile" }

    # A LocalDB instance exists once, per user, and has to be started before anything
    # can connect to it.
    if ($connectionString -match '\(localdb\)\\(\w+)') {
        $instance = $Matches[1]
        $sqllocaldb = (Get-Command sqllocaldb -ErrorAction SilentlyContinue).Source
        if (-not $sqllocaldb) {
            $sqllocaldb = Get-ChildItem 'C:\Program Files\Microsoft SQL Server\*\Tools\Binn\SqlLocalDB.exe' -ErrorAction SilentlyContinue |
                Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
        }
        if (-not $sqllocaldb) { throw 'LocalDB is not installed. Install SQL Server Express LocalDB, or use -Dev with a real server.' }

        if (@(& $sqllocaldb info | ForEach-Object { $_.Trim() }) -notcontains $instance) {
            Write-Host "Creating the LocalDB instance '$instance'..." -ForegroundColor Cyan
            & $sqllocaldb create $instance -s | Out-Null
        } else {
            $state = & $sqllocaldb info $instance | Select-String -Pattern '^State:'
            if (-not $state -or $state.ToString() -notmatch 'Running') {
                & $sqllocaldb start $instance | Out-Null
            }
        }
    }
}

# ── dependencies ──────────────────────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $webDir 'node_modules'))) {
    if ($SkipInstall) {
        Write-Warning 'Folio.Web has no node_modules and -SkipInstall was given; the dev server will fail.'
    } else {
        Write-Host 'Installing npm packages...' -ForegroundColor Cyan
        Push-Location $webDir
        npm install
        if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm install failed.' }
        Pop-Location
    }
}

# ── the database ────────────────────────────────────────────────────────────────
# LocalDB, built from the model scripts in Folio.Database and then migrated. The box
# gets its database a different way -- setup.ps1 creates it, then sqlpackage publishes
# the model -- so none of this is shared with the deploy.

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
        # type before a table is declared in terms of it. A project whose model declares
        # no types of its own simply has no folder to walk.
        foreach ($folder in @('Schemas', 'Types')) {
            $directory = Join-Path $ScriptsRoot $folder
            if (-not (Test-Path $directory)) { continue }

            foreach ($file in Get-ChildItem -Path $directory -Filter *.sql | Sort-Object Name) {
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

# ── build ─────────────────────────────────────────────────────────────────────────
if (-not $Mock) {
    Write-Host '=== Building the API ===' -ForegroundColor Cyan
    dotnet build $apiProject -v quiet --nologo
    if ($LASTEXITCODE -ne 0) { throw 'The API did not build.' }

    if ($Rebuild) {
        Write-Host '=== Rebuilding the database from the model scripts (its data is discarded) ===' -ForegroundColor Cyan
        Initialize-FolioDatabase -ConnectionString $connectionString -ScriptsRoot $databaseDir -Rebuild
    } else {
        # A first run has no database at all, so it is built from the model. After that
        # only the numbered migrations need applying: they are what an older database
        # gains a new column or table from.
        if (Test-FolioDatabaseExists -ConnectionString $connectionString) {
            Write-Host '=== Applying database migrations ===' -ForegroundColor Cyan
            Invoke-FolioMigrations -ConnectionString $connectionString -MigrationsDir (Join-Path $databaseDir 'Scripts\Migrations')
        } else {
            Write-Host '=== Creating the database from the model scripts ===' -ForegroundColor Cyan
            Initialize-FolioDatabase -ConnectionString $connectionString -ScriptsRoot $databaseDir
        }
    }
}

# ── start everything ──────────────────────────────────────────────────────────────
$children = New-Object System.Collections.ArrayList

function Start-Child {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [hashtable]$Environment = @{}
    )

    $saved = @{}
    foreach ($key in $Environment.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
    }

    Write-Host "Starting $Name..." -ForegroundColor Cyan
    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -PassThru -NoNewWindow

    foreach ($key in $saved.Keys) {
        [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process')
    }

    [void]$children.Add([pscustomobject]@{ Name = $Name; Process = $process })
}

function Wait-ForUrl {
    param([string]$Url, [int]$TimeoutSeconds = 180, [string]$Name)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        try {
            # Any answer below 500 means it is listening and serving.
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {
            $code = 0
            if ($_.Exception.Response) { try { $code = [int]$_.Exception.Response.StatusCode } catch { $code = 0 } }
            if ($code -ge 200 -and $code -lt 500) { return }
        }

        Start-Sleep -Milliseconds 500
    }

    throw "$Name never answered at $Url."
}

<#
  Stops a process and everything it started. A dev server is npm, which runs vite, which
  runs esbuild: stopping npm alone leaves the port held by a process nobody can see any
  more.
#>
function Stop-Tree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $offspring = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $offspring) { Stop-Tree -ProcessId $child.ProcessId }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

try {
    if ($Mock) {
        Start-Child -Name 'mock API' `
            -FilePath 'node' -ArgumentList @('mocks\server.mjs') -WorkingDirectory $webDir

        Start-Child -Name 'site' `
            -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') -WorkingDirectory $webDir `
            -Environment @{ Folio_MOCK = '1' }
    } else {
        # The AI features need a key, and a developer's own goes in the environment rather
        # than in a file: with none set, the pages simply do not offer them.
        $apiEnvironment = @{
            ASPNETCORE_URLS            = $apiUrl
            ConnectionStrings__Default = $connectionString
        }

        if ($env:DEEPSEEK_API_KEY) { $apiEnvironment['Ai__DeepSeek__ApiKey'] = $env:DEEPSEEK_API_KEY }

        Start-Child -Name 'API' `
            -FilePath 'dotnet' `
            -ArgumentList @('run', '--project', $apiProject, '--no-build') `
            -WorkingDirectory $root `
            -Environment $apiEnvironment

        Start-Child -Name 'site' -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') -WorkingDirectory $webDir
    }

    if (-not $Mock) { Wait-ForUrl -Url "$apiUrl/api/health" -Name 'The API' }
    Wait-ForUrl -Url "$siteUrl/" -Name 'The site'

    Write-Host ''
    Write-Host "  $siteUrl" -ForegroundColor Green
    if ($Mock) {
        Write-Host '  Mock mode: nothing is saved.' -ForegroundColor Yellow
    } else {
        Write-Host "  API at $apiUrl"
    }
    Write-Host ''
    Write-Host 'Press Ctrl+C to stop.' -ForegroundColor DarkGray

    if (-not $NoBrowser) { Start-Process $siteUrl | Out-Null }

    # Nothing to wait on but the children: leaving when one dies beats sitting in front
    # of a site that is half gone.
    while ($true) {
        Start-Sleep -Seconds 1
        $exited = @($children | Where-Object { $_.Process.HasExited })
        if ($exited.Count -gt 0) {
            Write-Warning "$($exited[0].Name) stopped. Shutting the rest down."
            break
        }
    }
} finally {
    foreach ($child in $children) {
        try {
            if (-not $child.Process.HasExited) { Stop-Tree -ProcessId $child.Process.Id }
        } catch {
            # Already gone, which is what was wanted.
        }
    }

    Write-Host 'Stopped.' -ForegroundColor DarkGray
}
