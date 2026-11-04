#Requires -Version 5.1
<#
.SYNOPSIS
  Prepares the box for its first deploy: IIS, the database and its Windows grants, and the
  runner that runs the deploy.

.DESCRIPTION
    .\setup.ps1 -Check

    .\setup.ps1

    .\setup.ps1 -RunnerUrl https://github.com/owner/repo -RunnerToken <registration token>

  Run this once on the server, from an elevated PowerShell. The deploy no longer creates
  anything for itself: this makes the folders, both app pools, both sites, the firewall
  rules, the database and its two Windows grants, and the deploy then only copies files,
  publishes the schema and checks that both answer.

  Every step asks the box what it already has and changes only what is missing, so a second
  run is a repair -- and it is the thing to run when a deploy says a site, a pool, a folder
  or a database is not there.

  The layout -- both sites, both ports, both folders, the app pools, the database -- is read
  from .github\workflows\deploy.yml's env: block rather than repeated here, so the box and
  the deploy cannot disagree about it.

  What it does not do: install IIS, URL Rewrite, the hosting bundle or SQL Server. Those are
  checked, each miss is reported with the fix, and nothing is changed until they all pass.

.PARAMETER SqlServer
  The SQL Server instance. Default: SQL_SERVER from deploy.yml.

.PARAMETER DatabaseName
  The database to create and grant. Default: DB_NAME from deploy.yml.

.PARAMETER RunnerUrl
  The repository the runner registers against, e.g. https://github.com/owner/repo. Asked for
  when it is not given, so a plain .\setup.ps1 sets up the whole box; an empty answer skips
  the runner and leaves the rest of the box as it is.

.PARAMETER RunnerToken
  The registration token from Settings -> Actions -> Runners -> New self-hosted runner. It
  expires within the hour, so it is asked for rather than kept anywhere. Given as a
  parameter it is used as it is; asked for, it is not echoed.

.PARAMETER RunnerPath
  Where this project's runner is unpacked. Default C:\actions-runner-<project>: a runner
  serves one repository, so C:\actions-runner belongs to whichever project got there first.

.PARAMETER Check
  Report and change nothing: the layout, then what the box has. Exit code 1 means a deploy
  would fail.

.EXAMPLE
  .\setup.ps1 -Check
#>
[CmdletBinding()]
param(
    [string]$SqlServer,
    [string]$DatabaseName,
    [string]$RunnerUrl,
    [string]$RunnerToken,
    [string]$RunnerPath,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# The string parameters are positional, so a switch typed with two dashes -- the habit from bash
# and from gh -- is taken as the value of the first one of them, and the run then fails with
# "SQL Server '--check' does not answer". Say what was meant instead.
foreach ($name in $PSBoundParameters.Keys) {
    $given = $PSBoundParameters[$name]
    if ($given -is [string] -and $given.StartsWith('-')) {
        throw "'$given' was read as the value of -$name. PowerShell spells a parameter with one dash: -Check, not --Check."
    }
}

# The runner's account. Services are not UAC-filtered, which is why the deploy can read IIS,
# stop app pools, write into C:\Program Files and publish a schema.
$runnerIdentity = 'NT AUTHORITY\SYSTEM'

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Text)
    Write-Host "  [OK] $Text" -ForegroundColor Green
}

function Write-Skip {
    param([string]$Text)
    Write-Host "  $Text" -ForegroundColor DarkGray
}

# The one SQL helper: Windows authentication, statements run in order on one connection, and
# the last answer back. No login, no password, nothing to keep in step.
function Invoke-Sql {
    param(
        [Parameter(Mandatory = $true)][string]$Server,
        [string]$Database = 'master',
        [Parameter(Mandatory = $true)][string[]]$Statement
    )

    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $builder['Data Source'] = $Server
    $builder['Initial Catalog'] = $Database
    $builder['Integrated Security'] = $true
    $builder['TrustServerCertificate'] = $true

    $connection = New-Object System.Data.SqlClient.SqlConnection $builder.ConnectionString
    try {
        $connection.Open()
        $answer = $null
        foreach ($sql in $Statement) {
            $command = $connection.CreateCommand()
            try {
                $command.CommandText = $sql
                $command.CommandTimeout = 300
                $answer = $command.ExecuteScalar()
            } finally {
                $command.Dispose()
            }
        }
        return $answer
    } finally {
        $connection.Dispose()
    }
}

