// 清理 probe13 副作用: 将 weekly-reporter SOUL 恢复为空字符串
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
  console.log('=== Clean up weekly-reporter SOUL pollution ===\n')

  const before = await c.callApi('agent.getSoul', 'weekly-reporter')
  const beforeStr = typeof before === 'string' ? before : ''
  console.log(`Before cleanup: length=${beforeStr.length}, content="${beforeStr}"`)

  // Set to empty string to restore original state (originally empty per probe13 discovery)
  const setRes = await c.callApi('agent.setSoul', 'weekly-reporter', '')
  console.log(`setSoul('') response:`, JSON.stringify(setRes))

  const after = await c.callApi('agent.getSoul', 'weekly-reporter')
  const afterStr = typeof after === 'string' ? after : ''
  console.log(`After cleanup: length=${afterStr.length}, content="${afterStr}"`)
  console.log(`Cleanup ${afterStr.length === 0 ? 'SUCCESS' : 'FAILED'}`)

  c.close()
}

main().catch(e => { console.error(e); process.exit(1) })
