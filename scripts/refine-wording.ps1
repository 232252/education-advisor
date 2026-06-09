# scripts/refine-wording.ps1
# =============================================================
# Refine wording: "companion repo" / "sister-project" / etc.
# → accurate phrasings, since education-advisor is now the same
# project (not a sibling).
# =============================================================

$root = 'C:\Users\sq199\.qwenpaw\workspaces\default\coding_projects\1\ai-workstation'

# Order matters: longer phrases first.
$replacements = @(
  @{ From = 'the companion repository''s';          To = 'the EAA CLI''s' }
  @{ From = 'the companion `education-advisor` repo';To = 'the EAA CLI (`core/eaa-cli/`)' }
  @{ From = 'the companion repo''s';                 To = 'the EAA CLI''s' }
  @{ From = 'the companion repository';              To = 'the EAA CLI repository' }
  @{ From = 'the companion repo';                    To = 'the EAA CLI repository' }
  @{ From = 'The companion `education-advisor` repo';To = 'The EAA CLI (`core/eaa-cli/`)' }
  @{ From = 'The companion repo';                    To = 'The EAA CLI repository' }
  @{ From = 'a sister-project dependency';           To = 'a core component of this project' }
  @{ From = 'is **sister-project code**';            To = 'is the data engine component of this same project' }
  @{ From = 'The companion **Rust data engine**';    To = 'The **Rust data engine (`core/eaa-cli/`)**' }
)

# Skip historical / generated / tool files.
$skip = @(
  'package-lock.json', 'BUG_REPORT.md',
  'SETTINGS_V2_REPORT.md', 'SETTINGS_V3_REPORT.md', 'SETTINGS_V4_FINAL_REPORT.md',
  'ZERO_BUG_ACCEPTANCE_REPORT.md', 'SWARM_ARCHITECTURE.md',
  'supplement-task-plan-2026-06-03.md',
  'analyze_links.py', 'link_chain.py', 'rename-brand.ps1',
  'rename-brand.ps1.bak'
)

$utf8 = New-Object System.Text.UTF8Encoding($false)
$total = 0

$files = Get-ChildItem -Path $root -Recurse -File -Force |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\dist\\|\\release\\|\.tmp-' } |
  Where-Object { $_.Extension -in '.md','.ts','.tsx','.mjs','.cjs','.json','.yml' } |
  Where-Object { $skip -notcontains $_.Name }

foreach ($f in $files) {
  $orig = [System.IO.File]::ReadAllText($f.FullName)
  $new = $orig
  $hits = 0
  foreach ($r in $replacements) {
    $count = ([regex]::Matches($new, [regex]::Escape($r.From))).Count
    if ($count -gt 0) {
      $new = $new.Replace($r.From, $r.To)
      $hits += $count
    }
  }
  if ($hits -gt 0 -and $new -ne $orig) {
    [System.IO.File]::WriteAllText($f.FullName, $new, $utf8)
    Write-Host ("  {0,-60}  {1,4} hits" -f $f.Name, $hits)
    $total += $hits
  }
}

Write-Host ""
Write-Host "Total replacements: $total"
