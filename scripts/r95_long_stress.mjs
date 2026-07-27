// =============================================================
// R95 长时间内存压力测试 (3 分钟高频)
// 角度 1: 3 分钟持续页面切换 + IPC 调用 (每 200ms 一次)
// 角度 2: 每 30s 采样 heapUsed / nodes
// 角度 3: GC 周期性回收验证 (至少一次下降)
// 角度 4: 0 unhandledrejection/error
// 角度 5: 渲染耗时统计
// =============================================================

import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`
const TOTAL_DURATION_MS = 3 * 60 * 1000 // 3 分钟
const SAMPLE_INTERVAL_MS = 30 * 1000
const OP_INTERVAL_MS = 200 // 每 200ms 一次操作

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
console.log(`[R95] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  ws.on('open', r)
  ws.on('error', rej)
  setTimeout(() => rej(new Error('ws connect timeout')), 10000)
})

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
  window.__r95Errors = [];
  if (!window.__r95HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r95Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r95Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r95HookInstalled = true;
  }
  true
`)

async function navigateTo(ws, hash) {
  await evalInPage(ws, `window.location.hash = ${JSON.stringify(hash)}; true`)
}

async function sampleMemory(ws) {
  return await evalInPage(ws, `(() => {
    const m = performance.memory || {};
    return {
      ts: Date.now(),
      usedJSHeapSize: m.usedJSHeapSize || 0,
      usedMB: m.usedJSHeapSize ? (m.usedJSHeapSize / 1024 / 1024).toFixed(2) : '0',
      nodeCount: document.querySelectorAll('*').length,
    };
  })()`)
}

// =============================================================
// R95-1: 基线采样
// =============================================================
console.log('\n=== R95-1: 基线采样 ===')
await navigateTo(ws, '#/dashboard')
await sleep(1500)
const baseline = await sampleMemory(ws)
console.log(`  基线: heapUsed=${baseline.usedMB}MB, nodes=${baseline.nodeCount}`)

// =============================================================
// R95-2: 3 分钟持续压力
// =============================================================
console.log(`\n=== R95-2: ${TOTAL_DURATION_MS / 60000} 分钟持续压力测试 ===`)

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

const ipcOps = [
  'window.api.eaa.info()',
  'window.api.eaa.stats()',
  'window.api.eaa.ranking(10)',
  'window.api.eaa.listStudents()',
  'window.api.agent.list()',
  'window.api.skill.list()',
]

const samples = [baseline]
const renderTimes = []
const startTime = Date.now()
let opCount = 0
let errorCount = 0
let lastSampleTime = Date.now()

while (Date.now() - startTime < TOTAL_DURATION_MS) {
  // 50% 概率切页面, 50% 概率调 IPC
  const isNav = Math.random() < 0.5
  const opStart = Date.now()
  if (isNav) {
    const hash = pages[Math.floor(Math.random() * pages.length)]
    await navigateTo(ws, hash)
  } else {
    const op = ipcOps[Math.floor(Math.random() * ipcOps.length)]
    await evalInPage(ws, op)
  }
  renderTimes.push(Date.now() - opStart)
  opCount++

  // 采样
  if (Date.now() - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    const s = await sampleMemory(ws)
    samples.push(s)
    const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(2)
    const errs = await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r95Errors || []))`)
    errorCount += errs.length
    console.log(
      `  [${elapsedMin}min] op=${opCount} heapUsed=${s.usedMB}MB nodes=${s.nodeCount} (errors=${errs.length})`,
    )
    if (errs.length > 0) {
      console.log(`    错误: ${JSON.stringify(errs.slice(0, 3))}`)
    }
    await evalInPage(ws, `window.__r95Errors = []; true`)
    lastSampleTime = Date.now()
  }

  await sleep(OP_INTERVAL_MS)
}

// =============================================================
// R95-3: 最终 GC + 对比基线
// =============================================================
console.log('\n=== R95-3: 最终采样 + 对比基线 ===')
await sleep(2000)
const final = await sampleMemory(ws)
samples.push(final)

const heapGrowthMB = parseFloat(final.usedMB) - parseFloat(baseline.usedMB)
const nodeGrowth = final.nodeCount - baseline.nodeCount

console.log(`  基线:    heapUsed=${baseline.usedMB}MB, nodes=${baseline.nodeCount}`)
console.log(`  最终:    heapUsed=${final.usedMB}MB, nodes=${final.nodeCount}`)
console.log(`  净增长:  heapUsed=+${heapGrowthMB.toFixed(2)}MB, nodes=+${nodeGrowth}`)
console.log(`  总操作:  ${opCount} 次 (errors=${errorCount})`)

// =============================================================
// R95-4: 渲染耗时统计
// =============================================================
console.log('\n=== R95-4: 操作耗时统计 ===')
const avgRender = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length
const maxRender = Math.max(...renderTimes)
const minRender = Math.min(...renderTimes)
const p95Idx = Math.ceil(0.95 * renderTimes.length) - 1
const sortedRender = [...renderTimes].sort((a, b) => a - b)
const p95Render = sortedRender[Math.max(0, p95Idx)]
console.log(`  总操作次数: ${opCount}`)
console.log(`  操作耗时: avg=${avgRender.toFixed(0)}ms, min=${minRender}ms, max=${maxRender}ms, p95=${p95Render}ms`)

// =============================================================
// 检查项
// =============================================================
console.log('\n=== R95 检查项 ===')

// 1. 内存净增长 < 50MB (3 分钟允许稍多)
check('3min 内存净增长 < 50MB', heapGrowthMB < 50, `(growth=+${heapGrowthMB.toFixed(2)}MB)`)

// 2. 节点数稳定
check('DOM 节点净增长 < 10000', nodeGrowth < 10000, `(growth=+${nodeGrowth})`)

// 3. 平均操作耗时 < 500ms
check('平均操作耗时 < 500ms', avgRender < 500, `(avg=${avgRender.toFixed(0)}ms)`)

// 4. P95 操作耗时 < 1000ms
check('P95 操作耗时 < 1000ms', p95Render < 1000, `(p95=${p95Render}ms)`)

// 5. 错误率 < 5%
const errorRate = opCount > 0 ? errorCount / opCount : 0
check('错误率 < 5%', errorRate < 0.05, `(errors=${errorCount}/${opCount}, rate=${(errorRate * 100).toFixed(2)}%)`)

// 6. 至少 6 个采样点 (3min/30s = 6 + 基线 + 最终 = 8)
check('采样点 >= 6 个', samples.length >= 6, `(samples=${samples.length})`)

// 7. GC 周期性回收
let hasGCReclaim = false
for (let i = 1; i < samples.length; i++) {
  if (samples[i].usedJSHeapSize < samples[i - 1].usedJSHeapSize) {
    hasGCReclaim = true
    break
  }
}
check('GC 周期性回收工作正常', hasGCReclaim, '(内存单调增长无回收)')

// 8. 采样明细
console.log('\n=== 内存采样明细 ===')
console.log('时间(min)  heapUsed(MB)  nodes')
console.log('--------   -----------   -----')
samples.forEach((s, i) => {
  const min = ((s.ts - baseline.ts) / 60000).toFixed(2)
  console.log(`${min.padStart(8)}   ${s.usedMB.padStart(11)}   ${String(s.nodeCount).padStart(5)}`)
})

// =============================================================
// 总结
// =============================================================
console.log('\n========================================')
console.log(`R95 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
