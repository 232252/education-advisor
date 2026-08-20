// 页面全巡检: 导航所有路由, 捕获 console 错误/异常, 断言关键 UI 元素与数据
import WebSocket from 'ws'

const page = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const pending = new Map()
const consoleErrors = []
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleErrors.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description?.slice(0, 300) || ''}`)
  }
})
const send = (method, params = {}, timeout = 25000) => new Promise((res, rej) => {
  const mid = ++id
  const t = setTimeout(() => { pending.delete(mid); rej(new Error(`timeout ${method}`)) }, timeout)
  pending.set(mid, (m) => { clearTimeout(t); res(m) })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evl = async (expr, timeout = 20000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout)
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await send('Page.enable')

const ROUTES = [
  ['dashboard', '#/dashboard', '仪表盘'],
  ['chat', '#/chat', '对话'],
  ['students', '#/students', '学生'],
  ['classes', '#/classes', '班级'],
  ['academics', '#/academics', '学业'],
  ['agents', '#/agents', 'Agent'],
  ['models', '#/models', '模型'],
  ['skills', '#/skills', '技能'],
  ['scheduler', '#/scheduler', '定时任务'],
  ['privacy', '#/privacy', '隐私'],
  ['settings', '#/settings', '设置'],
]

// 安装错误钩子
await evl(`(() => {
  if (window.__errHook) return true
  window.__errHook = true
  window.__appErrors = []
  window.addEventListener('error', (e) => window.__appErrors.push(String(e.message).slice(0, 200)))
  window.addEventListener('unhandledrejection', (e) => window.__appErrors.push('rej:' + String(e.reason).slice(0, 200)))
  return true
})()`)

const results = []
for (const [name, route, label] of ROUTES) {
  const errsBefore = (await evl(`window.__appErrors.length`)) ?? 0
  await evl(`location.hash = '${route}'`)
  await sleep(1800)
  const state = await evl(`(() => {
    const title = document.querySelector('h1, h2')?.textContent?.trim()?.slice(0, 60) || ''
    const navActive = document.querySelector('a[class*="active"], [class*="bg-blue-50"]')?.textContent?.trim()?.slice(0, 20) || ''
    const bodyLen = document.body.innerText.length
    const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim().slice(0, 12)).slice(0, 8)
    const errs = window.__appErrors.length
    return { title, bodyLen, btns, errs, navActive }
  })()`)
  const newErrs = (await evl(`window.__appErrors.length`)) ?? 0
  results.push({ name, route, ...state, newErrs: newErrs - errsBefore })
}

console.log(JSON.stringify(results, null, 2))
console.log('=== console errors (first 20) ===')
console.log(consoleErrors.slice(0, 20).join('\n') || '(none)')
ws.close()
process.exit(0)
