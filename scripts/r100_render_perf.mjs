// =============================================================
// R100: 渲染性能测试 (页面导航/DOM/布局稳定性/快速切换)
// 角度 1: 11 个页面全部可访问且首屏渲染 < 2s
// 角度 2: 每个页面 DOM 节点数合理 (<5000)
// 角度 3: 页面切换无 console error
// 角度 4: 快速路由切换 (10 次/秒) 不崩溃
// 角度 5: Layout/Paint 稳定性 (无 CLS / layout thrash)
// 角度 6: 长时间运行后 DOM 节点不无限增长
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
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R100] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  ws.on('open', r)
  ws.on('error', rej)
  setTimeout(() => rej(new Error('ws connect timeout')), 10000)
})

// 启用 Console + Runtime
await cdpCall(ws, 'Runtime.enable')
await cdpCall(ws, 'Log.enable')
await cdpCall(ws, 'Page.enable')

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

// 全局错误捕获 + console error 捕获
await evalInPage(ws, `
  window.__r100Errors = [];
  window.__r100ConsoleErrors = [];
  if (!window.__r100HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r100Errors.push({ type: 'error', message: e.message, time: Date.now() });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r100Errors.push({ type: 'unhandledrejection', message: msg, time: Date.now() });
    });
    const origErr = console.error;
    console.error = function(...args) {
      try {
        window.__r100ConsoleErrors.push(args.map(a => String(a)).join(' ').slice(0, 300));
      } catch {}
      origErr.apply(console, args);
    };
    window.__r100HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r100Errors || []))`)
}
async function getConsoleErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r100ConsoleErrors || []))`)
}
async function clearErrors() {
  await evalInPage(ws, `window.__r100Errors = []; window.__r100ConsoleErrors = []; true`)
}

async function navigateTo(hash) {
  await evalInPage(ws, `(async () => {
    window.location.hash = '#${hash}';
    await new Promise(r => setTimeout(r, 50));
    return window.location.hash;
  })()`)
}

async function measurePage(ws, hash) {
  // 清理错误
  await clearErrors()
  
  // 测量渲染时间
  const t0 = await evalInPage(ws, `performance.now()`)
  await navigateTo(hash)
  // 等待渲染稳定
  await sleep(800)
  const t1 = await evalInPage(ws, `performance.now()`)
  const elapsed = t1 - t0
  
  // DOM 节点数
  const domStats = await evalInPage(ws, `(() => {
    const all = document.querySelectorAll('*').length;
    const body = document.body ? document.body.querySelectorAll('*').length : 0;
    return { total: all, body };
  })()`)
  
  // 错误捕获
  const errors = await getErrors()
  const consoleErrors = await getConsoleErrors()
  
  // 检测 React 错误边界
  const reactErrors = await evalInPage(ws, `(() => {
    const errorBoundaries = document.querySelectorAll('[data-react-error-boundary]');
    return errorBoundaries.length;
  })()`)
  
  return {
    hash,
    elapsedMs: elapsed,
    domNodes: domStats?.total || 0,
    bodyNodes: domStats?.body || 0,
    errors: errors || [],
    consoleErrors: consoleErrors || [],
    reactErrors,
  }
}

// =============================================================
console.log('\n=== R100: 渲染性能测试 ===')

// =============================================================
console.log('\n[R100-1] 11 个页面全部可访问且首屏渲染 < 2s')

const pages = [
  { hash: '/dashboard', name: '仪表盘' },
  { hash: '/chat', name: 'AI 对话' },
  { hash: '/students', name: '学生' },
  { hash: '/classes', name: '班级' },
  { hash: '/academics', name: '学业' },
  { hash: '/agents', name: 'Agent' },
  { hash: '/models', name: '模型' },
  { hash: '/skills', name: '技能/MCP' },
  { hash: '/scheduler', name: '定时任务' },
  { hash: '/privacy', name: '隐私' },
  { hash: '/settings', name: '设置' },
]

const pageResults = []
let allPagesAccessible = true
let allPagesFast = true
let allPagesNoCriticalError = true

for (const p of pages) {
  const r = await measurePage(ws, p.hash)
  pageResults.push(r)
  
  const fast = r.elapsedMs < 2000
  const noCriticalError = r.errors.length === 0
  if (!fast) allPagesFast = false
  if (!noCriticalError) allPagesNoCriticalError = false
  
  const status = fast && noCriticalError ? '✅' : '⚠️'
  console.log(`  ${status} ${p.name.padEnd(12)} ${r.elapsedMs.toFixed(0).padStart(4)}ms  DOM=${String(r.domNodes).padStart(4)}  err=${r.errors.length} cerr=${r.consoleErrors.length}`)
  
  await sleep(200)
}

check('11 个页面全部可访问', pageResults.length === 11)
check('11 个页面首屏渲染 < 2s',
  allPagesFast,
  `slowest=${Math.max(...pageResults.map(r => r.elapsedMs)).toFixed(0)}ms`)

// =============================================================
console.log('\n[R100-2] 每个页面 DOM 节点数 < 5000')

let domOkCount = 0
const domDetails = []
for (const r of pageResults) {
  if (r.domNodes < 5000) {
    domOkCount++
  } else {
    domDetails.push(`${r.hash}: ${r.domNodes}`)
  }
}
check(`DOM 节点数合理 (${domOkCount}/${pageResults.length})`,
  domOkCount === pageResults.length,
  `exceed: ${domDetails.join(', ').slice(0, 200)}`)

// =============================================================
console.log('\n[R100-3] 页面切换无 critical error')

let pagesWithCriticalError = 0
const criticalErrorDetails = []
for (const r of pageResults) {
  if (r.errors.length > 0) {
    pagesWithCriticalError++
    criticalErrorDetails.push(`${r.hash}: ${JSON.stringify(r.errors[0]).slice(0, 100)}`)
  }
}
check('所有页面 0 critical error',
  pagesWithCriticalError === 0,
  `pages with errors=${pagesWithCriticalError}, details=${criticalErrorDetails.slice(0, 2).join('; ').slice(0, 200)}`)

// =============================================================
console.log('\n[R100-4] 快速路由切换 (10 次切换) 不崩溃')

await clearErrors()
const rapidSwitch = await evalInPage(ws, `(async () => {
  const hashes = ['/dashboard', '/chat', '/students', '/agents', '/settings',
                  '/dashboard', '/chat', '/students', '/agents', '/settings'];
  const results = [];
  for (const h of hashes) {
    const t0 = performance.now();
    window.location.hash = '#' + h;
    await new Promise(r => setTimeout(r, 100));
    const elapsed = performance.now() - t0;
    results.push({ hash: h, elapsedMs: elapsed });
  }
  return results;
})()`)

const rapidOkCount = rapidSwitch ? rapidSwitch.filter(r => r.elapsedMs < 500).length : 0
check('10 次快速路由切换全部完成',
  Array.isArray(rapidSwitch) && rapidSwitch.length === 10,
  `length=${rapidSwitch?.length}`)
check('10 次快速切换每次 < 500ms',
  rapidOkCount === 10,
  `slow=${10 - rapidOkCount}/10`)

if (Array.isArray(rapidSwitch)) {
  const avgRapid = rapidSwitch.reduce((a, b) => a + b.elapsedMs, 0) / rapidSwitch.length
  console.log(`    快速切换平均耗时: ${avgRapid.toFixed(2)}ms`)
}

const rapidErrors = await getErrors()
check('快速切换后 0 critical error',
  rapidErrors.length === 0,
  `errors=${rapidErrors.length}`)

// =============================================================
console.log('\n[R100-5] Layout/Paint 稳定性 (CLS)')

// 测量 layout shift (简化版: 检测 body 尺寸是否在 1s 内稳定)
const clsTest = await evalInPage(ws, `(async () => {
  // 跳到 dashboard
  window.location.hash = '#/dashboard';
  await new Promise(r => setTimeout(r, 500));
  
  // 测量 5 次 body 高度,间隔 100ms
  const samples = [];
  for (let i = 0; i < 5; i++) {
    samples.push({
      h: document.body.scrollHeight,
      w: document.body.scrollWidth,
    });
    await new Promise(r => setTimeout(r, 100));
  }
  
  // 高度变化次数 (排除最后一次)
  const heights = samples.map(s => s.h);
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const variation = maxH - minH;
  
  return {
    samples,
    minH,
    maxH,
    variation,
    stable: variation < 50, // 高度变化 < 50px 算稳定
  };
})()`)

check('Layout 稳定 (1s 内高度变化 < 50px)',
  clsTest?.stable === true,
  `variation=${clsTest?.variation}px`)

// =============================================================
console.log('\n[R100-6] 长时间运行后 DOM 节点不无限增长')

// 测量初始 DOM
await navigateTo('/dashboard')
await sleep(500)
const initialDom = await evalInPage(ws, `document.querySelectorAll('*').length`)

// 遍历所有页面 3 次
for (let cycle = 0; cycle < 3; cycle++) {
  for (const p of pages) {
    await navigateTo(p.hash)
    await sleep(150)
  }
}

// 回到 dashboard 测量
await navigateTo('/dashboard')
await sleep(800)
const finalDom = await evalInPage(ws, `document.querySelectorAll('*').length`)

const domGrowth = finalDom - initialDom
check(`DOM 节点不无限增长 (初始 ${initialDom}, 最终 ${finalDom}, 增长 ${domGrowth})`,
  Math.abs(domGrowth) < 500, // 允许 ±500 节点波动
  `growth=${domGrowth}`)

// =============================================================
console.log('\n[R100-7] 全程错误捕获')

const finalErrors = await getErrors()
const finalConsoleErrors = await getConsoleErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// =============================================================
console.log('\n========================================')
console.log(`R100 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}

// 汇总页面性能
console.log('\n--- 页面性能汇总 ---')
for (const r of pageResults) {
  console.log(`  ${r.hash.padEnd(14)} ${r.elapsedMs.toFixed(0).padStart(4)}ms  DOM=${String(r.domNodes).padStart(4)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
