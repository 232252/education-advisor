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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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

  // 1. listStudents 返回格式
  console.log('=== 1. listStudents ===')
  const listRes = await c.callApi('eaa.listStudents')
  console.log('Type:', typeof listRes)
  console.log('Keys:', listRes ? Object.keys(listRes) : 'N/A')
  console.log('success:', listRes?.success)
  console.log('data type:', typeof listRes?.data)
  if (listRes?.data) {
    if (Array.isArray(listRes.data)) {
      console.log('data is array, length:', listRes.data.length)
      console.log('first item type:', typeof listRes.data[0])
      console.log('first item:', JSON.stringify(listRes.data[0]).slice(0, 200))
    } else {
      console.log('data keys:', Object.keys(listRes.data))
      console.log('data preview:', JSON.stringify(listRes.data).slice(0, 300))
    }
  }

  // 2. chat.saveMessage 参数
  console.log('\n=== 2. chat.saveMessage ===')
  const testSession = 'probe_test_' + Date.now()
  // 尝试不同参数顺序
  const r1 = await c.callApi('chat.saveMessage', testSession, 'user', 'hello', Date.now())
  console.log('Try (session, role, content, timestamp):', JSON.stringify(r1).slice(0, 200))

  // 检查 chat API 结构
  const chatApiKeys = await c.eval(`Object.keys(window.api.chat)`)
  console.log('chat API keys:', chatApiKeys)

  // 3. agent.runManual 参数
  console.log('\n=== 3. agent.runManual ===')
  const agentRes = await c.callApi('agent.runManual', 'data-analyst')
  console.log('runManual result:', JSON.stringify(agentRes).slice(0, 300))

  // 检查 agent API
  const agentApiKeys = await c.eval(`Object.keys(window.api.agent)`)
  console.log('agent API keys:', agentApiKeys)

  // 4. privacy status
  console.log('\n=== 4. Privacy ===')
  const ps = await c.callApi('privacy.status')
  console.log('status:', JSON.stringify(ps))
  // 如果 locked, anonymize 不做任何处理
  const anon = await c.callApi('privacy.anonymize', '张三今天迟到了')
  console.log('anonymize:', JSON.stringify(anon).slice(0, 200))

  // 5. EAA addEvent 参数
  console.log('\n=== 5. EAA addEvent ===')
  const testStu = 'ProbeTest_' + Date.now()
  await c.callApi('eaa.addStudent', testStu)
  const evtRes = await c.callApi('eaa.addEvent', testStu, 'LATE')
  console.log('addEvent result:', JSON.stringify(evtRes).slice(0, 300))
  const histRes = await c.callApi('eaa.history', testStu)
  console.log('history result type:', typeof histRes)
  console.log('history result preview:', JSON.stringify(histRes).slice(0, 400))

  // 清理
  await c.callApi('eaa.deleteStudent', testStu)

  c.close()
}
main().catch(e => { console.error(e); process.exit(1) })
