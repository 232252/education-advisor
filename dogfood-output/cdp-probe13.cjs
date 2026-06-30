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

  // Check getSoul return format for multiple agents
  const agents = ['weekly-reporter', 'data-analyst', 'main', 'supervisor']
  for (const name of agents) {
    const res = await c.callApi('agent.getSoul', name)
    console.log(`\n=== ${name} ===`)
    console.log('Type:', typeof res)
    console.log('Keys:', res ? Object.keys(res) : 'null')
    console.log('success:', res?.success)
    console.log('dataType:', typeof res?.data)
    if (typeof res?.data === 'string') {
      console.log('dataLen:', res.data.length)
      console.log('dataPreview:', res.data.slice(0, 100))
    } else if (res?.data) {
      console.log('data:', JSON.stringify(res.data).slice(0, 200))
    }
    // Check if content is in a different field
    console.log('content field:', typeof res?.content, res?.content?.length || 0)
    console.log('text field:', typeof res?.text, res?.text?.length || 0)
    console.log('soul field:', typeof res?.soul, res?.soul?.length || 0)
  }

  // Also check setSoul return format
  console.log('\n=== setSoul test ===')
  const setRes = await c.callApi('agent.setSoul', 'weekly-reporter', 'Test SOUL content')
  console.log('setSoul result:', JSON.stringify(setRes).slice(0, 200))

  const getRes = await c.callApi('agent.getSoul', 'weekly-reporter')
  console.log('getSoul after set:', JSON.stringify(getRes).slice(0, 300))

  c.close()
}
main().catch(e => { console.error(e); process.exit(1) })
