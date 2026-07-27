// =============================================================
// R122: 渲染压力测试 (大数据量/长列表/图表/动画/DOM 变动)
// 角度 1: 大量学生数据渲染 (EAA + Students 页面)
// 角度 2: 长列表滚动性能 (Academics/Classes 表格)
// 角度 3: Dashboard 图表渲染稳定性 (ECharts)
// 角度 4: 高频 DOM 更新 (连续 IPC 调用触发渲染)
// 角度 5: 多页面快速切换下的渲染抖动
// 角度 6: CSS 动画/transition 一致性
// 角度 7: 渲染过程中错误捕获
// 角度 8: 渲染前后内存对比
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
    }, 45000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 40000,
  })
  if (r.exceptionDetails) {
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
if (!pageTarget) { console.error('No page target found.'); process.exit(1) }
console.log(`[R122] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('ws connect timeout')), 10000) })

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ✅ ${name}`) }
  else { results.fail++; results.errors.push(name); console.log(`  ❌ ${name} ${detail}`) }
}

// 错误捕获
await evalInPage(ws, `
  window.__r122Errors = [];
  if (!window.__r122HookInstalled) {
    window.addEventListener('error', (e) => { window.__r122Errors.push({ type: 'error', message: e.message }); });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r122Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r122HookInstalled = true;
  }
  true
`)
async function getErrors() { return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r122Errors || []))`) }

async function getHeap() {
  return await evalInPage(ws, `(async () => {
    if (performance && performance.memory) {
      return { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize };
    }
    return { used: 0, total: 0 };
  })()`)
}

const STAMP = `r122-${Date.now()}`
const createdStudents = []

console.log('\n=== R122: 渲染压力测试 ===')

// =============================================================
console.log('\n[R122-1] 大量学生数据渲染 (EAA 50 个学生)')

// 先批量创建 50 个学生
const bulkCreateResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const created = [];
  for (let i = 0; i < 50; i++) {
    const name = ${JSON.stringify(STAMP)} + '-bulk-' + i;
    try {
      const r = await window.api.eaa.addStudent(name);
      if (r?.success !== false) created.push(name);
      else errors.push(r?.error || 'unknown');
    } catch (e) { errors.push(e.message); }
  }
  return { created: created.length, errorCount: errors.length, sampleErrors: errors.slice(0, 3) };
})()`)
check(`批量创建 50 个学生成功 (实际=${bulkCreateResult?.created})`,
  bulkCreateResult?.created >= 40,
  `result=${JSON.stringify(bulkCreateResult).slice(0, 150)}`)

// 记录已创建的学生供清理
for (let i = 0; i < 50; i++) createdStudents.push(`${STAMP}-bulk-${i}`)

// 导航到 Students 页面,验证渲染
await evalInPage(ws, `window.location.hash = '#/students'; true`)
await sleep(1200)
const studentsRender = await evalInPage(ws, `(async () => {
  const main = document.querySelector('main');
  const rows = document.querySelectorAll('main tr, main [class*="row"], main [class*="card"]');
  const text = main?.innerText || '';
  return {
    hasContent: text.length > 0,
    rowCount: rows.length,
    hasStampStudents: text.includes(${JSON.stringify(STAMP)}),
  };
})()`)
check('Students 页面渲染学生数据',
  studentsRender?.hasContent === true && studentsRender?.rowCount > 0,
  `result=${JSON.stringify(studentsRender).slice(0, 150)}`)

// =============================================================
console.log('\n[R122-2] 长列表滚动性能 (Academics 表格)')

// 导航到 Academics 页面
await evalInPage(ws, `window.location.hash = '#/academics'; true`)
await sleep(1000)

// 模拟滚动 (触发重排重绘)
const scrollResult = await evalInPage(ws, `(async () => {
  const scrollables = document.querySelectorAll('main [class*="overflow"], main [class*="scroll"], main div');
  let scrolled = 0;
  for (const el of scrollables) {
    if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 100) {
      el.scrollTop = 100;
      await new Promise(r => setTimeout(r, 50));
      el.scrollTop = 300;
      await new Promise(r => setTimeout(r, 50));
      el.scrollTop = 0;
      scrolled++;
      if (scrolled >= 3) break;
    }
  }
  return { scrolled, errorCount: 0 };
})()`)
check('滚动操作无崩溃',
  scrollResult?.errorCount === 0,
  `result=${JSON.stringify(scrollResult)}`)

// =============================================================
console.log('\n[R122-3] Dashboard 图表渲染稳定性 (ECharts)')

await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(1500)

