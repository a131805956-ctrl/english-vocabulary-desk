$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath 'node_modules')) {
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$env:HOST = '0.0.0.0'
$env:PORT = '4176'
if ([string]::IsNullOrWhiteSpace($env:API_EDIT_PASSWORD)) {
  $env:API_EDIT_PASSWORD = 'morpheme-local'
}

function Read-HermesEnvValue([string]$name) {
  $envFile = Join-Path $env:LOCALAPPDATA 'hermes\.env'
  if (-not (Test-Path -LiteralPath $envFile)) { return $null }
  $line = Get-Content -LiteralPath $envFile | Where-Object {
    $_ -match "^\s*$([regex]::Escape($name))\s*="
  } | Select-Object -First 1
  if (-not $line) { return $null }
  $value = ($line -split '=', 2)[1].Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    return $value.Substring(1, $value.Length - 2)
  }
  return $value
}

$hermesKey = Read-HermesEnvValue 'API_SERVER_KEY'
if (-not [string]::IsNullOrWhiteSpace($hermesKey)) {
  $env:HERMES_API_KEY = $hermesKey
  $env:HERMES_API_URL = 'http://127.0.0.1:8642/v1'
  $env:HERMES_API_MODEL = 'hermes-agent'
  $env:HERMES_SESSION_KEY = 'agent:default:vocab-app:local:huang-yujie'
}

Write-Host "Starting Morpheme Desk for Android LAN access at http://0.0.0.0:$($env:PORT)..."
npm start
exit $LASTEXITCODE
