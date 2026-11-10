// Preload for the stock node.exe that runs dsh. Electron already reads
// app.asar; this process does not. Loaded with `node --import <this file>`.
import { createRequire, register } from 'node:module'
const require = createRequire(import.meta.url)
require('./asar-node-autorun.cjs')
require('./asar-node-url-fix.cjs')
register(new URL('./asar-node-hooks.mjs', import.meta.url), { parentURL: import.meta.url })
