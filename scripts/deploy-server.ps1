$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $nodePath) { throw 'Node.js 24 이상을 찾을 수 없습니다.' }
& $nodePath "$projectRoot\node_modules\wrangler\bin\wrangler.js" deploy --config "$projectRoot\server\wrangler-final-v2.jsonc"
exit $LASTEXITCODE
