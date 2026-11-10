// Rules for an upgrade onto an existing install directory.
// resources/eaa-copy-changed.ps1 is the Windows port of applyIncrementalInstall.
// Keep the two in lockstep:
// 1. Skip a file when the destination exists, sizes match, and SHA-256 matches.
//    Do not open that destination file for write.
// 2. Copy every other source file over the destination.
// 3. Delete a destination file whose relative path is not in the source, unless
//    its file name is in the keep list.
// 4. Compare relative paths case-insensitively.
// 5. Do not follow or delete reparse points (junctions, symlinks).
// 6. Never remove the destination root.
// 7. Remove empty directories left behind, except the root and reparse points.

import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, copyFileSync, utimesSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function isReparse(full) {
  try {
    return lstatSync(full).isSymbolicLink()
  } catch {
    return false
  }
}

function walk(root) {
  const files = []
  const dirs = []
  const pending = [root]
  while (pending.length > 0) {
    const dir = pending.pop()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = lstatSync(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        dirs.push(full)
        pending.push(full)
      } else if (st.isFile()) {
        const rel = full.slice(root.length).replace(/^[/\\]+/, '')
        files.push({ full, rel, segments: rel.split(/[/\\]/), size: st.size })
      }
    }
  }
  return { files, dirs }
}

function destPath(destRoot, segments) {
  return join(destRoot, ...segments)
}

/**
 * Copy changed files from sourceRoot onto destRoot.
 * Unchanged destination files are not opened for write (mtime stays put).
 */
export function applyIncrementalInstall(sourceRoot, destRoot, keepNames = []) {
  const keep = new Set(keepNames.map((name) => name.toLowerCase()))
  const source = walk(sourceRoot)
  const dest = walk(destRoot)
  const sourceByRel = new Map(source.files.map((file) => [file.rel.toLowerCase(), file]))
  const destByRel = new Map(dest.files.map((file) => [file.rel.toLowerCase(), file]))

  let copied = 0
  let skipped = 0
  let removed = 0
  let bytesCopied = 0
  let bytesSkipped = 0

  for (const src of source.files) {
    const key = src.rel.toLowerCase()
    const existing = destByRel.get(key)
    const candidate = destPath(destRoot, src.segments)
    if (isReparse(candidate)) {
      skipped += 1
      bytesSkipped += src.size
      continue
    }
    if (existing && existing.size === src.size && sha256(existing.full) === sha256(src.full)) {
      skipped += 1
      bytesSkipped += existing.size
      continue
    }
    mkdirSync(dirname(candidate), { recursive: true })
    copyFileSync(src.full, candidate)
    copied += 1
    bytesCopied += src.size
  }

  for (const file of dest.files) {
    if (sourceByRel.has(file.rel.toLowerCase())) continue
    if (keep.has(basename(file.rel).toLowerCase())) continue
    rmSync(file.full, { force: true })
    removed += 1
  }

  const emptyDirs = dest.dirs
    .filter((dir) => !isReparse(dir))
    .sort((a, b) => b.split(/[/\\]/).length - a.split(/[/\\]/).length)
  for (const dir of emptyDirs) {
    if (dir === destRoot) continue
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir)
    } catch {
      /* a file we kept is still inside */
    }
  }

  return { copied, skipped, removed, bytesCopied, bytesSkipped }
}

export function stamp(file, when) {
  const at = when instanceof Date ? when : new Date(when)
  utimesSync(file, at, at)
  return statSync(file).mtimeMs
}
