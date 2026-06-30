// 探查 R14 失败项
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

  // 1. 探查 SQL 注入哪些被接受
  console.log('=== SQL 注入探查 ===')
  const sqlPayloads = [
    "'; DROP TABLE students; --",
    "' OR '1'='1",
    "'; INSERT INTO students VALUES('hacker'); --",
    "' UNION SELECT * FROM sqlite_master --",
    "admin'--",
    "1;1;1;1",
  ]
  for (const p of sqlPayloads) {
    const res = await c.callApi('eaa.addStudent', p)
    if (!res?.__error && res?.success !== false) {
      console.log(`  ACCEPTED: "${p}" -> success=${res?.success}`)
      await c.callApi('eaa.deleteStudent', p, 'cleanup')
    } else {
      console.log(`  BLOCKED: "${p}" -> ${res?.__error?.slice(0, 80) || 'success=false'}`)
    }
  }

  // 2. 探查路径穿越哪些被接受
  console.log('\n=== 路径穿越探查 ===')
  const pathPayloads = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32',
    '....//....//etc/passwd',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '..%252f..%252fetc%252fpasswd',
  ]
  for (const p of pathPayloads) {
    const res = await c.callApi('skill.save', p, 'test')
    if (!res?.__error && res?.success !== false) {
      console.log(`  ACCEPTED: "${p}" -> success=${res?.success}`)
      await c.callApi('skill.delete', p)
    } else {
      console.log(`  BLOCKED: "${p}" -> ${res?.__error?.slice(0, 80) || 'success=false'}`)
    }
  }

  // 3. 探查无效参数哪些没返回错误
  console.log('\n=== 无效参数探查 ===')
  const invalidCalls = [
    ['eaa.score', null],
    ['eaa.score', ''],
    ['eaa.score', 123],
    ['eaa.history', null],
    ['eaa.addEvent', { invalid: true }],
    ['eaa.addStudent', ''],
    ['eaa.addStudent', null],
    ['eaa.deleteStudent', ''],
    ['agent.get', ''],
    ['agent.get', null],
    ['agent.getSoul', 'nonexistent-agent-xyz'],
    ['cron.add', null],
    ['cron.add', { invalid: true }],
    ['skill.get', ''],
    ['skill.get', null],
  ]
  for (const [api, arg] of invalidCalls) {
    const res = await c.callApi(api, arg)
    if (!res?.__error && res?.success !== false) {
      console.log(`  NO ERROR: ${api}(${JSON.stringify(arg)}) -> ${JSON.stringify(res).slice(0, 100)}`)
    } else {
      console.log(`  ERROR: ${api}(${JSON.stringify(arg)}) -> ${res?.__error?.slice(0, 80) || 'success=false'}`)
    }
  }

  // 4. 探查 EAA 事件去重行为
  console.log('\n=== EAA 事件去重探查 ===')
  const testStudent = `ProbeDedup_${Date.now()}`
  await c.callApi('eaa.addStudent', testStudent)

  // 添加 3 个相同 reason_code 的事件
  for (let i = 0; i < 3; i++) {
    const res = await c.callApi('eaa.addEvent', {
      studentName: testStudent,
      reasonCode: 'LATE',
      note: `事件 ${i}`
    })
    console.log(`  addEvent LATE #${i}: success=${res?.success}, data=${JSON.stringify(res?.data).slice(0, 100)}`)
  }

  // 查看历史
  const histRes = await c.callApi('eaa.history', testStudent)
  const histEvents = histRes?.data?.events || histRes?.data || []
  console.log(`  history count: ${Array.isArray(histEvents) ? histEvents.length : 0}`)
  if (Array.isArray(histEvents)) {
    histEvents.forEach((e, i) => {
      console.log(`    [${i}] reason=${e.reason_code}, delta=${e.score_delta}, note=${e.note}`)
    })
  }

  // 查看分数
  const scoreRes = await c.callApi('eaa.score', testStudent)
  console.log(`  score: ${JSON.stringify(scoreRes?.data).slice(0, 100)}`)

  // 清理
  await c.callApi('eaa.deleteStudent', testStudent, 'cleanup')

  // 5. 探查 EAA stats 返回结构
  console.log('\n=== EAA stats 返回结构 ===')
  const statsRes = await c.callApi('eaa.stats')
  console.log(`  stats: ${JSON.stringify(statsRes?.data || statsRes).slice(0, 400)}`)

  c.close()
}

main().catch(e => console.error(e))
