// CDP 全自动遍历测试 — 遍历 10 个页面，每页收集元素/文本/console 错误，点击按钮
// 用法: node dogfood-output/cdp-test.cjs
const http = require('node:http')
const WebSocket = require('ws')
const fs = require('node:fs')
const path = require('node:path')

const CDP_HTTP = 'http://127.0.0.1:9222'
const OUT_DIR = path.join(__dirname)
const REPORT_PATH = path.join(OUT_DIR, 'test-results.json')

const PAGES = [
  { name: 'dashboard', hash: '#/dashboard', label: '仪表盘' },
  { name: 'chat', hash: '#/chat', label: '对话' },
  { name: 'students', hash: '#/students', label: '学生' },
  { name: 'classes', hash: '#/classes', label: '班级' },
  { name: 'agents', hash: '#/agents', label: 'Agent' },
  { name: 'models', hash: '#/models', label: '模型' },
  { name: 'skills', hash: '#/skills', label: '技能' },
  { name: 'scheduler', hash: '#/scheduler', label: '任务' },
  { name: 'privacy', hash: '#/privacy', label: '隐私' },
  { name: 'settings', hash: '#/settings', label: '设置' },
]

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.id = 0
    this.cbs = new Map()
    this.consoleErrors = []
    this.consoleMessages = []
    this.pageErrors = []
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false, maxPayload: 50 * 1024 * 1024 })
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id != null) {
          const cb = this.cbs.get(msg.id)
          if (cb) { this.cbs.delete(msg.id); msg.error ? cb.reject(new Error(JSON.stringify(msg.error))) : cb.resolve(msg.result) }
        } else if (msg.method) {
          if (msg.method === 'Runtime.consoleAPICalled') {
            const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
            if (msg.params.type === 'error') this.consoleErrors.push(args)
            this.consoleMessages.push(`[${msg.params.type}] ${args}`)
          }
          if (msg.method === 'Log.entryAdded' && msg.params.entry) {
            const e = msg.params.entry
            if (e.level === 'error') this.consoleErrors.push(`[Log] ${e.text} (${e.url || ''})`)
          }
          if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails
            this.pageErrors.push(`[exception] ${d.text} ${d.exception?.description || ''}`)
          }
          if (msg.method === 'Runtime.bindingCalled') {
            // IPC binding calls
          }
        }
      })
    })
  }
  send(method, params = {}, sessionId, timeoutMs = 15000) {
    const id = ++this.id
    const m = { id, method, params }
    if (sessionId) m.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.cbs.has(id)) { this.cbs.delete(id); reject(new Error(`timeout: ${method} (${timeoutMs}ms)`)) } }, timeoutMs)
      this.cbs.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
      this.ws.send(JSON.stringify(m))
    })
  }
  async eval(expr, timeoutMs = 15000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, undefined, timeoutMs)
    if (r.exceptionDetails) throw new Error('Eval error: ' + JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  resetLogs() { this.consoleErrors = []; this.consoleMessages = []; this.pageErrors = [] }
  close() { this.ws?.close() }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject)
  })
}

