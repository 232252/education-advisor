// 验证 Agent history 增长 (延长等待时间到 60s)
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const targets = await getTargets()
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.on('open', r))
  let id = 0
  const pending = new Map()
  ws.on('message', msg => {
    const obj = JSON.parse(msg)
    if (obj.id && pending.has(obj.id)) {
      const { resolve, reject } = pending.get(obj.id)
      pending.delete(obj.id)
      if (obj.error) reject(new Error(JSON.stringify(obj.error)))
      else resolve(obj.result)
    }
  })
  async function callApi(path, ...args) {
    const i = ++id
    return new Promise((resolve, reject) => {
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({
        id: i, method: 'Runtime.evaluate',
        params: { expression: `(async () => {
          const parts = ${JSON.stringify(path)}.split('.')
          let obj = window.api
          for (const p of parts) obj = obj[p]
          const args = ${JSON.stringify(args)}
          return await obj(...args)
        })()`, awaitPromise: true, returnByValue: true }
      }))
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout')) } }, 120000)
    })
  }
  function extract(result) {
    if (result.exceptionDetails) return { __error: result.exceptionDetails.exception?.description || result.exceptionDetails.text }
    return result.result.value
  }

  console.log('=== Agent History 增长验证 (60s 等待) ===\n')

  const agents = extract(await callApi('agent.list'))
  const enabled = agents.find(a => a.enabled)
  console.log(`Agent: ${enabled.id} (${enabled.name})`)

  const h1 = extract(await callApi('agent.getHistory', enabled.id))
  const before = Array.isArray(h1) ? h1.length : 0
  console.log(`执行前 history 数: ${before}`)

  console.log('触发 runManual...')
  await callApi('agent.runManual', enabled.id, '回复一个字: 好', [])

  console.log('等待 60s...')
  for (let i = 0; i < 12; i++) {
    await sleep(5000)
    const h = extract(await callApi('agent.getHistory', enabled.id))
    const now = Array.isArray(h) ? h.length : 0
    process.stdout.write(`[${(i+1)*5}s] history=${now}\n`)
    if (now > before) {
      console.log(`\n✅ history 增长: ${before} → ${now}`)
      const last = h[h.length - 1]
      console.log(`最后一条: status=${last?.status}, duration=${last?.durationMs}ms, tokens=${JSON.stringify(last?.tokenUsage)}`)
      ws.close()
      return
    }
  }
  console.log(`\n❌ 60s 内 history 未增长 (still ${before})`)
  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
