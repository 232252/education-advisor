// 并发写压力: 10 个学生各加 5 条事件(共50写) 并发提交, 验证写队列串行化不丢数据
import WebSocket from 'ws'
const page = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0; const pending = new Map()
ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}, timeout = 60000) => new Promise((res, rej) => { const mid = ++id; const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout')) }, timeout); pending.set(mid, (m) => { clearTimeout(t); res(m) }); ws.send(JSON.stringify({ id: mid, method, params })) })
const evl = async (expr, timeout = 50000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout); if (r.result?.exceptionDetails) return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300) }; return r.result?.result?.value }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const T = (name, ok, detail) => console.log(`${ok ? '✓' : '✗'} ${name}: ${String(detail).slice(0, 250)}`)

const prefix = `conc-${Date.now()}`
const r = await evl(`(async () => {
  const names = Array.from({length: 10}, (_, i) => '${prefix}-' + i)
  // 并发创建 10 个学生
  const created = await Promise.all(names.map(n => api.eaa.addStudent(n)))
  const createdOk = created.filter(c => c.success).length
  // 每个学生并发 5 条事件
  const codes = ['CLASS_MONITOR','CLASS_COMMITTEE','ACTIVITY_PARTICIPATION','SPEAK_IN_CLASS','LATE']
  const writes = []
  for (const n of names) for (let i = 0; i < 5; i++) {
    writes.push(api.eaa.addEvent({ studentName: n, reasonCode: codes[i % codes.length], note: '并发测试', delta: undefined }))
  }
  const results = await Promise.all(writes)
  const writeOk = results.filter(r2 => r2.success).length
  // 验证每个学生都有 5 条事件
  const checks = []
  for (const n of names) {
    const h = await api.eaa.history(n)
    checks.push({ name: n, count: h.data?.length ?? h.events?.length ?? -1 })
  }
  const allFive = checks.every(c => c.count === 5)
  return { createdOk, writeOk, totalWrites: writes.length, allFive, checks: checks.slice(0, 3) }
})()`, 120000)
T('并发创建10学生', r.createdOk === 10, `created=${r.createdOk}/10`)
T('并发50条事件写入', r.writeOk === 50, `ok=${r.writeOk}/${r.totalWrites}`)
T('每学生恰好5条(无丢失)', r.allFive === true, JSON.stringify(r.checks))
ws.close(); process.exit(0)
