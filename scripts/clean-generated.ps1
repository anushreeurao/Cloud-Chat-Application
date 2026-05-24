$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

$targets = @("build", "dist", ".vite")

$fileTargets = @(
  "tsconfig.app.tsbuildinfo",
  "tsconfig.node.tsbuildinfo",
  "functions/tsconfig.tsbuildinfo"
)

Write-Host "Cleaning generated output from: $projectRoot"

foreach ($target in $targets) {
  $fullPath = Join-Path $projectRoot $target
  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Recurse -Force
    Write-Host "Removed folder: $target"
  }
}

foreach ($target in $fileTargets) {
  $fullPath = Join-Path $projectRoot $target
  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Force
    Write-Host "Removed file: $target"
  }
}

Write-Host "Done. Source files are unchanged."
