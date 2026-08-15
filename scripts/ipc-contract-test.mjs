// IPC 契约深度测试: 逐个调用 window.api 关键方法, 验证返回值与设计契约相符
import WebSocket from 'ws'

const page = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const pending = new Map()
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}, timeout = 30000) => new Promise((res, rej) => {
  const mid = ++id
  const t = setTimeout(() => { pending.delete(mid); rej(new Error(`timeout ${method}`)) }, timeout)
  pending.set(mid, (m) => { clearTimeout(t); res(m) })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evl = async (expr, timeout = 25000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout)
  if (r.result?.exceptionDetails) return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 400) }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 逐个 API 调用并结构化输出
const tests = [
  ['eaa.info', `api.eaa.info()`],
  ['eaa.stats', `api.eaa.stats()`],
  ['eaa.listStudents', `api.eaa.listStudents({})`],
  ['eaa.summary', `api.eaa.summary()`],
  ['eaa.codes', `api.eaa.codes()`],
  ['eaa.doctor', `api.eaa.doctor()`],
  ['agent.list', `api.agent.list()`],
  ['agent.getHistory', `api.agent.getHistory('class-monitor')`],
  ['cron.list', `api.cron.list()`],
  ['settings.get', `api.settings.get()`],
  ['class.list', `api.class.list()`],
  ['academic.getConfig', `api.academic.getConfig()`],
  ['academic.listExams', `api.academic.listExams()`],
  ['skill.list', `api.skill.list()`],
  ['mcp.list', `api.mcp.list()`],
  ['privacy.status', `api.privacy.status()`],
  ['log.list', `api.log.list({})`],
  ['sys.getPath', `api.sys.getPath('userData')`],
  ['ollama.detect', `api.ollama.detect()`],
  ['feishu.botStatus', `api.feishu.botStatus()`],
  ['feishu.status', `api.feishu.status()`],
  ['profile.get', `api.profile.get('test')`],
]

for (const [name, expr] of tests) {
  const start = Date.now()
  const r = await evl(`(async () => {
    try { return { ok: true, v: await (${expr}) } }
    catch (e) { return { ok: false, v: String(e && e.message || e).slice(0, 300) } }
  })()`)
  const ms = Date.now() - start
  if (!r || r.__error) { console.log(`✗ ${name}: EVAL ERROR ${r?.__error}`); continue }
  let summary
  try {
    const v = r.v
    if (r.ok === false) { console.log(`✗ ${name}: ${r.v}`); continue }
    if (Array.isArray(v)) summary = `array[${v.length}] ${JSON.stringify(v[0] ?? null).slice(0, 150)}`
    else if (v && typeof v === 'object') {
      const keys = Object.keys(v)
      summary = `object{${keys.join(',')}} ${JSON.stringify(v).slice(0, 180)}`
    } else summary = JSON.stringify(v).slice(0, 180)
    console.log(`✓ ${name} (${ms}ms): ${summary}`)
  } catch (e) { console.log(`✗ ${name}: ${e.message}`) }
}
ws.close()
process.exit(0)
