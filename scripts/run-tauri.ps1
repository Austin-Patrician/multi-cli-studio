param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Command,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"

$cargoBin = Join-Path $HOME ".cargo\bin"
$env:PATH = "$cargoBin;$env:PATH"
$env:CARGO_NET_OFFLINE = "false"

$tauriCmd = Join-Path $PSScriptRoot "..\node_modules\.bin\tauri.cmd"
$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"

if (-not (Test-Path $cargoBin)) {
  throw "Rust toolchain was not found at $cargoBin."
}

if (-not (Test-Path $tauriCmd)) {
  throw "Local Tauri CLI wrapper was not found at $tauriCmd."
}

if (-not (Test-Path $vswhere)) {
  throw "Visual Studio Build Tools installer metadata was not found at $vswhere."
}

$installRoot = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installRoot) {
  $installRoot = & $vswhere -latest -products * -property installationPath
}

$candidateVcvars = @(
  (Join-Path $installRoot "VC\Auxiliary\Build\vcvars64.bat"),
  "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) | Where-Object { $_ -and (Test-Path $_) }

$vcvarsPath = $candidateVcvars | Select-Object -First 1

if (-not $vcvarsPath) {
  throw "Microsoft C++ build tools were not detected. Install Visual Studio Build Tools with the C++ workload before running Tauri."
}

$setOutput = & cmd.exe /d /c "call `"$vcvarsPath`" >nul && set"
foreach ($line in $setOutput) {
  if ($line -match "^(.*?)=(.*)$") {
    Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2]
  }
}

& $tauriCmd $Command @ExtraArgs
exit $LASTEXITCODE
