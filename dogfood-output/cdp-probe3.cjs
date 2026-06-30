// 探查 agent.getSoul 失败的 agent + log.filter/search 实际返回结构
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 30000)
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

  console.log('=== [1] 探查每个 agent 的 getSoul ===')
  const agents = ['academic', 'bug-hunter', 'class-monitor', 'counselor', 'data-analyst',
    'discipline-officer', 'executor', 'governor', 'home_school', 'main',
    'psychology', 'research', 'risk-alert', 'safety', 'student-care',
    'supervisor', 'validator', 'weekly-reporter']

  for (const id of agents) {
    const soul = await c.callApi('agent.getSoul', id)
    const ok = soul && !soul.__error && (typeof soul === 'string' ? soul.length > 0 : true)
    if (!ok) {
      console.log(`  ${id}: FAIL`)
      console.log(`    soul type: ${typeof soul}`)
      console.log(`    soul value (first 200): ${JSON.stringify(soul).slice(0, 200)}`)
      console.log(`    soul.__error: ${soul?.__error?.slice(0, 150)}`)
    } else {
      const len = typeof soul === 'string' ? soul.length : JSON.stringify(soul).length
      console.log(`  ${id}: OK (len=${len})`)
    }
  }

  console.log('\n=== [2] 探查 log.filter 返回结构 ===')
  const logFilter = await c.callApi('log.filter', { level: 'info', limit: 5 })
  console.log(`  type: ${typeof logFilter}`)
  console.log(`  keys: ${logFilter ? Object.keys(logFilter).join(', ') : 'null'}`)
  console.log(`  value (first 300): ${JSON.stringify(logFilter).slice(0, 300)}`)

  console.log('\n=== [3] 探查 log.search 返回结构 ===')
  const logSearch = await c.callApi('log.search', 'test', 5)
  console.log(`  type: ${typeof logSearch}`)
  console.log(`  keys: ${logSearch ? Object.keys(logSearch).join(', ') : 'null'}`)
  console.log(`  value (first 300): ${JSON.stringify(logSearch).slice(0, 300)}`)

  console.log('\n=== [4] 探查 log.list 返回结构 ===')
  const logList = await c.callApi('log.list', { limit: 5 })
  console.log(`  type: ${typeof logList}`)
  console.log(`  keys: ${logList ? Object.keys(logList).join(', ') : 'null'}`)
  console.log(`  value (first 300): ${JSON.stringify(logList).slice(0, 300)}`)

  c.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
