import WebSocket from 'ws'
const page = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0; const pending = new Map()
ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}, timeout = 30000) => new Promise((res, rej) => { const mid = ++id; const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout')) }, timeout); pending.set(mid, (m) => { clearTimeout(t); res(m) }); ws.send(JSON.stringify({ id: mid, method, params })) })
const evl = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text }; return r.result?.result?.value }
const r = await evl(`(async()=>{ const r = await api.eaa.doctor(); return r.data })()`)
console.log(JSON.stringify(r, null, 1))
ws.close(); process.exit(0)
