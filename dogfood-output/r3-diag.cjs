// R3 失败项诊断 - 查看实际返回值
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
      try { return await obj(...a) } catch(e) { return { __error: e.message, __stack: e.stack } }
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('=== R3 失败项诊断 ===\n')

  console.log('[1] eaa.range_inverted (2025-12-31 → 2025-01-01):')
  console.log(JSON.stringify(await c.callApi('eaa.range', '2025-12-31', '2025-01-01'), null, 2))

  console.log('\n[2] agent.toggle_wrong_type (12345, "not-bool"):')
  console.log(JSON.stringify(await c.callApi('agent.toggle', 'academic', 'not-bool'), null, 2))

  console.log('\n[3] agent.setSoul_wrong_type (12345, 999):')
  console.log(JSON.stringify(await c.callApi('agent.setSoul', 'academic', 999), null, 2))

  console.log('\n[4] chat.deleteSession_not_found ("non-existent"):')
  console.log(JSON.stringify(await c.callApi('chat.deleteSession', 'non-existent-session-xyz'), null, 2))

  console.log('\n[5] class.assign_bad_student (bad name):')
  console.log(JSON.stringify(await c.callApi('class.assign', { classId: 'G7-TEST', studentName: '不存在学生xyz' }), null, 2))

  console.log('\n[6] cron.runNow_not_found:')
  console.log(JSON.stringify(await c.callApi('cron.runNow', 'task-not-exist-xyz'), null, 2))

  console.log('\n[7] cron.remove_not_found:')
  console.log(JSON.stringify(await c.callApi('cron.remove', 'task-not-exist-xyz'), null, 2))

  console.log('\n[8] ai.setApiKey_empty:')
  console.log(JSON.stringify(await c.callApi('ai.setApiKey', 'openai', ''), null, 2))

  console.log('\n[9] ai.deleteApiKey_bad_provider:')
  console.log(JSON.stringify(await c.callApi('ai.deleteApiKey', 'non-existent-provider'), null, 2))

  console.log('\n[10] profile.get_not_found:')
  console.log(JSON.stringify(await c.callApi('profile.get', 'non-existent-key-xyz'), null, 2))

  console.log('\n[11] sys.notify_wrong_type (12345):')
  console.log(JSON.stringify(await c.callApi('sys.notify', 12345), null, 2))

  c.close()
}
main().catch(e => { console.error('ERROR:', e); process.exit(1) })
