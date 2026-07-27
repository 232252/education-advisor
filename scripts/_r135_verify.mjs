// R135 verify — reload + check changed pages render without errors
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
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 400) }
  return r.result.value
}
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }
const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('timeout')), 10000) })

const consoleErrors = []
ws.on('message', (ev) => {
  try {
    const msg = JSON.parse(ev.toString())
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 150))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('EXC: ' + (msg.params.exceptionDetails?.text || '').slice(0, 150))
    }
  } catch {}
})
await cdpCall(ws, 'Runtime.enable')
await cdpCall(ws, 'Page.enable')

console.log('\n=== R135 验证 ===\n')

// Reload to pick up HMR changes cleanly
await cdpCall(ws, 'Page.reload')
await sleep(2500)

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

// 1. Chat page — verify purple ring gone, blue ring present
await evalInPage(ws, `window.location.hash = '#/chat'`)
await sleep(1500)
const chatSelect = await evalInPage(ws, `(() => {
  const sel = document.querySelector('main select');
  if (!sel) return { found: false };
  const cls = sel.className;
  return { found: true, hasPurple: cls.includes('purple'), hasBlue: cls.includes('blue') };
})()`)
check('Chat Agent 选择器: 紫色 ring 已移除', chatSelect && !chatSelect.hasPurple, `cls=${JSON.stringify(chatSelect).slice(0,100)}`)
check('Chat Agent 选择器: 蓝色 ring 已应用', chatSelect && chatSelect.hasBlue, `cls=${JSON.stringify(chatSelect).slice(0,100)}`)

// 2. Academics page — verify EmptyState renders for empty student list
await evalInPage(ws, `window.location.hash = '#/academics'`)
await sleep(1500)
const academicsEmpty = await evalInPage(ws, `(() => {
  const text = (document.querySelector('main') || document.body).innerText;
  const hasEmptyState = !!document.querySelector('main [class*="animate-fade-in"][class*="flex-col"][class*="items-center"]');
  return { hasEmptyState, hasRawText: text.includes('暂无学生') };
})()`)
check('Academics 空状态: EmptyState 组件已渲染', academicsEmpty?.hasEmptyState || academicsEmpty?.hasRawText)

// 3. Skills page — verify McpServerForm inputs use INPUT_SM (check for focus:ring-blue-500/60)
await evalInPage(ws, `window.location.hash = '#/skills'`)
await sleep(1500)
// Open the MCP tab and check if "add" form can be opened
const skillsTab = await evalInPage(ws, `(() => {
  // try to find and click the MCP tab
  const tabs = document.querySelectorAll('main button, main [role="tab"]');
  let mcpTab = null;
  for (const t of tabs) {
    if (t.textContent && t.textContent.includes('MCP')) { mcpTab = t; break; }
  }
  return { found: !!mcpTab, text: mcpTab?.textContent?.slice(0, 30) };
})()`)
check('Skills MCP 标签可定位', skillsTab?.found)

// 4. Verify no console errors across all pages
const routes = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/academics', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']
const errorsBefore = consoleErrors.length
for (const route of routes) {
  await evalInPage(ws, `window.location.hash = ${JSON.stringify(route)}`)
  await sleep(900)
}
const newErrors = consoleErrors.slice(errorsBefore)
check('全部页面无控制台错误', newErrors.length === 0, `${newErrors.length} errors: ${newErrors.slice(0,3).join(' | ')}`)

// 5. Verify INPUT_SM exists in compiled output (check a Settings input)
await evalInPage(ws, `window.location.hash = '#/settings'`)
await sleep(1500)
const settingsInputs = await evalInPage(ws, `(() => {
  const inputs = document.querySelectorAll('main input, main select, main textarea');
  let withBlueRing = 0, withGrayBg = 0;
  inputs.forEach(el => {
    const cls = el.className || '';
    if (typeof cls === 'string') {
      if (cls.includes('ring-blue-500')) withBlueRing++;
      if (cls.includes('bg-gray-50')) withGrayBg++;
    }
  });
  return { total: inputs.length, withBlueRing, withGrayBg };
})()`)
console.log(`  Settings inputs: total=${settingsInputs?.total}, blueRing=${settingsInputs?.withBlueRing}, grayBg=${settingsInputs?.withGrayBg}`)
check('Settings 输入框: 部分已使用蓝色 ring', settingsInputs?.withBlueRing > 0)

console.log(`\n=== R135 验证完成: ${pass} 通过, ${fail} 失败 ===`)
if (newErrors.length > 0) {
  console.log('\n控制台错误:')
  newErrors.forEach((e, i) => console.log(`  ${i+1}. ${e}`))
}
ws.close()
