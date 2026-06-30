// 探查 R13 失败项的实际返回结构
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

  // 1. EAA addEvent — 探查返回结构
  console.log('=== eaa.addEvent 探查 ===')
  const testStudent = `ProbeTest_${Date.now().toString().slice(-6)}`
  await c.callApi('eaa.addStudent', testStudent)

  const addEventRes = await c.callApi('eaa.addEvent', {
    entity_id: testStudent,
    reason_code: 'LATE',
    occurred_at: new Date().toISOString(),
    note: '探查测试'
  })
  console.log('addEvent 返回:', JSON.stringify(addEventRes, null, 2))

  // 尝试不同的参数名
  const addEventRes2 = await c.callApi('eaa.addEvent', {
    name: testStudent,
    reason_code: 'LATE',
    occurred_at: new Date().toISOString()
  })
  console.log('addEvent (name):', JSON.stringify(addEventRes2, null, 2))

  // 尝试 entity_id + reasonCode
  const addEventRes3 = await c.callApi('eaa.addEvent', {
    entity_id: testStudent,
    reasonCode: 'LATE',
    occurred_at: new Date().toISOString()
  })
  console.log('addEvent (reasonCode):', JSON.stringify(addEventRes3, null, 2))

  // 2. EAA ranking — 探查返回结构
  console.log('\n=== eaa.ranking 探查 ===')
  const rankingRes = await c.callApi('eaa.ranking', 3)
  console.log('ranking 返回:', JSON.stringify(rankingRes, null, 2).slice(0, 800))

  // 3. sys API
  console.log('\n=== sys API 探查 ===')
  const sysKeys = await c.eval(`JSON.stringify(Object.keys(window.api.sys || {}))`)
  console.log('sys keys:', sysKeys)

  const versionRes = await c.callApi('sys.checkUpdate')
  console.log('sys.checkUpdate:', JSON.stringify(versionRes, null, 2).slice(0, 500))

  const pathRes = await c.callApi('sys.getPath', 'userData')
  console.log('sys.getPath(userData):', JSON.stringify(pathRes).slice(0, 200))

  // 4. 检查 app 版本信息
  const appVersion = await c.eval(`navigator.appVersion`)
  console.log('navigator.appVersion:', appVersion?.slice(0, 100))

  // 5. profile API
  console.log('\n=== profile API 探查 ===')
  const profileGet = await c.callApi('profile.get', testStudent)
  console.log('profile.get(testStudent):', JSON.stringify(profileGet).slice(0, 200))

  // 6. 清理
  await c.callApi('eaa.deleteStudent', testStudent, 'probe cleanup')

  // 7. 检查 window.api 的所有键
  console.log('\n=== window.api 所有键 ===')
  const apiKeys = await c.eval(`JSON.stringify(Object.keys(window.api))`)
  console.log('api keys:', apiKeys)

  c.close()
}

main().catch(e => console.error(e))
