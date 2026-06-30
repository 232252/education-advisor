// CDP 第二轮深度测试 — 修正 className bug + 滚动长页面 + 深入交互
const http = require('node:http')
const WebSocket = require('ws')
const fs = require('node:fs')
const path = require('node:path')

const CDP_HTTP = 'http://127.0.0.1:9222'
const OUT_DIR = path.join(__dirname)
const REPORT_PATH = path.join(OUT_DIR, 'test-results-round2.json')

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
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.id = 0; this.cbs = new Map(); this.consoleErrors = []; this.pageErrors = [] }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false, maxPayload: 100 * 1024 * 1024 })
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id != null) { const cb = this.cbs.get(msg.id); if (cb) { this.cbs.delete(msg.id); msg.error ? cb.reject(new Error(JSON.stringify(msg.error))) : cb.resolve(msg.result) } }
        else if (msg.method) {
          if (msg.method === 'Runtime.consoleAPICalled') { const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '); if (msg.params.type === 'error') this.consoleErrors.push(args) }
          if (msg.method === 'Log.entryAdded' && msg.params.entry?.level === 'error') this.consoleErrors.push(`[Log] ${msg.params.entry.text}`)
          if (msg.method === 'Runtime.exceptionThrown') { const d = msg.params.exceptionDetails; this.pageErrors.push(`[exception] ${d.text} ${d.exception?.description || ''}`) }
        }
      })
    })
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.cbs.has(id)) { this.cbs.delete(id); reject(new Error(`timeout: ${method} (${timeoutMs}ms)`)) } }, timeoutMs)
      this.cbs.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr, timeoutMs = 15000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeoutMs)
    if (r.exceptionDetails) throw new Error('Eval: ' + JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  resetLogs() { this.consoleErrors = []; this.pageErrors = [] }
  close() { this.ws?.close() }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject)
  })
}

