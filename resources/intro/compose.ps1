# Compose final intro.mp4 with safe audio mixing
$baseDir = "C:\Users\sq199\Documents\GitHub\education-advisor\resources\intro"
Set-Location "$baseDir\scenes"

$filterComplex = @'
[0:v][1:v]xfade=transition=fade:duration=0.5:offset=9.5[v01];
[v01][2:v]xfade=transition=fade:duration=0.5:offset=19[v012];
[v012][3:v]xfade=transition=fade:duration=0.5:offset=28.5[v0123];
[v0123][4:v]xfade=transition=fade:duration=0.5:offset=38[v01234];
[v01234][5:v]xfade=transition=fade:duration=0.5:offset=47.5[v012345];
[v012345][6:v]xfade=transition=fade:duration=0.5:offset=57[vout];
[7:a]volume=0.95,aresample=44100[voice];
[8:a]volume=0.28,aresample=44100[music];
[voice][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]
'@

& ffmpeg -y `
  -i S1_hook.mp4 `
  -i S2_intro.mp4 `
  -i S3_record.mp4 `
  -i S4_weekly.mp4 `
  -i S5_privacy.mp4 `
  -i S6_daily.mp4 `
  -i S7_closing.mp4 `
  -i "$baseDir\audio\voiceover.mp3" `
  -i "$baseDir\audio\background_loop.mp3" `
  -filter_complex $filterComplex `
  -map "[vout]" -map "[aout]" `
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p `
  -c:a aac -b:a 192k -ar 44100 `
  -movflags +faststart `
  -t 70 `
  "$baseDir\intro.mp4" 2>$null

if (Test-Path "$baseDir\intro.mp4") {
  $size = (Get-Item "$baseDir\intro.mp4").Length
  Write-Host "OK  $([math]::Round($size/1MB, 2))MB"
  ffmpeg -i "$baseDir\intro.mp4" 2>&1 | Select-String "Duration|Stream"
} else {
  Write-Host "FAILED"
  & ffmpeg -y `
    -i S1_hook.mp4 -i S2_intro.mp4 -i S3_record.mp4 -i S4_weekly.mp4 `
    -i S5_privacy.mp4 -i S6_daily.mp4 -i S7_closing.mp4 `
    -i "$baseDir\audio\voiceover.mp3" -i "$baseDir\audio\background_loop.mp3" `
    -filter_complex $filterComplex `
    -map "[vout]" -map "[aout]" `
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p `
    -c:a aac -b:a 192k -ar 44100 `
    -movflags +faststart -t 70 `
    "$baseDir\intro.mp4" 2>&1 | Select-String "Error" | Select-Object -First 5
}
