$ErrorActionPreference = 'Stop'
$release = '2026.10.6'
$asset = 'cloudflared-windows-amd64.exe'
$digest = 'd521b3bf68982165f0d06d76732f22d9a105ef057ff3ae4c0986f3a23190950f'
$bin = Join-Path $env:RUNNER_TEMP 'runner-tools'
$target = Join-Path $bin 'cloudflared.exe'

New-Item -ItemType Directory -Force -Path $bin, $env:SESSION_STATE_DIR, (Join-Path $env:GITHUB_WORKSPACE 'results') | Out-Null
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/download/$release/$asset" -OutFile $target
$actual = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant()
if ($actual -ne $digest) { throw "cloudflared checksum mismatch: $actual" }
$bin | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
