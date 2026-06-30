// 修复 settings 数据损坏：logLevel 应为字符串，但被设置成了对象
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

  console.log('=== 修复前 settings 状态 ===')
  const before = await c.callApi('settings.get')
  const beforeLog = before?.general?.logLevel
  console.log(`  general.logLevel type: ${typeof beforeLog}`)
  console.log(`  general.logLevel value: ${JSON.stringify(beforeLog).slice(0, 200)}`)

  // 修复：logLevel 应为字符串
  if (typeof beforeLog !== 'string') {
    console.log('\n=== 检测到 logLevel 已损坏（非字符串），修复为 "info" ===')
    await c.callApi('settings.set', 'general.logLevel', 'info')
    const after = await c.callApi('settings.get')
    const afterLog = after?.general?.logLevel
    console.log(`  修复后 general.logLevel type: ${typeof afterLog}`)
    console.log(`  修复后 general.logLevel value: ${afterLog}`)
    if (typeof afterLog === 'string') {
      console.log('  ✅ 修复成功')
    } else {
      console.log('  ❌ 修复失败')
    }
  } else {
    console.log('\n  logLevel 已经是字符串，无需修复')
  }

  // 检查其他可能损坏的字段
  console.log('\n=== 检查所有 settings 字段类型 ===')
  const checkSettings = await c.callApi('settings.get')
  const general = checkSettings?.general || {}
  for (const [key, value] of Object.entries(general)) {
    const type = typeof value
    const isObj = type === 'object' && value !== null
    console.log(`  general.${key}: ${type}${isObj ? ` (keys: ${Object.keys(value).slice(0, 5).join(',')})` : ` = ${JSON.stringify(value).slice(0, 50)}`}`)
  }

  c.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
