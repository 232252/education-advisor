// electron-builder's NSIS template extracts app-64.7z and CopyFiles the whole
// tree onto $INSTDIR. That rewrites every installed file on upgrade.
// After the archive is extracted to $PLUGINSDIR\7z-out, insert a hook that
// resources/installer.nsh implements. Portable builds never define the hook,
// so they still take the full CopyFiles path.
//
// The template lives inside app-builder-lib and is compiled when the NSIS
// target runs, which is after afterPack. Patching the installed template
// there is the only place that still sees extractUsing7za before makensis.

import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const INCREMENTAL_EXTRACT_MARKER = 'EAA_INCREMENTAL_EXTRACT'

export const INCREMENTAL_EXTRACT_SNIPPET = `  # ${INCREMENTAL_EXTRACT_MARKER}
  # resources/installer.nsh defines eaaTryIncrementalCopy for Setup.exe.
  # Portable builds do not define it, so $R2 stays "0" and the full
  # CopyFiles below still runs. The stock retry loop does not use $R2.
  StrCpy $R2 "0"
  !ifmacrodef eaaTryIncrementalCopy
    !insertmacro eaaTryIncrementalCopy
  !endif
  StrCmp $R2 "1" DoneExtract7za
`

export function spliceIncrementalExtract(original, snippet = INCREMENTAL_EXTRACT_SNIPPET) {
  if (original.includes(INCREMENTAL_EXTRACT_MARKER)) return original
  const macroAt = original.indexOf('!macro extractUsing7za')
  if (macroAt < 0) {
    throw new Error('NSIS template has no extractUsing7za macro (app-builder-lib changed)')
  }
  const match = /SetOutPath \$R0\r?\n/.exec(original.slice(macroAt))
  if (!match) {
    throw new Error('NSIS extractUsing7za has no SetOutPath $R0 anchor (app-builder-lib changed)')
  }
  const insertAt = macroAt + match.index + match[0].length
  return original.slice(0, insertAt) + snippet + original.slice(insertAt)
}

function templateFrom(packageJson) {
  try {
    const require = createRequire(packageJson)
    const libDir = dirname(require.resolve('app-builder-lib/package.json'))
    const target = join(libDir, 'templates', 'nsis', 'include', 'extractAppPackage.nsh')
    return existsSync(target) ? target : null
  } catch {
    return null
  }
}

export function resolveExtractTemplate(root) {
  return (
    templateFrom(join(root, 'package.json')) ||
    templateFrom(join(root, 'node_modules', 'electron-builder', 'package.json'))
  )
}

export function patchNsisIncrementalExtract(root) {
  const target = resolveExtractTemplate(root)
  if (!target) {
    throw new Error(
      'app-builder-lib NSIS template extractAppPackage.nsh was not found; refusing to build an installer that would rewrite every installed file',
    )
  }
  const original = readFileSync(target, 'utf8')
  const next = spliceIncrementalExtract(original)
  if (next !== original) writeFileSync(target, next)
  return { patched: next !== original, target }
}