# A service starts with the machine PATH, not a user's: an install "for me" is invisible to
# the runner, and every step then fails with "not recognised as the name of a cmdlet".
function Test-OnMachinePath {
    param([string]$File)

    foreach ($folder in ([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';')) {
        if ($folder -and (Test-Path (Join-Path $folder $File))) { return $true }
    }
    return $false
}

# ── the box, as deploy.yml describes it ──────────────────────────────────────────
# A key that is not in the env: block is an error, not a default: a setup that guesses the
# port it is binding has become a second, wrong copy of the workflow.
$deployFile = Join-Path $root '.github\workflows\deploy.yml'
if (-not (Test-Path $deployFile)) { throw "Not found: $deployFile" }

$box = @{}
$inEnv = $false
foreach ($line in (Get-Content $deployFile)) {
    if ($line -match '^env:') { $inEnv = $true; continue }
    if (-not $inEnv) { continue }
    if ($line -match '^\S') { break }

    if ($line -match '^\s{2}(?<key>[A-Z_]+):\s*(?<value>\S.*?)\s*$') {
        $key = $Matches['key']
        $value = $Matches['value']
        # ${{ vars.NAME || 'default' }} -- a box with nothing set uses the default.
        if ($value -match "\|\|\s*'(?<fallback>[^']*)'") { $value = $Matches['fallback'] }
        $box[$key] = $value.Trim("'")
    }
}

foreach ($key in @('SITE_NAME', 'SITE_PATH', 'SITE_APP_POOL', 'SITE_PORT', 'API_SITE_NAME', 'API_SITE_PATH', 'API_APP_POOL', 'API_PORT', 'SQL_SERVER', 'DB_NAME')) {
    if (-not $box[$key]) { throw "deploy.yml's env: block has no $key, which this reads the box's layout from." }
}

if (-not $SqlServer) { $SqlServer = $box['SQL_SERVER'] }
if (-not $DatabaseName) { $DatabaseName = $box['DB_NAME'] }

$siteName = $box['SITE_NAME']
$sitePath = $box['SITE_PATH']
$sitePool = $box['SITE_APP_POOL']
$sitePort = [int]$box['SITE_PORT']
$siteUrl = $box['SITE_URL']

$apiName = $box['API_SITE_NAME']
$apiPath = $box['API_SITE_PATH']
$apiPool = $box['API_APP_POOL']
$apiPort = [int]$box['API_PORT']
$apiUrl = $box['API_SITE_URL']

# The API's Windows identity, created by IIS when the app pool is.
$apiIdentity = "IIS APPPOOL\$apiPool"

# A runner serves one repository, so each project gets a folder of its own rather than sharing
# C:\actions-runner with the project that was set up first.
if (-not $RunnerPath) { $RunnerPath = "C:\actions-runner-$siteName" }

Write-Section 'This box, as the deploy expects it'
Write-Host "  site      $siteName  $siteUrl  $sitePath  (pool $sitePool)"
Write-Host "  api       $apiName  $apiUrl  $apiPath  (pool $apiPool)"
Write-Host "  database  $DatabaseName on $SqlServer"
Write-Skip '  read from .github\workflows\deploy.yml, so the two cannot disagree'

$isAdmin = (New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw 'Run this from an elevated PowerShell: the IIS configuration, the firewall, the database logins and the runner service all need it.'
}

# ── what the box already has ─────────────────────────────────────────────────────
Write-Section 'What the box already has'

$problems = @()

function Add-Check {
    param([string]$What, [scriptblock]$Test, [string]$Fix)

    if (& $Test) { Write-Ok $What }
    else { $script:problems += [pscustomobject]@{ What = $What; Fix = $Fix } }
}

Import-Module WebAdministration -ErrorAction SilentlyContinue

Add-Check 'IIS, readable through WebAdministration' {
    try { $null = Get-ChildItem 'IIS:\AppPools' -ErrorAction Stop; $true } catch { $false }
} 'Install-WindowsFeature Web-Server -IncludeManagementTools'

Add-Check 'URL Rewrite, so /sample is served by index.html and not looked up as a file' `
    { Test-Path "$env:SystemRoot\System32\inetsrv\rewrite.dll" } `
    'Install it from https://www.iis.net/downloads/microsoft/url-rewrite'

Add-Check 'ASP.NET Core Hosting Bundle, which runs the API in its app pool' `
    { Test-Path 'C:\Program Files\IIS\Asp.Net Core Module\V2\aspnetcorev2.dll' } `
    'Install the ASP.NET Core 8 Hosting Bundle from https://dotnet.microsoft.com/download/dotnet/8.0'

$sdkMajor = 0
if (Test-OnMachinePath 'dotnet.exe') {
    foreach ($sdk in @(& dotnet --list-sdks)) {
        if ($sdk -match '^(?<major>\d+)\.' -and [int]$Matches['major'] -gt $sdkMajor) { $sdkMajor = [int]$Matches['major'] }
    }
}
Add-Check '.NET SDK 8 on the machine PATH' `
    { $sdkMajor -ge 8 } `
    'Install the .NET 8 SDK for all users: https://dotnet.microsoft.com/download/dotnet/8.0'

$nodeMajor = 0
if (Test-OnMachinePath 'node.exe') {
    if ((& node --version) -match '^v(?<major>\d+)\.') { $nodeMajor = [int]$Matches['major'] }
}
Add-Check 'Node 22 on the machine PATH' `
    { $nodeMajor -ge 22 } `
    'Install Node 22 for all users: https://nodejs.org'

Add-Check 'git on the machine PATH' `
    { Test-OnMachinePath 'git.exe' } `
    'Install git for all users: https://git-scm.com/download/win'

# Creating a login needs a sysadmin, and nothing can promote itself: that is the one grant
# typed into SSMS by hand, once, and this says whether it is already done.
try {
    $sysadmin = (Invoke-Sql -Server $SqlServer -Statement "SELECT CASE WHEN IS_SRVROLEMEMBER('sysadmin') = 1 THEN 1 ELSE 0 END") -eq 1
    if ($sysadmin) {
        Write-Ok "SQL Server '$SqlServer', as a sysadmin -- which creating the logins needs"
    } else {
        $problems += [pscustomobject]@{
            What = "this account is not a sysadmin on '$SqlServer'"
            Fix  = "Run setup.ps1 as the account that installed it, or in SSMS: ALTER SERVER ROLE sysadmin ADD MEMBER [$env:USERDOMAIN\$env:USERNAME];"
        }
    }
} catch {
    $problems += [pscustomobject]@{
        What = "SQL Server '$SqlServer' does not answer to this account ($($_.Exception.Message))"
        Fix  = 'Install it on this box, or point -SqlServer at the instance that hosts it'
    }
}

if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'The box is missing what a deploy needs:' -ForegroundColor Red
    foreach ($problem in $problems) {
        Write-Host "  $($problem.What)" -ForegroundColor Red
        Write-Host "    $($problem.Fix)" -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'Nothing was changed. Fix those and run setup.ps1 again.'
    exit 1
}

if ($Check) {
    Write-Host ''
    Write-Host '[OK] The box has everything a deploy needs. Nothing was changed (-Check).' -ForegroundColor Green
    exit 0
}

# ── IIS ─────────────────────────────────────────────────────────────────────────
Write-Section 'IIS'

foreach ($path in @($sitePath, $apiPath)) {
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Force -Path $path | Out-Null
        Write-Ok "created $path"
    }
}

