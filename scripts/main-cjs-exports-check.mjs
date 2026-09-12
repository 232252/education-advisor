#!/usr/bin/env node
// =============================================================
// 主进程 CJS 产物不得 require ESM-only 的 @earendil-works 子路径
// (exports 仅有 import 时,打包后 Windows 安装包会弹
//  ERR_PACKAGE_PATH_NOT_EXPORTED 的 Error 对话框)
// =============================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_DIR = join(ROOT, 'dist', 'main')

if (!existsSync(MAIN_DIR)) {
  console.error('[main-cjs-exports] dist/main 不存在 — 先 npm run build')
  process.exit(2)
}

const files = readdirSync(MAIN_DIR).filter((f) => f.endsWith('.cjs'))
const hits = []
for (const file of files) {
  const src = readFileSync(join(MAIN_DIR, file), 'utf8')
  for (const m of src.matchAll(/require\("(@earendil-works\/[^"]+)"\)/g)) {
    hits.push(`${file}: ${m[1]}`)
  }
}

if (hits.length) {
  console.error('[main-cjs-exports] FAIL — CJS 主进程还在 require ESM-only 包:')
  for (const h of [...new Set(hits)]) console.error(`  - ${h}`)
  console.error('把对应包加入 vite.config.main.ts 的 ssr.noExternal')
  process.exit(1)
}

console.log(`[main-cjs-exports] PASS — ${files.length} 个 CJS 文件无 @earendil-works require`)
