// =============================================================
// R91 性能/速度测试 + 优化验证
// 角度 1: IPC 调用延迟分布 (P50/P95/P99) - 8 个核心通道 × 30 次调用
// 角度 2: 路由切换渲染耗时 - 11 个页面 × 5 轮
// 角度 3: 大数据量查询性能 - ranking(100/500)、listStudents、stats
// 角度 4: 内存采样 - 基线/中段/最终 对比
// 角度 5: 0 unhandledrejection/error 全程错误捕获
// =============================================================

import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`
const ROUNDS = 30

// ---------- CDP 工具 ----------
async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/json`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function cdpCall(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.toString())
      if (msg.id === id) {
        ws.off('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 25000,
  })
  if (r.exceptionDetails) {
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  }
  return r.result.value
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------- 用 WebSocket 连 CDP ----------
let WebSocket
try {
  WebSocket = (await import('ws')).default
} catch {
  WebSocket = globalThis.WebSocket
}

const targets = await getTargets()
const pageTarget =
  targets.find((t) => t.type === 'page' && t.url.includes('localhost')) ||
  targets.find((t) => t.type === 'page' && t.url.includes('tauri')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R91] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  ws.on('open', r)
  ws.on('error', rej)
  setTimeout(() => rej(new Error('ws connect timeout')), 10000)
})

// ---------- 测试结果收集 ----------
const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) {
    results.pass++
    console.log(`  ✅ ${name}`)
  } else {
    results.fail++
    results.errors.push(name)
    console.log(`  ❌ ${name} ${detail}`)
  }
}

// ---------- 全局错误捕获器 ----------
await evalInPage(ws, `
  window.__r91Errors = [];
  if (!window.__r91HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r91Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r91Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r91HookInstalled = true;
  }
  true
`)

