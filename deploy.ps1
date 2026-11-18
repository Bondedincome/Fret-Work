<#
  Builds a ready-to-upload copy of Fretwork for cPanel (or any static web host).

  Usage (from the project folder):
      powershell -ExecutionPolicy Bypass -File deploy.ps1

  Output:
      dist\                 the website files only (no README, .git, scripts)
      fretwork-site.zip     the same files zipped; upload and Extract in cPanel → File Manager

  The script also checks that every local file referenced by index.html exists, and stamps
  CSS/JS links with a version (?v=…) so visitors never get a stale copy after an update.
#>
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$zip  = Join-Path $root 'fretwork-site.zip'

# Everything the website needs, and nothing else.
$files = @(
  'index.html', 'style.css',
  'chords.js', 'app.js', 'theory.js', 'learn.js', 'live.js', 'songcore.js', 'song.js', 
  'favicon.ico', 'site.webmanifest', 'robots.txt', '.htaccess'
)
$folders = @('icons')

Write-Host 'Building dist\ ...'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

foreach ($f in $files) {
  $src = Join-Path $root $f
  if (-not (Test-Path $src)) { throw "Missing file: $f" }
  Copy-Item $src (Join-Path $dist $f)
}
foreach ($d in $folders) {
  Copy-Item (Join-Path $root $d) (Join-Path $dist $d) -Recurse
}

# Version stamp for CSS/JS links, e.g. app.js?v=20261118-1642
$version = Get-Date -Format 'yyyyMMdd-HHmm'
$indexPath = Join-Path $dist 'index.html'
$html = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)
$html = [regex]::Replace($html, '(src|href)="(?!https?:|//|#|data:)([^"?]+\.(?:js|css))"', ('$1="$2?v=' + $version + '"'))

# Check that every local reference exists.
$missing = @()
foreach ($m in [regex]::Matches($html, '(?:src|href)="(?!https?:|//|#|data:|mailto:)([^"?#]+)')) {
  $ref = $m.Groups[1].Value
  if (-not (Test-Path (Join-Path $dist $ref))) { $missing += $ref }
}
$manifest = Get-Content (Join-Path $dist 'site.webmanifest') -Raw | ConvertFrom-Json
foreach ($icon in $manifest.icons) {
  if (-not (Test-Path (Join-Path $dist $icon.src))) { $missing += $icon.src }
}
if ($missing.Count) { throw ('Referenced but not found: ' + ($missing -join ', ')) }

# Write back as UTF-8 without BOM.
[System.IO.File]::WriteAllText($indexPath, $html, (New-Object System.Text.UTF8Encoding($false)))

# Zip with forward-slash paths (Compress-Archive on Windows PowerShell 5.1 uses backslashes,
# which Linux servers extract as file names like "icons\icon.svg").
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zip) { Remove-Item $zip -Force }
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $dist -Recurse -File -Force | ForEach-Object {
    $entry = $_.FullName.Substring($dist.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose() }

$count = (Get-ChildItem $dist -Recurse -File -Force).Count
$sizeKb = [math]::Round((Get-Item $zip).Length / 1KB)
Write-Host "Done: $count files, version $version"
Write-Host "  Folder: $dist"
Write-Host "  Zip:    $zip ($sizeKb KB)"
Write-Host 'Next: cPanel -> File Manager -> public_html -> Upload the zip -> right-click -> Extract.'
