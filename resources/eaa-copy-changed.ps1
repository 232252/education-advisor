# Requires -Version 5.0
# Windows port of scripts/lib/incremental-install.mjs (applyIncrementalInstall).
# Rules:
# 1. Skip a file when the destination exists, sizes match, and SHA-256 matches. Do not open it for write.
# 2. Copy every other source file over the destination.
# 3. Delete a destination file whose relative path is not in the source, unless its file name is in the keep list.
# 4. Compare relative paths case-insensitively.
# 5. Do not follow or delete reparse points (junctions, symlinks).
# 6. Never remove the destination root.
# 7. Remove empty directories left behind, except the root and reparse points.
$ErrorActionPreference = 'Stop'

function Fail([string]$message) {
  Write-Output "incremental-install error=$message"
  exit 2
}

$sourceRoot = $env:EAA_UPGRADE_SOURCE
$destRoot = $env:EAA_UPGRADE_DEST
if ([string]::IsNullOrWhiteSpace($sourceRoot) -or [string]::IsNullOrWhiteSpace($destRoot)) {
  Fail 'missing EAA_UPGRADE_SOURCE or EAA_UPGRADE_DEST'
}
if (-not [System.IO.Directory]::Exists($sourceRoot)) { Fail "source missing: $sourceRoot" }
if (-not [System.IO.Directory]::Exists($destRoot)) { Fail "dest missing: $destRoot" }

$keep = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
if ($env:EAA_UPGRADE_KEEP) {
  foreach ($name in ($env:EAA_UPGRADE_KEEP -split '\|')) {
    if (-not [string]::IsNullOrWhiteSpace($name)) { [void]$keep.Add($name.Trim()) }
  }
}

function Get-RelPath([string]$root, [string]$full) {
  $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
  $fileFull = [System.IO.Path]::GetFullPath($full)
  $prefix = $rootFull + '\'
  if (-not $fileFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail "path escapes install root: $fileFull"
  }
  return $fileFull.Substring($prefix.Length)
}

function Test-Reparse([string]$path) {
  try {
    $attr = [System.IO.File]::GetAttributes($path)
  } catch {
    return $false
  }
  return (($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Walk([string]$root) {
  $files = New-Object System.Collections.Generic.List[string]
  $dirs = New-Object System.Collections.Generic.List[string]
  $pending = New-Object System.Collections.Generic.Queue[string]
  $pending.Enqueue($root)
  while ($pending.Count -gt 0) {
    $dir = $pending.Dequeue()
    foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($dir)) {
      if (Test-Reparse $entry) { continue }
      $attr = [System.IO.File]::GetAttributes($entry)
      if (($attr -band [System.IO.FileAttributes]::Directory) -ne 0) {
        $dirs.Add($entry)
        $pending.Enqueue($entry)
      } else {
        $files.Add($entry)
      }
    }
  }
  return @{ Files = $files; Dirs = $dirs }
}

function Get-Sha256([string]$path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = $null
  try {
    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $hash = $sha.ComputeHash($stream)
    return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($stream) { $stream.Dispose() }
    $sha.Dispose()
  }
}

try {
  $sourceWalk = Walk $sourceRoot
  $destWalk = Walk $destRoot

  $sourceMap = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($file in $sourceWalk.Files) {
    $sourceMap[(Get-RelPath $sourceRoot $file)] = $file
  }
  $destMap = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($file in $destWalk.Files) {
    $destMap[(Get-RelPath $destRoot $file)] = $file
  }

  $copied = 0
  $skipped = 0
  $removed = 0
  [int64]$bytesCopied = 0
  [int64]$bytesSkipped = 0

  foreach ($rel in @($sourceMap.Keys)) {
    $srcPath = $sourceMap[$rel]
    $srcLen = (New-Object System.IO.FileInfo $srcPath).Length
    $same = $false
    if ($destMap.ContainsKey($rel)) {
      $dstPath = $destMap[$rel]
      $dstLen = (New-Object System.IO.FileInfo $dstPath).Length
      if ($dstLen -eq $srcLen -and (Get-Sha256 $srcPath) -eq (Get-Sha256 $dstPath)) {
        $same = $true
      }
    } elseif (Test-Reparse ([System.IO.Path]::Combine($destRoot, $rel))) {
      $same = $true
    }
    if ($same) {
      $skipped++
      $bytesSkipped += $srcLen
      continue
    }
    $target = if ($destMap.ContainsKey($rel)) { $destMap[$rel] } else { [System.IO.Path]::Combine($destRoot, $rel) }
    $parent = [System.IO.Path]::GetDirectoryName($target)
    if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }
    if ([System.IO.File]::Exists($target)) {
      $existing = New-Object System.IO.FileInfo $target
      if ($existing.IsReadOnly) { $existing.IsReadOnly = $false }
    }
    [System.IO.File]::Copy($srcPath, $target, $true)
    $copied++
    $bytesCopied += $srcLen
  }

  foreach ($rel in @($destMap.Keys)) {
    if ($sourceMap.ContainsKey($rel)) { continue }
    $leaf = [System.IO.Path]::GetFileName($rel)
    if ($keep.Contains($leaf)) { continue }
    $path = $destMap[$rel]
    $info = New-Object System.IO.FileInfo $path
    if ($info.IsReadOnly) { $info.IsReadOnly = $false }
    [System.IO.File]::Delete($path)
    $removed++
  }

  $dirs = @($destWalk.Dirs | Sort-Object @{ Expression = { @($_.ToCharArray() | Where-Object { $_ -eq '\' }).Count }; Descending = $true })
  foreach ($dir in $dirs) {
    if ([System.IO.Path]::GetFullPath($dir).TrimEnd('\') -eq [System.IO.Path]::GetFullPath($destRoot).TrimEnd('\')) { continue }
    if (Test-Reparse $dir) { continue }
    if (@([System.IO.Directory]::EnumerateFileSystemEntries($dir)).Count -eq 0) {
      [System.IO.Directory]::Delete($dir)
    }
  }

  Write-Output "incremental-install copied=$copied skipped=$skipped removed=$removed bytesCopied=$bytesCopied bytesSkipped=$bytesSkipped"
  exit 0
} catch {
  Fail $_.Exception.Message
}
