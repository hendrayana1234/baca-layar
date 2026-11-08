# Ubah teks jadi suara (WAV) memakai suara Windows (termasuk suara Indonesia "Andika").
param(
    [Parameter(Mandatory = $true)][string]$TextFile,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$VoiceId = '',
    [double]$Rate = 1.0
)
. (Join-Path $PSScriptRoot 'winrt-common.ps1')

$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer

$all = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
$voice = $null
if ($VoiceId) { $voice = $all | Where-Object { $_.Id -eq $VoiceId } | Select-Object -First 1 }
if (-not $voice) { $voice = $all | Where-Object { $_.Language -like 'id*' } | Select-Object -First 1 }
if ($voice) { $synth.Voice = $voice }
try { $synth.Options.SpeakingRate = [Math]::Max(0.5, [Math]::Min(6.0, $Rate)) } catch { }

$stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])

$saved = $false
try {
    $in = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $fs = [System.IO.File]::Create($OutFile)
    $in.CopyTo($fs)
    $fs.Close(); $in.Close()
    $saved = $true
} catch { }

if (-not $saved) {
    # Cara cadangan: baca byte lewat DataReader
    $size = [uint32]$stream.Size
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $null = Await ($reader.LoadAsync($size)) ([uint32])
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    [System.IO.File]::WriteAllBytes($OutFile, $bytes)
}
