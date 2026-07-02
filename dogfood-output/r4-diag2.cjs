// 调试: 查询 reason codes + DB 状态
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

  console.log('=== Reason Codes ===')
  const codes = await c.callApi('eaa.codes')
  if (codes?.success) {
    const codeMap = codes.data?.codes || codes.data || {}
    const keys = Object.keys(codeMap)
    console.log(`Total codes: ${keys.length}`)
    for (const k of keys) {
      const v = codeMap[k]
      console.log(`  ${k}: ${JSON.stringify(v)}`)
    }
  } else {
    console.log('codes result:', JSON.stringify(codes).slice(0, 500))
  }

  console.log('\n=== EAA Doctor (health) ===')
  const doc = await c.callApi('eaa.doctor')
  console.log(JSON.stringify(doc).slice(0, 800))

  console.log('\n=== EAA Info ===')
  const info = await c.callApi('eaa.info')
  console.log(JSON.stringify(info).slice(0, 400))

  console.log('\n=== Test chat.saveMessage (basic) ===')
  const testSave = await c.callApi('chat.saveMessage', { role: 'user', content: 'diag test' })
  console.log('saveMessage:', JSON.stringify(testSave))

  console.log('\n=== Test chat.listSessions ===')
  const ls = await c.callApi('chat.listSessions')
  console.log('listSessions:', JSON.stringify(ls).slice(0, 400))

  console.log('\n=== Settings DB path ===')
  const sp = await c.callApi('settings.get')
  console.log('settings keys:', sp ? Object.keys(sp) : 'null')
  console.log('settings sample:', JSON.stringify(sp).slice(0, 400))

  c.close()
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
