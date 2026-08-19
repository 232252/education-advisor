// =============================================================
// doc-stats.mjs — 架构文档与实现同源（docs-as-code）
//
// 使命：把「可枚举事实」（页面数 / 路由数 / IPC 通道数 / service 文件数 /
//       store 模块数 / agent 数 …）从手写数字中解放出来，改为由本脚本
//       自动扫描代码生成，杜绝「文档数字过时」这类漂移。
//
// 用法：
//   node scripts/doc-stats.mjs            打印统计（默认，便于人肉核对）
//   node scripts/doc-stats.mjs --write    把统计写回 docs/ARCHITECTURE.md 的占位块
//   node scripts/doc-stats.mjs --check    校验占位块与当前代码一致（CI 门禁）
//
// 约定：docs/ARCHITECTURE.md 中以
//        <!-- doc-stats:start --> ... <!-- doc-stats:end -->
//       包裹的 Markdown 表格为本脚本唯一权威输出目标。
// =============================================================

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARCH = join(ROOT, 'docs', 'ARCHITECTURE.md')

const START = '<!-- doc-stats:start -->'
const END = '<!-- doc-stats:end -->'

/** 递归列出目录下所有文件（绝对路径） */
function walk(dir, out = []) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

/** 统计目录下的 TypeScript 源文件数（排除声明/测试/快照）。 */
function countTsFiles(rel) {
  return walk(join(ROOT, rel)).filter(
    (f) =>
      f.endsWith('.ts') &&
      !f.endsWith('.d.ts') &&
      !/\.(test|spec)\.tsx?$/.test(f) &&
      !f.includes(`__tests__`) &&
      !f.includes(`node_modules`),
  ).length
}

/** 路由数：App.tsx 中 <Route path="..."> 的数量 */
function countRoutes() {
  const src = read('src/renderer/App.tsx')
  return (src.match(/<Route\s+path="/g) || []).length
}

/** 页面数：App.tsx 中 lazy(() => import('./pages/...) 的数量 */
function countPages() {
  const src = read('src/renderer/App.tsx')
  return (src.match(/lazy\(\(\)\s*=>/g) || []).length
}

/** IPC 通道数：ipc-channels.ts 中 export const IPC_* 的数量 */
function countIpcChannels() {
  const src = read('src/shared/ipc-channels.ts')
  return (src.match(/^export const IPC_/gm) || []).length
}

/** Zustand store 模块数：stores 顶层 .ts + 各域的 store.ts */
function countStores() {
  const dir = join(ROOT, 'src', 'renderer', 'stores')
  if (!existsSync(dir)) return 0
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isFile() && name.endsWith('.ts') && !name.endsWith('.test.ts')) n += 1
    else if (st.isDirectory()) {
      const storeFile = join(p, 'store.ts')
      if (existsSync(storeFile)) n += 1
    }
  }
  return n
}

/** Agent 数：agents/ 下含 SOUL.md 的一级子目录数 */
function countAgents() {
  const dir = join(ROOT, 'agents')
  if (!existsSync(dir)) return 0
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory() && existsSync(join(p, 'SOUL.md'))) n += 1
  }
  return n
}

function computeStats() {
  const s = {
    pages: countPages(),
    routes: countRoutes(),
    ipcChannels: countIpcChannels(),
    services: countTsFiles('src/main/services'),
    ipcHandlers: countTsFiles('src/main/ipc'),
    stores: countStores(),
    preloadApis: countTsFiles('src/main/preload/api'),
    sharedTypes: countTsFiles('src/shared/types'),
    rendererIpcTypes: countTsFiles('src/renderer/lib/ipc'),
    agents: countAgents(),
  }
  return s
}

function renderBlock(s) {
  const rows = [
    ['维度', '数量'],
    ['页面数', String(s.pages)],
    ['路由数', String(s.routes)],
    ['IPC 通道数', String(s.ipcChannels)],
    ['Service 文件数', String(s.services)],
    ['IPC handler 文件数', String(s.ipcHandlers)],
    ['Zustand store 模块数', String(s.stores)],
    ['Preload API 文件数', String(s.preloadApis)],
    ['Shared 类型文件数', String(s.sharedTypes)],
    ['Renderer IPC 类型文件数', String(s.rendererIpcTypes)],
    ['Agent 数', String(s.agents)],
  ]
  const lines = rows.map((r) => `| ${r[0]} | ${r[1]} |`)
  lines.splice(1, 0, '| --- | --- |')
  return `${START}\n${lines.join('\n')}\n${END}`
}

const flag = process.argv[2]
const s = computeStats()
const block = renderBlock(s)

if (flag === '--check') {
  const content = read('docs/ARCHITECTURE.md')
  if (!content.includes(block)) {
    console.error('[doc-stats] 架构文档与实现漂移：docs/ARCHITECTURE.md 的 doc-stats 块已过时。')
    console.error('[doc-stats] 运行 `node scripts/doc-stats.mjs --write` 更新后重试。')
    process.exit(1)
  }
  console.log(`[doc-stats] 一致：${Object.values(s).join(' / ')}`)
  process.exit(0)
}

if (flag === '--write') {
  const content = read('docs/ARCHITECTURE.md')
  const re = new RegExp(`${START}[\\s\\S]*?${END}`)
  if (!re.test(content)) {
    console.error('[doc-stats] docs/ARCHITECTURE.md 缺少 doc-stats 占位块（START/END）。')
    process.exit(1)
  }
  writeFileSync(ARCH, content.replace(re, block), 'utf-8')
  console.log('[doc-stats] 已写回 docs/ARCHITECTURE.md。')
} else {
  // 默认：打印 Markdown 统计块
  console.log(block)
}