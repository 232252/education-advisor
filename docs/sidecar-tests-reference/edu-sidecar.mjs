// =============================================================
// Sidecar 运行器 — 由 Tauri (Rust) 用 `node sidecar/edu-sidecar.mjs` 启动
//
// 它只是简单地加载 vite 构建好的 CJS 产物 dist/sidecar/sidecar.cjs
// 单独留一个 .mjs 是为了让 Rust 启动命令固定, 与构建产物路径解耦
// =============================================================

import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 定位构建产物
function findBundle() {
  const names = ['sidecar.mjs', 'sidecar.js', 'sidecar.cjs']
  const dirs = [
    path.resolve(__dirname, '..', 'dist', 'sidecar'),
    path.resolve(process.cwd(), 'dist', 'sidecar'),
    path.resolve(__dirname, 'dist', 'sidecar'),
  ]
  for (const d of dirs) {
    for (const n of names) {
      const p = path.resolve(d, n)
      if (fs.existsSync(p)) return p
    }
  }
  // 兜底
  return path.resolve(dirs[0], names[0])
}

const bundle = findBundle()

if (!fs.existsSync(bundle)) {
  process.stderr.write(`[edu-sidecar] FATAL: sidecar bundle not found at ${bundle}\n`)
  process.stderr.write(`[edu-sidecar] Did you run: npx vite build --config vite.config.sidecar.ts\n`)
  process.exit(1)
}

// 动态 import CJS 产物 (Node ESM 加载 CJS)
await import(pathToFileURL(bundle).href)
