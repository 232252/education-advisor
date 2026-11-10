// Packaging config: electron-builder.yml, but asarUnpack is only native
// binaries. JS stays in app.asar. Stock node reads it via scripts/asar-preload.
// The yml's `**/node_modules/**` remains a slower fallback for a bare
// `electron-builder` invocation that does not load this file.

import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { asarUnpackPatterns } from './scripts/lib/asar-unpack-patterns.mjs'

const ymlPath = fileURLToPath(new URL('./electron-builder.yml', import.meta.url))
const config = parse(readFileSync(ymlPath, 'utf8'))
config.asarUnpack = asarUnpackPatterns()

// Do not set compression to "store". electron-builder's 7z default is -mx=9,
// the same ultra LZMA that produced the ~323 MB v3.3.6 Setup.exe. Store mode
// (-mx=0) skips that decode but writes the raw tree, so the installer grows
// to about 0.8–1.1 GB. Install time is dominated by how many files NSIS
// creates, not by the LZMA decode of a ~300 MB archive (seconds, not a
// minute). Keep the default compressor and keep the file count low.

const officeDir = fileURLToPath(new URL('./build/office-kit', import.meta.url))
if (existsSync(officeDir)) {
  config.extraResources.push({ from: 'build/office-kit', to: 'office-kit', filter: ['*.zip'] })
}

console.log(
  `[electron-builder.config] asarUnpack ${config.asarUnpack.length} native globs; 7z compression left at electron-builder default (-mx=9); JS stays in app.asar`,
)
export default config
