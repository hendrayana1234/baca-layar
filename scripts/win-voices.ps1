# Daftar suara Windows yang terpasang -> JSON [{ id, name, lang, gender }]
param([Parameter(Mandatory = $true)][string]$OutFile)
. (Join-Path $PSScriptRoot 'winrt-common.ps1')

$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$list = New-Object System.Collections.ArrayList
foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
    $null = $list.Add([pscustomobject]@{ id = $v.Id; name = $v.DisplayName; lang = $v.Language; gender = [string]$v.Gender })
}
$default = ''
try { $default = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::DefaultVoice.Id } catch { }
$json = ConvertTo-Json -InputObject ([pscustomobject]@{ voices = @($list); defaultId = $default }) -Depth 4 -Compress
Write-Utf8File $OutFile $json
