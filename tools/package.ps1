# Builds the Chrome Web Store submission zip.
#
#   npm run package
#   powershell -ExecutionPolicy Bypass -File tools\package.ps1
#
# Everything is staged into dist\_staging first and validated there, so the
# checks run against exactly the bytes that get zipped rather than against the
# working tree.

$ErrorActionPreference = 'Stop'

$root    = Split-Path $PSScriptRoot -Parent
$dist    = Join-Path $root 'dist'
$staging = Join-Path $dist '_staging'

# Shipped in the package. Anything not listed here does not reach the store:
# test/, store/, tools/, package.json, README and the dotfiles all stay behind.
$files = @('manifest.json', 'LICENSE')
$dirs  = @('icons', 'src', 'options')

function Fail($message) { throw "PACKAGE FAILED: $message" }

# --------------------------------------------------------------- read manifest

$manifestPath = Join-Path $root 'manifest.json'
if (-not (Test-Path $manifestPath)) { Fail 'manifest.json not found' }

try { $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json }
catch { Fail "manifest.json is not valid JSON: $($_.Exception.Message)" }

$version = $manifest.version
if ($version -notmatch '^\d+\.\d+(\.\d+){0,2}$') { Fail "bad version '$version'" }
if ($manifest.manifest_version -ne 3) { Fail 'manifest_version must be 3' }
if ([string]::IsNullOrWhiteSpace($manifest.description)) { Fail 'description is empty' }
if ($manifest.description.Length -gt 132) {
    Fail "description is $($manifest.description.Length) chars; the store limit is 132"
}

$zipPath = Join-Path $dist "cutline-$version.zip"

"Cutline $version"
""

# ------------------------------------------------------------------- staging

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

foreach ($f in $files) {
    $src = Join-Path $root $f
    if (-not (Test-Path $src)) { Fail "missing required file: $f" }
    Copy-Item $src (Join-Path $staging $f)
}
foreach ($d in $dirs) {
    $src = Join-Path $root $d
    if (-not (Test-Path $src)) { Fail "missing required directory: $d" }
    Copy-Item $src (Join-Path $staging $d) -Recurse
}

# ----------------------------------------------------------------- validation

# Paths are tracked relative to the staging root. Matching against FullName
# would be wrong: staging itself lives under dist\, so a rule excluding "dist"
# would reject every file in the package.
$staged = Get-ChildItem $staging -Recurse -File | ForEach-Object {
    [pscustomobject]@{
        File = $_
        Rel  = $_.FullName.Substring($staging.Length + 1)
    }
}

# 1. Nothing from the development side leaked in.
$forbidden = $staged | Where-Object {
    $_.File.Name -match '\.test\.|\.spec\.' -or
    $_.File.Name -in @('package.json', 'package-lock.json', '.gitignore') -or
    $_.Rel -match '(^|\\)(node_modules|\.git|\.claude|test|store|tools|dist)(\\|$)'
}
if ($forbidden) { Fail "development files staged: $(($forbidden.Rel) -join ', ')" }

# 2. Every path the manifest names actually exists.
$manifestRefs = @($manifest.background.service_worker, $manifest.options_ui.page)
$manifestRefs += $manifest.icons.PSObject.Properties.Value
$manifestRefs += $manifest.action.default_icon.PSObject.Properties.Value
foreach ($ref in ($manifestRefs | Where-Object { $_ } | Select-Object -Unique)) {
    if (-not (Test-Path (Join-Path $staging $ref))) { Fail "manifest references missing file: $ref" }
}

# 3. Files the service worker injects at runtime are not in the manifest, so
#    they get their own check — a typo there fails silently in the browser.
$bg = Get-Content (Join-Path $staging $manifest.background.service_worker) -Raw
foreach ($m in [regex]::Matches($bg, "'(src/[^']+\.(?:js|css))'")) {
    $ref = $m.Groups[1].Value
    if (-not (Test-Path (Join-Path $staging $ref))) { Fail "service worker references missing file: $ref" }
}

# 4. No stray control bytes. These have bitten this project before: an escape
#    sequence written literally produced a NUL inside a regex.
foreach ($entry in ($staged | Where-Object { $_.File.Extension -in '.js', '.json', '.css', '.html' })) {
    $bytes = [System.IO.File]::ReadAllBytes($entry.File.FullName)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $b = $bytes[$i]
        if ($b -lt 9 -or ($b -gt 13 -and $b -lt 32)) {
            Fail ("control byte 0x{0:X2} at offset {1} in {2}" -f $b, $i, $entry.Rel)
        }
    }
}

# 5. No remotely hosted code — an automatic store rejection.
foreach ($entry in ($staged | Where-Object { $_.File.Extension -in '.js', '.html' })) {
    $body = Get-Content $entry.File.FullName -Raw
    if ($body -match 'src\s*=\s*["'']https?://' -or $body -match 'import\s+.*["'']https?://') {
        Fail "remote script reference in $($entry.Rel)"
    }
}

# ----------------------------------------------------------------------- zip

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal

$sizeKb = [Math]::Round((Get-Item $zipPath).Length / 1KB, 1)

"Contents:"
$staged | Sort-Object Rel | ForEach-Object { "  $($_.Rel)" }
""
"  {0} files, {1} KB" -f $staged.Count, $sizeKb
""

Remove-Item $staging -Recurse -Force

"Wrote $zipPath"
"Upload it at https://chrome.google.com/webstore/devconsole"
