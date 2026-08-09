param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Normal", "Portable")]
  [string]$Mode
)

$ErrorActionPreference = "Stop"
$origin = "http://127.0.0.1:3210"

function Fail-WithCode {
  param([Parameter(Mandatory = $true)][string]$Code)
  [Console]::Error.WriteLine($Code)
  exit 1
}

function Test-DirectoryWritable {
  param([Parameter(Mandatory = $true)][string]$Directory)
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $probe = Join-Path $Directory (".openrecall-write-test-{0}.tmp" -f [Guid]::NewGuid().ToString("N"))
  try {
    [IO.File]::WriteAllText($probe, "OpenRecall")
  }
  finally {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  }
}

function Open-OpenRecallBrowser {
  if ($env:OPENRECALL_LAUNCHER_BROWSER_MARKER) {
    if (-not [IO.Path]::IsPathRooted($env:OPENRECALL_LAUNCHER_BROWSER_MARKER)) {
      throw "OPENRECALL_LAUNCHER_BROWSER_MARKER_INVALID"
    }
    [IO.File]::WriteAllText(
      $env:OPENRECALL_LAUNCHER_BROWSER_MARKER,
      $origin,
      [Text.UTF8Encoding]::new($false)
    )
    return
  }
  Start-Process -FilePath $origin -ErrorAction Stop | Out-Null
}

$nodePath = Join-Path $PSScriptRoot "runtime\node.exe"
$hostPath = Join-Path $PSScriptRoot "LauncherHost.mjs"
$serverPath = Join-Path $PSScriptRoot "app\server\src\index.ts"
foreach ($requiredPath in @($nodePath, $hostPath, $serverPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    Fail-WithCode "OPENRECALL_LAUNCHER_FILES_MISSING"
  }
}

if ($Mode -eq "Portable") {
  $portableData = Join-Path $PSScriptRoot "Data"
  try {
    Test-DirectoryWritable -Directory $portableData
  }
  catch {
    Fail-WithCode "OPENRECALL_PORTABLE_DIRECTORY_NOT_WRITABLE"
  }
  $env:OPENRECALL_DATA_DIRECTORY = [IO.Path]::GetFullPath($portableData)
}
else {
  Remove-Item Env:OPENRECALL_DATA_DIRECTORY -ErrorAction SilentlyContinue
}

$env:NODE_ENV = "production"
$env:OPENRECALL_HOST = "127.0.0.1"
$env:OPENRECALL_PORT = "3210"
$env:OPENRECALL_PUBLIC_ORIGIN = $origin

$createdStopFile = $false
if (-not $env:OPENRECALL_LAUNCHER_STOP_FILE) {
  $env:OPENRECALL_LAUNCHER_STOP_FILE = Join-Path ([IO.Path]::GetTempPath()) ("openrecall-stop-{0}.signal" -f [Guid]::NewGuid().ToString("N"))
  $createdStopFile = $true
}
elseif (-not [IO.Path]::IsPathRooted($env:OPENRECALL_LAUNCHER_STOP_FILE)) {
  Fail-WithCode "OPENRECALL_LAUNCHER_STOP_FILE_INVALID"
}
Remove-Item -LiteralPath $env:OPENRECALL_LAUNCHER_STOP_FILE -Force -ErrorAction SilentlyContinue

$hostArguments = '"{0}"' -f $hostPath.Replace('"', '\"')
$hostProcess = Start-Process -FilePath $nodePath -ArgumentList $hostArguments -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
$ready = $false
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $deadline) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$origin/api/v1/health" -TimeoutSec 1
    if ($response.StatusCode -eq 200) {
      $ready = $true
      break
    }
  }
  catch {
    Start-Sleep -Milliseconds 100
  }
  $hostProcess.Refresh()
  if ($hostProcess.HasExited) { break }
}

if (-not $ready) {
  New-Item -ItemType File -Force -Path $env:OPENRECALL_LAUNCHER_STOP_FILE | Out-Null
  $hostProcess.WaitForExit(10000) | Out-Null
  Fail-WithCode "OPENRECALL_LAUNCHER_READY_TIMEOUT"
}

[Console]::Out.WriteLine("OPENRECALL_LAUNCHER_READY $origin")
if ($env:OPENRECALL_LAUNCHER_NO_BROWSER -ne "1") {
  try {
    Open-OpenRecallBrowser
  }
  catch {
    New-Item -ItemType File -Force -Path $env:OPENRECALL_LAUNCHER_STOP_FILE | Out-Null
    $hostProcess.WaitForExit(10000) | Out-Null
    if ($createdStopFile) {
      Remove-Item -LiteralPath $env:OPENRECALL_LAUNCHER_STOP_FILE -Force -ErrorAction SilentlyContinue
    }
    Fail-WithCode "OPENRECALL_BROWSER_OPEN_FAILED"
  }
}

$hostProcess.WaitForExit()
$exitCode = $hostProcess.ExitCode
if ($createdStopFile) {
  Remove-Item -LiteralPath $env:OPENRECALL_LAUNCHER_STOP_FILE -Force -ErrorAction SilentlyContinue
}
exit $exitCode
