// CDP 自动化测试脚本 — 基于 ws 库直连 Electron renderer
// 用法: node dogfood-output/cdp-explore.cjs
const http = require('node:http')
const WebSocket = require('ws')
const fs = require('node:fs')
const path = require('node:path')

const CDP_HTTP = 'http://127.0.0.1:9222'
const OUT_DIR = path.join(__dirname)

// ---------- CDP 客户端 ----------
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.id = 0
    this.cbs = new Map()
    this.consoleErrors = []
    this.consoleMessages = []
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false })
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id != null) {
          const cb = this.cbs.get(msg.id)
          if (cb) {
            this.cbs.delete(msg.id)
            if (msg.error) cb.reject(new Error(JSON.stringify(msg.error)))
            else cb.resolve(msg.result)
          }
        } else if (msg.method) {
          if (msg.method === 'Runtime.consoleAPICalled') {
            const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
            if (msg.params.type === 'error') this.consoleErrors.push(args)
            this.consoleMessages.push(`[${msg.params.type}] ${args}`)
          }
          if (msg.method === 'Log.entryAdded' && msg.params.entry) {
            const e = msg.params.entry
            if (e.level === 'error') this.consoleErrors.push(`[Log] ${e.text}`)
          }
          if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails
            this.consoleErrors.push(`[exception] ${d.text} ${d.exception?.description || ''}`)
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
      const timer = setTimeout(() => {
        if (this.cbs.has(id)) {
          this.cbs.delete(id)
          reject(new Error(`CDP send timeout: ${method} (${timeoutMs}ms)`))
        }
      }, timeoutMs)
      this.cbs.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.ws.send(JSON.stringify(m))
    })
  }
  close() { this.ws?.close() }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

async function getPageTarget() {
  const targets = await httpGet(`${CDP_HTTP}/json`)
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No page target found. Targets: ' + JSON.stringify(targets.map((t) => t.type)))
  return page
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('=== CDP Explore ===')
  const page = await getPageTarget()
  console.log('Page URL:', page.url)
  console.log('Page Title:', page.title)

  const cdp = new CDP(page.webSocketDebuggerUrl)
  await cdp.connect()
  console.log('CDP connected to page')

  // 启用域
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  // 等一下让页面完全加载
  await sleep(1000)

  // 获取页面基本信息
  const urlResult = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ url: window.location.href, title: document.title, bodyText: document.body.innerText.substring(0, 2000) })',
    returnByValue: true,
  })
  const info = JSON.parse(urlResult.result.value)
  console.log('\n=== Page Info ===')
  console.log('URL:', info.url)
  console.log('Title:', info.title)
  console.log('Body text (first 2000 chars):\n', info.bodyText)

  // 获取所有可交互元素
  const elementsResult = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify(Array.from(document.querySelectorAll('a, button, [role="button"], input, select, textarea, [tabindex]')).map((el, i) => ({
      idx: i,
      tag: el.tagName,
      type: el.type || '',
      role: el.getAttribute('role') || '',
      text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').substring(0, 80),
      href: el.href || '',
      id: el.id || '',
      className: (el.className || '').substring(0, 80),
      disabled: el.disabled || false,
      rect: el.getBoundingClientRect ? { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null
    })).filter(e => e.rect && e.rect.w > 0 && e.rect.h > 0))`,
    returnByValue: true,
  })
  const elements = JSON.parse(elementsResult.result.value)
  console.log('\n=== Interactive Elements ===')
  console.log(`Found ${elements.length} elements:`)
  elements.forEach((e) => {
    console.log(`  [${e.idx}] <${e.tag}${e.type ? ' type=' + e.type : ''}${e.role ? ' role=' + e.role : ''}> "${e.text}" ${e.href ? 'href=' + e.href : ''} ${e.id ? 'id=' + e.id : ''} @(${e.rect.x},${e.rect.y}) ${e.rect.w}x${e.rect.h}${e.disabled ? ' DISABLED' : ''}`)
  })

  // 截图
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, undefined, 30000)
  const screenshotPath = path.join(OUT_DIR, 'screenshots', 'initial.png')
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  console.log('\nScreenshot saved:', screenshotPath)

  // Console 错误
  console.log('\n=== Console Errors ===')
  if (cdp.consoleErrors.length === 0) {
    console.log('No console errors detected')
  } else {
    cdp.consoleErrors.forEach((e, i) => console.log(`  [${i}] ${e}`))
  }

  console.log('\n=== Console Messages (last 30) ===')
  cdp.consoleMessages.slice(-30).forEach((m) => console.log('  ' + m))

  cdp.close()
  console.log('\n=== Done ===')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
