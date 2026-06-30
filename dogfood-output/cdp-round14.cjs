// ============================================================
// 第十四轮：深度压力测试 + 长时间稳定性 + 安全审计 + 数据完整性
// 覆盖：
//   1. EAA 批量操作压力（100 次连续 addStudent + deleteStudent）
//   2. Agent 批量 toggle 压力（18 个 Agent 循环 toggle）
//   3. 并发 EAA 操作（同时 addEvent + score + history）
//   4. 长时间内存监控（10 次采样，间隔 10s）
//   5. 深度安全审计（SQL 注入、命令注入、路径穿越变体）
//   6. 边界输入（超长字符串、Unicode、特殊字符）
//   7. 数据完整性（EAA stats 前后一致性）
//   8. IPC 错误恢复（无效参数后系统是否继续正常工作）
// ============================================================
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

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + detail.slice(0, 120) : ''}`)
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 14: Stress + Stability + Security + Data Integrity')
  console.log('============================================================')

  // ============================================================
  // [1] EAA 批量操作压力测试
  // ============================================================
  console.log('\n[1] EAA 批量操作压力 (50 次 addStudent + deleteStudent)')

  const stressStart = Date.now()
  let addOk = 0
  let deleteOk = 0
  const stressStudents = []

  // 批量添加 50 个学生
  for (let i = 0; i < 50; i++) {
    const name = `R14Stress_${String(i).padStart(3, '0')}_${Date.now()}`
    stressStudents.push(name)
    const res = await c.callApi('eaa.addStudent', name)
    if (res?.success === true || !res?.__error) addOk++
  }
  record('stress.addStudent_50', addOk === 50, `${addOk}/50 succeeded`)

  // 验证学生数量增加
  const listAfterAdd = await c.callApi('eaa.listStudents')
  const studentsAfterAdd = listAfterAdd?.data?.students || []
  const stressStudentsFound = stressStudents.filter(name =>
    studentsAfterAdd.some(s => s.name === name || s.id === name)
  ).length
  record('stress.addStudent_verified', stressStudentsFound === 50, `${stressStudentsFound}/50 found in list`)

  // 批量删除 50 个学生
  for (const name of stressStudents) {
    const res = await c.callApi('eaa.deleteStudent', name, 'R14 压力测试清理')
    if (res?.success === true || !res?.__error) deleteOk++
  }
  record('stress.deleteStudent_50', deleteOk === 50, `${deleteOk}/50 succeeded`)

  // 验证学生已删除
  const listAfterDelete = await c.callApi('eaa.listStudents')
  const studentsAfterDelete = listAfterDelete?.data?.students || []
  const stressStudentsRemaining = stressStudents.filter(name =>
    studentsAfterDelete.some(s => s.name === name || s.id === name)
  ).length
  record('stress.deleteStudent_verified', stressStudentsRemaining === 0, `${stressStudentsRemaining}/50 remaining`)

  const stressDuration = Date.now() - stressStart
  record('stress.duration', stressDuration < 60000, `${stressDuration}ms for 100 ops`)
  console.log(`    压力测试耗时: ${stressDuration}ms (${(stressDuration / 100).toFixed(0)}ms/op)`)

  // ============================================================
  // [2] Agent 批量 toggle 压力
  // ============================================================
  console.log('\n[2] Agent 批量 toggle 压力')

  const agentList = await c.callApi('agent.list')
  const agents = agentList?.data?.agents || agentList?.agents || agentList || []
  const agentIds = Array.isArray(agents) ? agents.map(a => a.id).filter(Boolean) : []

  let toggleOk = 0
  const originalStates = new Map()

  // 记录原始状态
  for (const id of agentIds) {
    const agent = await c.callApi('agent.get', id)
    originalStates.set(id, agent?.enabled)
  }

  // 批量 toggle（先全部禁用，再全部启用）
  for (const id of agentIds) {
    const res = await c.callApi('agent.toggle', id, false)
    if (res?.success === true || !res?.__error) toggleOk++
  }
  record('stress.agent_toggle_disable', toggleOk === agentIds.length, `${toggleOk}/${agentIds.length}`)

  let toggleBackOk = 0
  for (const id of agentIds) {
    const res = await c.callApi('agent.toggle', id, true)
    if (res?.success === true || !res?.__error) toggleBackOk++
  }
  record('stress.agent_toggle_enable', toggleBackOk === agentIds.length, `${toggleBackOk}/${agentIds.length}`)

  // 恢复原始状态
  for (const [id, enabled] of originalStates) {
    if (enabled !== true) {
      await c.callApi('agent.toggle', id, enabled)
    }
  }

  // ============================================================
  // [3] 并发 EAA 操作
  // ============================================================
  console.log('\n[3] 并发 EAA 操作')

  const concurrentStart = Date.now()
  const concurrentOps = []

  // 同时发起多种 EAA 操作
  for (let i = 0; i < 20; i++) {
    concurrentOps.push(c.callApi('eaa.listStudents'))
    concurrentOps.push(c.callApi('eaa.ranking', 10))
    concurrentOps.push(c.callApi('eaa.stats'))
    concurrentOps.push(c.callApi('eaa.codes'))
    concurrentOps.push(c.callApi('eaa.info'))
  }

  const concurrentResults = await Promise.allSettled(concurrentOps)
  const concurrentOk = concurrentResults.filter(r =>
    r.status === 'fulfilled' && !r.value?.__error
  ).length
  const concurrentDuration = Date.now() - concurrentStart

  record('concurrent.100_ops', concurrentOk === 100, `${concurrentOk}/100 succeeded, ${concurrentDuration}ms`)
  console.log(`    100 并发操作: ${concurrentDuration}ms (avg ${(concurrentDuration / 100).toFixed(0)}ms/op)`)

  // ============================================================
  // [4] 长时间内存监控 (10 次采样, 间隔 10s)
  // ============================================================
  console.log('\n[4] 长时间内存监控 (10 次采样, 间隔 10s)')

  const memorySamples = []
  for (let i = 0; i < 10; i++) {
    const memInfo = await c.eval(`JSON.stringify({
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit,
      domNodes: document.querySelectorAll('*').length,
      timestamp: Date.now()
    })`)
    const mem = JSON.parse(memInfo)
    memorySamples.push(mem)
    console.log(`    [${i + 1}/10] used=${(mem.used / 1024 / 1024).toFixed(1)}MB, dom=${mem.domNodes} nodes`)
    if (i < 9) await sleep(10000)
  }

  const firstUsed = memorySamples[0].used
  const lastUsed = memorySamples[memorySamples.length - 1].used
  const memoryGrowth = ((lastUsed - firstUsed) / firstUsed) * 100
  record('stability.memory_growth', Math.abs(memoryGrowth) < 20, `growth=${memoryGrowth.toFixed(1)}%`)
  record('stability.dom_nodes_stable',
    Math.abs(memorySamples[0].domNodes - memorySamples[9].domNodes) < 50,
    `start=${memorySamples[0].domNodes}, end=${memorySamples[9].domNodes}`)
  console.log(`    内存增长: ${memoryGrowth.toFixed(1)}% (${(firstUsed / 1024 / 1024).toFixed(1)}MB → ${(lastUsed / 1024 / 1024).toFixed(1)}MB)`)

  // ============================================================
  // [5] 深度安全审计
  // ============================================================
  console.log('\n[5] 深度安全审计')

  // 5.1 SQL 注入变体
  const sqlInjections = [
    "'; DROP TABLE students; --",
    "' OR '1'='1",
    "'; INSERT INTO students VALUES('hacker'); --",
    "' UNION SELECT * FROM sqlite_master --",
    "admin'--",
    "1;1;1;1",
  ]
  let sqlInjectionBlocked = 0
  for (const payload of sqlInjections) {
    const res = await c.callApi('eaa.addStudent', payload)
    if (res?.__error || res?.success === false) sqlInjectionBlocked++
    else {
      // 如果成功了，说明被当作合法名字（EAA 会 sanitize），清理
      await c.callApi('eaa.deleteStudent', payload, 'security cleanup')
    }
  }
  record('security.sql_injection', sqlInjectionBlocked >= 4, `${sqlInjectionBlocked}/${sqlInjections.length} blocked`)

  // 5.2 命令注入变体
  const cmdInjections = [
    'test; rm -rf /',
    'test && cat /etc/passwd',
    'test | whoami',
    'test$(whoami)',
    'test`whoami`',
    'test\x00evil',
    'test\nwhoami',
    'test\r\nwhoami',
  ]
  let cmdInjectionBlocked = 0
  for (const payload of cmdInjections) {
    const res = await c.callApi('eaa.addStudent', payload)
    if (res?.__error || res?.success === false) cmdInjectionBlocked++
    else {
      await c.callApi('eaa.deleteStudent', payload, 'security cleanup')
    }
  }
  record('security.cmd_injection', cmdInjectionBlocked >= 6, `${cmdInjectionBlocked}/${cmdInjections.length} blocked`)

  // 5.3 路径穿越变体
  const pathTraversals = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32',
    '....//....//etc/passwd',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '..%252f..%252fetc%252fpasswd',
  ]
  let pathTraversalBlocked = 0
  for (const payload of pathTraversals) {
    const res = await c.callApi('skill.save', payload, 'test')
    if (res?.__error || res?.success === false) pathTraversalBlocked++
    else {
      await c.callApi('skill.delete', payload)
    }
  }
  record('security.path_traversal', pathTraversalBlocked >= 4, `${pathTraversalBlocked}/${pathTraversals.length} blocked`)

  // 5.4 超长输入
  const longString = 'A'.repeat(10000)
  const longRes = await c.callApi('eaa.addStudent', longString)
  record('security.long_input_blocked', longRes?.__error || longRes?.success === false, `blocked=${!!longRes?.__error}`)
  if (!longRes?.__error && longRes?.success !== false) {
    await c.callApi('eaa.deleteStudent', longString, 'cleanup')
  }

  // 5.5 Unicode 和特殊字符
  const specialChars = ['测试🎉', '学生\x00', '<script>alert(1)</script>', '"; DROP TABLE--', '\x00\x01\x02']
  let specialHandled = 0
  for (const payload of specialChars) {
    const res = await c.callApi('eaa.addStudent', payload)
    if (res?.__error || res?.success === false) specialHandled++
    else {
      await c.callApi('eaa.deleteStudent', payload, 'cleanup')
    }
  }
  record('security.special_chars', specialHandled >= 3, `${specialHandled}/${specialChars.length} handled`)

  // 5.6 openExternal 安全
  const maliciousUrls = [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'smb://evil/share',
  ]
  let urlBlocked = 0
  for (const url of maliciousUrls) {
    const res = await c.callApi('sys.openExternal', url)
    if (res?.__error || res?.success === false) urlBlocked++
  }
  record('security.malicious_urls', urlBlocked >= 4, `${urlBlocked}/${maliciousUrls.length} blocked`)

  // ============================================================
  // [6] 数据完整性 — stats 前后一致性
  // ============================================================
  console.log('\n[6] 数据完整性')

  const statsBefore = await c.callApi('eaa.stats')
  const statsBeforeData = statsBefore?.data || statsBefore

  // 执行一些操作（add + delete 学生，不改变净数量）
  const integrityStudent = `R14Integrity_${Date.now()}`
  await c.callApi('eaa.addStudent', integrityStudent)
  await c.callApi('eaa.deleteStudent', integrityStudent, 'integrity check')

  // stats 应该与操作前一致
  const statsAfter = await c.callApi('eaa.stats')
  const statsAfterData = statsAfter?.data || statsAfter

  // 学生数量应该相同（add then delete = net 0）
  const studentCountBefore = statsBeforeData?.student_count || statsBeforeData?.students || statsBeforeData?.total
  const studentCountAfter = statsAfterData?.student_count || statsAfterData?.students || statsAfterData?.total
  record('integrity.student_count', studentCountBefore === studentCountAfter, `before=${studentCountBefore}, after=${studentCountAfter}`)

  // validate 应该通过
  const validateRes = await c.callApi('eaa.validate')
  record('integrity.validate', validateRes?.success === true, `success=${validateRes?.success}`)

  // doctor 应该通过
  const doctorRes = await c.callApi('eaa.doctor')
  record('integrity.doctor', doctorRes?.success === true, `success=${doctorRes?.success}`)

  // ============================================================
  // [7] IPC 错误恢复 — 无效参数后系统是否继续正常
  // ============================================================
  console.log('\n[7] IPC 错误恢复')

  // 发送一系列无效参数
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

  let errorHandled = 0
  for (const [api, arg] of invalidCalls) {
    const res = await c.callApi(api, arg)
    // 应该返回错误而不是崩溃
    if (res?.__error || res?.success === false) errorHandled++
  }
  record('recovery.invalid_params_handled', errorHandled === invalidCalls.length, `${errorHandled}/${invalidCalls.length} handled gracefully`)

  // 错误后系统应该继续正常工作
  const recoveryCheck = await c.callApi('eaa.listStudents')
  record('recovery.system_still_works', recoveryCheck?.success === true && !recoveryCheck?.__error, `success=${recoveryCheck?.success}`)

  const recoveryCheck2 = await c.callApi('agent.list')
  record('recovery.agent_list_works', recoveryCheck2 && !recoveryCheck2?.__error, `success=${!recoveryCheck2?.__error}`)

  // ============================================================
  // [8] EAA 事件批量操作 + 分数验证
  // ============================================================
  console.log('\n[8] EAA 事件批量操作 + 分数验证')

  const batchStudent = `R14Batch_${Date.now()}`
  await c.callApi('eaa.addStudent', batchStudent)

  // 批量添加 10 个事件
  const eventTypes = [
    { reasonCode: 'LATE', expectedDelta: -2 },
    { reasonCode: 'LATE', expectedDelta: -2 },
    { reasonCode: 'LATE', expectedDelta: -2 },
    { reasonCode: 'LATE', expectedDelta: -2 },
    { reasonCode: 'LATE', expectedDelta: -2 },
    { reasonCode: 'ACTIVITY_PARTICIPATION', expectedDelta: 1 },
    { reasonCode: 'ACTIVITY_PARTICIPATION', expectedDelta: 1 },
    { reasonCode: 'ACTIVITY_PARTICIPATION', expectedDelta: 1 },
    { reasonCode: 'ACTIVITY_PARTICIPATION', expectedDelta: 1 },
    { reasonCode: 'ACTIVITY_PARTICIPATION', expectedDelta: 1 },
  ]

  let eventsAdded = 0
  for (const evt of eventTypes) {
    const res = await c.callApi('eaa.addEvent', {
      studentName: batchStudent,
      reasonCode: evt.reasonCode
    })
    if (res?.success === true || !res?.__error) eventsAdded++
  }
  record('batch.events_added', eventsAdded === 10, `${eventsAdded}/10`)

  // 验证分数（100 + 5*1 - 5*2 = 95）
  const scoreRes = await c.callApi('eaa.score', batchStudent)
  const finalScore = scoreRes?.data?.score ?? scoreRes?.data
  const expectedScore = 100 + 5 * 1 - 5 * 2 // = 95
  record('batch.score_correct', finalScore === expectedScore, `expected=${expectedScore}, actual=${finalScore}`)

  // 验证历史记录数量
  const histRes = await c.callApi('eaa.history', batchStudent)
  const histEvents = histRes?.data?.events || histRes?.data || []
  record('batch.history_count', Array.isArray(histEvents) && histEvents.length === 10, `count=${Array.isArray(histEvents) ? histEvents.length : 0}`)

  // 清理
  await c.callApi('eaa.deleteStudent', batchStudent, 'batch cleanup')

  // ============================================================
  // [9] 页面快速切换压力（100 次）
  // ============================================================
  console.log('\n[9] 页面快速切换压力 (100 次)')

  const routes = ['#/dashboard', '#/students', '#/chat', '#/agents', '#/settings']
  const navStart = Date.now()
  let navOk = 0
  const navErrors = []

  for (let i = 0; i < 100; i++) {
    const route = routes[i % routes.length]
    try {
      await c.eval(`window.location.hash = '${route}'`)
      await sleep(100) // 短暂等待渲染
      const hash = await c.eval(`window.location.hash`)
      if (hash === route) navOk++
      else navErrors.push(`iter ${i}: expected ${route}, got ${hash}`)
    } catch (e) {
      navErrors.push(`iter ${i}: ${e.message}`)
    }
  }
  const navDuration = Date.now() - navStart
  record('stress.nav_100', navOk === 100, `${navOk}/100 ok, ${navDuration}ms`)
  console.log(`    100 次导航: ${navDuration}ms (avg ${(navDuration / 100).toFixed(0)}ms/nav)`)

  // 导航后内存检查
  const postNavMem = await c.eval(`performance.memory.usedJSHeapSize`)
  const preNavMem = memorySamples[memorySamples.length - 1].used
  const navMemGrowth = ((postNavMem - preNavMem) / preNavMem) * 100
  record('stress.nav_memory', Math.abs(navMemGrowth) < 30, `growth=${navMemGrowth.toFixed(1)}%`)

  // ============================================================
  // [10] 最终系统健康检查
  // ============================================================
  console.log('\n[10] 最终系统健康检查')

  // 所有核心 API 应该仍然正常
  const finalChecks = [
    ['eaa.info', []],
    ['eaa.doctor', []],
    ['eaa.validate', []],
    ['eaa.listStudents', []],
    ['eaa.ranking', [5]],
    ['eaa.stats', []],
    ['eaa.codes', []],
    ['agent.list', []],
    ['settings.get', []],
    ['cron.list', []],
    ['skill.list', []],
    ['class.list', []],
    ['chat.listSessions', []],
    ['log.list', []],
    ['ai.listProviders', []],
  ]

  let finalOk = 0
  for (const [api, args] of finalChecks) {
    const res = await c.callApi(api, ...args)
    if (res && !res.__error) {
      finalOk++
    } else {
      console.log(`    FAIL: ${api} -> ${res?.__error?.slice(0, 60) || 'unknown'}`)
    }
  }
  record('final.all_apis_healthy', finalOk === finalChecks.length, `${finalOk}/${finalChecks.length} healthy`)

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  console.log('ROUND 14 SUMMARY')
  console.log('============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) {
    console.log('FAILED:')
    failed.forEach(r => console.log(`  FAIL: ${r.name}${r.detail ? ' :: ' + r.detail : ''}`))
  }
  console.log(`\nTotal: ${passed} ok, ${failed.length} fail, ${results.length} tests`)

  c.close()
}

main().catch(e => { console.error(e); process.exit(1) })