foreach ($pool in @($sitePool, $apiPool) | Select-Object -Unique) {
    if (-not (Test-Path "IIS:\AppPools\$pool")) {
        New-WebAppPool -Name $pool | Out-Null
        Write-Ok "created app pool $pool"
    }

    # An ASP.NET Core app brings its own runtime; a pool set to v4.0 looks for the .NET
    # Framework and never starts.
    Set-ItemProperty "IIS:\AppPools\$pool" -Name managedRuntimeVersion -Value ''
}

# The folder and the port are what the deploy and the smoke tests assume, so a site that
# already exists is moved onto them rather than trusted to still have them.
foreach ($site in @(
    [pscustomobject]@{ Name = $siteName; Port = $sitePort; Path = $sitePath; Pool = $sitePool }
    [pscustomobject]@{ Name = $apiName; Port = $apiPort; Path = $apiPath; Pool = $apiPool }
)) {
    if (-not (Test-Path "IIS:\Sites\$($site.Name)")) {
        New-Website -Name $site.Name -Port $site.Port -PhysicalPath $site.Path -ApplicationPool $site.Pool | Out-Null
        Write-Ok "created site $($site.Name) on $($site.Port), serving $($site.Path)"
        continue
    }

    Set-ItemProperty "IIS:\Sites\$($site.Name)" -Name physicalPath -Value $site.Path
    Set-ItemProperty "IIS:\Sites\$($site.Name)" -Name applicationPool -Value $site.Pool

    $binding = (Get-Item "IIS:\Sites\$($site.Name)").bindings.Collection | Select-Object -First 1
    $bound = 0
    if ($binding) { $bound = [int](($binding.bindingInformation -split ':')[1]) }

    if ($bound -ne $site.Port) {
        if ($bound -gt 0) { Remove-WebBinding -Name $site.Name -Protocol 'http' -Port $bound }
        New-WebBinding -Name $site.Name -Protocol 'http' -Port $site.Port
        Write-Ok "moved site $($site.Name) from port $bound to $($site.Port)"
    } else {
        Write-Ok "site $($site.Name) on $($site.Port), serving $($site.Path), pool $($site.Pool)"
    }
}

