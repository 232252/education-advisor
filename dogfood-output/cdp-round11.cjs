// ============================================================
// 第十一轮：Chat 会话 + Cron 触发 + Agent 执行 + 并发压力
// 覆盖：
//   1. Chat 会话完整 CRUD（saveMessage/loadMessages/listSessions/deleteSession）
//   2. Cron runNow 实际触发
//   3. Agent runManual 多 agent 执行
//   4. 并发 IPC 压力测试（同时发起多个调用）
//   5. 长时间稳定性（5 次采样，间隔 15s）
//   6. Feishu status（无 secret 应优雅降级）
//   7. Settings get/set 功能（注意：get 不接受路径参数）
//   8. EAA 复合查询（仅限实际暴露的 IPC 方法）
// ============================================================
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 120000)
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

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + detail.slice(0, 150) : ''}`)
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 11: Chat + Cron Trigger + Agent Run + Concurrency')
  console.log('============================================================')

  // ============================================================
  // [1] Provider / API Key 状态
  // ============================================================
  console.log('\n[1] Provider / API Key')

  const providers = await c.callApi('ai.listProviders')
  record('ai.listProviders', Array.isArray(providers), `count=${providers?.length}`)

  // settings.get() 不接受路径参数，返回整个设置对象
  const allSettings = await c.callApi('settings.get')
  const defaultProvider = allSettings?.models?.defaultProvider
  const defaultModel = allSettings?.models?.defaultModel
  console.log(`    defaultProvider=${defaultProvider}, defaultModel=${defaultModel}`)

  // ai.testConnection 用 dummy key 应返回错误（不崩溃）
  const testConn = await c.callApi('ai.testConnection', 'openai', 'dummy-key-for-probing')
  record('ai.testConnection_no_key', testConn?.success === false || testConn?.error, `success=${testConn?.success}, error=${testConn?.error?.slice(0, 60) || 'none'}`)

  // ============================================================
  // [2] Chat 会话完整流程
  // ============================================================
  console.log('\n[2] Chat 会话完整流程')

  // chat 无 createSession — 通过 saveMessage 隐式创建
  // saveMessage 必填: role, content, timestamp(number)
  const sessionId = `r11-session-${Date.now()}`
  const ts = Date.now()

  const saveMsg = await c.callApi('chat.saveMessage', {
    sessionId,
    role: 'user',
    content: 'R11 测试消息',
    timestamp: ts,
    provider: 'openai',
    model: 'gpt-4'
  })
  record('chat.saveMessage', saveMsg?.success === true || saveMsg?.id, `success=${saveMsg?.success}, id=${saveMsg?.id}`)

  const loadMsgs = await c.callApi('chat.loadMessages', sessionId)
  const msgs = loadMsgs?.messages || loadMsgs?.data || loadMsgs
  record('chat.loadMessages', Array.isArray(msgs) && msgs.length > 0, `count=${Array.isArray(msgs) ? msgs.length : 0}`)

  const saveReply = await c.callApi('chat.saveMessage', {
    sessionId,
    role: 'assistant',
    content: 'R11 测试回复',
    timestamp: ts + 1000,
    provider: 'openai',
    model: 'gpt-4'
  })
  record('chat.saveReply', saveReply?.success === true || saveReply?.id, `success=${saveReply?.success}`)

  const loadMsgs2 = await c.callApi('chat.loadMessages', sessionId)
  const msgs2 = loadMsgs2?.messages || loadMsgs2?.data || loadMsgs2
  record('chat.loadMessages_after_reply', Array.isArray(msgs2) && msgs2.length === 2, `count=${Array.isArray(msgs2) ? msgs2.length : 0}`)

  const listSessions = await c.callApi('chat.listSessions')
  const sessions = listSessions?.sessions || listSessions?.data || listSessions
  record('chat.listSessions', Array.isArray(sessions), `count=${Array.isArray(sessions) ? sessions.length : 0}`)

  const delSession = await c.callApi('chat.deleteSession', sessionId)
  record('chat.deleteSession', delSession?.success === true || !delSession?.__error, `success=${delSession?.success}`)

  const listSessions2 = await c.callApi('chat.listSessions')
  const sessions2 = listSessions2?.sessions || listSessions2?.data || listSessions2
  const stillExists = Array.isArray(sessions2) && sessions2.some(s => s.id === sessionId || s.sessionId === sessionId)
  record('chat.deleteSession_verified', !stillExists, `stillExists=${stillExists}`)

  // ============================================================
  // [3] Cron runNow 触发
  // ============================================================
  console.log('\n[3] Cron runNow 触发')

  const cronTask = {
    name: `R11-trigger-${Date.now()}`,
    expression: '0 9 * * *',
    agentId: 'safety',
    prompt: 'R11 测试触发任务',
    enabled: true,
    modelTier: 'low_cost'
  }
  const cronAdd = await c.callApi('cron.add', cronTask)
  const cronId = cronAdd?.id || cronAdd?.data?.id || cronAdd
  record('cron.add', !!cronId, `id=${cronId}`)

  if (cronId) {
    const runNow = await c.callApi('cron.runNow', cronId)
    record('cron.runNow', runNow?.success === true || !runNow?.__error, `success=${runNow?.success}`)

    await sleep(3000)
    const logs = await c.callApi('cron.getLogs', cronId)
    const logData = logs?.logs || logs?.data || logs
    record('cron.getLogs_after_run', logData && !logs?.__error, `type=${typeof logData}`)

    const remove = await c.callApi('cron.remove', cronId)
    record('cron.remove', remove?.success === true || !remove?.__error, `success=${remove?.success}`)
  }

  // ============================================================
  // [4] Agent runManual 多 agent
  // ============================================================
  console.log('\n[4] Agent runManual')

  const testAgents = ['weekly-reporter', 'data-analyst']
  for (const agentId of testAgents) {
    const runRes = await c.callApi('agent.runManual', agentId, `R11 测试执行 ${agentId}`, [])
    record(`agent.runManual.${agentId}`, runRes?.success === true || !runRes?.__error, `success=${runRes?.success}, id=${runRes?.id}`)
  }

  await sleep(2000)

  for (const agentId of testAgents) {
    const hist = await c.callApi('agent.getHistory', agentId)
    const histData = hist?.history || hist?.data || hist
    record(`agent.getHistory.${agentId}`, histData && !hist?.__error, `count=${Array.isArray(histData) ? histData.length : 'unknown'}`)
  }

  // ============================================================
  // [5] 并发 IPC 压力测试
  // ============================================================
  console.log('\n[5] 并发 IPC 压力测试')

  const concurrentStart = Date.now()
  const concurrentCalls = []
  for (let i = 0; i < 10; i++) {
    concurrentCalls.push(c.callApi('eaa.listStudents'))
    concurrentCalls.push(c.callApi('eaa.codes'))
    concurrentCalls.push(c.callApi('ai.listProviders'))
  }
  const concurrentResults = await Promise.allSettled(concurrentCalls)
  const concurrentOk = concurrentResults.filter(r => r.status === 'fulfilled' && !r.value?.__error).length
  const concurrentDuration = Date.now() - concurrentStart
  record('concurrent.30_calls', concurrentOk === 30, `${concurrentOk}/30 succeeded, duration=${concurrentDuration}ms`)

  const serialStart = Date.now()
  let serialOk = 0
  for (let i = 0; i < 10; i++) {
    const r1 = await c.callApi('eaa.listStudents')
    if (r1 && !r1.__error) serialOk++
    const r2 = await c.callApi('eaa.codes')
    if (r2 && !r2.__error) serialOk++
    const r3 = await c.callApi('ai.listProviders')
    if (r3 && !r3.__error) serialOk++
  }
  const serialDuration = Date.now() - serialStart
  record('serial.30_calls', serialOk === 30, `${serialOk}/30 succeeded, duration=${serialDuration}ms`)
  record('concurrent_vs_serial', concurrentDuration < serialDuration, `concurrent=${concurrentDuration}ms, serial=${serialDuration}ms`)

  // ============================================================
  // [6] 长时间稳定性
  // ============================================================
  console.log('\n[6] 长时间稳定性 (5 次采样, 间隔 15s)')

  const samples = []
  for (let i = 0; i < 5; i++) {
    const heap = await c.eval(`JSON.stringify({
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit
    })`)
    const hash = await c.eval(`window.location.hash`)
    const tsLabel = new Date().toISOString()
    samples.push({ ts: tsLabel, heap, hash })
    console.log(`    [${i+1}/5] ${tsLabel} hash=${hash} heap=${heap}`)
    if (i < 4) await sleep(15000)
  }

  const heaps = samples.map(s => JSON.parse(s.heap).used)
  const heapGrowth = (heaps[heaps.length - 1] - heaps[0]) / heaps[0]
  record('stability.memory_growth', Math.abs(heapGrowth) < 0.3, `growth=${(heapGrowth * 100).toFixed(1)}%, samples=${JSON.stringify(heaps)}`)

  // ============================================================
  // [7] Feishu status
  // ============================================================
  console.log('\n[7] Feishu status')

  const feishuStatus = await c.callApi('feishu.status')
  record('feishu.status', feishuStatus && !feishuStatus?.__error, `hasToken=${feishuStatus?.hasToken || feishuStatus?.tokenCached || 'unknown'}`)

  const feishuTest = await c.callApi('feishu.test', 'dummy-app-id')
  record('feishu.test_no_secret', feishuTest?.__error || feishuTest?.success === false, `error=${feishuTest?.__error?.slice(0, 60) || feishuTest?.error || 'none'}`)

  // ============================================================
  // [8] Settings get/set
  // ============================================================
  console.log('\n[8] Settings get/set')

  // settings.get() 返回整个对象
  const beforeSettings = await c.callApi('settings.get')
  const beforeLog = beforeSettings?.general?.logLevel
  console.log(`    beforeLog=${beforeLog}`)

  // settings.set(path, value) — 接受 dotted path
  await c.callApi('settings.set', 'general.logLevel', 'debug')
  const afterSetSettings = await c.callApi('settings.get')
  const afterSetLog = afterSetSettings?.general?.logLevel
  record('settings.set_debug', afterSetLog === 'debug', `value=${afterSetLog}`)

  // 恢复原始值
  if (beforeLog && beforeLog !== afterSetLog) {
    await c.callApi('settings.set', 'general.logLevel', beforeLog)
    const afterRestoreSettings = await c.callApi('settings.get')
    const afterRestoreLog = afterRestoreSettings?.general?.logLevel
    record('settings.restore_value', afterRestoreLog === beforeLog, `restored=${afterRestoreLog}`)
  } else {
    record('settings.restore_value', true, 'no restore needed')
  }

  // 测试 set 其他 key
  const beforeTheme = beforeSettings?.general?.theme
  await c.callApi('settings.set', 'general.theme', 'light')
  const afterThemeSettings = await c.callApi('settings.get')
  const afterTheme = afterThemeSettings?.general?.theme
  record('settings.set_theme', afterTheme === 'light', `value=${afterTheme}`)
  // 恢复
  await c.callApi('settings.set', 'general.theme', beforeTheme || 'dark')

  // ============================================================
  // [9] EAA 实际暴露的查询方法
  // ============================================================
  console.log('\n[9] EAA 查询方法')

  // eaa.search
  const searchRes = await c.callApi('eaa.search', 'LATE')
  record('eaa.search', searchRes?.success === true || Array.isArray(searchRes?.data?.events), `success=${searchRes?.success}, events=${searchRes?.data?.events?.length || 0}`)

  // eaa.listStudents — data.students
  const studentsRes = await c.callApi('eaa.listStudents')
  const students = studentsRes?.data?.students || []
  record('eaa.listStudents', studentsRes?.success === true && Array.isArray(students), `count=${students.length}`)

  // eaa.score（第一个学生）
  if (students.length > 0) {
    const firstStudent = students[0]
    const studentName = firstStudent?.name
    const scoreRes = await c.callApi('eaa.score', studentName)
    record('eaa.score', scoreRes?.success === true || typeof scoreRes?.data?.score === 'number', `success=${scoreRes?.success}, score=${scoreRes?.data?.score}`)
  }

  // eaa.ranking
  const rankingRes = await c.callApi('eaa.ranking', 10)
  record('eaa.ranking', rankingRes?.success === true || Array.isArray(rankingRes?.data), `success=${rankingRes?.success}`)

  // eaa.stats
  const statsRes = await c.callApi('eaa.stats')
  record('eaa.stats', statsRes?.success === true || typeof statsRes?.data === 'object', `success=${statsRes?.success}`)

  // eaa.summary
  const summaryRes = await c.callApi('eaa.summary')
  record('eaa.summary', summaryRes?.success === true || typeof summaryRes?.data === 'object', `success=${summaryRes?.success}`)

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n============================================================')
  console.log('ROUND 11 SUMMARY')
  console.log('============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  results.filter(r => !r.ok).forEach(r => {
    console.log(`  FAIL: ${r.name} :: ${r.detail}`)
  })
  console.log(`\nTotal: ${passed} ok, ${failed} fail, ${results.length} tests`)

  fs.writeFileSync(
    'c:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round11.json',
    JSON.stringify({ round: 11, timestamp: new Date().toISOString(), results, passed, failed, total: results.length }, null, 2)
  )

  c.close()
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
