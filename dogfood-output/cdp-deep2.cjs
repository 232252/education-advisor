// =============================================================
// 第三轮补充:深度交互测试(修正数据结构后)
// 覆盖: Agent 详情 / Cron 日志 / Class 完整 CRUD / AI 模型 / Log 读取
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
    if (!page) throw new Error('No page target found')
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
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} timeout`))
        }
      }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    }
    return r.result.value
  }
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(category, name, result) {
  if (result === null || result === undefined) result = { __ok_null: true }
  const entry = {
    category, name,
    ok: !result.__error,
    error: result.__error || null,
    data: result.__error ? null : result,
  }
  results.push(entry)
  console.log(`[${entry.ok ? 'OK' : 'FAIL'}] ${category}/${name}${entry.error ? ' :: ' + entry.error.slice(0, 120) : ''}`)
  return entry
}

async function main() {
  const cdp = new CDPClient()
  await cdp.connect()
  console.log('CDP connected. Supplementary deep tests...\n')

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
  // 1. Agent 完整测试(使用正确的数组结构)
  // =========================================================
  console.log('\n=== 1. Agent 完整测试 ===')
  const agentList = await callApi('agent.list')
  if (!agentList.__error && Array.isArray(agentList)) {
    console.log(`  Found ${agentList.length} agents`)
    // 测试前 3 个 agent 的详情
    for (const a of agentList.slice(0, 3)) {
      record('agent', `get.${a.id}`, await callApi('agent.get', a.id))
      record('agent', `getSoul.${a.id}`, await callApi('agent.getSoul', a.id))
      record('agent', `getRules.${a.id}`, await callApi('agent.getRules', a.id))
      record('agent', `getHistory.${a.id}`, await callApi('agent.getHistory', a.id))
    }

    // toggle 测试:对最后一个 agent 切换 enabled(然后恢复)
    if (agentList.length > 0) {
      const lastAgent = agentList[agentList.length - 1]
      const originalEnabled = lastAgent.enabled
      record('agent', `toggle.${lastAgent.id}.off`, await callApi('agent.toggle', lastAgent.id, false))
      record('agent', `toggle.${lastAgent.id}.restore`, await callApi('agent.toggle', lastAgent.id, originalEnabled))
    }
  }

  // =========================================================
  // 2. Cron 完整测试
  // =========================================================
  console.log('\n=== 2. Cron 完整测试 ===')
  const cronList = await callApi('cron.list')
  if (!cronList.__error && Array.isArray(cronList)) {
    console.log(`  Found ${cronList.length} cron tasks`)
    // 全局日志
    record('cron', 'getLogs.all', await callApi('cron.getLogs'))

    // 前 2 个任务的日志
    for (const t of cronList.slice(0, 2)) {
      record('cron', `getLogs.${t.id}`, await callApi('cron.getLogs', t.id))
    }

    // toggle 测试:对第一个任务切换(然后恢复)
    if (cronList.length > 0) {
      const t = cronList[0]
      const originalEnabled = t.enabled
      record('cron', `toggle.${t.id}`, await callApi('cron.toggle', t.id, !originalEnabled))
      record('cron', `toggle.${t.id}.restore`, await callApi('cron.toggle', t.id, originalEnabled))
    }
  }

  // =========================================================
  // 3. Class 完整 CRUD(使用 class_id)
  // =========================================================
  console.log('\n=== 3. Class 完整 CRUD ===')
  const testClassId = 'TEST_' + Date.now()
  const testClassName = '自动化测试班级'
  record('class', 'create', await callApi('class.create', {
    class_id: testClassId,
    name: testClassName,
    grade: '2026',
    note: '自动化测试创建',
  }))

  // 获取列表找到新创建的班级
  const classList = await callApi('class.list')
  let newClassEntityId = null
  if (!classList.__error && classList.data) {
    const found = classList.data.find((c) => c.class_id === testClassId)
    if (found) newClassEntityId = found.id
  }

  if (newClassEntityId) {
    console.log(`  Created class entity id = ${newClassEntityId}`)
    record('class', 'update', await callApi('class.update', newClassEntityId, { note: '更新后的备注' }))
    record('class', 'archive', await callApi('class.archive', newClassEntityId))
    record('class', 'list_after_archive', await callApi('class.list'))
    record('class', 'restore', await callApi('class.restore', newClassEntityId))
    record('class', 'delete', await callApi('class.delete', newClassEntityId))
    record('class', 'list_after_delete', await callApi('class.list'))
  } else {
    record('class', 'find_created', { __error: 'Created class not found in list' })
  }

  // =========================================================
  // 4. AI 模型列表
  // =========================================================
  console.log('\n=== 4. AI 模型列表 ===')
  const providers = await callApi('ai.listProviders')
  if (!providers.__error && Array.isArray(providers)) {
    // 测试有 API key 和无 API key 的 provider
    for (const p of providers.slice(0, 5)) {
      record('ai', `listModels.${p.id}`, await callApi('ai.listModels', p.id))
    }
  }

  // =========================================================
  // 5. Log 读取/过滤/搜索
  // =========================================================
  console.log('\n=== 5. Log 读取/过滤/搜索 ===')
  const logList = await callApi('log.list')
  if (!logList.__error && Array.isArray(logList)) {
    console.log(`  Found ${logList.length} log files`)
    // 测试前 3 个日志文件
    for (const log of logList.slice(0, 3)) {
      const logName = log.name
      record('log', `read.${logName}`, await callApi('log.read', logName, 20))
      record('log', `filter.${logName}`, await callApi('log.filter', logName, ['error', 'warn'], 20))
      record('log', `search.${logName}`, await callApi('log.search', logName, 'error', 10))
    }
  }

  // =========================================================
  // 6. EAA 导出 HTML 仪表盘
  // =========================================================
  console.log('\n=== 6. EAA HTML 仪表盘 ===')
  record('eaa', 'export.html', await callApi('eaa.export', 'html'))
  record('eaa', 'dashboard', await callApi('eaa.dashboard'))

  // =========================================================
  // 7. EAA 反匿名化测试(privacy 已锁定,测试错误处理)
  // =========================================================
  console.log('\n=== 7. Privacy 错误处理 ===')
  // 隐私引擎已锁定,deanonymize 应该返回错误
  record('privacy', 'deanonymize_after_lock', await callApi('privacy.deanonymize', '测试文本'))
  record('privacy', 'anonymize_after_lock', await callApi('privacy.anonymize', '测试文本'))

  // =========================================================
  // 8. EAA revert 测试(需要有效事件 ID)
  // =========================================================
  console.log('\n=== 8. EAA revert 测试 ===')
  // 先添加一个事件,获取事件 ID,然后 revert
  const revertTestStudent = '__revert_test_' + Date.now()
  record('eaa', 'addStudent_for_revert', await callApi('eaa.addStudent', revertTestStudent))
  const addResult = await callApi('eaa.addEvent', {
    studentName: revertTestStudent,
    reasonCode: 'LATE',
    note: '测试撤销',
  })
  record('eaa', 'addEvent_for_revert', addResult)

  // 获取历史找到事件 ID
  const histResult = await callApi('eaa.history', revertTestStudent)
  let eventId = null
  if (!histResult.__error && histResult) {
    const events = histResult.events || histResult.data?.events || (Array.isArray(histResult) ? histResult : [])
    if (Array.isArray(events) && events.length > 0) {
      eventId = events[0].id || events[0].event_id
    }
  }

  if (eventId) {
    record('eaa', 'revert', await callApi('eaa.revertEvent', eventId, '测试撤销'))
  } else {
    record('eaa', 'revert', { __error: 'No event ID found in history' })
  }

  // 清理
  record('eaa', 'deleteStudent_after_revert', await callApi('eaa.deleteStudent', revertTestStudent, 'cleanup'))

  // =========================================================
  // 汇总
  // =========================================================
  console.log('\n\n============================================================')
  console.log('SUPPLEMENTARY DEEP TEST SUMMARY')
  console.log('============================================================')
  const byCategory = {}
  let totalOk = 0, totalFail = 0
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { ok: 0, fail: 0, fails: [] }
    if (r.ok) { byCategory[r.category].ok++; totalOk++ }
    else { byCategory[r.category].fail++; byCategory[r.category].fails.push(r.name + ': ' + (r.error || '').slice(0, 80)); totalFail++ }
  }
  for (const [cat, s] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${s.ok} ok, ${s.fail} fail`)
    for (const f of s.fails) console.log(`    - ${f}`)
  }
  console.log(`\nTotal: ${totalOk} ok, ${totalFail} fail, ${results.length} tests`)

  const fs = require('fs')
  const outPath = 'C:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round3-supplement.json'
  fs.writeFileSync(outPath, JSON.stringify({
    summary: { total: results.length, ok: totalOk, fail: totalFail },
    byCategory,
    results,
  }, null, 2))
  console.log(`Report: ${outPath}`)

  cdp.close()
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
