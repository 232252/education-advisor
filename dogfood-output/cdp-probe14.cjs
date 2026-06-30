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

  // Check agent list structure
  const listRes = await c.callApi('agent.list')
  console.log('=== agent.list ===')
  console.log('Type:', typeof listRes)
  if (Array.isArray(listRes)) {
    console.log('Length:', listRes.length)
    console.log('First item:', JSON.stringify(listRes[0]).slice(0, 300))
    console.log('Second item:', JSON.stringify(listRes[1]).slice(0, 300))
    // Show all agent IDs/names
    listRes.forEach((a, i) => {
      const id = typeof a === 'string' ? a : (a.id || a.name || a.agent_id || a.key || '')
      const display = typeof a === 'string' ? '' : (a.displayName || a.display_name || a.title || a.label || '')
      const enabled = typeof a === 'object' ? (a.enabled ?? a.active ?? 'N/A') : 'N/A'
      console.log(`  [${i}] id=${id}, display=${display}, enabled=${enabled}, keys=${typeof a === 'object' ? Object.keys(a).join(',') : 'string'}`)
    })
  } else {
    console.log('Not array:', JSON.stringify(listRes).slice(0, 500))
  }

  // Try getSoul with known English IDs
  console.log('\n=== getSoul with English IDs ===')
  const englishIds = ['main', 'data-analyst', 'supervisor', 'weekly-reporter', 'academic', 'counselor']
  for (const id of englishIds) {
    const soul = await c.callApi('agent.getSoul', id)
    const soulStr = typeof soul === 'string' ? soul : ''
    console.log(`  ${id}: len=${soulStr.length}, preview=${soulStr.slice(0, 60)}`)
  }

  // Try toggle with internal ID
  console.log('\n=== toggle test ===')
  const toggleRes = await c.callApi('agent.toggle', 'main')
  console.log('toggle main:', JSON.stringify(toggleRes).slice(0, 200))

  c.close()
}
main().catch(e => { console.error(e); process.exit(1) })
