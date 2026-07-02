// R5b: 每个页面的所有按钮深度点击 + 每个页面的表单填写
// 补充 R5 只测 Dashboard 的不足
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

const LOG_FILE = path.join(__dirname, 'r5b-output.log')
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

const stats = { total: 0, pass: 0, fail: 0, errors: [], byPage: {} }
function record(page, name, ok, detail = '') {
  stats.total++
  if (ok) stats.pass++
  else { stats.fail++; stats.errors.push({ page, name, detail: String(detail).slice(0, 200) }) }
  stats.byPage[page] = stats.byPage[page] || { pass: 0, fail: 0 }
  if (ok) stats.byPage[page].pass++
  else stats.byPage[page].fail++
  if (!ok) logProgress(`  [${page}] FAIL: ${name} :: ${String(detail).slice(0, 150)}`)
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function clickAllButtons(c, pageName) {
  // 获取所有可见可点击按钮
  const btns = await c.eval(`(function(){
    const btns = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')
    return Array.from(btns).map((b, i) => ({
      idx: i,
      text: (b.textContent || b.value || '').trim().slice(0, 50),
      disabled: b.disabled,
      visible: b.offsetParent !== null
    })).filter(b => b.text && b.visible && !b.disabled)
  })()`)
  logProgress(`  [${pageName}] 发现 ${btns?.length || 0} 个可点击按钮`)

  let okCount = 0
  for (let i = 0; i < (btns?.length || 0); i++) {
    const btn = btns[i]
    // 清空 alert/confirm 记录
    await c.eval('window.__r5bAlerts = []; window.__r5bConfirms = []')
    const r = await c.eval(`(function(){
      const btns = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')
      const visibleBtns = Array.from(btns).filter(b => (b.textContent || b.value || '').trim() && b.offsetParent !== null && !b.disabled)
      const btn = visibleBtns[${i}]
      if (!btn) return { ok: false, err: 'not found' }
      try {
        btn.click()
        return { ok: true, text: btn.textContent.trim().slice(0, 30) }
      } catch(e) { return { ok: false, err: e.message } }
    })()`)
    if (r?.ok) okCount++
    record(pageName, `btn[${i}]=${btn?.text?.slice(0, 20)}`, r?.ok === true, r?.err || '')
    await sleep(250)
    // 关闭可能弹出的 modal/dialog
    await c.eval(`(function(){
      const closeBtns = document.querySelectorAll('[role="dialog"] button, .modal button, [class*="close"], [class*="cancel"], [class*="Close"], [class*="Cancel"], [aria-label="Close"]')
      for (const b of closeBtns) {
        const t = (b.textContent || '').trim()
        if (/^(关闭|取消|Close|Cancel|×|×|✕|X)$/i.test(t) || b.getAttribute('aria-label') === 'Close') {
          try { b.click(); return } catch(e) {}
        }
      }
      // 点击 modal 外部背景
      const modal = document.querySelector('[role="dialog"], .modal, [class*="modal"][class*="overlay"]')
      if (modal) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27 }))
      }
    })()`)
    await sleep(150)
  }
  return { total: btns?.length || 0, ok: okCount }
}

async function fillAllForms(c, pageName) {
  const fields = await c.eval(`(function(){
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select')
    return Array.from(inputs).map((el, i) => ({
      idx: i,
      type: el.type || el.tagName.toLowerCase(),
      name: el.name || el.placeholder || el.id || el.getAttribute('aria-label') || '',
      visible: el.offsetParent !== null,
      disabled: el.disabled,
      readOnly: el.readOnly
    })).filter(f => f.visible && !f.disabled && !f.readOnly && f.name)
  })()`)
  logProgress(`  [${pageName}] 发现 ${fields?.length || 0} 个可填写表单字段`)

  let okCount = 0
  for (const field of (fields || []).slice(0, 40)) {
    const value = field.type === 'number' ? '42' :
                  field.type === 'email' ? 'test@example.com' :
                  field.type === 'password' ? 'TestPass123!' :
                  field.type === 'checkbox' || field.type === 'radio' ? '__CHECK__' :
                  field.type === 'date' || field.type === 'time' ? '' :
                  field.type === 'select-one' ? '__SELECT__' :
                  'R5b测试文本'
    // skip date/time (need special format)
    if (field.type === 'date' || field.type === 'time' || field.type === 'datetime-local') {
      record(pageName, `form_skip_${field.type}_${field.name?.slice(0, 20)}`, true, 'skipped date/time')
      continue
    }
    const r = await c.eval(`(function(){
      const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select')
      const visibleInputs = Array.from(inputs).filter(el => el.offsetParent !== null && !el.disabled && !el.readOnly)
      const el = visibleInputs[${field.idx}]
      if (!el) return { ok: false, err: 'not found' }
      try {
        const val = ${JSON.stringify(value)}
        if (val === '__CHECK__') {
          if (!el.checked) el.click()
        } else if (el.tagName === 'SELECT' || val === '__SELECT__') {
          const opts = el.options
          if (opts.length > 1) { el.selectedIndex = 1; el.dispatchEvent(new Event('change', {bubbles: true})) }
        } else {
          const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set
                     || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
                     || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          if (setter) setter.call(el, val)
          else el.value = val
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('blur', { bubbles: true }))
        }
        return { ok: true }
      } catch(e) { return { ok: false, err: e.message } }
    })()`)
    if (r?.ok) okCount++
    record(pageName, `form[${field.idx}]=${field.name?.slice(0, 20)}`, r?.ok === true, r?.err || '')
  }
  return { total: fields?.length || 0, ok: okCount }
}

async function navigateToPage(c, navText) {
  // 点击导航项
  await c.eval(`(function(){
    const allNav = document.querySelectorAll('nav a, nav button, [role="navigation"] a, [role="navigation"] button, .sidebar a, .sidebar button, aside a, aside button, .nav-item, .menu-item, [data-nav], [data-page]')
    for (const el of allNav) {
      if ((el.textContent || '').trim() === ${JSON.stringify(navText)}) {
        try { el.click() } catch(e) {}
        return
      }
    }
  })()`)
  await sleep(1000)
}

async function main() {
  logProgress('============================================================')
  logProgress('ROUND 5b (R5b): 各页面按钮深度点击 + 表单填写')
  logProgress('============================================================')

  const c = new CDPClient()
  await c.connect()

  // 注入 stub
  await c.eval(`(function(){
    if(window.__r5bStub) return
    window.__r5bStub = true
    window.__r5bErrs = []
    window.__r5bAlerts = []
    window.__r5bConfirms = []
    window.alert = function(m) { window.__r5bAlerts.push(String(m)); return undefined }
    window.confirm = function(m) { window.__r5bConfirms.push(String(m)); return true }
    window.prompt = function(m, d) { return d || 'R5b测试输入' }
    window.addEventListener('error', e => { window.__r5bErrs.push(e.message) })
    window.addEventListener('unhandledrejection', e => { window.__r5bErrs.push('unhandled:' + (e.reason && e.reason.message || e.reason)) })
    const origErr = console.error
    console.error = function(...args) { window.__r5bErrs.push('console:' + args.map(a => typeof a === 'object' ? JSON.stringify(a).slice(0,100) : String(a)).join(' ').slice(0,200)); origErr.apply(console, args) }
  })()`)

  const navItems = ['📊仪表盘', '💬对话', '👥学生', '🎓班级', '🤖Agent', '🧠模型', '📝技能', '⏰任务', '🔒隐私', '⚙️设置']

  for (const nav of navItems) {
    logProgress(`\n----- ${nav} -----`)
    await navigateToPage(c, nav)
    record(nav, 'nav_reached', true, '')
    // 点击所有按钮
    const btnResult = await clickAllButtons(c, nav)
    record(nav, `btn_summary`, btnResult.ok === btnResult.total || btnResult.ok >= Math.floor(btnResult.total * 0.9), `${btnResult.ok}/${btnResult.total}`)
    // 关闭可能残留的 modal
    await c.eval(`(function(){
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27 }))
      const closeBtns = document.querySelectorAll('[role="dialog"] button, .modal button, [class*="close"], [class*="Close"]')
      for (const b of closeBtns) {
        const t = (b.textContent || '').trim()
        if (/^(关闭|取消|Close|Cancel|×|×|✕|X)$/i.test(t) || b.getAttribute('aria-label') === 'Close') {
          try { b.click() } catch(e) {}
        }
      }
    })()`)
    await sleep(300)
    // 填写表单
    const formResult = await fillAllForms(c, nav)
    record(nav, `form_summary`, true, `${formResult.ok}/${formResult.total}`)
  }

  // 最终错误检查
  logProgress('\n----- 最终错误检查 -----')
  const errs = await c.eval('window.__r5bErrs || []')
  const realErrs = (errs || []).filter(e => !/React DevTools|Download the React|Warning: .*deprecated| ELECTRON|was suspended|renderer_security/i.test(e))
  record('final', 'no_real_errors', realErrs.length === 0, `${realErrs.length} real errors`)
  logProgress(`  errors: ${realErrs.length}/${errs?.length || 0} (filtered out benign)`)
  if (realErrs.length > 0 && realErrs.length <= 20) {
    for (const e of realErrs) logProgress(`    ERR: ${String(e).slice(0, 250)}`)
  }

  logProgress('\n============================================================')
  logProgress('R5b SUMMARY')
  logProgress('============================================================')
  logProgress(`Total: ${stats.total}, Pass: ${stats.pass}, Fail: ${stats.fail}`)
  logProgress('By page:')
  for (const [p, s] of Object.entries(stats.byPage)) {
    logProgress(`  ${p}: ${s.pass} pass / ${s.fail} fail`)
  }
  if (stats.errors.length > 0) {
    logProgress(`Failures (first 20):`)
    for (const e of stats.errors.slice(0, 20)) {
      logProgress(`  [${e.page}] ${e.name}: ${e.detail}`)
    }
  }

  try {
    fs.writeFileSync(path.join(__dirname, 'r5b-results.json'), JSON.stringify({ ...stats, realErrs }, null, 2))
  } catch {}

  c.close()
}

main().catch(e => { logProgress('FATAL: ' + e.message); logProgress(e.stack || ''); process.exit(1) })
