// 探查: agent.toggle 行为 + weekly-reporter SOUL 状态
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

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => this.ws.on('open', r))
    this.id = 0; this.pending = new Map()
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.id && this.pending.has(obj.id)) {
        const { resolve, reject } = this.pending.get(obj.id)
        this.pending.delete(obj.id)
        if (obj.error) reject(new Error(JSON.stringify(obj.error)))
        else resolve(obj.result)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  async callApi(path, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('=== PROBE 15: agent.toggle + weekly-reporter SOUL ===\n')

  // [1] weekly-reporter SOUL 当前内容
  const weeklySoul = await c.callApi('agent.getSoul', 'weekly-reporter')
  const weeklySoulStr = typeof weeklySoul === 'string' ? weeklySoul : ''
  console.log(`weekly-reporter SOUL length: ${weeklySoulStr.length}`)
  console.log(`weekly-reporter SOUL preview: ${weeklySoulStr.slice(0, 200)}`)
  console.log(`Contains "Test SOUL content": ${weeklySoulStr.includes('Test SOUL content')}`)
  console.log()

  // [2] 列出所有 agent 及其 enabled 状态
  const agentListRes = await c.callApi('agent.list')
  const agents = agentListRes?.data || agentListRes || []
  console.log('All agents enabled state:')
  if (Array.isArray(agents)) {
    for (const a of agents) {
      if (typeof a === 'object') {
        console.log(`  ${a.id} | enabled=${a.enabled} | name=${a.name || ''}`)
      }
    }
  }
  console.log()

  // [3] 探查 toggle API 在 main 上调用后的返回
  console.log('=== Test toggle on main ===')
  const toggleRes1 = await c.callApi('agent.toggle', 'main')
  console.log(`toggle('main') raw response:`, JSON.stringify(toggleRes1).slice(0, 300))

  const listAfter1 = await c.callApi('agent.list')
  const agentsAfter1 = listAfter1?.data || listAfter1 || []
  const mainAfter1 = Array.isArray(agentsAfter1) ? agentsAfter1.find(a => a.id === 'main') : null
  console.log(`main agent after toggle: enabled=${mainAfter1?.enabled}`)

  // toggle 再切回
  const toggleRes2 = await c.callApi('agent.toggle', 'main')
  console.log(`toggle('main') again raw response:`, JSON.stringify(toggleRes2).slice(0, 300))

  const listAfter2 = await c.callApi('agent.list')
  const agentsAfter2 = listAfter2?.data || listAfter2 || []
  const mainAfter2 = Array.isArray(agentsAfter2) ? agentsAfter2.find(a => a.id === 'main') : null
  console.log(`main agent after 2nd toggle: enabled=${mainAfter2?.enabled}`)
  console.log()

  // [4] 尝试切换非 main 的 agent
  console.log('=== Test toggle on data-analyst ===')
  const toggleRes3 = await c.callApi('agent.toggle', 'data-analyst')
  console.log(`toggle('data-analyst') raw response:`, JSON.stringify(toggleRes3).slice(0, 300))

  const listAfter3 = await c.callApi('agent.list')
  const agentsAfter3 = listAfter3?.data || listAfter3 || []
  const daAfter3 = Array.isArray(agentsAfter3) ? agentsAfter3.find(a => a.id === 'data-analyst') : null
  console.log(`data-analyst after toggle: enabled=${daAfter3?.enabled}`)

  // 恢复
  await c.callApi('agent.toggle', 'data-analyst')
  const listAfter4 = await c.callApi('agent.list')
  const agentsAfter4 = listAfter4?.data || listAfter4 || []
  const daAfter4 = Array.isArray(agentsAfter4) ? agentsAfter4.find(a => a.id === 'data-analyst') : null
  console.log(`data-analyst after restore: enabled=${daAfter4?.enabled}`)

  c.close()
}

main().catch(e => { console.error(e); process.exit(1) })