# The browser is on another machine and calls both ports directly.
foreach ($port in @($sitePort, $apiPort)) {
    $rule = "$siteName $port"
    if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
        Write-Ok "opened inbound TCP $port ($rule)"
    }
}

# ── the database, and the two Windows identities that use it ─────────────────────
Write-Section "Database $DatabaseName on $SqlServer"

# The pools exist by now on purpose: IIS APPPOOL\<pool> is a Windows identity that only
# appears once its pool does. The runner gets dbcreator rather than sysadmin: it publishes
# the schema and builds throwaway databases for the tests, and needs nothing else.
Invoke-Sql -Server $SqlServer -Statement @(
    "IF DB_ID(N'$DatabaseName') IS NULL CREATE DATABASE [$DatabaseName];"
    "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE [name] = N'$runnerIdentity') CREATE LOGIN [$runnerIdentity] FROM WINDOWS;"
    "IF IS_SRVROLEMEMBER('dbcreator', '$runnerIdentity') <> 1 ALTER SERVER ROLE [dbcreator] ADD MEMBER [$runnerIdentity];"
    "IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE [name] = N'$apiIdentity') CREATE LOGIN [$apiIdentity] FROM WINDOWS;"
)

# The runner owns the database it deploys. Each publish drops the users the project does not
# describe -- its own among them, they are grants -- and puts them back afterwards, which only
# works while the runner can still open the database with no user in it. An owner is mapped to
# dbo, and dbo is not a user: that is the access that survives the drop. A database made by
# this script otherwise belongs to whoever ran it, and the first publish locks the runner out
# of the database it had just published to.
#
# The grant below puts a user there, and SQL Server will not hand a database to a login that
# already has one, so that user goes first. It is only ever the grant this script made.
Invoke-Sql -Server $SqlServer -Database $DatabaseName -Statement @(
    "IF EXISTS (SELECT 1 FROM sys.database_principals WHERE [name] = N'$runnerIdentity' AND [type] = 'U') DROP USER [$runnerIdentity];"
)
Invoke-Sql -Server $SqlServer -Statement @(
    "IF EXISTS (SELECT 1 FROM sys.databases WHERE [name] = N'$DatabaseName' AND ISNULL(SUSER_SNAME(owner_sid), N'') <> N'$runnerIdentity') ALTER AUTHORIZATION ON DATABASE::[$DatabaseName] TO [$runnerIdentity];"
)

Write-Ok "database $DatabaseName, owned by the runner, with the runner's and the API's logins"

