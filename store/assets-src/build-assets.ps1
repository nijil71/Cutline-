# Renders the Web Store assets from the HTML sources in this folder.
#
#   powershell -ExecutionPolicy Bypass -File store\assets-src\build-assets.ps1
#
# Uses headless Edge (Chromium) so the output matches what the store audience
# will see in a Chromium browser.

$ErrorActionPreference = 'Stop'

$srcDir  = $PSScriptRoot
$storeDir = Split-Path $srcDir -Parent
$shotsDir = Join-Path $storeDir 'screenshots'
$promoDir = Join-Path $storeDir 'promo'

foreach ($dir in @($shotsDir, $promoDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
}

$candidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "No Edge or Chrome found in the usual locations." }
"using $browser"

function Render($htmlName, $outPath, $width, $height) {
    $src = Join-Path $srcDir $htmlName
    if (-not (Test-Path $src)) { throw "missing source: $src" }
    if (Test-Path $outPath) { Remove-Item $outPath -Force }

    $uri = ([System.Uri]$src).AbsoluteUri

    # Start-Process rather than the call operator: Chromium writes routine
    # noise to stderr, and in Windows PowerShell that gets wrapped into
    # ErrorRecords which trip $ErrorActionPreference = 'Stop'.
    $argv = @(
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        "--window-size=$width,$height",
        "--screenshot=`"$outPath`"",
        "`"$uri`""
    )
    Start-Process -FilePath $browser -ArgumentList $argv -Wait -NoNewWindow | Out-Null

    if (-not (Test-Path $outPath)) { throw "render produced nothing: $htmlName" }

    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile($outPath)
    $dims = "$($img.Width)x$($img.Height)"
    $img.Dispose()
    if ($dims -ne "${width}x${height}") { throw "$htmlName rendered at $dims, expected ${width}x${height}" }

    "  {0,-26} {1}" -f (Split-Path $outPath -Leaf), $dims
}

Render '01-the-point.html'   (Join-Path $shotsDir '01-the-point.png')   1280 800
Render '02-in-context.html'  (Join-Path $shotsDir '02-in-context.png')  1280 800
Render '03-signals.html'     (Join-Path $shotsDir '03-signals.png')     1280 800
Render '04-privacy.html'     (Join-Path $shotsDir '04-privacy.png')     1280 800
Render 'promo-440x280.html'  (Join-Path $promoDir 'tile-440x280.png')    440 280

"done"
