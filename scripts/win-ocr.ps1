# OCR bawaan Windows 10/11 (Windows.Media.Ocr).
# Menulis JSON baris: [{ t: teks, x, y, w, h }] ke -OutFile (UTF-8).
param(
    [Parameter(Mandatory = $true)][string]$ImageFile,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$Lang = ''
)
. (Join-Path $PSScriptRoot 'winrt-common.ps1')

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImageFile)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = $null
foreach ($code in @($Lang, 'id', 'id-ID', 'en-US', 'en')) {
    if (-not $code) { continue }
    try {
        $l = New-Object Windows.Globalization.Language($code)
        if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($l)) {
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l)
            if ($engine) { break }
        }
    } catch { }
}
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw 'NO_OCR_LANGUAGE' }

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$rows = New-Object System.Collections.ArrayList
foreach ($line in $result.Lines) {
    $minX = [double]::MaxValue; $minY = [double]::MaxValue; $maxX = 0.0; $maxY = 0.0
    foreach ($w in $line.Words) {
        $r = $w.BoundingRect
        if ($r.X -lt $minX) { $minX = $r.X }
        if ($r.Y -lt $minY) { $minY = $r.Y }
        if (($r.X + $r.Width) -gt $maxX) { $maxX = $r.X + $r.Width }
        if (($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
    }
    $null = $rows.Add([pscustomobject]@{ t = $line.Text; x = [int]$minX; y = [int]$minY; w = [int]($maxX - $minX); h = [int]($maxY - $minY) })
}
$json = ConvertTo-Json -InputObject @($rows) -Depth 3 -Compress
Write-Utf8File $OutFile $json
try { $stream.Dispose() } catch { }