// ---------- 工具函数 ----------
function percentile(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

async function measureIPC(ws, expr, label) {
  const start = Date.now()
  const r = await evalInPage(ws, expr)
  const elapsed = Date.now() - start
  return { elapsed, result: r, label }
}

async function sampleMemory(ws) {
  return await evalInPage(ws, `(() => {
    const m = performance.memory || {};
    return {
      ts: Date.now(),
      usedMB: m.usedJSHeapSize ? (m.usedJSHeapSize / 1024 / 1024).toFixed(2) : '0',
      totalMB: m.totalJSHeapSize ? (m.totalJSHeapSize / 1024 / 1024).toFixed(2) : '0',
      nodeCount: document.querySelectorAll('*').length,
    };
  })()`)
}

async function navigateTo(ws, hash) {
  await evalInPage(ws, `window.location.hash = ${JSON.stringify(hash)}; true`)
}

async function getCapturedErrors(ws) {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r91Errors || []))`)
}

async function clearErrors(ws) {
  await evalInPage(ws, `window.__r91Errors = []; true`)
}

// =============================================================
// R91-1: IPC 调用延迟分布 (8 通道 × 30 次)
// =============================================================
console.log('\n=== R91-1: IPC 调用延迟分布 ===')

const ipcTests = [
  { label: 'eaa.info', expr: 'window.api.eaa.info()' },
  { label: 'eaa.stats', expr: 'window.api.eaa.stats()' },
  { label: 'eaa.codes', expr: 'window.api.eaa.codes()' },
  { label: 'eaa.summary', expr: 'window.api.eaa.summary()' },
  { label: 'eaa.ranking(10)', expr: 'window.api.eaa.ranking(10)' },
  { label: 'eaa.listStudents', expr: 'window.api.eaa.listStudents()' },
  { label: 'agent.list', expr: 'window.api.agent.list()' },
  { label: 'skill.list', expr: 'window.api.skill.list()' },
]

const ipcLatencies = {}
for (const t of ipcTests) {
  const latencies = []
  let fail = 0
  for (let i = 0; i < ROUNDS; i++) {
    const r = await measureIPC(ws, t.expr, t.label)
    if (r.result && r.result.__error) {
      fail++
    } else {
      latencies.push(r.elapsed)
    }
  }
  ipcLatencies[t.label] = { latencies, fail }
  const p50 = percentile(latencies, 50)
  const p95 = percentile(latencies, 95)
  const p99 = percentile(latencies, 99)
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
  console.log(
    `  ${t.label.padEnd(20)} n=${latencies.length}/${ROUNDS} fail=${fail} avg=${avg.toFixed(0)}ms p50=${p50}ms p95=${p95}ms p99=${p99}ms`,
  )
}

// =============================================================
// R91-2: 路由切换渲染耗时 (11 页 × 5 轮)
// =============================================================
console.log('\n=== R91-2: 路由切换渲染耗时 ===')

const pages = [
  '#/dashboard',
  '#/students',
  '#/classes',
  '#/academics',
  '#/chat',
  '#/agents',
  '#/models',
  '#/skills',
  '#/scheduler',
  '#/privacy',
  '#/settings',
]

const navLatencies = []
for (let round = 0; round < 5; round++) {
  for (const hash of pages) {
    const start = Date.now()
    await navigateTo(ws, hash)
    await sleep(150) // 给 React 渲染时间
    const info = await evalInPage(ws, `(() => ({
      hash: window.location.hash,
      bodyLen: document.body.innerText.length,
      buttons: document.querySelectorAll('button').length,
    }))()`)
    const elapsed = Date.now() - start
    navLatencies.push({ hash, elapsed, bodyLen: info.bodyLen, buttons: info.buttons })
  }
}

const navTimes = navLatencies.map((n) => n.elapsed)
const navP50 = percentile(navTimes, 50)
const navP95 = percentile(navTimes, 95)
const navP99 = percentile(navTimes, 99)
const navAvg = navTimes.reduce((a, b) => a + b, 0) / navTimes.length
console.log(
  `  导航 ${navLatencies.length} 次: avg=${navAvg.toFixed(0)}ms p50=${navP50}ms p95=${navP95}ms p99=${navP99}ms`,
)

// 按页面分组找最慢页
const pageGroup = {}
for (const n of navLatencies) {
  if (!pageGroup[n.hash]) pageGroup[n.hash] = []
  pageGroup[n.hash].push(n.elapsed)
}
console.log('  各页面平均耗时:')
for (const [h, arr] of Object.entries(pageGroup)) {
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length
  console.log(`    ${h.padEnd(20)} avg=${avg.toFixed(0)}ms (n=${arr.length})`)
}

// =============================================================
// R91-3: 大数据量查询性能
// =============================================================
console.log('\n=== R91-3: 大数据量查询性能 ===')

const bigQueries = [
  { label: 'eaa.ranking(100)', expr: 'window.api.eaa.ranking(100)' },
  { label: 'eaa.ranking(500)', expr: 'window.api.eaa.ranking(500)' },
  { label: 'eaa.ranking(1000)', expr: 'window.api.eaa.ranking(1000)' },
  { label: 'eaa.listStudents', expr: 'window.api.eaa.listStudents()' },
  { label: 'eaa.stats', expr: 'window.api.eaa.stats()' },
  { label: 'eaa.search("学生")', expr: 'window.api.eaa.search("学生", 50)' },
]

for (const q of bigQueries) {
  const times = []
  for (let i = 0; i < 5; i++) {
    const start = Date.now()
    const r = await evalInPage(ws, q.expr)
    times.push(Date.now() - start)
    if (r && r.__error) {
      console.log(`    ${q.label} error: ${r.__error.slice(0, 100)}`)
    }
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)
  console.log(`  ${q.label.padEnd(25)} avg=${avg.toFixed(0)}ms min=${min}ms max=${max}ms`)
}

// =============================================================
// R91-4: 内存采样对比
// =============================================================
console.log('\n=== R91-4: 内存采样对比 ===')

// 切到 dashboard 作基线
await navigateTo(ws, '#/dashboard')
await sleep(800)
const baseline = await sampleMemory(ws)
console.log(`  基线: heapUsed=${baseline.usedMB}MB nodes=${baseline.nodeCount}`)

// 模拟一段中等强度使用 (60s)
const stressStart = Date.now()
const stressDurationMs = 30 * 1000 // 30 秒
let stressOps = 0
while (Date.now() - stressStart < stressDurationMs) {
  const hash = pages[Math.floor(Math.random() * pages.length)]
  await navigateTo(ws, hash)
  await sleep(120)
  // 偶尔触发一次 IPC
  if (Math.random() < 0.3) {
    await evalInPage(ws, `window.api.eaa.stats()`)
  }
  stressOps++
}
const midSample = await sampleMemory(ws)
console.log(
  `  中段(${stressOps}次操作后): heapUsed=${midSample.usedMB}MB nodes=${midSample.nodeCount} (+${(parseFloat(midSample.usedMB) - parseFloat(baseline.usedMB)).toFixed(2)}MB)`,
)

// 等待 GC
await sleep(3000)
const finalSample = await sampleMemory(ws)
console.log(
  `  最终(GC后): heapUsed=${finalSample.usedMB}MB nodes=${finalSample.nodeCount} (基线差 ${(parseFloat(finalSample.usedMB) - parseFloat(baseline.usedMB)).toFixed(2)}MB)`,
)

// =============================================================
// 检查项
// =============================================================
console.log('\n=== R91 检查项 ===')

// 1. P95 IPC 延迟 < 200ms (除 listStudents 可能数据量大)
const slowP95 = []
for (const [label, data] of Object.entries(ipcLatencies)) {
  const p95 = percentile(data.latencies, 95)
  if (label !== 'eaa.listStudents' && p95 > 200) {
    slowP95.push({ label, p95 })
  }
}
check('IPC P95 延迟 < 200ms (除 listStudents)', slowP95.length === 0, slowP95.length ? JSON.stringify(slowP95) : '')

// 2. listStudents P95 < 500ms (大数据量宽松)
const listStudentsP95 = percentile(ipcLatencies['eaa.listStudents']?.latencies || [], 95)
check('eaa.listStudents P95 < 500ms', listStudentsP95 < 500, `(p95=${listStudentsP95}ms)`)

// 3. IPC 调用 0 失败
const ipcFails = Object.entries(ipcLatencies).filter(([, d]) => d.fail > 0)
check('IPC 调用 0 失败', ipcFails.length === 0, ipcFails.length ? JSON.stringify(ipcFails.map(([l, d]) => `${l}:${d.fail}`)) : '')

// 4. 路由切换 P95 < 800ms (含 150ms sleep,实际 React 渲染 ~650ms)
check('路由切换 P95 < 800ms', navP95 < 800, `(p95=${navP95}ms)`)

// 5. 路由切换 P99 < 1500ms
check('路由切换 P99 < 1500ms', navP99 < 1500, `(p99=${navP99}ms)`)

// 6. 大数据量 ranking(1000) < 200ms
let bigRanking1000Time = 0
for (let i = 0; i < 3; i++) {
  const start = Date.now()
  await evalInPage(ws, 'window.api.eaa.ranking(1000)')
  bigRanking1000Time = Math.max(bigRanking1000Time, Date.now() - start)
}
check('eaa.ranking(1000) < 200ms', bigRanking1000Time < 200, `(max=${bigRanking1000Time}ms)`)

// 7. 内存净增长 < 30MB
const memGrowth = parseFloat(finalSample.usedMB) - parseFloat(baseline.usedMB)
check('30s 操作后内存净增长 < 30MB', memGrowth < 30, `(growth=+${memGrowth.toFixed(2)}MB)`)

// 8. 全程 0 unhandledrejection/error
const errs = await getCapturedErrors(ws)
check('全程 0 unhandledrejection/error', errs.length === 0, `(errors=${errs.length})`)
if (errs.length > 0) {
  console.log(`    错误明细: ${JSON.stringify(errs.slice(0, 5))}`)
}

// =============================================================
// 总结
// =============================================================
console.log('\n========================================')
console.log(`R91 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
