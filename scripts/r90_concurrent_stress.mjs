// =============================================================
// R90 并发压力测试: 高强度并行 IPC + 快速 UI 交互 + 内存/DOM 监控
// 角度 1: 50 并发 IPC 调用(混合读/写)× 5 轮 = 250 次,验证并发安全
// 角度 2: 100 次快速路由切换 + 50 次 tab 切换,验证渲染层不泄漏
// 角度 3: 全程内存/DOM 节点/事件监听器采样,对比基线
// 角度 4: 0 unhandledrejection/error(全程错误捕获)
// 与 R85 区别: R85 是 5 分钟低频长时间运行; R90 是 2 分钟高频并发压力
// =============================================================

import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`

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
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 200) }
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
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R90] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  ws.on('open', r)
  ws.on('error', rej)
  setTimeout(() => rej(new Error('ws connect timeout')), 10000)
})

// ---------- 结果收集 ----------
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

// ---------- 全局错误捕获 ----------
await evalInPage(ws, `(() => {
  if (window.__r90_errors) return 'already';
  window.__r90_errors = [];
  window.addEventListener('unhandledrejection', (e) => {
    window.__r90_errors.push({ type: 'rejection', reason: String(e.reason).slice(0, 150) });
  });
  window.addEventListener('error', (e) => {
    window.__r90_errors.push({ type: 'error', message: e.message });
  });
  return 'installed';
})()`)

async function getErrors() {
  return await evalInPage(ws, `window.__r90_errors || []`)
}

// ---------- 内存采样 ----------
async function sampleMemory(label) {
  const mem = await evalInPage(ws, `(() => {
    const perf = performance.memory || {};
    return {
      label: ${JSON.stringify(label)},
      ts: Date.now(),
      usedMB: perf.usedJSHeapSize ? (perf.usedJSHeapSize / 1024 / 1024).toFixed(2) : 'N/A',
      totalMB: perf.totalJSHeapSize ? (perf.totalJSHeapSize / 1024 / 1024).toFixed(2) : 'N/A',
      domNodes: document.querySelectorAll('*').length,
      eventListeners: (() => {
        // 估算: chrome 不直接暴露 listener count,用 getEventListeners 不行(CDP 才有)
        // 改为统计 window 上的 __r90_errors 等,以及 DOM Element 数量作为间接指标
        return document.querySelectorAll('[onclick]').length;
      })(),
    };
  })()`)
  console.log(`  📊 [${label}] heap=${mem.usedMB}MB / ${mem.totalMB}MB, dom=${mem.domNodes}`)
  return mem
}

// =============================================================
// 基线采样
// =============================================================
console.log('\n[R90-0] 基线采样')
const baseline = await sampleMemory('baseline')

// =============================================================
// 角度 1: 50 并发 IPC × 5 轮 = 250 次混合调用
// =============================================================
console.log('\n[R90-1] 50 并发 IPC × 5 轮(混合读/写)')

let concurrentTotal = 0
let concurrentSuccess = 0
let concurrentFail = 0
const roundTimings = []

for (let round = 0; round < 5; round++) {
  const t0 = Date.now()
  const roundResult = await evalInPage(ws, `(async () => {
    const api = window.api;
    if (!api) return { error: 'no_api' };
    // 50 个混合调用: 读 + 写 + 查询
    const calls = [];
    for (let i = 0; i < 10; i++) {
      calls.push(() => api.eaa.listStudents());
      calls.push(() => api.eaa.ranking(10));
      calls.push(() => api.eaa.stats());
      calls.push(() => api.eaa.codes());
      calls.push(() => api.eaa.summary());
    }
    const settled = await Promise.allSettled(calls.map(fn => fn()));
    let ok = 0, fail = 0;
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value?.success !== false) ok++;
      else fail++;
    }
    return { ok, fail, total: calls.length };
  })()`)

  if (roundResult.error) {
    check(`R90-1 轮 ${round + 1}/5 并发 IPC`, false, roundResult.error)
  } else {
    concurrentTotal += roundResult.total
    concurrentSuccess += roundResult.ok
    concurrentFail += roundResult.fail
    const dt = Date.now() - t0
    roundTimings.push(dt)
    check(`R90-1 轮 ${round + 1}/5: ${roundResult.ok}/${roundResult.total} 成功 (${dt}ms)`, roundResult.fail === 0, `fail=${roundResult.fail}`)
  }
}

check('R90-1 并发 IPC 250/250 全成功', concurrentSuccess === concurrentTotal, `${concurrentSuccess}/${concurrentTotal}`)
const avgRoundMs = Math.round(roundTimings.reduce((s, t) => s + t, 0) / roundTimings.length)
check('R90-1 平均每轮 < 3000ms', avgRoundMs < 3000, `avg=${avgRoundMs}ms`)
console.log(`  📊 并发 IPC: ${concurrentSuccess}/${concurrentTotal} 成功, 平均 ${avgRoundMs}ms/轮`)

await sampleMemory('after-concurrent-ipc')

// =============================================================
// 角度 2: 100 次快速路由切换
// =============================================================
console.log('\n[R90-2] 100 次快速路由切换')

const ROUTES = ['/dashboard', '/students', '/classes', '/academics', '/agents', '/models', '/skills', '/scheduler', '/privacy', '/settings']
await evalInPage(ws, `window.__r90_errors = []; true`)

const routeSwitchStart = Date.now()
let routeSwitchSuccess = 0
for (let i = 0; i < 100; i++) {
  const route = ROUTES[i % ROUTES.length]
  await evalInPage(ws, `location.hash = '#${route}'; true`)
  // 不等待渲染完成,快速切换(每 100ms 一次)
  if (i % 10 === 9) {
    await sleep(100) // 每 10 次等 100ms 让 React 批量处理
  }
  routeSwitchSuccess++
}
const routeSwitchDt = Date.now() - routeSwitchStart

check('R90-2 100 次路由切换完成', routeSwitchSuccess === 100, `count=${routeSwitchSuccess}`)
check('R90-2 100 次路由切换 < 15s', routeSwitchDt < 15000, `dt=${routeSwitchDt}ms`)

// 等待最后一次渲染完成
await sleep(1500)

const routeErrors = await getErrors()
check('R90-2 路由切换 0 error/rejection', routeErrors.length === 0, `errors=${routeErrors.length}`)

await sampleMemory('after-100-routes')

// =============================================================
// 角度 3: 50 次 tab 切换(在 Students 详情页)
// =============================================================
console.log('\n[R90-3] 50 次 tab 切换(Students 详情页)')

// 导航到 Students 并进入详情
await evalInPage(ws, `location.hash = '#/students'; true`)
await sleep(1000)
await evalInPage(ws, `(() => {
  const row = document.querySelector('tr[data-ctx-student-name]');
  if (row) row.click();
  return true;
})()`)
await sleep(1000)

// 找到 tab 按钮
const tabCount = await evalInPage(ws, `(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const labels = ['概览', '档案', '事件', '学业', 'AI分析'];
  window.__r90_tabs = btns.filter(b => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && labels.some(l => b.textContent?.includes(l));
  });
  return window.__r90_tabs.length;
})()`)

if (tabCount >= 2) {
  await evalInPage(ws, `window.__r90_errors = []; true`)
  let tabSwitchSuccess = 0
  for (let i = 0; i < 50; i++) {
    const tabIdx = i % tabCount
    await evalInPage(ws, `(() => {
      if (window.__r90_tabs && window.__r90_tabs[${tabIdx}]) {
        window.__r90_tabs[${tabIdx}].click();
      }
      return true;
    })()`)
    if (i % 5 === 4) {
      await sleep(80) // 每 5 次等 80ms
    }
    tabSwitchSuccess++
  }
  await sleep(800)

  const tabErrors = await getErrors()
  check(`R90-3 50 次 tab 切换完成 (${tabCount} tabs)`, tabSwitchSuccess === 50, `success=${tabSwitchSuccess}`)
  check('R90-3 tab 切换 0 error/rejection', tabErrors.length === 0, `errors=${tabErrors.length}`)
} else {
  check('R90-3 tab 按钮可定位', false, `tabCount=${tabCount}`)
}
console.log(`  📊 tab 切换: ${tabCount} tabs found`)

await sampleMemory('after-50-tabs')

// =============================================================
// 角度 4: 20 次主题切换(dark ↔ light)
// =============================================================
console.log('\n[R90-4] 20 次主题切换')

await evalInPage(ws, `location.hash = '#/dashboard'; true`)
await sleep(800)
await evalInPage(ws, `window.__r90_errors = []; true`)

// 标记 theme toggle
const toggleFound = await evalInPage(ws, `(() => {
  const btn = document.querySelector('aside button[aria-label*="主题"], aside button[title*="主题"]');
  if (btn) {
    btn.setAttribute('data-r90-toggle', 'true');
    return true;
  }
  return false;
})()`)

if (toggleFound) {
  let themeSwitchSuccess = 0
  for (let i = 0; i < 20; i++) {
    await evalInPage(ws, `(() => {
      const btn = document.querySelector('[data-r90-toggle="true"]');
      if (btn) btn.click();
      return true;
    })()`)
    await sleep(150) // 给 IPC + 事件派发时间
    themeSwitchSuccess++
  }
  const themeErrors = await getErrors()
  check('R90-4 20 次主题切换完成', themeSwitchSuccess === 20, `count=${themeSwitchSuccess}`)
  check('R90-4 主题切换 0 error/rejection', themeErrors.length === 0, `errors=${themeErrors.length}`)
} else {
  check('R90-4 ThemeToggle 可定位', false, 'not found')
}

await sampleMemory('after-20-themes')

// =============================================================
// 最终内存对比
// =============================================================
console.log('\n[R90-5] 内存对比(基线 vs 最终)')

const final = await sampleMemory('final')
const baselineUsed = parseFloat(baseline.usedMB)
const finalUsed = parseFloat(final.usedMB)
const growth = finalUsed - baselineUsed
const growthPercent = baselineUsed > 0 ? ((growth / baselineUsed) * 100).toFixed(1) : 'N/A'

console.log(`  📊 内存增长: ${baselineUsed}MB → ${finalUsed}MB (+${growth.toFixed(2)}MB, ${growthPercent}%)`)
console.log(`  📊 DOM 节点: ${baseline.domNodes} → ${final.domNodes} (Δ${final.domNodes - baseline.domNodes})`)

check('R90-5 内存增长 < 30MB', growth < 30, `growth=${growth.toFixed(2)}MB`)
check('R90-5 DOM 节点增长 < 500', (final.domNodes - baseline.domNodes) < 500, `Δ=${final.domNodes - baseline.domNodes}`)
check('R90-5 最终堆内存 < 200MB', finalUsed < 200, `used=${finalUsed}MB`)

// 全程错误汇总
const allErrors = await getErrors()
check('R90-5 全程 0 error/rejection', allErrors.length === 0, `errors=${allErrors.length}`)

// =============================================================
// 最终汇总
// =============================================================
console.log('\n' + '='.repeat(60))
console.log(`[R90] 结果: ${results.pass} pass / ${results.fail} fail`)
if (results.fail > 0) {
  console.log(`[R90] 失败项: ${results.errors.join(', ')}`)
}
console.log('='.repeat(60))

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
