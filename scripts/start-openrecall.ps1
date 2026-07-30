$ErrorActionPreference = "Stop"

function Fail-WithCode {
  param([Parameter(Mandatory = $true)][string]$Code)
  [Console]::Error.WriteLine($Code)
  exit 1
}

$nodeCommand = Get-Command "node" -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
  Fail-WithCode "OPENRECALL_NODE_24_REQUIRED"
}
$nodeVersion = & $nodeCommand.Source --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
  Fail-WithCode "OPENRECALL_NODE_24_REQUIRED"
}

$pnpmCommand = Get-Command "pnpm" -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $pnpmCommand) {
  Fail-WithCode "OPENRECALL_PNPM_11_REQUIRED"
}
$pnpmVersion = & $pnpmCommand.Source --version
if ($LASTEXITCODE -ne 0 -or $pnpmVersion -notmatch '^11\.') {
  Fail-WithCode "OPENRECALL_PNPM_11_REQUIRED"
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$openRecallExitCode = 1
Push-Location -LiteralPath $repositoryRoot
try {
  & $pnpmCommand.Source start
  $openRecallExitCode = $LASTEXITCODE
}
finally {
  Pop-Location
}

exit $openRecallExitCode
