// =============================================================
// R129: 内存压力/泄漏测试 (HeapProfiler + 长时运行)
// 角度 1: 初始堆内存基线 (performance.memory + heap size)
// 角度 2: 页面导航压力 (反复切换路由 50 次)
// 角度 3: IPC 调用压力 (反复 listStudents/score/stats 100 次)
// 角度 4: 事件监听器泄漏 (i18n-changed/theme-changed 反复派发)
// 角度 5: 定时器泄漏 (反复创建/清理 cron 任务)
// 角度 6: DOM 节点增长 (detached nodes 检测)
// 角度 7: 长时运行内存增长 (综合压力后对比基线)
// 角度 8: GC 触发后内存可回收
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
    }, 60000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 55000,
  })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function connectWS() {
  let WebSocket
  try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }
  const targets = await getTargets()
  const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
  if (!pageTarget) { console.error('No page target found.'); process.exit(1) }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('ws connect timeout')), 10000) })
  return ws
}

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ✅ ${name}`) }
  else { results.fail++; results.errors.push(name); console.log(`  ❌ ${name} ${detail}`) }
}

// 获取内存快照
async function getMemorySnapshot(ws) {
  return await evalInPage(ws, `(async () => {
    // performance.memory (Chromium only)
    const pm = performance.memory ? {
      jsHeapUsed: performance.memory.usedJSHeapSize,
      jsHeapTotal: performance.memory.totalJSHeapSize,
      jsHeapLimit: performance.memory.jsHeapSizeLimit,
    } : null;
    // DOM 节点数
    const domNodes = document.querySelectorAll('*').length;
    // 定时器计数 (通过 monkey-patch 检测, 这里只能估算)
    // 事件监听器无法直接计数, 但可以通过 getEventListeners 在 DevTools 中查看
    return {
      perfMemory: pm,
      domNodes,
      timestamp: Date.now(),
    };
  })()`)
}

// 强制 GC 通过 CDP HeapProfiler.CollectGarbage (真正的 GC, 不分配内存)
async function forceGC(ws) {
  try {
    await cdpCall(ws, 'HeapProfiler.enable')
    await cdpCall(ws, 'HeapProfiler.collectGarbage')
    await sleep(1000)
    return true
  } catch {
    // fallback: 如果 HeapProfiler 不可用, 等待自然 GC
    await sleep(2000)
    return false
  }
}

console.log('\n=== R129: 内存压力/泄漏测试 ===')

let ws = await connectWS()

// =============================================================
console.log('\n[R129-1] 初始堆内存基线')

// 启用 Performance domain 以获取 memory
await cdpCall(ws, 'Performance.enable')
const perfMetrics1 = await cdpCall(ws, 'Performance.getMetrics')

const baseline = await getMemorySnapshot(ws)
console.log(`  基线: jsHeapUsed=${(baseline?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB, domNodes=${baseline?.domNodes}`)

check('performance.memory 可用',
  baseline?.perfMemory?.jsHeapUsed > 0,
  `perfMemory=${JSON.stringify(baseline?.perfMemory).slice(0, 200)}`)
check('初始 DOM 节点数 > 0 且 < 10000',
  baseline?.domNodes > 0 && baseline?.domNodes < 10000,
  `domNodes=${baseline?.domNodes}`)
check('初始 JS 堆使用 < 500MB',
  baseline?.perfMemory?.jsHeapUsed < 500 * 1024 * 1024,
  `jsHeapUsed=${(baseline?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB`)

// =============================================================
console.log('\n[R129-2] 页面导航压力 (反复切换路由 50 次)')

const routes = ['#/dashboard', '#/chat', '#/agents', '#/settings', '#/eaa', '#/scheduler', '#/models', '#/logs']
const navStartDOM = baseline?.domNodes
const navStartHeap = baseline?.perfMemory?.jsHeapUsed

for (let i = 0; i < 50; i++) {
  const route = routes[i % routes.length]
  await evalInPage(ws, `window.location.hash = ${JSON.stringify(route)}`)
  await sleep(100) // 短暂等待, 模拟快速切换
}
await sleep(2000) // 等待最终路由渲染完成

const afterNav = await getMemorySnapshot(ws)
const navHeapGrowth = afterNav?.perfMemory?.jsHeapUsed - navStartHeap
const navDomGrowth = afterNav?.domNodes - navStartDOM
console.log(`  导航后: jsHeapUsed=${(afterNav?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB (增长 ${(navHeapGrowth / 1024 / 1024).toFixed(1)}MB), domNodes=${afterNav?.domNodes} (变化 ${navDomGrowth})`)

check('导航压力后应用未崩溃',
  afterNav?.perfMemory?.jsHeapUsed > 0,
  `heap=${(afterNav?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB`)
check('导航后 DOM 节点数 < 20000 (无严重泄漏)',
  afterNav?.domNodes < 20000,
  `domNodes=${afterNav?.domNodes}`)
check('导航后堆内存增长 < 100MB',
  navHeapGrowth < 100 * 1024 * 1024,
  `growth=${(navHeapGrowth / 1024 / 1024).toFixed(1)}MB`)

// =============================================================
console.log('\n[R129-3] IPC 调用压力 (反复 listStudents/score/stats 100 次)')

const ipcStartHeap = afterNav?.perfMemory?.jsHeapUsed
const ipcResult = await evalInPage(ws, `(async () => {
  let ok = 0, fail = 0;
  const errors = [];
  for (let i = 0; i < 100; i++) {
    try {
      // 交替调用不同 IPC
      if (i % 3 === 0) await window.api.eaa.listStudents();
      else if (i % 3 === 1) await window.api.eaa.stats();
      else await window.api.settings.get();
      ok++;
    } catch (e) {
      fail++;
      if (errors.length < 3) errors.push(e.message?.slice(0, 80));
    }
  }
  return { ok, fail, errors };
})()`)

const afterIpc = await getMemorySnapshot(ws)
const ipcHeapGrowth = afterIpc?.perfMemory?.jsHeapUsed - ipcStartHeap
console.log(`  IPC 压力后: jsHeapUsed=${(afterIpc?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB (增长 ${(ipcHeapGrowth / 1024 / 1024).toFixed(1)}MB)`)

check('IPC 压力 100 次调用全部成功',
  ipcResult?.ok === 100 && ipcResult?.fail === 0,
  `ok=${ipcResult?.ok}, fail=${ipcResult?.fail}, errors=${JSON.stringify(ipcResult?.errors).slice(0, 200)}`)
check('IPC 压力后堆内存增长 < 50MB',
  ipcHeapGrowth < 50 * 1024 * 1024,
  `growth=${(ipcHeapGrowth / 1024 / 1024).toFixed(1)}MB`)

// =============================================================
console.log('\n[R129-4] 事件监听器泄漏 (i18n-changed/theme-changed 反复派发)')

const eventStartHeap = afterIpc?.perfMemory?.jsHeapUsed
await evalInPage(ws, `(async () => {
  // 反复派发事件 500 次
  for (let i = 0; i < 500; i++) {
    window.dispatchEvent(new CustomEvent('i18n-changed', { detail: i % 2 === 0 ? 'zh' : 'en' }));
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: i % 2 === 0 ? 'dark' : 'light' }));
  }
  return true;
})()`)
await sleep(500)

const afterEvents = await getMemorySnapshot(ws)
const eventHeapGrowth = afterEvents?.perfMemory?.jsHeapUsed - eventStartHeap
console.log(`  事件派发后: jsHeapUsed=${(afterEvents?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB (增长 ${(eventHeapGrowth / 1024 / 1024).toFixed(1)}MB)`)

check('事件派发 1000 次后应用未崩溃',
  afterEvents?.perfMemory?.jsHeapUsed > 0,
  `heap=${(afterEvents?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB`)
check('事件派发后堆内存增长 < 30MB',
  eventHeapGrowth < 30 * 1024 * 1024,
  `growth=${(eventHeapGrowth / 1024 / 1024).toFixed(1)}MB`)

// 恢复语言和主题
await evalInPage(ws, `(async () => {
  window.dispatchEvent(new CustomEvent('i18n-changed', { detail: 'zh' }));
  await window.api.settings.set('general.theme', 'light');
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }));
  return true;
})()`)

// =============================================================
console.log('\n[R129-5] 定时器泄漏 (反复创建/清理 cron 任务)')

const timerStartHeap = afterEvents?.perfMemory?.jsHeapUsed
const STAMP = `r129-${Date.now()}`
const cronStressResult = await evalInPage(ws, `(async () => {
  const createdIds = [];
  let createOk = 0, createFail = 0;
  // 创建 20 个 cron 任务
  for (let i = 0; i < 20; i++) {
    try {
      const r = await window.api.cron.add({
        name: ${JSON.stringify(STAMP)} + '-cron-' + i,
        expression: '0 */12 * * *',
        agentId: 'weekly-reporter',
        modelTier: 'low_cost',
        enabled: false,
      });
      const id = r?.id || r?.data?.id || r?.task?.id;
      if (id) { createdIds.push(id); createOk++; }
      else createFail++;
    } catch { createFail++; }
  }
  // 删除所有创建的任务 (API 方法名是 remove, 不是 delete)
  let deleteOk = 0, deleteFail = 0;
  for (const id of createdIds) {
    try {
      await window.api.cron.remove(id);
      deleteOk++;
    } catch { deleteFail++; }
  }
  return { createOk, createFail, deleteOk, deleteFail, createdCount: createdIds.length };
})()`)

const afterCron = await getMemorySnapshot(ws)
const cronHeapGrowth = afterCron?.perfMemory?.jsHeapUsed - timerStartHeap
console.log(`  Cron 压力后: jsHeapUsed=${(afterCron?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB (增长 ${(cronHeapGrowth / 1024 / 1024).toFixed(1)}MB)`)

check('Cron 任务创建 20 个全部成功',
  cronStressResult?.createOk === 20,
  `createOk=${cronStressResult?.createOk}, createFail=${cronStressResult?.createFail}`)
check('Cron 任务删除全部成功',
  cronStressResult?.deleteOk === cronStressResult?.createdCount,
  `deleteOk=${cronStressResult?.deleteOk}, deleteFail=${cronStressResult?.deleteFail}`)
check('Cron 创建/删除后堆内存增长 < 20MB',
  cronHeapGrowth < 20 * 1024 * 1024,
  `growth=${(cronHeapGrowth / 1024 / 1024).toFixed(1)}MB`)

// =============================================================
console.log('\n[R129-6] DOM 节点增长 (detached nodes 检测)')

// 通过 querySelectorAll 计数 + 创建/删除大量临时元素
const domStartCount = afterCron?.domNodes
await evalInPage(ws, `(async () => {
  // 创建大量临时 DOM 元素并移除 (模拟组件挂载/卸载)
  const container = document.createElement('div');
  document.body.appendChild(container);
  for (let i = 0; i < 500; i++) {
    const el = document.createElement('div');
    el.className = 'r129-temp';
    el.textContent = 'temp ' + i;
    container.appendChild(el);
  }
  // 移除
  document.body.removeChild(container);
  return true;
})()`)
await sleep(500)

const afterDom = await getMemorySnapshot(ws)
const domGrowth = afterDom?.domNodes - domStartCount
console.log(`  DOM 压力后: domNodes=${afterDom?.domNodes} (变化 ${domGrowth})`)

check('临时 DOM 创建/删除后节点数回到原水平 (无泄漏)',
  Math.abs(domGrowth) < 10,
  `domGrowth=${domGrowth}, before=${domStartCount}, after=${afterDom?.domNodes}`)

// =============================================================
console.log('\n[R129-7] 长时运行内存增长 (综合压力后对比基线)')

// 综合压力: 导航 + IPC + 事件 + 创建/删除
const stressStartHeap = afterDom?.perfMemory?.jsHeapUsed
console.log(`  综合压力前: jsHeapUsed=${(stressStartHeap / 1024 / 1024).toFixed(1)}MB`)

await evalInPage(ws, `(async () => {
  // 综合压力循环 10 轮
  const routes = ['#/dashboard', '#/chat', '#/agents', '#/settings', '#/eaa'];
  for (let round = 0; round < 10; round++) {
    // 导航
    window.location.hash = routes[round % routes.length];
    await new Promise(r => setTimeout(r, 200));
    // IPC 调用
    try { await window.api.eaa.listStudents(); } catch {}
    try { await window.api.settings.get(); } catch {}
    try { await window.api.eaa.stats(); } catch {}
    // 事件
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }));
  }
  return true;
})()`)
await sleep(2000)

const afterStress = await getMemorySnapshot(ws)
const totalGrowth = afterStress?.perfMemory?.jsHeapUsed - baseline?.perfMemory?.jsHeapUsed
const stressGrowth = afterStress?.perfMemory?.jsHeapUsed - stressStartHeap
console.log(`  综合压力后: jsHeapUsed=${(afterStress?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB`)
console.log(`  综合压力增长: ${(stressGrowth / 1024 / 1024).toFixed(1)}MB`)
console.log(`  总增长 (vs 基线): ${(totalGrowth / 1024 / 1024).toFixed(1)}MB`)

check('综合压力后应用未崩溃',
  afterStress?.perfMemory?.jsHeapUsed > 0,
  `heap=${(afterStress?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB`)
check('综合压力后堆内存增长 < 30MB',
  stressGrowth < 30 * 1024 * 1024,
  `stressGrowth=${(stressGrowth / 1024 / 1024).toFixed(1)}MB`)

// =============================================================
console.log('\n[R129-8] GC 触发后内存可回收')

const beforeGc = await getMemorySnapshot(ws)
await forceGC(ws)
await sleep(1000)
const afterGc = await getMemorySnapshot(ws)
const gcReclaim = beforeGc?.perfMemory?.jsHeapUsed - afterGc?.perfMemory?.jsHeapUsed
console.log(`  GC 前: ${(beforeGc?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB → GC 后: ${(afterGc?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)}MB (回收 ${(gcReclaim / 1024 / 1024).toFixed(1)}MB)`)

// GC 后内存应持平或下降 (允许少量波动)
check('GC 后堆内存未显著增长 (允许 ±10MB 波动)',
  gcReclaim > -10 * 1024 * 1024,
  `gcReclaim=${(gcReclaim / 1024 / 1024).toFixed(1)}MB (正数=回收, 负数=增长)`)

// =============================================================
console.log('\n[R129-9] 最终内存总结')

const finalMem = await getMemorySnapshot(ws)
const totalGrowthVsBaseline = finalMem?.perfMemory?.jsHeapUsed - baseline?.perfMemory?.jsHeapUsed
const totalGrowthMB = (totalGrowthVsBaseline / 1024 / 1024).toFixed(1)
const baselineMB = (baseline?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)
const finalMB = (finalMem?.perfMemory?.jsHeapUsed / 1024 / 1024).toFixed(1)

console.log(`  基线: ${baselineMB}MB → 最终: ${finalMB}MB (总增长: ${totalGrowthMB}MB)`)
console.log(`  DOM 节点: ${baseline?.domNodes} → ${finalMem?.domNodes}`)

// 总增长应在合理范围内 (< 100MB)
check('总内存增长 < 100MB (无严重泄漏)',
  totalGrowthVsBaseline < 100 * 1024 * 1024,
  `totalGrowth=${totalGrowthMB}MB`)
check('DOM 节点数未异常增长 (< 2x 基线)',
  finalMem?.domNodes < baseline?.domNodes * 2,
  `baseline=${baseline?.domNodes}, final=${finalMem?.domNodes}`)

// 恢复到 dashboard
await evalInPage(ws, `window.location.hash = '#/dashboard'`)
await sleep(500)

// =============================================================
console.log(`\n=== R129 完成 ===`)
console.log(`通过: ${results.pass}, 失败: ${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项:`)
  for (const e of results.errors) console.log(`  - ${e}`)
}

try { ws.close() } catch {}
process.exit(results.fail > 0 ? 1 : 0)
