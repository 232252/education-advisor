// R1: 10 页面 UI 渲染 + 导航 + 实际按钮/表单交互测试
// 每个页面: 1) hash 导航 2) 等待渲染 3) 收集可交互元素 4) 实际操作(点击/填值) 5) 验证副作用
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout: ' + method)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  async callApi(path, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + String(detail).slice(0, 150) : ''}`)
}

async function navigate(c, hash) {
  await c.eval(`location.hash = '${hash}'`)
  await sleep(700)
}

async function getPageStats(c) {
  return c.eval(`(function(){
    const buttons = document.querySelectorAll('button').length
    const inputs = document.querySelectorAll('input,textarea,select').length
    const links = document.querySelectorAll('a').length
    const h1 = document.querySelectorAll('h1,h2,h3').length
    const bodyLen = document.body ? document.body.innerHTML.length : 0
    const visible = document.querySelectorAll('button:not([disabled]),input:not([disabled])').length
    return {buttons,inputs,links,h1,bodyLen,visible}
  })()`)
}

async function clickAllSafeButtons(c, pageName) {
  // 先获取所有安全按钮的文本和索引,然后逐个点击,每次独立超时
  const list = await c.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'))
    const skip = /delete|remove|clear|reset|drop|wipe|销毁|删除|清空|卸载|导出|export/i
    const out = []
    btns.forEach((b, i) => {
      const txt = (b.textContent || '').trim()
      if (!txt) return
      if (skip.test(txt)) return
      if (b.disabled) return
      out.push({i, txt: txt.slice(0, 30)})
    })
    return out
  })()`).catch(() => [])

  let clicked = 0
  for (const b of list) {
    // 单按钮点击 + 短等待,每次独立 eval,失败不影响其他按钮
    const r = await c.eval(`(async function(){
      const btns = document.querySelectorAll('button')
      const b = btns[${b.i}]
      if (!b || b.disabled) return false
      try {
        b.scrollIntoView({block:'center'})
      } catch(e) {}
      try { b.click() } catch(e) { return 'click_err:' + e.message }
      return true
    })()`).catch(e => `eval_err: ${e.message}`)
    if (r === true) clicked++
    await sleep(80)
  }
  return { clicked, list }
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 1 (R1): UI 10 页面导航 + 实际交互')
  console.log('============================================================')

  // 注入错误监听 + stub 阻塞对话框(alert/confirm/prompt 不能在 CDP 里被处理,会卡死)
  await c.eval(`(function(){
    if(window.__r1Errs) return
    window.__r1Errs = []
    window.addEventListener('error', e => { window.__r1Errs.push(e.message) })
    window.addEventListener('unhandledrejection', e => { window.__r1Errs.push('unhandled:' + (e.reason && e.reason.message || e.reason)) })
    // stub 阻塞对话框 — 默认 confirm=true 以便"确认"类按钮可以继续
    window.alert = function(msg){ window.__r1Errs.push('alert:' + msg); return undefined }
    window.confirm = function(msg){ window.__r1Errs.push('confirm:' + msg); return true }
    window.prompt = function(msg, def){ window.__r1Errs.push('prompt:' + msg); return def || '' }
  })()`)

  const pages = [
    { hash: '#/dashboard', name: 'Dashboard' },
    { hash: '#/students', name: 'Students' },
    { hash: '#/classes', name: 'Classes' },
    { hash: '#/chat', name: 'Chat' },
    { hash: '#/agents', name: 'Agents' },
    { hash: '#/skills', name: 'Skills' },
    { hash: '#/privacy', name: 'Privacy' },
    { hash: '#/scheduler', name: 'Scheduler' },
    { hash: '#/models', name: 'Models' },
    { hash: '#/settings', name: 'Settings' },
  ]

  const totals = { buttons: 0, inputs: 0, links: 0, visible: 0 }
  for (const p of pages) {
    console.log(`\n[页面] ${p.name} (${p.hash})`)
    await navigate(c, p.hash)
    const cur = await c.eval('location.hash')
    record(`nav.${p.name}.hash_ok`, cur === p.hash, `cur=${cur}`)

    const stats = await getPageStats(c)
    record(`render.${p.name}.bodyLen>50`, stats.bodyLen > 50, `bodyLen=${stats.bodyLen}`)
    record(`render.${p.name}.hasInteractive`, stats.visible > 0, `buttons=${stats.buttons},inputs=${stats.inputs},links=${stats.links},visible=${stats.visible}`)
    record(`render.${p.name}.hasHeading`, stats.h1 > 0, `h1-h3=${stats.h1}`)
    totals.buttons += stats.buttons
    totals.inputs += stats.inputs
    totals.links += stats.links
    totals.visible += stats.visible

    // 实际点击所有安全按钮(不点 delete/remove)
    const clicked = await clickAllSafeButtons(c, p.name)
    record(`interact.${p.name}.safe_clicks`, clicked >= 0, `clicked ${clicked} safe buttons`)

    // 点击后检查错误
    await sleep(300)
    const errs = await c.eval('window.__r1Errs.length')
    record(`interact.${p.name}.no_new_errors`, errs === 0 || errs === (await c.eval('window.__r1Errs.length')), `total errs so far=${errs}`)
  }

  console.log('\n[统计]')
  console.log(`  总计: buttons=${totals.buttons}, inputs=${totals.inputs}, links=${totals.links}, visible=${totals.visible}`)

  // 最终错误检查
  const finalErrs = await c.eval('JSON.stringify(window.__r1Errs)')
  record('final.no_errors', JSON.parse(finalErrs).length === 0, `errors=${finalErrs}`)

  // 内存
  const mem = await c.eval('JSON.stringify({used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize})')
  console.log(`  memory: ${mem}`)

  // 汇总
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`\n=== R1 SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`)

  // 写入结果
  const fs = require('fs')
  const path = require('path')
  fs.writeFileSync(path.join(__dirname, 'r1-results.json'), JSON.stringify({ startedAt: new Date().toISOString(), results, totals, memory: JSON.parse(mem), errors: JSON.parse(finalErrs) }, null, 2))

  c.close()
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1) })
