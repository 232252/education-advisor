// =============================================================
// 压力测试 — 长时间运行、多角度
// - 反复导航每个页面
// - 反复点击刷新按钮
// - 反复打开/关闭 sidebar tabs
// - 监控内存和错误
// =============================================================

const http = require('node:http')
const WebSocket = require('ws')

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.msgId = 0
    this.callbacks = new Map()
    this.eventListeners = new Map()
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false })
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id != null) {
          const cb = this.callbacks.get(msg.id)
          if (cb) {
            this.callbacks.delete(msg.id)
            if (msg.error) cb.reject(new Error(msg.error.message))
            else cb.resolve(msg.result)
          }
        } else if (msg.method) {
          const ls = this.eventListeners.get(msg.method) || []
          for (const l of ls) l(msg.params)
        }
      })
    })
  }

  send(method, params = {}) {
    const id = ++this.msgId
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(eventName, listener) {
    if (!this.eventListeners.has(eventName)) this.eventListeners.set(eventName, [])
    this.eventListeners.get(eventName).push(listener)
  }

  close() {
    this.ws?.close()
  }
}

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FILE_URL = 'file:///C:/Users/sq199/.trae-cn/worktrees/education-advisor/compile-open-lUArGK/dist/renderer/index.html'

async function main() {
  const args = process.argv.slice(2)
  const duration = parseInt(args[0] || '60', 10) * 1000 // 默认 60 秒
  const interval = parseInt(args[1] || '500', 10) // 每 500ms 一次操作

  console.log('=== Stress Test ===')
  console.log(`Duration: ${duration / 1000}s, Interval: ${interval}ms`)

  const targets = await listTargets()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.error('No page target found')
    process.exit(1)
  }
  const cdp = new CDPClient(page.webSocketDebuggerUrl)
  await cdp.connect()

  // 收集错误和性能指标
  const errors = []
  const consoleErrors = []
  const pageErrors = []

  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      const msg = params.args.map((a) => a.value || a.description).join(' ')
      if (!msg.includes('favicon') && !msg.includes('source map')) {
        consoleErrors.push({ time: Date.now(), message: msg })
      }
    }
  })

  cdp.on('Runtime.exceptionThrown', (params) => {
    pageErrors.push({
      time: Date.now(),
      text: params.exceptionDetails.text,
      url: params.exceptionDetails.url,
    })
  })

  cdp.on('Log.entryAdded', (params) => {
    if (params.entry.level === 'error') {
      errors.push({ time: Date.now(), message: params.entry.text })
    }
  })

  async function eval(expr) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }

  async function navigate(path) {
    await cdp.send('Page.navigate', { url: `${FILE_URL}#${path}` })
    await sleep(300)
  }

  const pages = [
    '/dashboard',
    '/chat',
    '/students',
    '/agents',
    '/models',
    '/skills',
    '/scheduler',
    '/privacy',
    '/settings',
  ]

  async function getMetrics() {
    return await eval(`
      (() => {
        const perf = performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
        } : null;
        return {
          domNodes: document.querySelectorAll('*').length,
          eventListeners: typeof getEventListeners === 'function' ? 'devtools' : 'unavailable',
          url: window.location.href,
          heap: perf,
        };
      })()
    `)
  }

  const startTime = Date.now()
  let operationCount = 0
  let lastMetrics = null
  const metrics = []

  console.log('\n--- 阶段 1: 反复导航 ---')
  for (let i = 0; Date.now() - startTime < duration * 0.4; i++) {
    const path = pages[i % pages.length]
    try {
      await navigate(path)
      operationCount++
      if (operationCount % 10 === 0) {
        const m = await getMetrics()
        metrics.push({ phase: 'navigate', op: operationCount, ...m })
        process.stdout.write(`\r  操作 #${operationCount}: ${path} | 节点=${m.domNodes} | 时间=${((Date.now() - startTime) / 1000).toFixed(0)}s`)
      }
    } catch (err) {
      errors.push({ time: Date.now(), message: `navigate ${path}: ${err.message}` })
    }
    await sleep(interval)
  }
  console.log()

  console.log('\n--- 阶段 2: 反复点击刷新 ---')
  // 在 dashboard 页面
  await navigate('/dashboard')
  for (let i = 0; Date.now() - startTime < duration * 0.7; i++) {
    try {
      const result = await eval(`
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('刷新'));
          if (!btn) return 'no button';
          btn.click();
          return 'clicked';
        })()
      `)
      if (result === 'clicked') operationCount++
    } catch (err) {
      errors.push({ time: Date.now(), message: `refresh: ${err.message}` })
    }
    await sleep(interval)
  }
  const m2 = await getMetrics()
  metrics.push({ phase: 'refresh', op: operationCount, ...m2 })
  console.log(`  节点数: ${m2.domNodes}`)

  console.log('\n--- 阶段 3: 反复切换 settings 选项 ---')
  await navigate('/settings')
  const selectTargets = ['debug', 'info', 'warn', 'error']
  for (let i = 0; Date.now() - startTime < duration; i++) {
    try {
      const value = selectTargets[i % selectTargets.length]
      await eval(`
        (() => {
          const selects = Array.from(document.querySelectorAll('select'));
          const logSel = selects.find(s => Array.from(s.options).some(o => o.value === 'debug' || o.value === 'info'));
          if (logSel) {
            logSel.value = '${value}';
            logSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `)
      operationCount++
    } catch (err) {
      errors.push({ time: Date.now(), message: `settings: ${err.message}` })
    }
    await sleep(interval)
  }
  const m3 = await getMetrics()
  metrics.push({ phase: 'settings', op: operationCount, ...m3 })
  console.log(`  节点数: ${m3.domNodes}`)

  // ==================== 报告 ====================
  const totalTime = (Date.now() - startTime) / 1000
  console.log('\n=== 报告 ===')
  console.log(`总时间: ${totalTime.toFixed(1)}s`)
  console.log(`操作数: ${operationCount}`)
  console.log(`操作速率: ${(operationCount / totalTime).toFixed(1)} ops/s`)
  console.log(`错误数: ${errors.length}`)
  console.log(`Console errors: ${consoleErrors.length}`)
  console.log(`Page errors: ${pageErrors.length}`)

  if (metrics.length > 0) {
    const first = metrics[0]
    const last = metrics[metrics.length - 1]
    console.log(`\n内存增长:`)
    console.log(`  开始 DOM 节点: ${first.domNodes}`)
    console.log(`  结束 DOM 节点: ${last.domNodes}`)
    console.log(`  节点增长: ${last.domNodes - first.domNodes}`)
    if (last.heap && first.heap) {
      const heapGrowth = last.heap.usedJSHeapSize - first.heap.usedJSHeapSize
      console.log(`  JS Heap 增长: ${(heapGrowth / 1024 / 1024).toFixed(2)} MB`)
    }
  }

  if (consoleErrors.length > 0) {
    console.log('\n=== Console Errors ===')
    const uniqueErrors = [...new Set(consoleErrors.map((e) => e.message))]
    for (const msg of uniqueErrors.slice(0, 10)) {
      console.log(`  - ${msg}`)
    }
  }

  if (pageErrors.length > 0) {
    console.log('\n=== Page Errors ===')
    for (const err of pageErrors.slice(0, 5)) {
      console.log(`  - ${err.text} (${err.url})`)
    }
  }

  if (errors.length > 0) {
    console.log('\n=== Operation Errors ===')
    for (const err of errors.slice(0, 10)) {
      console.log(`  - ${err.message}`)
    }
  }

  cdp.close()

  // 退出码:有 page error = 失败
  process.exit(pageErrors.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
