param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $SearchArgs
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$scriptDir = $PSScriptRoot
$cli = Join-Path $scriptDir 'search.cjs'
if (-not (Test-Path -LiteralPath $cli)) {
  throw "web-search CLI not found: $cli"
}

$nodeCommand = $env:WEB_SEARCH_NODE
if ([string]::IsNullOrWhiteSpace($nodeCommand)) {
  $nodeCommand = 'node'
}

& $nodeCommand $cli @SearchArgs
exit $LASTEXITCODE
