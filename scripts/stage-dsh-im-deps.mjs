// Install production dependencies of vendor/dsh-im before packaging.
// Connection center links this plugin; qrcode and the channel SDKs are not
// in the plugin zip. Installing here keeps the first launch off the network
// and out of a read-only resources directory.
//
// dsh-im 5.9.1 起官方包改用 npm 管理依赖（暂存安装后 package-lock.json
// 留在 vendor/dsh-im，scripts/verify-package.mjs 直接读它），不再有
// pnpm-lock.yaml。这里跟着用 npm，避免打包机为了一个 link: 插件再装一套 pnpm。
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

const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const command = existsSync(npmCli) ? process.execPath : 'npm'
const prefix = existsSync(npmCli) ? [npmCli] : []

const result = spawnSync(
  command,
  [...prefix, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: imDir, stdio: 'inherit', shell: command === 'npm' && process.platform === 'win32' },
)
process.exit(result.status ?? 1)