const chartResult = await evalInPage(ws, `(async () => {
  // ECharts 实例通常挂载到 _echarts_instance_ 属性的 div
  const chartEls = document.querySelectorAll('[_echarts_instance_], .echarts-for-react, canvas');
  const main = document.querySelector('main');
  const hasNumeric = /\\d+/.test(main?.innerText || '');
  return {
    chartElCount: chartEls.length,
    hasNumericContent: hasNumeric,
    mainHasContent: (main?.innerText?.length ?? 0) > 100,
  };
})()`)
check('Dashboard 渲染稳定 (有图表或数据展示)',
  chartResult?.mainHasContent === true,
  `result=${JSON.stringify(chartResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R122-4] 高频 DOM 更新 (连续 IPC 触发渲染)')

// 高频调用 listStudents 触发 store 更新
const freqResult = await evalInPage(ws, `(async () => {
  const errors = [];
  // 20 次快速连续调用
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(window.api.eaa.listStudents().catch(e => errors.push(e.message)));
  }
  await Promise.all(promises);
  // 渲染应该仍然稳定
  const main = document.querySelector('main');
  return { errorCount: errors.length, mainHasContent: (main?.innerText?.length ?? 0) > 0 };
})()`)
check('高频 20 次并发 IPC 调用后渲染稳定',
  freqResult?.errorCount === 0 && freqResult?.mainHasContent === true,
  `result=${JSON.stringify(freqResult)}`)

// =============================================================
console.log('\n[R122-5] 多页面快速切换下的渲染抖动')

// 快速切换 30 次路由,测量耗时
const heapBeforeNav = await getHeap()
const t0 = Date.now()
const fastSwitchResult = await evalInPage(ws, `(async () => {
  const routes = ['#/dashboard', '#/students', '#/classes', '#/academics', '#/agents', '#/skills', '#/settings', '#/chat'];
  const errors = [];
  for (let i = 0; i < 30; i++) {
    const route = routes[i % routes.length];
    try {
      window.location.hash = route;
      await new Promise(r => setTimeout(r, 80));
    } catch (e) { errors.push(e.message); }
  }
  return { errorCount: errors.length };
})()`)
const navDurationMs = Date.now() - t0
const heapAfterNav = await getHeap()
const navGrowthMB = (heapAfterNav.used - heapBeforeNav.used) / 1024 / 1024
check(`30 次快速路由切换无错误 (耗时 ${navDurationMs}ms)`,
  fastSwitchResult?.errorCount === 0,
  `result=${JSON.stringify(fastSwitchResult)}, growth=${navGrowthMB.toFixed(1)}MB`)
check(`快速切换后堆增长 < 80MB`,
  navGrowthMB < 80,
  `growth=${navGrowthMB.toFixed(1)}MB`)

// =============================================================
console.log('\n[R122-6] CSS 动画/transition 一致性')

// 触发主题切换动画
const animResult = await evalInPage(ws, `(async () => {
  const html = document.documentElement;
  const before = html.classList.contains('dark');
  // 切换 5 次
  for (let i = 0; i < 5; i++) {
    try {
      await window.api.settings.set('general.theme', i % 2 === 0 ? 'dark' : 'light');
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: i % 2 === 0 ? 'dark' : 'light' }));
      await new Promise(r => setTimeout(r, 250));
    } catch (e) {}
  }
  // 恢复 dark
  await window.api.settings.set('general.theme', 'dark');
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }));
  await new Promise(r => setTimeout(r, 300));
  const after = html.classList.contains('dark');
  return { before, after, restored: after === true };
})()`)
check('5 次主题切换动画后状态正确恢复 (dark)',
  animResult?.restored === true,
  `result=${JSON.stringify(animResult)}`)

// =============================================================
console.log('\n[R122-7] 渲染过程中错误捕获')

// 触发一些可能产生渲染错误的场景
await evalInPage(ws, `(async () => {
  // 1. 访问不存在的路由
  window.location.hash = '#/nonexistent-route-' + Date.now();
  await new Promise(r => setTimeout(r, 400));
  // 2. 访问合法路由
  window.location.hash = '#/dashboard';
  await new Promise(r => setTimeout(r, 400));
  return true;
})()`)

const finalErrors = await getErrors()
check('渲染压力测试期间 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// =============================================================
console.log('\n[R122-8] 渲染前后内存对比')

const finalHeap = await getHeap()
const baselineMB = heapBeforeNav.used / 1024 / 1024
const finalMB = finalHeap.used / 1024 / 1024
const totalGrowthMB = finalMB - baselineMB
check(`总内存增长合理 (< 100MB, baseline=${baselineMB.toFixed(1)}MB, final=${finalMB.toFixed(1)}MB)`,
  totalGrowthMB < 100,
  `growth=${totalGrowthMB.toFixed(1)}MB`)

// =============================================================
console.log('\n[R122-9] 清理 - 删除测试学生')

// 清理 50 个学生
const cleanupResult = await evalInPage(ws, `(async () => {
  const errors = [];
  let deleted = 0;
  for (const name of ${JSON.stringify(createdStudents)}) {
    try {
      await window.api.eaa.deleteStudent(name);
      deleted++;
    } catch (e) { errors.push(e.message); }
  }
  return { deleted, errorCount: errors.length };
})()`)
check(`清理 ${createdStudents.length} 个测试学生`,
  cleanupResult?.deleted >= createdStudents.length * 0.9,
  `result=${JSON.stringify(cleanupResult)}`)

// =============================================================
console.log('\n========================================')
console.log(`R122 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
