// =============================================================
// 第三轮补充2:修复 class_id 和 addEvent delta 参数
// =============================================================
const http = require('http')
const WebSocket = require('ws')
const CDP_PORT = 9222

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('timeout')))
  })
}

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find((t) => t.type === 'page')
    if (!page) throw new Error('No page target')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => this.ws.on('open', r))
    this.id = 0
    this.pending = new Map()
    this.ws.on('message', (msg) => {
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timeout`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(category, name, result) {
  if (result === null || result === undefined) result = { __ok_null: true }
  const entry = { category, name, ok: !result.__error, error: result.__error || null, data: result.__error ? null : result }
  results.push(entry)
  console.log(`[${entry.ok ? 'OK' : 'FAIL'}] ${category}/${name}${entry.error ? ' :: ' + entry.error.slice(0, 150) : ''}`)
  return entry
}

async function main() {
  const cdp = new CDPClient()
  await cdp.connect()
  console.log('CDP connected. Fix-and-retest...\n')

  async function callApi(path, ...args) {
    const safeExpr = `(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      if (typeof obj !== 'function') throw new Error('API not a function')
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`
    return cdp.eval(safeExpr)
  }

  // =========================================================
  // 1. Class 完整 CRUD(使用合法的 class_id:字母数字+连字符)
  // =========================================================
  console.log('=== 1. Class 完整 CRUD ===')
  const testClassId = 'TEST-' + Date.now()
  const testClassName = '自动化测试班级'
  console.log(`  class_id = ${testClassId}`)
  record('class', 'create', await callApi('class.create', {
    class_id: testClassId,
    name: testClassName,
    grade: '2026',
    note: '自动化测试创建',
  }))

  const classList = await callApi('class.list')
  let newClassEntityId = null
  if (!classList.__error && classList.data) {
    const found = classList.data.find((c) => c.class_id === testClassId)
    if (found) newClassEntityId = found.id
  }
  console.log(`  entity id = ${newClassEntityId}`)

  if (newClassEntityId) {
    record('class', 'update', await callApi('class.update', newClassEntityId, { note: '更新后的备注' }))
    record('class', 'archive', await callApi('class.archive', newClassEntityId))
    record('class', 'list_after_archive', await callApi('class.list'))
    record('class', 'restore', await callApi('class.restore', newClassEntityId))
    record('class', 'delete', await callApi('class.delete', newClassEntityId))
    record('class', 'list_after_delete', await callApi('class.list'))
  } else {
    // 检查 create 返回的 data 里是否有 id
    const createRes = results.find(r => r.category === 'class' && r.name === 'create')
    console.log('  create result:', JSON.stringify(createRes?.data).slice(0, 300))
    record('class', 'find_created', { __error: 'Created class not found in list' })
  }

  // =========================================================
  // 2. EAA revert(不传 delta,让 EAA 用 reason code 默认值)
  // =========================================================
  console.log('\n=== 2. EAA revert(不传 delta) ===')
  const revertTestStudent = '__revert_test_' + Date.now()
  record('eaa', 'addStudent_for_revert', await callApi('eaa.addStudent', revertTestStudent))

  // 不传 delta,让 EAA 用 LATE 的默认值 -2.0
  const addResult = await callApi('eaa.addEvent', {
    studentName: revertTestStudent,
    reasonCode: 'LATE',
    note: '测试撤销',
  })
  record('eaa', 'addEvent_for_revert', addResult)

  // 获取历史找到事件 ID
  const histResult = await callApi('eaa.history', revertTestStudent)
  console.log('  history result:', JSON.stringify(histResult).slice(0, 400))

  let eventId = null
  if (!histResult.__error && histResult) {
    // 尝试多种结构
    const events = histResult.events || histResult.data?.events || histResult.data || (Array.isArray(histResult) ? histResult : [])
    if (Array.isArray(events) && events.length > 0) {
      eventId = events[0].id || events[0].event_id || events[0].uuid
    }
  }
  console.log(`  event id = ${eventId}`)

  if (eventId) {
    record('eaa', 'revert', await callApi('eaa.revertEvent', eventId, '测试撤销'))
  } else {
    record('eaa', 'revert', { __error: 'No event ID found in history' })
  }

  // 清理
  record('eaa', 'deleteStudent_after_revert', await callApi('eaa.deleteStudent', revertTestStudent, 'cleanup'))

  // =========================================================
  // 3. 额外:EAA 带正确 delta 的事件
  // =========================================================
  console.log('\n=== 3. EAA 带正确 delta 的事件 ===')
  const deltaTestStudent = '__delta_test_' + Date.now()
  await callApi('eaa.addStudent', deltaTestStudent)

  // LATE 的 delta 是 -2,传 -2 应该成功
  record('eaa', 'addEvent.LATE.with_correct_delta', await callApi('eaa.addEvent', {
    studentName: deltaTestStudent,
    reasonCode: 'LATE',
    delta: -2,
    note: '迟到扣分',
  }))

  // ACTIVITY_PARTICIPATION 的 delta 是 1,传 1 应该成功
  record('eaa', 'addEvent.ACTIVITY.with_correct_delta', await callApi('eaa.addEvent', {
    studentName: deltaTestStudent,
    reasonCode: 'ACTIVITY_PARTICIPATION',
    delta: 1,
    note: '活动参与加分',
  }))

  // 不传 delta(用默认值)
  record('eaa', 'addEvent.LATE.no_delta', await callApi('eaa.addEvent', {
    studentName: deltaTestStudent,
    reasonCode: 'SLEEP_IN_CLASS',
    note: '课堂睡觉',
  }))

  // 查看分数变化
  record('eaa', 'score_after_events', await callApi('eaa.score', deltaTestStudent))

  // 清理
  await callApi('eaa.deleteStudent', deltaTestStudent, 'cleanup')

  // =========================================================
  // 汇总
  // =========================================================
  console.log('\n\n============================================================')
  console.log('FIX-AND-RETEST SUMMARY')
  console.log('============================================================')
  let ok = 0, fail = 0
  for (const r of results) { if (r.ok) ok++; else { fail++; console.log(`  FAIL: ${r.category}/${r.name} :: ${r.error?.slice(0, 100)}`) } }
  console.log(`\nTotal: ${ok} ok, ${fail} fail, ${results.length} tests`)

  const fs = require('fs')
  fs.writeFileSync('C:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round3-fix.json', JSON.stringify({ summary: { ok, fail, total: results.length }, results }, null, 2))

  cdp.close()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
