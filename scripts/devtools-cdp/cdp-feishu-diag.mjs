// 飞书功能深度诊断: 状态/凭证/设置项/命令路由
import WebSocket from 'ws'

const res = await fetch('http://localhost:9222/json')
const targets = await res.json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
let id = 0
const pending = new Map()
ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((r) => {
  const mid = ++id
  pending.set(mid, r)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') }
  return r.result?.result?.value
}

// 1. 枚举 window.api 上飞书相关方法
const apiKeys = await evl(`(() => {
  const out = {}
  for (const k of Object.keys(window.api || {})) {
    if (/feishu|lark|bot/i.test(k)) {
      out[k] = Object.keys(window.api[k] || {})
    }
  }
  return out
})()`)
console.log('=== api 飞书命名空间 ===')
console.log(JSON.stringify(apiKeys, null, 1))

// 2. 查询 bot 状态
const botStatus = await evl(`(async () => {
  try {
    if (window.api?.feishu?.botStatus) return await window.api.feishu.botStatus()
    if (window.api?.feishu?.getBotStatus) return await window.api.feishu.getBotStatus()
    return { error: 'no botStatus method', keys: Object.keys(window.api?.feishu || {}) }
  } catch (e) { return { error: String(e) } }
})()`)
console.log('=== bot 状态 ===')
console.log(JSON.stringify(botStatus, null, 1))

// 3. 设置里的飞书配置
const settings = await evl(`(async () => {
  try {
    const s = await window.api.settings.get()
    return { feishu: s.feishu ?? null }
  } catch (e) { return { error: String(e) } }
})()`)
console.log('=== settings.feishu ===')
console.log(JSON.stringify(settings, null, 1))

ws.close()
process.exit(0)
