// 多角度健康检查: 内存/性能/DOM/存储/监听器泄漏
import WebSocket from 'ws'

const res = await fetch('http://localhost:9222/json')
const targets = await res.json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res2, rej) => { ws.on('open', res2); ws.on('error', rej) })
let id = 0
const pending = new Map()
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}) => new Promise((res2) => {
  const mid = ++id
  pending.set(mid, res2)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. 基线指标
await send('Performance.enable')
const metrics1 = await send('Performance.getMetrics')
const m1 = Object.fromEntries(metrics1.result.metrics.map((m) => [m.name, m.value]))
console.log('=== 基线 ===')
console.log('JSHeapUsedSize(MB):', (m1.JSHeapUsedSize / 1048576).toFixed(1))
console.log('JSHeapTotalSize(MB):', (m1.JSHeapTotalSize / 1048576).toFixed(1))
console.log('DOMNodes:', m1.Nodes, ' JSEventListeners:', m1.JSEventListeners)
console.log('Documents:', m1.Documents, ' Frames:', m1.Frames, ' LayoutCount:', m1.LayoutCount)

// 2. 路由往返压力: 11 路由 x 3 轮, 检查堆/监听器泄漏
const ROUTES = ['dashboard', 'chat', 'students', 'classes', 'academics', 'agents', 'models', 'skills', 'scheduler', 'privacy', 'settings']
for (let round = 0; round < 3; round++) {
  for (const r of ROUTES) {
    await evl(`location.hash = '#/${r}'`)
    await sleep(450)
  }
}
await evl(`location.hash = '#/dashboard'`)
await sleep(1500)
// 强制 GC (需要 --js-flags=--expose-gc; 没有则用分配压力诱导)
await evl(`(() => { for (let i = 0; i < 30; i++) new ArrayBuffer(1024 * 1024); return true })()`)
await sleep(1200)
const metrics2 = await send('Performance.getMetrics')
const m2 = Object.fromEntries(metrics2.result.metrics.map((m) => [m.name, m.value]))
console.log('=== 33 次路由切换后 ===')
console.log('JSHeapUsedSize(MB):', (m2.JSHeapUsedSize / 1048576).toFixed(1))
console.log('DOMNodes:', m2.Nodes, ' JSEventListeners:', m2.JSEventListeners)
console.log('LayoutCount:', m2.LayoutCount, ' RecalcStyleCount:', m2.RecalcStyleCount)
const heapDelta = (m2.JSHeapUsedSize - m1.JSHeapUsedSize) / 1048576
const nodesDelta = m2.Nodes - m1.Nodes
const listenersDelta = m2.JSEventListeners - m1.JSEventListeners
console.log(`Δheap: ${heapDelta.toFixed(1)}MB  Δnodes: ${nodesDelta}  Δlisteners: ${listenersDelta}`)
console.log(heapDelta < 30 && nodesDelta < 3000 && listenersDelta < 3000 ? 'PASS: 无明显泄漏' : 'WARN: 可能存在泄漏')

// 3. localStorage / indexedDB 使用
const storage = await evl(`(async () => {
  const ls = {}
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = (localStorage.getItem(k) || '').length }
  const dbs = await indexedDB.databases?.() ?? []
  const est = await navigator.storage?.estimate?.() ?? {}
  return { ls, dbs: dbs.map((d) => d.name), quotaMB: (est.quota / 1048576).toFixed(0), usedMB: (est.usage / 1048576).toFixed(1) }
})()`)
console.log('=== 存储 ===')
console.log(JSON.stringify(storage, null, 1))

// 4. 长任务检测: 切到 students(225行表格) 测渲染耗时
const t0 = Date.now()
await evl(`location.hash = '#/students'`)
await sleep(2000)
const longTasks = await evl(`(async () => {
  return await new Promise((resolve) => {
    const entries = []
    const po = new PerformanceObserver((list) => { entries.push(...list.getEntries().map((e) => Math.round(e.duration))) })
    try { po.observe({ entryTypes: ['longtask'] }) } catch { resolve(['unsupported']) }
    setTimeout(() => { po.disconnect(); resolve(entries) }, 1200)
  })
})()`)
console.log('=== students 页 longtask(>50ms) ===')
console.log('nav+render wall(ms):', Date.now() - t0, ' longtasks:', JSON.stringify(longTasks))

ws.close()
process.exit(0)
