$ports = 9222,9223,9224,9225,9229,9230,9231
foreach ($p in $ports) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$p/json/version" -UseBasicParsing -TimeoutSec 3
        Write-Host "CDP on port $p : $($r.Content)"
        exit 0
    } catch {
        Write-Host "Port $p : not available"
    }
}
Write-Host "No CDP port found"
exit 1
