// Install production dependencies of vendor/dsh-im before packaging.
// Connection center links this plugin; qrcode and the channel SDKs are not
// in the plugin zip. Installing here keeps the first launch off the network
// and out of a read-only resources directory.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const imDir = join(root, 'vendor', 'dsh-im')
const marker = join(imDir, 'node_modules', 'qrcode', 'package.json')

if (existsSync(marker)) {
  console.log(`dsh-im deps already staged: ${marker}`)
  process.exit(0)
}

const pnpm = join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
if (!existsSync(pnpm)) {
  console.error('找不到 node_modules/pnpm，先在仓库根目录 npm install')
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  [pnpm, 'install', '--prod', '--ignore-scripts', '--ignore-workspace'],
  { cwd: imDir, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
