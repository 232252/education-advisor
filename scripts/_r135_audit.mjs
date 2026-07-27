// R135 UI audit — runtime DOM metrics per page to find inconsistencies
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
      if (msg.id === id) { ws.off('message', handler); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result) }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { ws.off('message', handler); reject(new Error(`timeout: ${method}`)) }, 30000)
  })
}
async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result.value
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }
const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('timeout')), 10000) })

// Collect console errors during navigation
const consoleErrors = []
ws.on('message', (ev) => {
  try {
    const msg = JSON.parse(ev.toString())
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const txt = msg.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 120)
      consoleErrors.push(txt)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXC: ' + (msg.params.exceptionDetails?.text || '').slice(0, 120))
    }
  } catch {}
})
await cdpCall(ws, 'Runtime.enable')

const routes = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/academics', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']

console.log('\n=== R135 UI 审计 (运行时 DOM 指标) ===\n')
console.log('route'.padEnd(14) + 'h1  btn  card  inline  hardcoded  scrollH  bodyH')
console.log('-'.repeat(72))

const issues = []
for (const route of routes) {
  await evalInPage(ws, `window.location.hash = ${JSON.stringify(route)}`)
  await sleep(1400)
  const m = await evalInPage(ws, `(() => {
    const main = document.querySelector('main') || document.body;
    const h1 = main.querySelectorAll('h1').length;
    const btns = main.querySelectorAll('button').length;
    const cards = main.querySelectorAll('[class*="rounded-xl"][class*="border"]').length;
    // inline style attributes (design system bypass)
    const inline = main.querySelectorAll('[style]').length;
    // hardcoded hex colors in inline styles
    let hardcoded = 0;
    main.querySelectorAll('[style]').forEach(el => {
      const s = el.getAttribute('style') || '';
      if (/#[0-9a-fA-F]{3,8}\\b|rgb\\(/.test(s)) hardcoded++;
    });
    const scrollH = main.scrollHeight;
    const bodyH = document.body.scrollHeight;
    return { h1, btns, cards, inline, hardcoded, scrollH, bodyH };
  })()`)
  if (m && !m.__error) {
    console.log(route.replace('#/','').padEnd(14) + String(m.h1).padEnd(5) + String(m.btns).padEnd(6) + String(m.cards).padEnd(7) + String(m.inline).padEnd(8) + String(m.hardcoded).padEnd(11) + String(m.scrollH).padEnd(9) + m.bodyH)
    if (m.h1 === 0) issues.push(`${route}: 无 h1 标题 (缺失 PageHeader?)`)
    if (m.hardcoded > 0) issues.push(`${route}: ${m.hardcoded} 个内联硬编码颜色`)
    if (m.inline > 3) issues.push(`${route}: ${m.inline} 个内联 style (可能绕过设计系统)`)
  } else {
    console.log(route.replace('#/','').padEnd(14) + 'AUDIT FAILED: ' + (m?.__error?.slice(0,60) || 'unknown'))
  }
}

// Empty-state audit: check pages for list containers with no empty-state UI
console.log('\n=== 空状态审计 ===')
for (const route of routes) {
  await evalInPage(ws, `window.location.hash = ${JSON.stringify(route)}`)
  await sleep(1200)
  const empty = await evalInPage(ws, `(() => {
    // look for elements that indicate empty lists: "暂无" / "No " / empty containers
    const txt = (document.querySelector('main') || document.body).innerText;
    const hasEmpty = /暂无|没有|No data|No .+ yet|空/.test(txt);
    return { hasEmptyText: hasEmpty };
  })()`)
  // just report presence
}

console.log('\n=== 导航期间捕获的控制台错误 ===')
if (consoleErrors.length === 0) console.log('  (无)')
else consoleErrors.slice(0, 15).forEach((e, i) => console.log(`  ${i+1}. ${e}`))

console.log('\n=== 发现的 UI 一致性问题 ===')
if (issues.length === 0) console.log('  (无)')
else issues.forEach((s, i) => console.log(`  ${i+1}. ${s}`))

ws.close()
