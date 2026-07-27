// =============================================================
// R125: 长时间内存泄漏测试 (HeapProfiler + GC 分析)
// 角度 1: HeapProfiler 快照对比 (前后)
// 角度 2: 1000 次路由导航的堆增长趋势
// 角度 3: 重复 IPC 调用堆增长
// 角度 4: 主题切换 100 次的堆增长
// 角度 5: 监听器泄漏检测 (订阅/取消订阅循环)
// 角度 6: 大数据量加载/卸载循环 (Students 50 个)
// 角度 7: 强制 GC 后的残留内存
// 角度 8: 错误捕获
// =============================================================

import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`

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
    }, 90000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 80000,
  })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
if (!pageTarget) { console.error('No page target found.'); process.exit(1) }
console.log(`[R125] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('ws connect timeout')), 10000) })

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ✅ ${name}`) }
  else { results.fail++; results.errors.push(name); console.log(`  ❌ ${name} ${detail}`) }
}

await evalInPage(ws, `
  window.__r125Errors = [];
  if (!window.__r125HookInstalled) {
    window.addEventListener('error', (e) => { window.__r125Errors.push({ type: 'error', message: e.message }); });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r125Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r125HookInstalled = true;
  }
  true
`)
async function getErrors() { return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r125Errors || []))`) }

async function getHeap() {
  return await evalInPage(ws, `(async () => {
    if (performance && performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
      };
    }
    return { used: 0, total: 0, limit: 0 };
  })()`)
}

async function forceGC() {
  // 启用 HeapProfiler 强制 GC (需要 --expose-gc 或通过 CDP)
  try {
    await cdpCall(ws, 'HeapProfiler.collectGarbage', {})
  } catch (e) {
    // 备用: 通过 window.gc (如果暴露)
    await evalInPage(ws, `if (typeof window.gc === 'function') { window.gc(); } true`)
  }
  await sleep(500)
}

console.log('\n=== R125: 长时间内存泄漏测试 ===')

// =============================================================
console.log('\n[R125-1] HeapProfiler 强制 GC 可用性验证')

await forceGC()
const baselineHeap = await getHeap()
const baselineMB = baselineHeap.used / 1024 / 1024
check(`HeapProfiler.collectGarbage 可用 (baseline=${baselineMB.toFixed(1)}MB)`,
  baselineHeap.used > 0,
  `heap=${JSON.stringify(baselineHeap)}`)

// =============================================================
console.log('\n[R125-2] 1000 次路由导航的堆增长趋势')

const routes = ['#/dashboard', '#/students', '#/classes', '#/academics', '#/agents', '#/skills', '#/settings', '#/chat', '#/scheduler', '#/privacy']
const navBatchSize = 200
let navGrowthMB = 0
const navSamples = []

for (let batch = 0; batch < 5; batch++) {
  const before = await getHeap()
  for (let i = 0; i < navBatchSize; i++) {
    await evalInPage(ws, `window.location.hash = '${routes[(batch * navBatchSize + i) % routes.length]}'; true`)
    if (i % 20 === 19) await sleep(50) // 每 20 次让出事件循环
  }
  await sleep(500)
  await forceGC()
  const after = await getHeap()
  const growthMB = (after.used - before.used) / 1024 / 1024
  navSamples.push({ batch: batch + 1, growthMB: growthMB.toFixed(2), usedMB: (after.used / 1024 / 1024).toFixed(1) })
  console.log(`    batch ${batch + 1}/5: growth=${growthMB.toFixed(2)}MB, used=${(after.used / 1024 / 1024).toFixed(1)}MB`)
}

const finalNavHeap = await getHeap()
navGrowthMB = (finalNavHeap.used - baselineHeap.used) / 1024 / 1024
check(`1000 次路由导航总增长 < 60MB (实际 ${navGrowthMB.toFixed(1)}MB)`,
  navGrowthMB < 60,
  `samples=${JSON.stringify(navSamples)}`)
// 检查增长趋势是否收敛 (后两次 batch 增长应小于前两次)
const earlyGrowth = parseFloat(navSamples[1]?.growthMB || '0')
const lateGrowth = parseFloat(navSamples[4]?.growthMB || '0')
check(`导航增长趋势收敛 (batch2=${earlyGrowth}MB → batch5=${lateGrowth}MB)`,
  lateGrowth <= earlyGrowth + 5,
  `early=${earlyGrowth}, late=${lateGrowth}`)

// =============================================================
console.log('\n[R125-3] 重复 IPC 调用堆增长 (500 次 listStudents)')

const ipcBefore = await getHeap()
await evalInPage(ws, `(async () => {
  for (let i = 0; i < 500; i++) {
    await window.api.eaa.listStudents();
    if (i % 50 === 49) await new Promise(r => setTimeout(r, 20));
  }
  return true;
})()`)
await sleep(500)
await forceGC()
const ipcAfter = await getHeap()
const ipcGrowthMB = (ipcAfter.used - ipcBefore.used) / 1024 / 1024
check(`500 次 IPC listStudents 堆增长 < 30MB (实际 ${ipcGrowthMB.toFixed(1)}MB)`,
  ipcGrowthMB < 30,
  `growth=${ipcGrowthMB.toFixed(1)}MB`)

