// 探查 chat.createSession / settings / eaa.find/query/list 实际返回结构
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

  console.log('=== [1] chat.createSession ===')
  const cs = await c.callApi('chat.createSession')
  console.log(`  type: ${typeof cs}`)
  console.log(`  keys: ${cs ? Object.keys(cs).join(', ') : 'null'}`)
  console.log(`  value: ${JSON.stringify(cs).slice(0, 300)}`)

  console.log('\n=== [2] settings.get("general.logLevel") ===')
  const logLevel = await c.callApi('settings.get', 'general.logLevel')
  console.log(`  type: ${typeof logLevel}`)
  console.log(`  keys: ${logLevel ? Object.keys(logLevel).join(', ') : 'null'}`)
  console.log(`  value: ${JSON.stringify(logLevel).slice(0, 300)}`)

  console.log('\n=== [3] settings.get("general") ===')
  const general = await c.callApi('settings.get', 'general')
  console.log(`  type: ${typeof general}`)
  console.log(`  keys: ${general ? Object.keys(general).join(', ') : 'null'}`)
  console.log(`  value: ${JSON.stringify(general).slice(0, 400)}`)

  console.log('\n=== [4] settings.getAll ===')
  const all = await c.callApi('settings.getAll')
  console.log(`  type: ${typeof all}`)
  console.log(`  keys: ${all ? Object.keys(all).join(', ') : 'null'}`)
  console.log(`  value (first 500): ${JSON.stringify(all).slice(0, 500)}`)

  console.log('\n=== [5] eaa.listStudents ===')
  const ls = await c.callApi('eaa.listStudents')
  console.log(`  type: ${typeof ls}`)
  console.log(`  keys: ${ls ? Object.keys(ls).join(', ') : 'null'}`)
  console.log(`  value (first 400): ${JSON.stringify(ls).slice(0, 400)}`)

  console.log('\n=== [6] eaa.list ===')
  const list = await c.callApi('eaa.list')
  console.log(`  type: ${typeof list}`)
  console.log(`  keys: ${list ? Object.keys(list).join(', ') : 'null'}`)
  console.log(`  value (first 400): ${JSON.stringify(list).slice(0, 400)}`)

  console.log('\n=== [7] eaa.find("LATE") ===')
  const find = await c.callApi('eaa.find', 'LATE')
  console.log(`  type: ${typeof find}`)
  console.log(`  keys: ${find ? Object.keys(find).join(', ') : 'null'}`)
  console.log(`  value (first 400): ${JSON.stringify(find).slice(0, 400)}`)

  console.log('\n=== [8] eaa.query("score < 100") ===')
  const query = await c.callApi('eaa.query', 'score < 100')
  console.log(`  type: ${typeof query}`)
  console.log(`  keys: ${query ? Object.keys(query).join(', ') : 'null'}`)
  console.log(`  value (first 400): ${JSON.stringify(query).slice(0, 400)}`)

  console.log('\n=== [9] eaa.search("LATE") ===')
  const search = await c.callApi('eaa.search', 'LATE')
  console.log(`  type: ${typeof search}`)
  console.log(`  keys: ${search ? Object.keys(search).join(', ') : 'null'}`)
  console.log(`  value (first 400): ${JSON.stringify(search).slice(0, 400)}`)

  c.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
