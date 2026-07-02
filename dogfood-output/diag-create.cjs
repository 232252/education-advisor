// 诊断 class.create 返回值
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })

  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString())
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
  })

  async function evalJS(expr) {
    const i = ++id
    return new Promise((r, j) => {
      pending.set(i, { resolve: r, reject: j })
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); j(new Error('timeout')) } }, 25000)
    })
  }

  // 直接调用 API,返回完整响应
  const result = await evalJS(`(async()=>{
    const r = await window.api.class.create({ class_id: 'DIAG-1', name: '诊断班' });
    return JSON.parse(JSON.stringify(r));
  })()`)
  console.log('create 返回:', JSON.stringify(result.result.value, null, 2))

  // 检查 list
  const listResult = await evalJS(`(async()=>{
    const r = await window.api.class.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  console.log('list 返回:', JSON.stringify(listResult.result.value, null, 2))

  ws.close()
}
main().catch(e => console.error('FATAL:', e))
