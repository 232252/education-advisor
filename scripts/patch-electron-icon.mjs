// scripts/patch-electron-icon.mjs
// =============================================================
// 开发模式下用 rcedit 将 electron.exe 的图标和元信息替换为自定义值,
// 使 Windows 任务栏右键菜单显示正确的应用名称和图标。
// 在 postinstall 时自动执行; 若 rcedit 不可用则静默跳过。
// =============================================================

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const ELECTRON_EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const ICO_PATH = join(ROOT, 'resources', 'icon.ico')

function main() {
  if (!existsSync(ELECTRON_EXE)) {
    console.log('[patch-electron-icon] electron.exe not found, skipping')
    return
  }
  if (!existsSync(ICO_PATH)) {
    console.log('[patch-electron-icon] icon.ico not found, skipping')
    return
  }

  let rceditBin
  try {
    const rceditPkg = require('rcedit')
    // rcedit 包导出的 bin 路径
    rceditBin = join(dirname(require.resolve('rcedit')), 'bin', 'rcedit-x64.exe')
    if (!existsSync(rceditBin)) {
      rceditBin = join(dirname(require.resolve('rcedit')), 'bin', 'rcedit.exe')
    }
  } catch {
    console.log('[patch-electron-icon] rcedit not installed, skipping')
    return
  }

  if (!existsSync(rceditBin)) {
    console.log('[patch-electron-icon] rcedit binary not found, skipping')
    return
  }

  // rcedit 在某些目录(如 node_modules)下可能因安全软件拦截写入,
  // 因此先复制到 temp 目录 patch, 再替换回去
  const tmpExe = join(tmpdir(), `electron_patch_${Date.now()}.exe`)
  try {
    copyFileSync(ELECTRON_EXE, tmpExe)

    execFileSync(rceditBin, [
      tmpExe,
      '--set-icon', ICO_PATH,
      '--set-version-string', 'ProductName', 'Education Advisor',
      '--set-version-string', 'FileDescription', 'Education Advisor',
      '--set-version-string', 'CompanyName', 'Education Advisor',
      '--set-version-string', 'LegalCopyright', 'Copyright 2026',
      '--set-version-string', 'OriginalFilename', 'Education Advisor.exe',
      '--set-version-string', 'InternalName', 'Education Advisor',
      '--set-file-version', '0.1.0',
      '--set-product-version', '0.1.0',
    ], { stdio: 'pipe' })

    // 替换: 先 rename 原文件, 再 copy 回来 (避免 "device busy")
    const origBackup = ELECTRON_EXE + '.orig'
    try { renameSync(ELECTRON_EXE, origBackup) } catch { /* already renamed */ }
    copyFileSync(tmpExe, ELECTRON_EXE)
    console.log('[patch-electron-icon] electron.exe patched successfully')
  } catch (err) {
    console.warn('[patch-electron-icon] Failed to patch (non-fatal):', err.message || err)
  } finally {
    try { require('node:fs').unlinkSync(tmpExe) } catch { /* ignore */ }
  }
}

main()
