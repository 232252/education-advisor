#!/usr/bin/env node
// =============================================================
// scripts/build-office-kit-asset.mjs
//
// 打 office 转 PDF 组件的按需下载资产：
//   build/office-kit/office-kit-win32-x64-<kitVersion>.zip
//     └─ libreoffice-kit-win32-x64/…（@deepseek-ai 的平台包整目录）
//   config/office-kit.json（随 app 分发的清单：文件名/sha256/字节数/版本）
//
// 注意输出目录不能在 dist/ 下：electron-builder files 收 dist/**/*，
// 这份 zip 会再混进 app.asar，安装包里就有两份（实测踩过）。
//
// 现行布局：恰有一个 deflate zip。afterPack 把它复制进
// resources/office-kit/，NSIS 只多写这一个文件。首次转 PDF 时
// office-kit-service 从随包 zip 解到 userData。GitHub Release 上的同一
// 份 zip 是损坏后的修复通道，不是「安装包里不带 kit」的意思。不要把
// kit 预解压成约 735 个散文件。清单与 zip 同一次生成；两者都没变时
// 可以跳过重打。runtime 的 STORE zip 没有这个缓存，每次 prepackage 都重写。
//
// 非 win32 平台跳过（该平台包只服务 Windows 教师机）。
// zip 用系统 bsdtar（Windows 10+ 自带 System32/tar.exe）；
// 缺席时报错退出，不静默产出坏资产。
//
// 用法: node scripts/build-office-kit-asset.mjs   （prepackage 链自动跑）
// 退出码: 0 成功/跳过/缓存命中, 1 失败
// =============================================================

import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const KIT_DIR = join(ROOT, 'node_modules', '@deepseek-ai', 'libreoffice-kit-win32-x64')
const OUT_DIR = join(ROOT, 'build', 'office-kit')
const MANIFEST_PATH = join(ROOT, 'config', 'office-kit.json')

function info(msg) {
  console.log(`[build-office-kit-asset] ${msg}`)
}
function fail(msg) {
  console.error(`[build-office-kit-asset] ${msg}`)
  process.exit(1)
}

if (process.platform !== 'win32') {
  info('非 win32，跳过（office-kit 资产只服务 Windows）')
  process.exit(0)
}
if (!existsSync(join(KIT_DIR, 'package.json'))) {
  fail(`找不到 ${KIT_DIR}（npm ci 后应作为 optionalDependencies 就位）`)
}

const kitPkg = JSON.parse(readFileSync(join(KIT_DIR, 'package.json'), 'utf8'))
const kitVersion = kitPkg.version
if (!kitVersion) fail('libreoffice-kit-win32-x64 缺 version')
const dshVersion = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
})()

const asset = `office-kit-win32-x64-${kitVersion}.zip`
const zipPath = join(OUT_DIR, asset)

// ---- 缓存：清单与 zip 都在且 zip 未变（大小一致 + 源目录未更新则信任）----
if (existsSync(MANIFEST_PATH) && existsSync(zipPath)) {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    if (manifest.asset === asset && statSync(zipPath).size === manifest.bytes) {
      info(`缓存命中：${asset}（sha256 ${manifest.sha256.slice(0, 12)}…）`)
      process.exit(0)
    }
  } catch {
    /* 重新生成 */
  }
}

// ---- 用系统 bsdtar 打 zip（GNU tar 不支持 zip 格式，明确报错）----
// Git Bash 的 GNU tar 会遮住 System32 的 bsdtar，win32 直接点绝对路径。
const TAR = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
const tarProbe = spawnSync(TAR, ['--version'], { stdio: 'pipe' })
const tarVersion = (tarProbe.stdout?.toString() || '') + (tarProbe.stderr?.toString() || '')
if (!tarVersion.includes('bsdtar')) {
  fail(`系统 tar 不是 bsdtar（${tarVersion.split('\n')[0] || '不可用'}），无法生成 zip 资产`)
}

mkdirSync(OUT_DIR, { recursive: true })
info(`打包 ${asset} …`)
const zip = spawnSync(
  TAR,
  ['-a', '-cf', zipPath, '-C', join(ROOT, 'node_modules', '@deepseek-ai'), 'libreoffice-kit-win32-x64'],
  { stdio: 'inherit' },
)
if (zip.status !== 0) fail(`tar 打包失败（exit ${zip.status}）`)
if (!existsSync(zipPath)) fail('zip 未生成')

// ---- 清单 ----
const bytes = statSync(zipPath).size
const hash = createHash('sha256')
for await (const chunk of createReadStream(zipPath)) hash.update(chunk)
const manifest = {
  asset,
  sha256: hash.digest('hex'),
  bytes,
  kitVersion,
  ...(dshVersion ? { dshVersion } : {}),
}
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
info(
  `资产就绪：${asset}（${(bytes / 1024 / 1024).toFixed(1)}MB, sha256 ${manifest.sha256.slice(0, 12)}…）`,
)
info(`清单已写：config/office-kit.json`)
