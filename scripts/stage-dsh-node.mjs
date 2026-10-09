// Copy the Node binary that successfully boots dsh into vendor/dsh-node.
// dsh 0.2.1 rejects Electron 43.2.0's runtime fingerprint, so the packaged
// app ships this executable and the main process launches dsh with it.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fileName = process.platform === 'win32' ? 'node.exe' : 'node'
const destDir = join(root, 'vendor', 'dsh-node')
const dest = join(destDir, fileName)

if (existsSync(dest) && statSync(dest).size > 1_000_000) {
  console.log(`dsh node already staged: ${dest}`)
  process.exit(0)
}

const source = resolveNodeBinary()
mkdirSync(destDir, { recursive: true })
copyFileSync(source, dest)
console.log(`staged dsh node: ${source} -> ${dest}`)

function resolveNodeBinary() {
  if (!process.versions.electron && existsSync(process.execPath)) return process.execPath
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  const listed = execFileSync(finder, ['node'], { encoding: 'utf8' })
  const hit = listed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && existsSync(line) && !line.toLowerCase().includes('electron'))
  if (!hit) throw new Error('找不到可随包分发的 node，dsh 无法在 Electron 43.2.0 里启动')
  return hit
}
