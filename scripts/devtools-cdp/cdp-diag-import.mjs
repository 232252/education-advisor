// 诊断: 在运行中的应用内动态导入各模块,检查默认导出解析为什么
// 用法: node scripts/cdp-eval-module.mjs
const CDP_HTTP = `http://localhost:${process.env.EA_CDP_PORT || '9222'}`

async function getPage() {
  const res = await fetch(`${CDP_HTTP}/json`)
  const targets = await res.json()
  return targets.find((t) => t.type === 'page')
}

const page = await getPage()
const { default: WebSocket } = await import('ws')
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 1
const pending = new Map()
ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res, rej) => {
  const myId = id++
  pending.set(myId, res)
  ws.send(JSON.stringify({ id: myId, method, params }))
  setTimeout(() => rej(new Error('timeout')), 15000)
})

// 找到 DashboardPage chunk 并检查其 echarts-for-react 引用
const expr = `(async () => {
  // 通过 webpackChunk 不可行(vite),改为直接检查全局错误
  // 抓取最近 console.error 内容已由日志覆盖;这里改为:
  // 动态 import 构建产物中的 DashboardPage chunk,触发同样的错误并捕获完整 message
  try {
    const mods = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('DashboardPage'))
    return { mods }
  } catch (e) { return { err: String(e) } }
})()`
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(r.result?.result?.value ?? r, null, 2).slice(0, 2000))
ws.close()
process.exit(0)