async function getPageTarget() {
  const targets = await httpGet(`${CDP_HTTP}/json`)
  return targets.find((t) => t.type === 'page')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 修正版：处理 SVG className（baseVal），加滚动到元素
const GET_ELEMENTS_JS = `JSON.stringify((function(){
  const els = Array.from(document.querySelectorAll('a, button, [role="button"], input, select, textarea'));
  return els.map((el, i) => {
    // 滚动到元素
    if (el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest', behavior: 'instant' }) } catch(e) {} }
    const cn = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return {
      idx: i, tag: el.tagName, type: el.type || '', role: el.getAttribute('role') || '',
      text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || cn).substring(0, 100),
      href: el.href || '', id: el.id || '', className: cn.substring(0, 80),
      disabled: el.disabled || false,
      rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null
    };
  }).filter(e => e.rect && e.rect.w > 0 && e.rect.h > 0);
})())`

const CLICK_JS = (x, y) => `new Promise(resolve => {
  const el = document.elementFromPoint(${x}, ${y});
  if (!el) { resolve(JSON.stringify({ok:false, reason:'no element at point'})); return; }
  const cn = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');
  const info = { ok: true, tag: el.tagName, text: (el.innerText||'').substring(0,100), id: el.id, className: cn.substring(0,80) };
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }));
  setTimeout(() => resolve(JSON.stringify(info)), 300);
})`

async function main() {
  const results = { pages: [], summary: { totalPages: PAGES.length, pagesWithErrors: 0, totalErrors: 0, totalButtons: 0, buttonsClicked: 0, buttonsFailed: 0 } }
  const page = await getPageTarget()
  const cdp = new CDP(page.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  console.log('CDP connected. Round 2 deep test...\n')

  for (const pg of PAGES) {
    console.log(`\n${'='.repeat(60)}\nPAGE: ${pg.label} (${pg.name})\n${'='.repeat(60)}`)
    cdp.resetLogs()
    await cdp.eval(`window.location.hash = '${pg.hash}'`)
    await sleep(2000)

    // 先滚动到顶部，然后逐步收集元素（每收集一次滚动一次）
    await cdp.eval(`window.scrollTo(0, 0)`)
    await sleep(200)
    
    // 获取页面文本
    const bodyText = await cdp.eval(`document.body.innerText.substring(0, 2000)`)
    console.log('Body:', bodyText.substring(0, 500))

    // 收集元素（GET_ELEMENTS_JS 会自动滚动到每个元素）
    const elementsStr = await cdp.eval(GET_ELEMENTS_JS)
    const elements = JSON.parse(elementsStr)
    const buttons = elements.filter((e) => e.tag === 'BUTTON' || e.role === 'button')
    console.log(`Elements: ${elements.length} (${buttons.length} buttons)`)

    const pageResult = { name: pg.name, label: pg.label, hash: pg.hash, bodyText: bodyText.substring(0, 1000), elements, buttonsClicked: [], consoleErrors: [], pageErrors: [] }

    // 点击所有按钮
    for (const btn of buttons) {
      const cx = btn.rect.x + Math.round(btn.rect.w / 2)
      const cy = btn.rect.y + Math.round(btn.rect.h / 2)
      if (cx <= 0 || cy <= 0) { results.summary.buttonsFailed++; continue }
      // 先滚动到按钮位置
      await cdp.eval(`window.scrollTo(0, ${Math.max(0, btn.rect.y - 100)})`)
      await sleep(300)
      // 重新获取按钮位置（滚动后可能变了）
      try {
        const rePos = await cdp.eval(`(function(){const els=document.querySelectorAll('button,[role="button"]');for(const el of els){const cn=typeof el.className==='string'?el.className:(el.className?.baseVal||'');if((el.innerText||'').includes('${(btn.text||'').replace(/'/g, "\\'").substring(0, 30)}')){const r=el.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)})}}return null})()`)
        if (rePos) {
          const rp = JSON.parse(rePos)
          if (rp.w > 0 && rp.h > 0) { btn.rect = rp }
        }
      } catch(e) {}
      
      const fcx = btn.rect.x + Math.round(btn.rect.w / 2)
      const fcy = btn.rect.y + Math.round(btn.rect.h / 2)
      console.log(`  Click: "${btn.text.substring(0, 40)}" @(${fcx},${fcy})`)
      try {
        const cr = JSON.parse(await cdp.eval(CLICK_JS(fcx, fcy), 5000))
        if (cr.ok) { console.log(`    → clicked ${cr.tag} "${(cr.text||'').substring(0,40)}"`); pageResult.buttonsClicked.push({ text: btn.text, result: cr }); results.summary.buttonsClicked++ }
        else { console.log(`    → FAILED: ${cr.reason}`); pageResult.buttonsClicked.push({ text: btn.text, error: cr.reason }); results.summary.buttonsFailed++ }
        await sleep(1000)
      } catch (e) { console.log(`    → ERROR: ${e.message.substring(0, 100)}`); pageResult.buttonsClicked.push({ text: btn.text, error: e.message }); results.summary.buttonsFailed++ }
    }
    results.summary.totalButtons += buttons.length

    pageResult.consoleErrors = [...cdp.consoleErrors]
    pageResult.pageErrors = [...cdp.pageErrors]
    if (cdp.consoleErrors.length > 0 || cdp.pageErrors.length > 0) {
      results.summary.pagesWithErrors++
      results.summary.totalErrors += cdp.consoleErrors.length + cdp.pageErrors.length
      console.log(`  ⚠️ ${cdp.consoleErrors.length} console errors, ${cdp.pageErrors.length} page errors`)
      cdp.consoleErrors.forEach((e) => console.log(`    [console] ${e.substring(0, 200)}`))
      cdp.pageErrors.forEach((e) => console.log(`    [page] ${e.substring(0, 200)}`))
    } else { console.log('  ✓ No errors') }
    results.pages.push(pageResult)
  }

  cdp.close()
  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2))
  console.log(`\n${'='.repeat(60)}\nSUMMARY\n${'='.repeat(60)}`)
  console.log(JSON.stringify(results.summary, null, 2))
  console.log('\nReport:', REPORT_PATH)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
