// 性能基线: 内存/堆/DOM节点/路由切换耗时
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
// 首次基线
const base = await evl(`(() => {
  const mem = performance.memory ? { usedJS: Math.round(performance.memory.usedJSHeapSize/1048576), totalJS: Math.round(performance.memory.totalJSHeapSize/1048576) } : null
  return { mem, domNodes: document.querySelectorAll('*').length, listeners: performance.getEntriesByType('resource').length }
})()`)
console.log('baseline:', JSON.stringify(base))
// 路由切换耗时(预热一次后)
await evl(`location.hash = '#/dashboard'`); await sleep(1500)
const navTimes = {}
for (const r of routes) {
  const t0 = Date.now()
  await evl(`location.hash = '${r}'`)
  // 等待内容渲染(轮询 body 变化或固定等待)
  await sleep(1200)
  navTimes[r] = Date.now() - t0
}
console.log('nav times:', JSON.stringify(navTimes))
// 切换后的内存
await evl(`location.hash = '#/students'`); await sleep(2500)
const after = await evl(`(() => {
  const mem = performance.memory ? { usedJS: Math.round(performance.memory.usedJSHeapSize/1048576), totalJS: Math.round(performance.memory.totalJSHeapSize/1048576) } : null
  return { mem, domNodes: document.querySelectorAll('*').length }
})()`)
console.log('after nav:', JSON.stringify(after))
ws.close(); process.exit(0)