async function getPageTarget() {
  const targets = await httpGet(`${CDP_HTTP}/json`)
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No page target')
  return page
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 点击元素的 JS（通过坐标派发事件，比 DOM.click 更可靠）
const CLICK_JS = (x, y) => `new Promise(resolve => {
  const el = document.elementFromPoint(${x}, ${y});
  if (!el) { resolve(JSON.stringify({ok:false, reason:'no element at point'})); return; }
  const rect = el.getBoundingClientRect();
  const info = { ok: true, tag: el.tagName, text: (el.innerText||'').substring(0,100), id: el.id, className: (el.className||'').substring(0,80) };
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
  setTimeout(() => resolve(JSON.stringify(info)), 200);
})`

const GET_ELEMENTS_JS = `JSON.stringify(Array.from(document.querySelectorAll('a, button, [role="button"], input, select, textarea')).map((el, i) => ({
  idx: i, tag: el.tagName, type: el.type || '', role: el.getAttribute('role') || '',
  text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').substring(0, 100),
  href: el.href || '', id: el.id || '', disabled: el.disabled || false,
  rect: el.getBoundingClientRect ? { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null
})).filter(e => e.rect && e.rect.w > 0 && e.rect.h > 0))`

async function main() {
  const results = { pages: [], summary: { totalPages: PAGES.length, pagesWithErrors: 0, totalErrors: 0, totalButtons: 0, buttonsClicked: 0 } }
  const page = await getPageTarget()
  console.log(`Page target: ${page.url}`)
  const cdp = new CDP(page.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  console.log('CDP connected. Starting page traversal...\n')

  for (const pg of PAGES) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`PAGE: ${pg.label} (${pg.name}) → ${pg.hash}`)
    console.log('='.repeat(60))

    cdp.resetLogs()
    // 导航
    await cdp.eval(`window.location.hash = '${pg.hash}'`)
    await sleep(1500) // 等待页面渲染 + IPC 数据加载

    const pageInfo = await cdp.eval(`JSON.stringify({ url: window.location.href, title: document.title, bodyText: document.body.innerText.substring(0, 3000), bodyHTMLLength: document.body.innerHTML.length })`)
    const info = JSON.parse(pageInfo)
    console.log('URL:', info.url)
    console.log('Body text (first 1500):', info.bodyText.substring(0, 1500))

    const elementsStr = await cdp.eval(GET_ELEMENTS_JS)
    const elements = JSON.parse(elementsStr)
    const buttons = elements.filter((e) => e.tag === 'BUTTON' || e.role === 'button')
    const links = elements.filter((e) => e.tag === 'A')
    const inputs = elements.filter((e) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tag))
    console.log(`Elements: ${elements.length} (${buttons.length} buttons, ${links.length} links, ${inputs.length} inputs)`)

    const pageResult = { name: pg.name, label: pg.label, hash: pg.hash, url: info.url, bodyText: info.bodyText, elements, consoleErrors: [...cdp.consoleErrors], pageErrors: [...cdp.pageErrors], buttonsClicked: [] }

    // 点击所有按钮（非导航类）
    for (const btn of buttons) {
      const cx = btn.rect.x + Math.round(btn.rect.w / 2)
      const cy = btn.rect.y + Math.round(btn.rect.h / 2)
      if (cx <= 0 || cy <= 0) continue
      console.log(`  Click: [${btn.idx}] "${btn.text}" @(${cx},${cy})`)
      try {
        const clickResult = await cdp.eval(CLICK_JS(cx, cy), 5000)
        const cr = JSON.parse(clickResult)
        console.log(`    → ${cr.ok ? 'clicked ' + cr.tag + ' "' + (cr.text||'').substring(0,50) + '"' : 'FAILED: ' + cr.reason}`)
        pageResult.buttonsClicked.push({ text: btn.text, result: cr })
        results.summary.buttonsClicked++
        await sleep(800) // 等待 IPC 响应/UI 更新
      } catch (e) {
        console.log(`    → ERROR: ${e.message}`)
        pageResult.buttonsClicked.push({ text: btn.text, error: e.message })
      }
    }
    results.summary.totalButtons += buttons.length

    // 收集点击后的 console 错误
    pageResult.postClickErrors = [...cdp.consoleErrors]
    pageResult.postClickPageErrors = [...cdp.pageErrors]

    if (cdp.consoleErrors.length > 0 || cdp.pageErrors.length > 0) {
      results.summary.pagesWithErrors++
      results.summary.totalErrors += cdp.consoleErrors.length + cdp.pageErrors.length
      console.log(`  ⚠️  ${cdp.consoleErrors.length} console errors, ${cdp.pageErrors.length} page errors`)
      cdp.consoleErrors.forEach((e) => console.log(`    [console] ${e.substring(0, 200)}`))
      cdp.pageErrors.forEach((e) => console.log(`    [page] ${e.substring(0, 200)}`))
    } else {
      console.log('  ✓ No errors')
    }
    results.pages.push(pageResult)
  }

  cdp.close()

  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2))
  console.log(`\n${'='.repeat(60)}`)
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(JSON.stringify(results.summary, null, 2))
  console.log('\nReport saved:', REPORT_PATH)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
