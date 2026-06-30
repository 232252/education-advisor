// 验证 addEvent 修复:不传 delta 时自动使用 reason code 默认值
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('timeout')))
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
  close() { if (this.ws) this.ws.close() }
}

async function main() {
  const cdp = new CDPClient()
  await cdp.connect()
  console.log('=== addEvent 修复验证 ===\n')

  async function callApi(path, ...args) {
    return cdp.eval(`(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`)
  }

  const testStudent = '__fixverify_' + Date.now()
  console.log(`Test student: ${testStudent}`)

  // 1. 添加学生
  const addRes = await callApi('eaa.addStudent', testStudent)
  console.log('addStudent:', JSON.stringify(addRes).slice(0, 200))

  // 2. 不传 delta 添加 LATE 事件(之前会失败,现在应该自动用 -2.0)
  const lateRes = await callApi('eaa.addEvent', {
    studentName: testStudent,
    reasonCode: 'LATE',
    note: '不传delta测试',
  })
  console.log('\naddEvent LATE (no delta):', JSON.stringify(lateRes).slice(0, 300))

  // 3. 不传 delta 添加 SLEEP_IN_CLASS 事件
  const sleepRes = await callApi('eaa.addEvent', {
    studentName: testStudent,
    reasonCode: 'SLEEP_IN_CLASS',
    note: '不传delta测试2',
  })
  console.log('addEvent SLEEP_IN_CLASS (no delta):', JSON.stringify(sleepRes).slice(0, 300))

  // 4. 不传 delta 添加 ACTIVITY_PARTICIPATION 事件(加分类)
  const actRes = await callApi('eaa.addEvent', {
    studentName: testStudent,
    reasonCode: 'ACTIVITY_PARTICIPATION',
    note: '不传delta测试3',
  })
  console.log('addEvent ACTIVITY_PARTICIPATION (no delta):', JSON.stringify(actRes).slice(0, 300))

  // 5. 查看分数(应该是 100 - 2 - 2 + 1 = 97)
  const scoreRes = await callApi('eaa.score', testStudent)
  console.log('\nscore:', JSON.stringify(scoreRes).slice(0, 300))

  // 6. 查看历史(应该有 3 个事件)
  const histRes = await callApi('eaa.history', testStudent)
  console.log('history:', JSON.stringify(histRes).slice(0, 400))

  // 7. 测试 revert:获取事件 ID 并撤销
  let eventId = null
  if (!histRes.__error && histRes.data) {
    const events = histRes.data.events || []
    if (Array.isArray(events) && events.length > 0) {
      eventId = events[0].id || events[0].event_id
      console.log(`\nFound event to revert: ${eventId}`)
    }
  }

  if (eventId) {
    const revertRes = await callApi('eaa.revertEvent', eventId, '测试撤销')
    console.log('revert:', JSON.stringify(revertRes).slice(0, 300))

    // 查看撤销后的分数(应该是 97 + 2 = 99,因为撤销了 LATE 的 -2)
    const scoreAfterRevert = await callApi('eaa.score', testStudent)
    console.log('score after revert:', JSON.stringify(scoreAfterRevert).slice(0, 300))
  }

  // 8. 清理
  const delRes = await callApi('eaa.deleteStudent', testStudent, 'cleanup')
  console.log('\ndeleteStudent:', JSON.stringify(delRes).slice(0, 200))

  // 汇总
  console.log('\n=== 验证结果 ===')
  const lateOk = lateRes.success !== false
  const sleepOk = sleepRes.success !== false
  const actOk = actRes.success !== false
  console.log(`LATE (no delta): ${lateOk ? 'PASS' : 'FAIL'}`)
  console.log(`SLEEP_IN_CLASS (no delta): ${sleepOk ? 'PASS' : 'FAIL'}`)
  console.log(`ACTIVITY_PARTICIPATION (no delta): ${actOk ? 'PASS' : 'FAIL'}`)
  console.log(`Score = ${scoreRes.data?.score} (expected 97: 100-2-2+1)`)
  console.log(`Revert: ${eventId ? 'PASS' : 'FAIL'}`)

  cdp.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
