# Relance propre du serveur Board Wizzard.
#   powershell -File tools\restart.ps1            met la file en pause, attend la fin des taches en cours, relance
#   powershell -File tools\restart.ps1 -Now       relance tout de suite (les taches en cours sont reprises a zero)
# Dans les deux cas les taches en file sont conservees. Avec -Now, ou si l'attente depasse 8 minutes, les taches de
# Board Wizzard encore sur les machines ComfyUI (prefixe de sortie « bw/ ») sont retirees pour ne pas tourner deux fois.
param([switch]$Now)
$root = Split-Path -Parent $PSScriptRoot
$api = "http://127.0.0.1:8795/api"
$drained = $false
if (-not $Now) {
  try {
    Invoke-RestMethod "$api/jobs/pause" -Method Post -ContentType "application/json" -Body '{"on": true}' -TimeoutSec 5 | Out-Null
    foreach ($i in 1..96) {
      $run = @((Invoke-RestMethod "$api/jobs?active=1" -TimeoutSec 10) | Where-Object { $_.status -eq "running" })
      if (-not $run.Count) { $drained = $true; break }
      Start-Sleep -Seconds 5
    }
  } catch {}
}
$p = Get-NetTCPConnection -LocalPort 8795 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
if ($p) { Stop-Process -Id $p -Force -Confirm:$false }
if (-not $drained) {
  $urls = @()
  try { $urls = (& python -c "import sys; sys.path.insert(0, r'$root'); from app import settings; print('\n'.join(w['url'] for w in settings.workers()))") -split "`n" | Where-Object { $_ } } catch {}
  foreach ($u in $urls) {
    try {
      $q = Invoke-RestMethod "$u/queue" -TimeoutSec 5
      $all = @($q.queue_pending) + @($q.queue_running)
      $mine = @($all | Where-Object { ($_[2] | ConvertTo-Json -Depth 6 -Compress) -match '"bw/' } | ForEach-Object { $_[1] })
      if ($mine.Count) { Invoke-RestMethod "$u/queue" -Method Post -ContentType "application/json" -Body (@{delete = $mine} | ConvertTo-Json) -TimeoutSec 5 | Out-Null }
      $run = @($q.queue_running | Where-Object { ($_[2] | ConvertTo-Json -Depth 6 -Compress) -match '"bw/' })
      if ($run.Count) { Invoke-RestMethod "$u/interrupt" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 5 | Out-Null }
      "$u : $($mine.Count) tache(s) Board Wizzard retiree(s), $($all.Count - $mine.Count) autre(s) laissee(s)"
    } catch { "$u : injoignable" }
  }
} else { "File videe proprement : aucune tache perdue." }
Start-Sleep -Seconds 2
Start-Process -FilePath "cmd.exe" -ArgumentList '/c', 'python -m app --no-browser >> data\server.log 2>&1' -WorkingDirectory $root -WindowStyle Hidden
Start-Sleep -Seconds 14
& python "$root\tools\status.py"
