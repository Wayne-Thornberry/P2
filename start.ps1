#Requires -Version 5.1
<#
.SYNOPSIS
  Starts the site for local development in one window.

.DESCRIPTION
  A local run has no database. By default the site talks to its own mock API
  (Folio.Web\mocks\server.mjs), which serves a complete example budget from memory: the
  budget, three months of transactions, accounts, goals, a loan, the planner and an import
  history. Nothing is written to disk, nothing is installed, and a change survives only
  until the process stops.

    .\start.ps1          the site and the mock API -- no database, no .NET build
    .\start.ps1 -Api     the real API, against a database you configured

  Press Ctrl+C to stop everything.

.PARAMETER Api
  Run the real API instead of the mock, using ConnectionStrings:Default from
  Folio.Api\appsettings.Development.json. That file is gitignored: copy
  appsettings.Development.example.json to it and fill in the connection string.

  This expects a database that has already been deployed -- applying the schema is the
  deploy's job, not a local run's. If there is no database to point at, leave this off.

.PARAMETER SkipInstall
  Do not run npm install when Folio.Web\node_modules is missing.

.PARAMETER NoBrowser
  Do not open the browser once everything is answering.

.EXAMPLE
  .\start.ps1

.EXAMPLE
  .\start.ps1 -Api -NoBrowser
#>
[CmdletBinding()]
param(
    [switch]$Api,
    [switch]$SkipInstall,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot

$apiProject  = Join-Path $root 'Folio.Api\Folio.Api.csproj'
$webDir      = Join-Path $root 'Folio.Web'
$devSettings = Join-Path $root 'Folio.Api\appsettings.Development.json'

$siteUrl = 'http://127.0.0.1:5420'
$apiUrl  = 'http://127.0.0.1:5421'
$mockUrl = 'http://127.0.0.1:5490'

# The mock's account. It applies to a server that saves nothing, so it is not a secret.
$mockUsername = 'wayne'
$mockPassword = 'mock'

if (-not (Test-Path $webDir)) { throw "Not found: $webDir" }

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

# ── which API ─────────────────────────────────────────────────────────────────────
$connectionString = $null
$signInNote       = "Account: $mockUsername / $mockPassword"

if ($Api) {
    if (-not (Test-Path $devSettings)) {
        throw @"
Not found: $devSettings

-Api runs the real API, which needs a database. Copy the example and fill in its
connection string, or drop -Api to run against the mock instead:

  Copy-Item Folio.Api\appsettings.Development.example.json Folio.Api\appsettings.Development.json
"@
    }

    $devConfig        = Read-JsonSettings -Path $devSettings
    $connectionString = $devConfig.ConnectionStrings.Default

    if (-not $connectionString) {
        throw "No ConnectionStrings:Default in $devSettings"
    }

    $account    = if ($devConfig.Auth.SeedUsername) { $devConfig.Auth.SeedUsername } else { $mockUsername }
    $signInNote = "Account: $account (the password its database was seeded with)"
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
if ($Api) {
    Write-Host '=== Building the API ===' -ForegroundColor Cyan
    dotnet build $apiProject -v quiet --nologo
    if ($LASTEXITCODE -ne 0) { throw 'The API did not build.' }
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
    if ($Api) {
        Start-Child -Name 'API' `
            -FilePath 'dotnet' `
            -ArgumentList @('run', '--project', $apiProject, '--no-build') `
            -WorkingDirectory $root `
            -Environment @{
                ASPNETCORE_URLS            = $apiUrl
                ConnectionStrings__Default = $connectionString
            }

        # The dev server proxies /api to the real API rather than the mock.
        Start-Child -Name 'site' -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') -WorkingDirectory $webDir `
            -Environment @{ Folio_MOCK = '0' }

        Wait-ForUrl -Url "$apiUrl/api/health" -Name 'The API'
    } else {
        Start-Child -Name 'mock API' `
            -FilePath 'node' -ArgumentList @('mocks\server.mjs') -WorkingDirectory $webDir `
            -Environment @{ MOCK_PASSWORD = $mockPassword }

        Start-Child -Name 'site' -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') -WorkingDirectory $webDir `
            -Environment @{ Folio_MOCK = '1' }

        Wait-ForUrl -Url "$mockUrl/api/health" -Name 'The mock API'
    }

    Wait-ForUrl -Url "$siteUrl/" -Name 'The site'

    Write-Host ''
    Write-Host "  $siteUrl" -ForegroundColor Green
    Write-Host "  $signInNote"
    if ($Api) {
        Write-Host "  API at $apiUrl"
    } else {
        Write-Host '  Mock mode: a full example budget, held in memory. Nothing is saved when this stops.' -ForegroundColor Yellow
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