# db_owner for both. The deploy makes these again after every publish: sqlpackage drops a
# user the project does not describe, and these two are grants rather than schema. The
# runner's own user can be dropped too, which is why it owns the database above.
$grants = @()
foreach ($name in @($runnerIdentity, $apiIdentity)) {
    $grants += "IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE [name] = N'$name' OR [sid] = SUSER_SID(N'$name')) CREATE USER [$name] FOR LOGIN [$name];"
    $grants += "IF IS_ROLEMEMBER('db_owner', '$name') <> 1 ALTER ROLE [db_owner] ADD MEMBER [$name];"
}
Invoke-Sql -Server $SqlServer -Database $DatabaseName -Statement $grants
Write-Ok "db_owner on $DatabaseName for both"

# ── the runner ──────────────────────────────────────────────────────────────────
Write-Section 'Runner'

# One runner serves one repository and runs that repository's deploys, so a box carrying
# several projects has several runners, each in a folder of its own and named after its
# project. The .runner a folder holds records which repository it serves, and without reading
# it a runner belonging to another project looks exactly like one of this project's.

# git@github.com:owner/repo.git, https://github.com/owner/repo.git and the same address
# without either are one repository, and the two compared below are written differently by the
# things that write them.
function ConvertTo-RepositoryUrl {
    param([string]$Url)

    if (-not $Url -or $Url -isnot [string]) { return '' }

    return (($Url.Trim() -replace '^git@([^:]+):', 'https://$1/') -replace '\.git$', '').TrimEnd('/')
}

function Get-RunnerRepository {
    param([string]$Folder)

    $config = Join-Path $Folder '.runner'
    if (-not (Test-Path $config)) { return $null }

    try { return ConvertTo-RepositoryUrl ([string](Get-Content $config -Raw | ConvertFrom-Json).gitHubUrl) }
    catch { return '' }
}

# What this project's runner has to be registered to: -RunnerUrl when it is given, and the
# repository this clone came from when it is not, which is the answer the prompt would get.
function Get-OriginRepository {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return '' }

    try { $url = & git -C $root config --get remote.origin.url 2>$null | Select-Object -First 1 }
    catch { return '' }

    return ConvertTo-RepositoryUrl $url
}

if ($RunnerUrl) { $RunnerUrl = ConvertTo-RepositoryUrl $RunnerUrl }

$target = if ($RunnerUrl) { $RunnerUrl } else { Get-OriginRepository }
$here = Get-RunnerRepository -Folder $RunnerPath
$someoneElses = [bool]($here -and $target -and $here -ne $target)

# Asked for rather than demanded as parameters: the token exists for an hour, so it is not on
# a command line anyone keeps, and a box set up with no argument at all is the common case.
if (-not $here) {
    if (-not $RunnerUrl) {
        Write-Host '  A runner registers against one repository and deploys that repository only.'
        Write-Host "  This project's own goes in $RunnerPath, named $siteName."
        Write-Host '  Enter skips it: the rest of the box is still set up, and a deploy waits.'
        $RunnerUrl = (Read-Host '  Repository URL (https://github.com/owner/repo)').Trim().TrimEnd('/')
    }

    if ($RunnerUrl -and $RunnerUrl -notmatch '^https?://') {
        Write-Skip "not an http(s) address, so the runner step is skipped: $RunnerUrl"
        $RunnerUrl = ''
    }

    if ($RunnerUrl -and -not $RunnerToken) {
        # Hidden when there is a console to hide it from: a secure prompt reads the keyboard
        # itself, so with the answers piped in it would wait for a console that is not there.
        if ([Console]::IsInputRedirected) {
            $RunnerToken = (Read-Host '  Registration token (Settings -> Actions -> Runners)').Trim()
        }
        else {
            $secure = Read-Host '  Registration token (Settings -> Actions -> Runners)' -AsSecureString
            $pinned = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            try { $RunnerToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pinned).Trim() }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pinned) }
        }
    }
}

