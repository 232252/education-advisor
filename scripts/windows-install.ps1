# Full Windows install. Same result as npm ci + npm run build:eaa.
# See scripts/windows-install.mjs for mirror flags.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& node (Join-Path $PSScriptRoot 'windows-install.mjs') @args
exit $LASTEXITCODE
