$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

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
if ([string]::IsNullOrWhiteSpace($hermesKey)) {
  throw 'Hermes API_SERVER_KEY was not found in %LOCALAPPDATA%\hermes\.env'
}

$env:HOST = '127.0.0.1'
$env:PORT = '4174'
$env:HERMES_API_URL = 'http://127.0.0.1:8642/v1'
$env:HERMES_API_KEY = $hermesKey
$env:HERMES_API_MODEL = 'hermes-agent'
$env:HERMES_SESSION_KEY = 'agent:default:vocab-app:local:huang-yujie'
$env:CORS_ORIGIN = '*'
if ([string]::IsNullOrWhiteSpace($env:API_EDIT_PASSWORD)) {
  $env:API_EDIT_PASSWORD = 'vocab-local-8642'
}

Write-Host "Starting public API bridge at http://127.0.0.1:$($env:PORT)"
Write-Host 'Hermes gateway: http://127.0.0.1:8642/v1 (key loaded from local Hermes .env)'
npm start
