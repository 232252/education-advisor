#!/usr/bin/env node
// =============================================================
// scripts/bundle-shape-check.mjs — bundle 形状守卫(build 后运行)
//
// 保护 R150-R160 的懒加载战果不被无意回归:
//   R150 vendor-echarts 独立 chunk(不在 entry 静态图)
//   R151 zh/en 字典各成异步 chunk
//   R153 katex/remark-math 异步 chunk
// 判定基于 dist 产物静态分析:
//   1) entry 集 = index.html 引用 + 递归静态 import(动态 import 在产物中
//      经 rolldown runtime,不是静态 import 语句,天然不进 entry 集)
//   2) 断言 entry 集内出现懒库内容标记即失败
//   3) 断言对应独立 chunk 存在
//   4) entry JS 总量 ≤ 上限(防缓慢爬升;调整需在提交信息说明理由)
// 退出码: 0 通过 / 1 失败 / 2 dist 缺失(提示先 build)
// =============================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'dist', 'renderer', 'assets')
const HTML = join(ROOT, 'dist', 'renderer', 'index.html')

if (!existsSync(HTML)) {
  console.error('[bundle-shape] dist/renderer/index.html 不存在 — 先 npm run build')
  process.exit(2)
}

// ---- 1) 收集 entry 集(index.html 引用 + 递归静态 import) ----
const html = readFileSync(HTML, 'utf8')
const entryFiles = new Set()
for (const m of html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)) {
  entryFiles.add(m[1])
}
const queue = [...entryFiles].filter((f) => f.endsWith('.js'))
while (queue.length) {
  const rel = queue.pop()
  const p = join(ROOT, 'dist', 'renderer', rel)
  if (!existsSync(p)) continue
  const src = readFileSync(p, 'utf8')
  for (const m of src.matchAll(/(?:import[^('"]*?from|import)\s*"(\.\/[^"]+\.js)"/g)) {
    const dep = `assets/${m[1].replace(/^\.\//, '')}`
    if (!entryFiles.has(dep)) {
      entryFiles.add(dep)
      queue.push(dep)
    }
  }
}

// ---- 2) 懒库内容标记不得出现在 entry 集 ----
// zrender 是 echarts 独有内部库;katex 标记在压缩产物中稳定出现
const FORBIDDEN_MARKERS = [
  ['zrender', 'echarts(R150: vendor-echarts 应仅由 EChartImpl 异步引用)'],
  ['katex', 'KaTeX(R153: 数学栈应仅由 Markdown 按需加载)'],
]
const violations = []
for (const rel of entryFiles) {
  if (!rel.endsWith('.js')) continue
  const src = readFileSync(join(ROOT, 'dist', 'renderer', rel), 'utf8')
  for (const [marker, label] of FORBIDDEN_MARKERS) {
    if (src.includes(marker)) violations.push(`${rel} 含 ${label} 标记 "${marker}"`)
  }
}

// ---- 3) 独立 chunk 必须存在 ----
const assetFiles = readdirSync(ASSETS)
const requiredChunks = [
  [/^vendor-echarts-[\w-]+\.js$/, 'vendor-echarts(R150)'],
  [/^zh-[\w-]+\.js$/, 'zh 字典(R151)'],
  [/^en-[\w-]+\.js$/, 'en 字典(R151)'],
  [/^rehype-katex-[\w-]+\.js$/, 'rehype-katex(R153)'],
  [/^remark-math-[\w-]+\.js$/, 'remark-math(R153)'],
]
for (const [re, label] of requiredChunks) {
  if (!assetFiles.some((f) => re.test(f))) violations.push(`缺少独立 chunk: ${label} (${re})`)
}
// 字典不得进入 entry 集(文件名级断言,内容级由体积守卫兜底)
for (const rel of entryFiles) {
  if (/^assets\/(zh|en)-[\w-]+\.js$/.test(rel)) violations.push(`字典 ${rel} 进入 entry 静态图`)
}

// ---- 4) entry JS 总量上限 ----
const ENTRY_JS_BYTES_LIMIT = 400_000
let total = 0
for (const rel of entryFiles) {
  if (rel.endsWith('.js')) total += statSync(join(ROOT, 'dist', 'renderer', rel)).size
}
const fmt = (n) => `${(n / 1024).toFixed(1)}KB`
console.log(`[bundle-shape] entry JS: ${entryFiles.size} 文件, ${fmt(total)} (上限 ${fmt(ENTRY_JS_BYTES_LIMIT)})`)

if (total > ENTRY_JS_BYTES_LIMIT) {
  violations.push(`entry JS 总量 ${fmt(total)} 超上限 ${fmt(ENTRY_JS_BYTES_LIMIT)}`)
}

if (violations.length) {
  console.error('[bundle-shape] FAIL:')
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}
console.log('[bundle-shape] PASS — 懒加载分割完好,entry 体积在限')
