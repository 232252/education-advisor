// 浸泡测试: 6 轮随机页面 + 随机 IPC 调用, 监控错误与内存
import WebSocket from 'ws'
const page = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0; const pending = new Map(); const errs = []
ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('ERR: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200))
})
const send = (method, params = {}, timeout = 40000) => new Promise((res, rej) => { const mid = ++id; const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout')) }, timeout); pending.set(mid, (m) => { clearTimeout(t); res(m) }); ws.send(JSON.stringify({ id: mid, method, params })) })
const evl = async (expr, timeout = 30000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout); if (r.result?.exceptionDetails) return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 200) }; return r.result?.result?.value }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
await send('Runtime.enable')
const routes = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/academics', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']
const ipcCalls = [
  `api.eaa.info()`, `api.eaa.stats()`, `api.eaa.codes()`, `api.cron.list()`, `api.agent.list()`,
  `api.class.list()`, `api.settings.get()`, `api.skill.list()`, `api.academic.getConfig()`, `api.log.list({})`
]
let round = 0
const mems = []
while (round < 6) {
  round++
  for (let i = 0; i < 4; i++) {
    const r = routes[Math.floor(Math.random() * routes.length)]
    await evl(`location.hash = '${r}'`)
    await sleep(800)
    const c = ipcCalls[Math.floor(Math.random() * ipcCalls.length)]
    await evl(`(async()=>{ try { await (${c}) } catch(e) {} })()`)
  }
  const mem = await evl(`(() => { const m = performance.memory; return m ? Math.round(m.usedJSHeapSize/1048576) : -1 })()`)
  mems.push(mem)
  console.log(`round ${round}: heap=${mem}MB errors=${errs.length}`)
  if (errs.length > 20) break
}
console.log('---')
console.log('final errors:', errs.slice(0, 10).join('\n') || '(none)')
console.log('heap trend:', mems.join(' → ') + ' MB')
ws.close(); process.exit(0)
