// CDP API dump — 遍历运行中 Electron 实例的 window.api(contextBridge
// 暴露的 preload 面),记录每个 namespace 的方法名与参数签名,写入
// docs/ipc-api-dump.json 作为渲染层可调用面的权威快照。
//
// 背景: docs/PROBLEMS.md R36-2 曾生成过同类 dump(139 方法),原文件
// 在 2026-09-06 存储事故中丢失,此脚本为可重复再生的替代。
// 参数签名为静态解析 preload/api/<ns>.ts 的结果——contextBridge 代理
// 的 fn.toString() 被钳制为空(安全语义),运行时拿不到形参,签名以
// TypeScript 源码为准逐方法配对。
//
// 用法: 应用以 CDP 启动后
//   EA_CDP_PORT=9444 node scripts/devtools-cdp/cdp-api-dump.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp, fetchTargets } from '../lib/cdp-client.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'docs', 'ipc-api-dump.json')
const realFetch = globalThis.fetch
globalThis.fetch = (url, ...a) => realFetch(String(url).replace('localhost', '127.0.0.1'), ...a)

const targets = await fetchTargets()
if (!targets || targets.length === 0) {
  console.log('[cdp-api-dump] no CDP target — 启动应用并开启 CDP 后再跑')
  process.exit(0)
}
const { evl, close } = await connectCdp()

// 静态解析 preload api 源码: 方法名 → 形参列表(TypeScript 原文)
function staticSignatures() {
  const sigs = {}
  const dir = path.join(ROOT, 'src/main/preload/api')
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue
    const ns = f.slice(0, -3)
    const src = fs.readFileSync(path.join(dir, f), 'utf-8')
    const map = {}
    // 形如 "  methodName: (a: T, b: U) =>" 或 "  methodName: (" 收归到 "=>" 前
    const re = /^\s{2}(\w+):\s*(?:async\s*)?\(([^)]*)\)\s*=>/gm
    let m
    while ((m = re.exec(src)) !== null) map[m[1]] = m[2].replace(/\s+/g, ' ')
    sigs[ns] = map
  }
  return sigs
}
const STATIC_SIGS = staticSignatures()

const dump = await evl(`(() => {
  const api = window.api
  if (!api) return JSON.stringify({ error: 'window.api missing' })
  const paramsOf = (fn) => {
    try {
      const m = fn.toString().match(/\\(([^)]*)\\)/)
      if (!m) return []
      return m[1].split(',').map((s) => s.trim()).filter(Boolean)
    } catch { return ['<unparsable>'] }
  }
  const out = {}
  for (const [ns, obj] of Object.entries(api)) {
    if (typeof obj !== 'object' || obj === null) continue
    out[ns] = {}
    for (const [name, fn] of Object.entries(obj)) {
      if (typeof fn === 'function') out[ns][name] = { params: paramsOf(fn), arity: fn.length }
    }
  }
  return JSON.stringify(out)
})()`)

close()

const parsed = JSON.parse(dump)
if (parsed.error) {
  console.error('[cdp-api-dump]', parsed.error)
  process.exit(1)
}
// 用静态签名回填 params(contextBridge 代理 toString 为空,运行时拿不到);
// 静态源里也找不到的方法记 params: null(如经工厂动态挂载的方法)
let enriched = 0
for (const [ns, methodsMap] of Object.entries(parsed)) {
  const sigs = STATIC_SIGS[ns] || {}
  for (const [name, info] of Object.entries(methodsMap)) {
    if (sigs[name] !== undefined) {
      info.params = sigs[name] === '' ? [] : sigs[name].split(',').map((x) => x.trim())
      enriched++
    } else {
      info.params = null
    }
  }
}
const namespaces = Object.keys(parsed)
const methods = Object.values(parsed).reduce((n, o) => n + Object.keys(o).length, 0)
const archive = {
  _meta: {
    description: 'window.api 运行时快照(preload contextBridge 暴露面) — 权威契约参考',
    howToRegenerate: '启动应用(ENABLE_CDP=1)后: EA_CDP_PORT=9444 node scripts/devtools-cdp/cdp-api-dump.mjs',
    capturedAt: new Date().toISOString(),
    namespaces: namespaces.length,
    methods,
    paramNote: 'params 为 preload/api/<ns>.ts 静态解析的 TypeScript 形参(contextBridge 代理 toString 被钳制,运行时不可得); null = 静态源未匹配(经工厂动态挂载)',
    staticSignaturesEnriched: enriched,
  },
  ...parsed,
}
fs.writeFileSync(OUT, JSON.stringify(archive, null, 2) + '\n')
console.log(`[cdp-api-dump] wrote ${OUT}: ${namespaces.length} namespaces / ${methods} methods`)
console.log('namespaces:', namespaces.join(', '))
