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

$siteUrl      = 'http://localhost:5420'
$apiUrl       = 'http://127.0.0.1:5421'

# The password the LocalDB account is created with, the mock's, and the recovery code that
# lets a forgotten password be replaced from the sign-in page. They only ever apply to a
# throwaway local database and to a server that saves nothing, so none is a secret.
$localPassword = 'folio-dev'
$mockPassword  = 'mock'
$localRecovery = 'folio-recovery'

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

# ── build ─────────────────────────────────────────────────────────────────────────
if (-not $Mock) {
    Write-Host '=== Building the API ===' -ForegroundColor Cyan
    dotnet build $apiProject -v quiet --nologo
    if ($LASTEXITCODE -ne 0) { throw 'The API did not build.' }

    if ($Rebuild) {
        Write-Host '=== Rebuilding the database from the model scripts (its data is discarded) ===' -ForegroundColor Cyan
        . (Join-Path $root 'scripts\lib.ps1')
        Initialize-FolioDatabase -ConnectionString $connectionString -ScriptsRoot $databaseDir -Rebuild
    } else {
        . (Join-Path $root 'scripts\lib.ps1')

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
            # Any answer below 500 means it is listening and serving. A 401 from the
            # API is a perfectly good sign.
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
            -FilePath 'node' -ArgumentList @('mocks\server.mjs') -WorkingDirectory $webDir `
            -Environment @{ MOCK_PASSWORD = $mockPassword }

        Start-Child -Name 'site' `
            -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') -WorkingDirectory $webDir `
            -Environment @{ Folio_MOCK = '1' }
    } else {
        Start-Child -Name 'API' `
            -FilePath 'dotnet' `
            -ArgumentList @('run', '--project', $apiProject, '--no-build') `
            -WorkingDirectory $root `
            -Environment @{
                ASPNETCORE_URLS            = $apiUrl
                ConnectionStrings__Default = $connectionString
                Auth__SeedPassword         = $(if ($Dev) { '' } else { $localPassword })
                Auth__RecoveryCode         = $(if ($Dev) { '' } else { $localRecovery })
            }

        Start-Child -Name 'site' -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') -WorkingDirectory $webDir
    }

    if (-not $Mock) { Wait-ForUrl -Url "$apiUrl/api/health" -Name 'The API' }
    Wait-ForUrl -Url "$siteUrl/" -Name 'The site'

    $account = (Read-JsonSettings -Path $baseSettings).Auth.SeedUsername
    Write-Host ''
    Write-Host "  $siteUrl" -ForegroundColor Green
    if ($Mock) {
        Write-Host "  Mock mode: nothing is saved. Account: wayne / $mockPassword" -ForegroundColor Yellow
    } else {
        Write-Host "  API at $apiUrl   Account: $account / $(if ($Dev) { 'as configured' } else { $localPassword })"
        if (-not $Dev) {
            Write-Host "  Forgotten-password code: $localRecovery" -ForegroundColor DarkGray
            if (-not $Rebuild) {
                Write-Host '  (password and code were set when the database was empty: use -Rebuild to start over)' -ForegroundColor DarkGray
            }
        }
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
