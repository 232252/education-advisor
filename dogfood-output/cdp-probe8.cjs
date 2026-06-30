// 探查 R16 失败项
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
  console.log('=== R16 失败项探查 ===\n')

  // 1. addStudent 各种边界输入的实际返回
  console.log('[1] addStudent 边界输入返回:')
  const testCases = [
    { name: 'long_name', value: 'A'.repeat(100) },
    { name: 'very_long_name', value: 'B'.repeat(1000) },
    { name: 'control_char', value: 'test\x00student' },
    { name: 'empty', value: '' },
    { name: 'normal', value: `Probe_${Date.now()}` },
  ]
  for (const tc of testCases) {
    const res = await c.callApi('eaa.addStudent', tc.value)
    console.log(`  ${tc.name}: ${JSON.stringify(res).slice(0, 200)}`)
    // 清理
    if (res?.success !== false && !res?.__error && tc.value.length > 0 && tc.value.length < 65) {
      await c.callApi('eaa.deleteStudent', tc.value, 'probe cleanup')
    }
  }

  // 2. addEvent 完整流程探查
  console.log('\n[2] addEvent 完整流程:')
  const testStu = `ProbeEvt_${Date.now().toString().slice(-6)}`
  const addStuRes = await c.callApi('eaa.addStudent', testStu)
  console.log(`  addStudent: ${JSON.stringify(addStuRes).slice(0, 100)}`)

  // 添加 LATE 事件
  const addEvtRes = await c.callApi('eaa.addEvent', {
    studentName: testStu,
    reasonCode: 'LATE',
    note: 'probe test'
  })
  console.log(`  addEvent LATE: ${JSON.stringify(addEvtRes).slice(0, 200)}`)

  // 添加 SLEEP_IN_CLASS 事件
  const addEvt2Res = await c.callApi('eaa.addEvent', {
    studentName: testStu,
    reasonCode: 'SLEEP_IN_CLASS',
    note: 'probe test 2'
  })
  console.log(`  addEvent SLEEP: ${JSON.stringify(addEvt2Res).slice(0, 200)}`)

  // 查询历史
  const histRes = await c.callApi('eaa.history', testStu)
  console.log(`  history: ${JSON.stringify(histRes).slice(0, 400)}`)

  // 查询分数
  const scoreRes = await c.callApi('eaa.score', testStu)
  console.log(`  score: ${JSON.stringify(scoreRes).slice(0, 100)}`)

  // 清理
  await c.callApi('eaa.deleteStudent', testStu, 'probe cleanup')

  c.close()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
