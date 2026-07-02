// R4 diagnostic - 检查 eaa.info 实际返回结构
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
  async callApi(p, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(p)}.split('.')
      let obj = window.api
      for (const x of parts) obj = obj[x]
      const a = ${JSON.stringify(args)}
      try { return await obj(...a) } catch(e) { return { __error: e.message } }
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('eaa.info keys & structure:')
  const info = await c.callApi('eaa.info')
  console.log('top-level:', Object.keys(info || {}))
  if (info?.data) {
    console.log('data keys:', Object.keys(info.data))
    if (info.data.students) {
      console.log('students type:', typeof info.data.students, Array.isArray(info.data.students) ? 'array' : 'not-array')
      console.log('students sample:', JSON.stringify(info.data.students).slice(0, 400))
    }
  }

  console.log('\neaa.listStudents:')
  const ls = await c.callApi('eaa.listStudents')
  console.log('top-level:', Object.keys(ls || {}))
  if (ls?.data) {
    console.log('data type:', typeof ls.data, Array.isArray(ls.data) ? 'array' : 'not-array')
    console.log('sample:', JSON.stringify(ls.data).slice(0, 400))
  }

  console.log('\nclass.list:')
  const cl = await c.callApi('class.list')
  console.log(JSON.stringify(cl).slice(0, 600))

  c.close()
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
