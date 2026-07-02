// R5: UI 深度交互测试 - 真实模拟用户点击每个按钮 + 填写表单
// 用户要求: "打开真实软件 真实模拟用户情况"
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

const LOG_FILE = require('path').join(__dirname, 'r5-output.log')
try { fs.writeFileSync(LOG_FILE, '') } catch {}
function logProgress(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`
  process.stdout.write(line)
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => this.ws.on('open', r))
    this.id = 0; this.pending = new Map()
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.id && this.pending.has(obj.id)) {
        const { resolve, reject } = this.pending.get(obj.id)
        this.pending.delete(obj.id)
        if (obj.error) reject(new Error(JSON.stringify(obj.error)))
        else resolve(obj.result)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 15000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  close() { if (this.ws) this.ws.close() }
}

const stats = { total: 0, pass: 0, fail: 0, errors: [] }
function record(name, ok, detail = '') {
  stats.total++
  if (ok) stats.pass++
  else { stats.fail++; stats.errors.push({ name, detail: String(detail).slice(0, 200) }) }
  if (!ok) logProgress(`  FAIL: ${name} :: ${String(detail).slice(0, 150)}`)
}

async function main() {
  logProgress('============================================================')
  logProgress('ROUND 5 (R5): UI 深度交互 — 每个按钮 + 表单填写')
  logProgress('============================================================')

  const c = new CDPClient()
  await c.connect()

  // 注入: stub alert/confirm/prompt + 错误监听 + 截取 console.error
  await c.eval(`(function(){
    if(window.__r5Stub) return
    window.__r5Stub = true
    window.__r5Errs = []
    window.__r5Confirms = []
    window.__r5Alerts = []
    window.alert = function(m) { window.__r5Alerts.push(String(m)); return undefined }
    window.confirm = function(m) { window.__r5Confirms.push(String(m)); return true }
    window.prompt = function(m, d) { return d || '' }
    window.addEventListener('error', e => { window.__r5Errs.push(e.message) })
    window.addEventListener('unhandledrejection', e => { window.__r5Errs.push('unhandled:' + (e.reason && e.reason.message || e.reason)) })
    // 截取 console.error
    const origErr = console.error
    console.error = function(...args) { window.__r5Errs.push('console:' + args.map(a => typeof a === 'object' ? JSON.stringify(a).slice(0,100) : String(a)).join(' ').slice(0,200)); origErr.apply(console, args) }
  })()`)

  // 获取当前 URL 和路径
  const url = await c.eval('window.location.href')
  logProgress(`当前 URL: ${url}`)
  record('initial_url_loaded', !!url && !url.includes('error'), url)

  // 等待 React 渲染
  await new Promise(r => setTimeout(r, 2000))

  // 获取所有导航项 (侧边栏)
  const navItems = await c.eval(`(function(){
    // 尝试多种导航选择器
    const sels = [
      'nav a', 'nav button', '[role="navigation"] a', '[role="navigation"] button',
      '.sidebar a', '.sidebar button', '.nav-item', '.menu-item',
      'aside a', 'aside button', '[data-nav]', '[data-page]'
    ]
    const items = new Set()
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach(el => {
        const txt = (el.textContent || '').trim()
        if (txt && txt.length < 30) items.add(txt)
      })
    }
    return Array.from(items)
  })()`)
  logProgress(`发现 ${navItems?.length || 0} 个导航项: ${JSON.stringify(navItems).slice(0, 300)}`)
  record('nav_items_found', (navItems?.length || 0) > 0, `${navItems?.length || 0} items`)

  // 获取当前页面所有按钮
  const buttons = await c.eval(`(function(){
    const btns = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')
    return Array.from(btns).map(b => ({
      text: (b.textContent || b.value || '').trim().slice(0, 50),
      type: b.type || 'button',
      disabled: b.disabled,
      visible: b.offsetParent !== null,
      id: b.id || '',
      class: (b.className || '').slice(0, 60)
    })).filter(b => b.text && b.visible && !b.disabled)
  })()`)
  logProgress(`当前页面可见可点击按钮: ${buttons?.length || 0}`)
  record('buttons_found_on_dashboard', (buttons?.length || 0) > 0, `${buttons?.length || 0} buttons`)

  // ============================================================
  // [1] 遍历每个导航项,记录每个页面的按钮数量
  // ============================================================
  logProgress('\n[1] 遍历每个导航页面')
  const navClickResults = []
  for (const navText of (navItems || []).slice(0, 20)) { // 限制 20 个避免太长
    const r = await c.eval(`(async function(){
      const navText = ${JSON.stringify(navText)}
      // 找到匹配的导航元素并点击
      const allNav = document.querySelectorAll('nav a, nav button, [role="navigation"] a, [role="navigation"] button, .sidebar a, .sidebar button, aside a, aside button, .nav-item, .menu-item, [data-nav], [data-page]')
      for (const el of allNav) {
        if ((el.textContent || '').trim() === navText) {
          try { el.click(); return { ok: true, text: navText } } catch(e) { return { ok: false, err: e.message } }
        }
      }
      return { ok: false, err: 'not found' }
    })()`)
    // 等待页面切换
    await new Promise(r => setTimeout(r, 800))
    // 数按钮
    const pageButtons = await c.eval(`(function(){
      const btns = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')
      return Array.from(btns).filter(b => (b.textContent || '').trim() && b.offsetParent !== null && !b.disabled).length
    })()`)
    navClickResults.push({ nav: navText, ok: r?.ok === true, buttonCount: pageButtons })
    record('nav_click', navText, r?.ok === true, `buttons: ${pageButtons}`)
    logProgress(`  ${navText}: ${r?.ok ? 'OK' : 'FAIL'} (${pageButtons} buttons)`)
  }

  // ============================================================
  // [2] 回到 Dashboard,逐个点击按钮
  // ============================================================
  logProgress('\n[2] 回到 Dashboard 点击按钮')
  // 点第一个导航项 (通常是 Dashboard/首页)
  if (navItems && navItems.length > 0) {
    await c.eval(`(function(){
      const allNav = document.querySelectorAll('nav a, nav button, [role="navigation"] a, [role="navigation"] button, .sidebar a, .sidebar button, aside a, aside button')
      for (const el of allNav) {
        if ((el.textContent || '').trim() === ${JSON.stringify(navItems[0])}) {
          try { el.click() } catch(e) {}
          return
        }
      }
    })()`)
    await new Promise(r => setTimeout(r, 1500))
  }

  // 获取 Dashboard 所有按钮并逐个点击
  const dashBtns = await c.eval(`(function(){
    const btns = document.querySelectorAll('button, [role="button"]')
    return Array.from(btns).map((b, i) => ({
      idx: i,
      text: (b.textContent || '').trim().slice(0, 50),
      disabled: b.disabled,
      visible: b.offsetParent !== null
    })).filter(b => b.text && b.visible && !b.disabled)
  })()`)
  logProgress(`Dashboard 可点击按钮: ${dashBtns?.length || 0}`)

  let btnClickOk = 0
  for (let i = 0; i < (dashBtns?.length || 0); i++) {
    const btn = dashBtns[i]
    // 清空之前的 alert/confirm
    await c.eval('window.__r5Alerts = []; window.__r5Confirms = []')
    const r = await c.eval(`(function(){
      const btns = document.querySelectorAll('button, [role="button"]')
      const visibleBtns = Array.from(btns).filter(b => (b.textContent || '').trim() && b.offsetParent !== null && !b.disabled)
      const btn = visibleBtns[${i}]
      if (!btn) return { ok: false, err: 'not found' }
      try {
        btn.click()
        return { ok: true, text: btn.textContent.trim().slice(0, 30) }
      } catch(e) {
        return { ok: false, err: e.message }
      }
    })()`)
    if (r?.ok) btnClickOk++
    record('dash_btn_click', `btn[${i}]=${btn?.text?.slice(0, 20)}`, r?.ok === true, r?.err || '')
    // 短暂等待 UI 响应
    await new Promise(r => setTimeout(r, 300))
    // 如果打开了 modal/dialog,尝试关闭
    await c.eval(`(function(){
      // 关闭 modal: 点 close/cancel/取消 按钮,或按 Escape
      const closeBtns = document.querySelectorAll('[role="dialog"] button, .modal button, [class*="close"], [class*="cancel"], [class*="Close"], [class*="Cancel"]')
      for (const b of closeBtns) {
        const t = (b.textContent || '').trim()
        if (/^(关闭|取消|Close|Cancel|×|×)$/i.test(t) || b.getAttribute('aria-label') === 'Close') {
          try { b.click(); return } catch(e) {}
        }
      }
      // 按 Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }))
    })()`)
    await new Promise(r => setTimeout(r, 200))
  }
  logProgress(`  ${btnClickOk}/${dashBtns?.length || 0} Dashboard 按钮点击成功`)

  // ============================================================
  // [3] 表单填写测试 - 找到所有 input/textarea 并填写
  // ============================================================
  logProgress('\n[3] 表单填写测试')
  const formFields = await c.eval(`(function(){
    const inputs = document.querySelectorAll('input, textarea, select')
    return Array.from(inputs).map((el, i) => ({
      idx: i,
      type: el.type || el.tagName.toLowerCase(),
      name: el.name || el.placeholder || el.id || '',
      visible: el.offsetParent !== null,
      disabled: el.disabled
    })).filter(f => f.visible && !f.disabled && f.name)
  })()`)
  logProgress(`找到 ${formFields?.length || 0} 个可见可填写表单字段`)

  let formFillOk = 0
  for (const field of (formFields || []).slice(0, 30)) { // 限制 30 个
    const value = field.type === 'number' ? '42' :
                  field.type === 'email' ? 'test@example.com' :
                  field.type === 'password' ? 'testpass123' :
                  field.type === 'checkbox' || field.type === 'radio' ? '__CHECK__' :
                  '测试文本R5'
    const r = await c.eval(`(function(){
      const inputs = document.querySelectorAll('input, textarea, select')
      const visibleInputs = Array.from(inputs).filter(el => el.offsetParent !== null && !el.disabled)
      const el = visibleInputs[${field.idx}]
      if (!el) return { ok: false, err: 'not found' }
      try {
        const val = ${JSON.stringify(value)}
        if (val === '__CHECK__') {
          if (!el.checked) el.click()
        } else if (el.tagName === 'SELECT') {
          const opts = el.options
          if (opts.length > 1) { el.selectedIndex = 1; el.dispatchEvent(new Event('change', {bubbles: true})) }
        } else {
          // React 受控组件需要用 native setter
          const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set
          if (setter) setter.call(el, val)
          else el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        return { ok: true }
      } catch(e) { return { ok: false, err: e.message } }
    })()`)
    if (r?.ok) formFillOk++
    record('form_fill', `field[${field.idx}]=${field.name?.slice(0, 20)}`, r?.ok === true, r?.err || '')
  }
  logProgress(`  ${formFillOk}/${Math.min(formFields?.length || 0, 30)} 表单字段填写成功`)

  // ============================================================
  // [4] 验证关键页面是否可访问 (URL hash 路由)
  // ============================================================
  logProgress('\n[4] 验证关键页面 hash 路由')
  const routes = ['#/', '#/dashboard', '#/chat', '#/agents', '#/classes', '#/eaa', '#/settings', '#/logs', '#/privacy', '#/cron']
  for (const route of routes) {
    const r = await c.eval(`(async function(){
      try {
        window.location.hash = ${JSON.stringify(route)}
        await new Promise(r => setTimeout(r, 800))
        const errEls = document.querySelectorAll('.error, [class*="error"], [class*="Error"]')
        const visibleErrors = Array.from(errEls).filter(e => e.offsetParent !== null && (e.textContent || '').trim().length > 5)
        return { ok: true, errorCount: visibleErrors.length, bodyLen: document.body.textContent.length }
      } catch(e) { return { ok: false, err: e.message } }
    })()`)
    record('route_access', route, r?.ok === true && (r?.errorCount || 0) < 3, `errors: ${r?.errorCount}`)
    logProgress(`  ${route}: ${r?.ok ? 'OK' : 'FAIL'} (${r?.errorCount || 0} visible errors, body ${r?.bodyLen || 0} chars)`)
  }

  // ============================================================
  // [5] 最终错误检查
  // ============================================================
  logProgress('\n[5] 最终错误检查')
  const errs = await c.eval('window.__r5Errs || []')
  const alerts = await c.eval('window.__r5Alerts || []')
  const confirms = await c.eval('window.__r5Confirms || []')
  // 过滤掉 benign console errors (React DevTools warnings, etc.)
  const realErrs = (errs || []).filter(e => !/React DevTools|Download the React|Warning: .*deprecated/i.test(e))
  record('final_no_errors', realErrs.length === 0, `${realErrs.length} real errors`)
  logProgress(`  errors: ${realErrs.length}/${errs?.length || 0} (filtered out benign)`)
  logProgress(`  alerts triggered: ${alerts?.length || 0}`)
  logProgress(`  confirms triggered: ${confirms?.length || 0}`)
  if (realErrs.length > 0 && realErrs.length <= 5) {
    for (const e of realErrs) logProgress(`    ERR: ${String(e).slice(0, 200)}`)
  }

  // ============================================================
  // 汇总
  // ============================================================
  logProgress('============================================================')
  logProgress('R5 SUMMARY')
  logProgress('============================================================')
  logProgress(`Total: ${stats.total}, Pass: ${stats.pass}, Fail: ${stats.fail}`)
  logProgress(`Nav items: ${navItems?.length || 0}, Dashboard buttons: ${buttons?.length || 0}, Form fields: ${formFields?.length || 0}`)
  if (stats.errors.length > 0) {
    logProgress('Failures (first 10):')
    for (const e of stats.errors.slice(0, 10)) {
      logProgress(`  ${e.name}: ${e.detail}`)
    }
  }

  try {
    fs.writeFileSync(require('path').join(__dirname, 'r5-results.json'), JSON.stringify({
      ...stats,
      navItems,
      navClickResults,
      dashBtns,
      formFields,
      alerts,
      confirms,
      realErrs
    }, null, 2))
  } catch {}

  c.close()
}

main().catch(e => { logProgress('FATAL: ' + e.message); logProgress(e.stack || ''); process.exit(1) })