if ($someoneElses) {
    Write-Host ''
    Write-Host "  $RunnerPath is registered to $here, and this project is $target." -ForegroundColor Yellow
    Write-Host '  A runner serves one repository, so this project needs a folder of its own:' -ForegroundColor Yellow
    Write-Host "    .\setup.ps1 -RunnerPath C:\actions-runner-$siteName" -ForegroundColor Yellow
    Write-Host '  Nothing was registered for this repository, and nothing was changed.' -ForegroundColor Yellow
}
elseif ($here) {
    Write-Ok "a runner is already configured in $RunnerPath, for $here"

    # So the service check below knows which one to look for.
    $RunnerUrl = $here
}
elseif (-not $RunnerUrl -or -not $RunnerToken) {
    Write-Skip 'skipped: a runner registers against a repository, so it needs both answers'
    Write-Host '  Run this again and answer the two questions, or give them here:'
    Write-Host '    .\setup.ps1 -RunnerUrl https://github.com/<owner>/<repo> -RunnerToken <token>' -ForegroundColor Yellow
}
else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod 'https://api.github.com/repos/actions/runner/releases/latest' `
        -UseBasicParsing -Headers @{ 'User-Agent' = 'folio-setup' }
    $asset = $release.assets | Where-Object { $_.name -like 'actions-runner-win-x64-*.zip' } | Select-Object -First 1
    if (-not $asset) {
        throw 'The latest runner release has no win-x64 zip. Download one from https://github.com/actions/runner/releases by hand.'
    }

    New-Item -ItemType Directory -Force -Path $RunnerPath | Out-Null
    $zip = Join-Path $env:TEMP $asset.name

    Write-Skip "downloading $($asset.name)"
    # curl, not Invoke-WebRequest: a truncated download unpacks later into "End of Central
    # Directory record could not be found", which says nothing about the cause.
    & curl.exe -L --fail --silent --show-error --output $zip $asset.browser_download_url
    if ($LASTEXITCODE -ne 0) { throw "Could not download $($asset.browser_download_url)" }

    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($asset.digest -like 'sha256:*' -and $hash -ne $asset.digest.Substring(7).ToLowerInvariant()) {
        Remove-Item $zip -Force
        throw 'The download does not match the published SHA256. Run setup.ps1 again.'
    }

    Expand-Archive -Path $zip -DestinationPath $RunnerPath -Force
    Remove-Item $zip -Force

    Push-Location $RunnerPath
    try {
        & .\config.cmd --unattended --url $RunnerUrl --token $RunnerToken --name $siteName `
            --work '_work' --runasservice --windowslogonaccount $runnerIdentity
        if ($LASTEXITCODE -ne 0) {
            throw "config.cmd failed (exit $LASTEXITCODE). A registration token expires within the hour: take a fresh one and run setup.ps1 again."
        }
    } finally {
        Pop-Location
    }

    Write-Ok "registered against $RunnerUrl, as a service running as $runnerIdentity"
}

# The service is named after the repository and the runner it serves:
# actions.runner.<owner>-<repo>.<runner name>. Another runner on this box belongs to another
# project, so it is not this script's to start.
$service = $null
if ($RunnerUrl) {
    $slug = ($RunnerUrl -replace '^https?://[^/]+/', '' -replace '\.git$', '') -replace '/', '-'
    $service = Get-Service "actions.runner.$slug.$siteName" -ErrorAction SilentlyContinue
}
if ($service) {
    if ($service.Status -ne 'Running') {
        Start-Service $service.Name
        $service.WaitForStatus('Running', '00:00:30')
    }
    Write-Ok "service $($service.Name) is $((Get-Service $service.Name).Status)"
}

# ── what is left ────────────────────────────────────────────────────────────────
Write-Section 'Ready'

Write-Host "  site      $siteUrl"
Write-Host "  api       $apiUrl/api/health"
Write-Host "  database  $DatabaseName on $SqlServer"
Write-Host ''
Write-Host '  The deploy does the rest: push to main, or Actions -> Deploy to Production ->'
Write-Host '  Run workflow -> full. It runs the tests, publishes the schema and the site, and'
Write-Host '  smoke-tests both.'
Write-Host ''
Write-Host '  Set on GitHub, per repository, rather than here:'
# Port 80 is the bare address: a browser does not write it down, so neither does this.
$origin = if ($sitePort -eq 80) { "http://$($env:COMPUTERNAME)" } else { "http://$($env:COMPUTERNAME):$sitePort" }
Write-Host "    WEB_PUBLIC_ORIGIN = $origin      # the origin browsers load the site from"
Write-Host ''

if (-not $service) {
    Write-Host '  [TODO] No runner yet: until one is online, a deploy queues instead of running.' -ForegroundColor Yellow
    Write-Host ''
}

Write-Host '[OK] The box is set up.' -ForegroundColor Green
