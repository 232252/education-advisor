// 内存稳定性: 连续 12 轮路由切换, 观察 JS 堆与 DOM 节点是否泄漏增长
import WebSocket from 'ws'
const page = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0; const pending = new Map()
ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}, timeout = 30000) => new Promise((res, rej) => { const mid = ++id; const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout')) }, timeout); pending.set(mid, (m) => { clearTimeout(t); res(m) }); ws.send(JSON.stringify({ id: mid, method, params })) })
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text }; return r.result?.result?.value }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const routes = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/academics', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']
const readMem = () => evl(`(() => {
  const m = performance.memory || null
  return { used: m ? Math.round(m.usedJSHeapSize/1048576) : -1, dom: document.querySelectorAll('*').length }
})()`)
const samples = []
for (let round = 0; round < 3; round++) {
  for (const r of routes) {
    await evl(`location.hash = '${r}'`)
    await sleep(700)
  }
  samples.push(await readMem())
}
// 强制 GC 后再采样一次(若可用)
await evl(`(async()=>{ try { if (window.gc) { window.gc(); await new Promise(r=>setTimeout(r,300)); window.gc() } } catch(e){} })()`)
samples.push(await readMem())
console.log(JSON.stringify(samples, null, 1))
const first = samples[0], last = samples[samples.length-1]
console.log(`\n结论: 起始 used=${first.used}MB dom=${first.dom} → 结束 used=${last.used}MB dom=${last.dom}; 增长=${last.used-first.used}MB`)
ws.close(); process.exit(0)
