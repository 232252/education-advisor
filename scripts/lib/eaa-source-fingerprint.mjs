// Source fingerprint for core/eaa-cli.
//
// mtime is not a valid cache key on Windows: git checkout stamps files in
// write order, so a fresh clone often looks "dirty" and `npm run build:eaa`
// recompiles the engine even when resources/eaa-binaries already matches
// the source. Hash the build inputs instead. Newlines are normalized so
// core.autocrlf cannot force a rebuild.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { ROOT, walkFiles } from './gate-utils.mjs'

export const EAA_SRC = join(ROOT, 'core', 'eaa-cli')

function isBuildInput(file) {
  const name = basename(file)
  return name.endsWith('.rs') || name.endsWith('.toml') || name === 'Cargo.lock'
}

/** Sorted repo-relative paths of every file that can change the eaa binary. */
export function eaaSourceFiles() {
  return walkFiles(EAA_SRC, isBuildInput, ['target', 'node_modules', '.git', 'tests']).sort((a, b) =>
    relative(EAA_SRC, a).replaceAll('\\', '/').localeCompare(relative(EAA_SRC, b).replaceAll('\\', '/')),
  )
}

export function eaaSourceFingerprint() {
  const hash = createHash('sha256')
  const files = eaaSourceFiles()
  for (const file of files) {
    const rel = relative(EAA_SRC, file).replaceAll('\\', '/')
    let buf = readFileSync(file)
    if (!buf.includes(0)) {
      buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'))
    }
    hash.update(rel)
    hash.update('\0')
    hash.update(buf)
    hash.update('\0')
  }
  return { fingerprint: hash.digest('hex'), fileCount: files.length }
}