// =============================================================
console.log('\n[R125-4] 主题切换 100 次的堆增长')

const themeBefore = await getHeap()
await evalInPage(ws, `(async () => {
  for (let i = 0; i < 100; i++) {
    try {
      await window.api.settings.set('general.theme', i % 2 === 0 ? 'dark' : 'light');
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: i % 2 === 0 ? 'dark' : 'light' }));
      if (i % 10 === 9) await new Promise(r => setTimeout(r, 50));
    } catch (e) {}
  }
  // 恢复 dark
  await window.api.settings.set('general.theme', 'dark');
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }));
  return true;
})()`)
await sleep(500)
await forceGC()
const themeAfter = await getHeap()
const themeGrowthMB = (themeAfter.used - themeBefore.used) / 1024 / 1024
check(`100 次主题切换堆增长 < 20MB (实际 ${themeGrowthMB.toFixed(1)}MB)`,
  themeGrowthMB < 20,
  `growth=${themeGrowthMB.toFixed(1)}MB`)

// =============================================================
console.log('\n[R125-5] 监听器泄漏检测 (订阅/取消订阅循环 100 次)')

const STAMP = `r125-${Date.now()}`
const listenerBefore = await getHeap()
await evalInPage(ws, `(async () => {
  // 100 次 订阅 + 立即取消订阅
  for (let i = 0; i < 100; i++) {
    const unsub1 = window.api.agent.onStatusUpdate(() => {});
    const unsub2 = window.api.ai.onStream(() => {});
    const unsub3 = window.api.cron.onStatusUpdate(() => {});
    if (typeof unsub1 === 'function') unsub1();
    if (typeof unsub2 === 'function') unsub2();
    if (typeof unsub3 === 'function') unsub3();
    if (i % 20 === 19) await new Promise(r => setTimeout(r, 30));
  }
  return true;
})()`)
await sleep(500)
await forceGC()
const listenerAfter = await getHeap()
const listenerGrowthMB = (listenerAfter.used - listenerBefore.used) / 1024 / 1024
check(`100 次订阅/取消订阅循环堆增长 < 10MB (实际 ${listenerGrowthMB.toFixed(1)}MB)`,
  listenerGrowthMB < 10,
  `growth=${listenerGrowthMB.toFixed(1)}MB`)

// =============================================================
console.log('\n[R125-6] 大数据量加载/卸载循环 (50 学生 x 10 轮)')

// 先创建 50 个学生
const bulkNames = []
for (let i = 0; i < 50; i++) bulkNames.push(`${STAMP}-bulk-${i}`)
await evalInPage(ws, `(async () => {
  const names = ${JSON.stringify(bulkNames)};
  for (const n of names) { try { await window.api.eaa.addStudent(n); } catch {} }
  return true;
})()`)

const bulkBefore = await getHeap()
// 10 轮加载/卸载: 切到 students 页面 → 等待渲染 → 切到 dashboard
for (let round = 0; round < 10; round++) {
  await evalInPage(ws, `window.location.hash = '#/students'; true`)
  await sleep(300)
  await evalInPage(ws, `(async () => {
    // 触发 listStudents
    await window.api.eaa.listStudents();
    return true;
  })()`)
  await sleep(200)
  await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
  await sleep(200)
}
await sleep(500)
await forceGC()
const bulkAfter = await getHeap()
const bulkGrowthMB = (bulkAfter.used - bulkBefore.used) / 1024 / 1024
check(`10 轮 50 学生加载/卸载循环堆增长 < 25MB (实际 ${bulkGrowthMB.toFixed(1)}MB)`,
  bulkGrowthMB < 25,
  `growth=${bulkGrowthMB.toFixed(1)}MB`)

// 清理
await evalInPage(ws, `(async () => {
  const names = ${JSON.stringify(bulkNames)};
  for (const n of names) { try { await window.api.eaa.deleteStudent(n); } catch {} }
  return true;
})()`)

// =============================================================
console.log('\n[R125-7] 强制 GC 后的残留内存对比')

await forceGC()
await sleep(1000)
const finalHeap = await getHeap()
const totalGrowthMB = (finalHeap.used - baselineHeap.used) / 1024 / 1024
const baselineMBFloat = baselineHeap.used / 1024 / 1024
const finalMBFloat = finalHeap.used / 1024 / 1024
check(`全部测试后总堆增长 < 100MB (baseline=${baselineMBFloat.toFixed(1)}MB, final=${finalMBFloat.toFixed(1)}MB, growth=${totalGrowthMB.toFixed(1)}MB)`,
  totalGrowthMB < 100,
  `growth=${totalGrowthMB.toFixed(1)}MB`)

// =============================================================
console.log('\n[R125-8] 错误捕获')

const finalErrors = await getErrors()
check('内存测试期间 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// =============================================================
console.log('\n========================================')
console.log(`R125 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
