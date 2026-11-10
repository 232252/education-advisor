// Packaging config: electron-builder.yml, but asarUnpack is only native
// binaries. JS stays in app.asar. Stock node reads it via scripts/asar-preload.
// The yml's `**/node_modules/**` remains a slower fallback for a bare
// `electron-builder` invocation that does not load this file.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { asarUnpackPatterns } from './scripts/lib/asar-unpack-patterns.mjs'

const ymlPath = fileURLToPath(new URL('./electron-builder.yml', import.meta.url))
const config = parse(readFileSync(ymlPath, 'utf8'))
config.asarUnpack = asarUnpackPatterns()
console.log(
  `[electron-builder.config] asarUnpack ${config.asarUnpack.length} native globs; JS stays in app.asar`,
)
export default config
