# Render scenes - 极轻微 Ken Burns (3% zoom, no pan, ease-in-out via cosine)
# v2 改进：1.00 → 1.03，避免头晕
# 用 here-string 避免 PowerShell 单引号嵌套地狱

$scenes = @(
  @{n="S1_hook";    dur=10},
  @{n="S2_intro";   dur=10},
  @{n="S3_record";  dur=10},
  @{n="S4_weekly";  dur=10},
  @{n="S5_privacy"; dur=10},
  @{n="S6_daily";   dur=10},
  @{n="S7_closing"; dur=11}
)

foreach ($s in $scenes) {
  $n = $s.n
  $src = Join-Path $PSScriptRoot "scenes\$n.png"
  $dst = Join-Path $PSScriptRoot "scenes\$n.mp4"
  $dur = $s.dur
  $frames = 30 * $dur

  # Use here-string to keep single quotes literal
  $vf = @'
zoompan=z='1.0+0.03*(1-cos(3.14159*on/__FRAMES__))/2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=__FRAMES__:s=1920x1080:fps=30
'@
  $vf = $vf.Replace('__FRAMES__', "$frames")

  Write-Host "Rendering $n ($dur s) ... " -NoNewline
  $argList = @(
    "-y", "-loop", "1", "-i", $src, "-t", "$dur",
    "-vf", $vf,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-r", "30",
    $dst
  )
  $proc = Start-Process -FilePath ffmpeg -ArgumentList $argList -Wait -PassThru -NoNewWindow -RedirectStandardError "$PSScriptRoot\render-$n.log"
  if ((Test-Path $dst) -and (Get-Item $dst).Length -gt 1000) {
    $size = (Get-Item $dst).Length
    Write-Host "OK  $([math]::Round($size/1MB, 2))MB"
  } else {
    Write-Host "FAILED exit=$($proc.ExitCode)"
    Get-Content "$PSScriptRoot\render-$n.log" -Tail 5
  }
}
