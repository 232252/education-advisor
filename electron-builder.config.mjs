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

// Windows NSIS embeds a 7z of the app. electron-builder's default for 7z is
// -mx=9 (ultra LZMA). That decode, not the download, is what blows past a
// minute on a modest PC. `store` writes the payload uncompressed so install
// is a copy. macOS/Linux builds keep the default so their artifacts stay small.
const argv = process.argv
const buildingWin = argv.includes('--win') || argv.includes('--windows')
const buildingOther = argv.includes('--mac') || argv.includes('--linux')
if (buildingWin && !buildingOther) config.compression = 'store'

const officeDir = fileURLToPath(new URL('./build/office-kit', import.meta.url))
if (existsSync(officeDir)) {
  config.extraResources.push({ from: 'build/office-kit', to: 'office-kit', filter: ['*.zip'] })
}

console.log(
  `[electron-builder.config] asarUnpack ${config.asarUnpack.length} native globs; compression ${config.compression ?? 'default'}; JS stays in app.asar`,
)
export default config
