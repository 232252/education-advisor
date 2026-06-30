// 探查 EAA validate 完整输出 — 76 条 unknown entity_id 事件的上下文
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
  console.log('=== PROBE 16: EAA validate full output ===\n')

  // 1) eaa.validate 完整输出
  const validateRes = await c.callApi('eaa.validate')
  console.log('=== validate raw response ===')
  console.log(JSON.stringify(validateRes, null, 2))
  console.log()

  // 2) eaa.stats
  const statsRes = await c.callApi('eaa.stats')
  console.log('=== stats ===')
  console.log(JSON.stringify(statsRes?.data, null, 2))
  console.log()

  // 3) 列出所有学生 — entity_id 对照
  const listRes = await c.callApi('eaa.listStudents')
  const students = listRes?.data?.students || listRes?.data || []
  console.log(`=== listStudents: ${students.length} ===`)
  if (Array.isArray(students)) {
    console.log('Sample (first 5):')
    students.slice(0, 5).forEach(s => console.log(`  ${JSON.stringify(s).slice(0, 200)}`))
    // 收集所有 entity_id
    const eids = new Set(students.map(s => s.entity_id || s.id).filter(Boolean))
    console.log(`Unique entity_ids: ${eids.size}`)
  }
  console.log()

  // 4) EAA 数据库位置
  console.log('=== EAA data location ===')
  const eaaInfo = await c.callApi('eaa.info')
  console.log(JSON.stringify(eaaInfo?.data, null, 2))

  c.close()
}

main().catch(e => { console.error(e); process.exit(1) })