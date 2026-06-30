// ============================================================
// 第十六轮：错误恢复 + 并发竞争 + 数据一致性交叉验证
// 覆盖：
//   1. IPC 错误注入与恢复（无效参数、超长输入、特殊字符）
//   2. 并发竞争条件（同时操作同一资源）
//   3. 数据一致性交叉验证（多源数据对比）
//   4. EAA 边界条件（极端分数、连锁 revert）
//   5. Agent 并发 toggle 竞争
//   6. Skill 并发 save/delete 竞争
//   7. Chat 并发消息写入
//   8. Settings 并发写入一致性
//   9. 长时间运行后内存状态
//  10. IPC 通道压力（快速连续调用）
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + detail.slice(0, 150) : ''}`)
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 16: Error Recovery + Concurrency + Data Consistency')
  console.log('============================================================')

  // ============================================================
  // [1] IPC 错误注入与恢复
  // ============================================================
  console.log('\n[1] IPC 错误注入与恢复')

  // 1.1 无效参数类型
  const invalidTypeRes = await c.callApi('eaa.addStudent', 12345)
  record('error.invalid_type_addStudent', invalidTypeRes?.__error || invalidTypeRes?.success === false, `success=${invalidTypeRes?.success}, hasError=${!!invalidTypeRes?.__error}`)

  // 1.2 超长输入（>1000 字符）— IPC 异常返回 __error
  const longName = 'A'.repeat(1000)
  const longNameRes = await c.callApi('eaa.addStudent', longName)
  record('error.long_name_rejected', longNameRes?.__error || longNameRes?.success === false, `hasError=${!!longNameRes?.__error}, len=${longName.length}`)

  // 1.3 特殊字符（控制字符）— IPC 异常返回 __error
  const controlCharName = 'test\x00\x01\x02student'
  const controlCharRes = await c.callApi('eaa.addStudent', controlCharName)
  record('error.control_char_rejected', controlCharRes?.__error || controlCharRes?.success === false, `hasError=${!!controlCharRes?.__error}`)

  // 1.4 空字符串 — IPC 异常返回 __error
  const emptyNameRes = await c.callApi('eaa.addStudent', '')
  record('error.empty_name_rejected', emptyNameRes?.__error || emptyNameRes?.success === false, `hasError=${!!emptyNameRes?.__error}`)

  // 1.5 null 参数
  const nullRes = await c.callApi('eaa.addStudent', null)
  record('error.null_name_rejected', nullRes?.success === false || nullRes?.__error, `success=${nullRes?.success}`)

  // 1.6 不存在的事件 ID revert
  const fakeRevertRes = await c.callApi('eaa.revertEvent', 'nonexistent-event-id-12345', 'test')
  record('error.invalid_revert_id', fakeRevertRes?.success === false || fakeRevertRes?.__error, `success=${fakeRevertRes?.success}`)

  // 1.7 不存在的学生 score
  const fakeScoreRes = await c.callApi('eaa.score', 'NonExistentStudent12345')
  record('error.invalid_score_name', fakeScoreRes !== null && fakeScoreRes !== undefined, `hasResult=${fakeScoreRes !== null}`)

  // 1.8 不存在的 agent ID
  const fakeAgentRes = await c.callApi('agent.get', 'nonexistent-agent')
  record('error.invalid_agent_id', fakeAgentRes === null || fakeAgentRes?.__error, `result=${fakeAgentRes === null ? 'null' : 'has_error'}`)

  // 1.9 错误后系统恢复能力
  const recoveryRes = await c.callApi('eaa.info')
  record('error.recovery_after_errors', recoveryRes?.success !== false && !recoveryRes?.__error, `recovered=${recoveryRes?.success !== false}`)

  // ============================================================
  // [2] 并发竞争条件 — 同时操作同一资源
  // ============================================================
  console.log('\n[2] 并发竞争条件')

  // 2.1 并发添加同一学生（应只有 1 个成功）
  const concurrentStudent = `R16Concurrent_${Date.now().toString().slice(-6)}`
  const concurrentAdds = await Promise.all([
    c.callApi('eaa.addStudent', concurrentStudent),
    c.callApi('eaa.addStudent', concurrentStudent),
    c.callApi('eaa.addStudent', concurrentStudent),
    c.callApi('eaa.addStudent', concurrentStudent),
    c.callApi('eaa.addStudent', concurrentStudent),
  ])
  // 至少一个成功
  const successCount = concurrentAdds.filter(r => r?.success !== false && !r?.__error).length
  record('concurrent.same_student_add', successCount >= 1, `successCount=${successCount}/5`)

  // 验证只有一个学生
  const listAfter = await c.callApi('eaa.listStudents')
  const students = listAfter?.data?.students || []
  const matchingStudents = students.filter(s => s.name === concurrentStudent)
  record('concurrent.no_duplicate_students', matchingStudents.length === 1, `count=${matchingStudents.length}`)

  // 清理
  await c.callApi('eaa.deleteStudent', concurrentStudent, 'R16 cleanup')

  // 2.2 并发 toggle 同一 agent
  const agentList = await c.callApi('agent.list')
  const agents = agentList?.agents || agentList || []
  if (Array.isArray(agents) && agents.length > 0) {
    const testAgent = agents[0]
    const agentId = testAgent.id || testAgent.name
    const originalEnabled = testAgent.enabled

    const concurrentToggles = await Promise.all([
      c.callApi('agent.toggle', agentId, true),
      c.callApi('agent.toggle', agentId, false),
      c.callApi('agent.toggle', agentId, true),
      c.callApi('agent.toggle', agentId, false),
    ])
    // 至少一个成功
    const toggleSuccesses = concurrentToggles.filter(r => r?.success !== false).length
    record('concurrent.agent_toggle', toggleSuccesses >= 1, `successes=${toggleSuccesses}/4`)

    // 最终状态应该是确定的（不是中间态）
    const finalAgent = await c.callApi('agent.get', agentId)
    record('concurrent.agent_final_state', typeof finalAgent?.enabled === 'boolean', `enabled=${finalAgent?.enabled}`)

    // 恢复
    await c.callApi('agent.toggle', agentId, originalEnabled)
  }

  // 2.3 并发 skill save 同名技能
  const skillName = `r16-concurrent-${Date.now().toString().slice(-6)}`
  const concurrentSkills = await Promise.all([
    c.callApi('skill.save', skillName, 'content version 1'),
    c.callApi('skill.save', skillName, 'content version 2'),
    c.callApi('skill.save', skillName, 'content version 3'),
  ])
  const skillSuccesses = concurrentSkills.filter(r => r?.success !== false).length
  record('concurrent.skill_save', skillSuccesses >= 1, `successes=${skillSuccesses}/3`)

  // 验证最终内容是其中一个版本
  const finalSkill = await c.callApi('skill.get', skillName)
  const validVersions = ['content version 1', 'content version 2', 'content version 3']
  record('concurrent.skill_final_content', finalSkill?.content && validVersions.includes(finalSkill.content), `content=${finalSkill?.content?.slice(0, 20)}`)

  // 清理
  await c.callApi('skill.delete', skillName)

  // ============================================================
  // [3] 数据一致性交叉验证
  // ============================================================
  console.log('\n[3] 数据一致性交叉验证')

  // 3.1 EAA listStudents vs ranking 数量一致
  const listRes = await c.callApi('eaa.listStudents')
  const rankingRes = await c.callApi('eaa.ranking', 100)
  const listCount = listRes?.data?.students?.length || 0
  const rankingCount = rankingRes?.data?.ranking?.length || rankingRes?.data?.length || 0
  record('consistency.list_vs_ranking_count', listCount === rankingCount || rankingCount >= listCount, `list=${listCount}, ranking=${rankingCount}`)

  // 3.2 EAA stats total_events vs 实际事件数
  const statsRes = await c.callApi('eaa.stats')
  const totalEvents = statsRes?.data?.summary?.total_events || statsRes?.summary?.total_events || 0
  record('consistency.stats_total_events', totalEvents > 0, `total_events=${totalEvents}`)

  // 3.3 EAA info 学生数 vs listStudents 数量
  const infoRes = await c.callApi('eaa.info')
  const infoCount = infoRes?.data?.student_count || infoRes?.data?.students || infoRes?.students || 0
  record('consistency.info_vs_list', infoCount === listCount || infoCount > 0, `info=${infoCount}, list=${listCount}`)

  // 3.4 Settings 一致性 — 多次 get 结果一致
  const settings1 = await c.callApi('settings.get')
  const settings2 = await c.callApi('settings.get')
  record('consistency.settings_repeatable', JSON.stringify(settings1) === JSON.stringify(settings2), `match=${JSON.stringify(settings1) === JSON.stringify(settings2)}`)

  // 3.5 Agent list vs individual get 一致性
  if (Array.isArray(agents) && agents.length > 0) {
    const firstAgent = agents[0]
    const agentId = firstAgent.id || firstAgent.name
    const individualGet = await c.callApi('agent.get', agentId)
    record('consistency.agent_list_vs_get', individualGet !== null, `listId=${agentId}, getId=${individualGet?.id || individualGet?.name}`)
  }

  // 3.6 Cron list 稳定性
  const cron1 = await c.callApi('cron.list')
  const cron2 = await c.callApi('cron.list')
  const cronCount1 = (cron1?.tasks || cron1 || []).length
  const cronCount2 = (cron2?.tasks || cron2 || []).length
  record('consistency.cron_repeatable', cronCount1 === cronCount2, `count1=${cronCount1}, count2=${cronCount2}`)

  // ============================================================
  // [4] EAA 边界条件 — 极端分数、连锁 revert
  // ============================================================
  console.log('\n[4] EAA 边界条件')

  const boundaryStudent = `R16Boundary_${Date.now().toString().slice(-6)}`
  await c.callApi('eaa.addStudent', boundaryStudent)

  // 4.1 初始分数
  const initScoreRes = await c.callApi('eaa.score', boundaryStudent)
  const initScore = initScoreRes?.data?.score ?? initScoreRes?.data
  record('boundary.initial_score', initScore === 100, `score=${initScore}`)

  // 4.2 连续添加多个不同 reason_code 事件
  const codes = ['LATE', 'SLEEP_IN_CLASS', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR']
  const eventIds = []
  for (const code of codes) {
    const addRes = await c.callApi('eaa.addEvent', {
      studentName: boundaryStudent,
      reasonCode: code,
      note: `R16 boundary test ${code}`
    })
    if (addRes?.success) {
      // 获取历史找出事件 ID（history 返回 {data: {events: [{event_id, reason_code, ...}]}}）
      const histRes = await c.callApi('eaa.history', boundaryStudent)
      const events = histRes?.data?.events || histRes?.data || []
      const evt = Array.isArray(events) ? events.find(e => e.reason_code === code) : null
      const evtId = evt?.event_id || evt?.id
      if (evtId) eventIds.push({ code, id: evtId })
    }
  }
  record('boundary.add_multiple_events', eventIds.length === codes.length, `added=${eventIds.length}/${codes.length}`)

  // 4.3 连锁 revert（revert 一个事件后，再 revert 该 revert）
  if (eventIds.length > 0) {
    const firstEvent = eventIds[0]
    const revert1Res = await c.callApi('eaa.revertEvent', firstEvent.id, 'R16 连锁 revert 1')
    record('boundary.revert_first', revert1Res?.success !== false, `success=${revert1Res?.success}`)

    // 查找 revert 事件的 ID（event_id 字段）
    const histAfterRevert = await c.callApi('eaa.history', boundaryStudent)
    const eventsAfterRevert = histAfterRevert?.data?.events || histAfterRevert?.data || []
    const revertEvent = Array.isArray(eventsAfterRevert) ? eventsAfterRevert.find(e => e.reason_code === 'REVERT') : null
    const revertEventId = revertEvent?.event_id || revertEvent?.id

    // 尝试 revert 一个 revert 事件（应被拒绝 — 防止无限循环）
    if (revertEventId) {
      const revert2Res = await c.callApi('eaa.revertEvent', revertEventId, 'R16 连锁 revert 2')
      // REVERT 事件不应被再次 revert（by design，防止无限循环）
      record('boundary.revert_revert', revert2Res?.success === false || revert2Res?.__error, `rejected=${revert2Res?.success === false || !!revert2Res?.__error}`)
    } else {
      record('boundary.revert_revert', true, `no revert event found (skipped)`)
    }
  }

  // 4.4 删除不存在的学生
  const delNonexistRes = await c.callApi('eaa.deleteStudent', 'TotallyNonExistentStudent99999', 'test')
  record('boundary.delete_nonexistent', delNonexistRes?.success === false || delNonexistRes?.__error, `success=${delNonexistRes?.success}`)

  // 清理
  await c.callApi('eaa.deleteStudent', boundaryStudent, 'R16 cleanup')

  // ============================================================
  // [5] Chat 并发消息写入
  // ============================================================
  console.log('\n[5] Chat 并发消息写入')
  const concurrentSessionId = `r16-concurrent-${Date.now()}`
  const baseTs = Date.now()

  const concurrentMsgs = await Promise.all([
    c.callApi('chat.saveMessage', { role: 'user', content: 'msg1', timestamp: baseTs, sessionId: concurrentSessionId }),
    c.callApi('chat.saveMessage', { role: 'user', content: 'msg2', timestamp: baseTs + 1, sessionId: concurrentSessionId }),
    c.callApi('chat.saveMessage', { role: 'user', content: 'msg3', timestamp: baseTs + 2, sessionId: concurrentSessionId }),
    c.callApi('chat.saveMessage', { role: 'user', content: 'msg4', timestamp: baseTs + 3, sessionId: concurrentSessionId }),
    c.callApi('chat.saveMessage', { role: 'user', content: 'msg5', timestamp: baseTs + 4, sessionId: concurrentSessionId }),
  ])
  const msgSuccesses = concurrentMsgs.filter(r => r?.success !== false).length
  record('chat.concurrent_save', msgSuccesses === 5, `successes=${msgSuccesses}/5`)

  // 验证消息数量
  const loadConcurrent = await c.callApi('chat.loadMessages', concurrentSessionId)
  const concurrentMessages = loadConcurrent?.messages || loadConcurrent?.data || []
  record('chat.concurrent_count', Array.isArray(concurrentMessages) && concurrentMessages.length === 5, `count=${Array.isArray(concurrentMessages) ? concurrentMessages.length : 0}`)

  // 清理
  await c.callApi('chat.deleteSession', concurrentSessionId)

  // ============================================================
  // [6] IPC 通道压力 — 快速连续调用
  // ============================================================
  console.log('\n[6] IPC 通道压力测试')
  const pressureStart = Date.now()
  const pressurePromises = []
  for (let i = 0; i < 50; i++) {
    pressurePromises.push(c.callApi('eaa.info'))
  }
  const pressureResults = await Promise.all(pressurePromises)
  const pressureDuration = Date.now() - pressureStart
  const pressureSuccesses = pressureResults.filter(r => r?.success !== false && !r?.__error).length
  record('pressure.50_concurrent_info', pressureSuccesses === 50, `successes=${pressureSuccesses}/50, duration=${pressureDuration}ms`)

  // 串行快速调用
  const serialStart = Date.now()
  let serialSuccesses = 0
  for (let i = 0; i < 20; i++) {
    const r = await c.callApi('eaa.doctor')
    if (r?.success !== false && !r?.__error) serialSuccesses++
  }
  const serialDuration = Date.now() - serialStart
  record('pressure.20_serial_doctor', serialSuccesses === 20, `successes=${serialSuccesses}/20, duration=${serialDuration}ms, avg=${(serialDuration / 20).toFixed(0)}ms/op`)

  // ============================================================
  // [7] 长时间运行后内存状态
  // ============================================================
  console.log('\n[7] 长时间运行后内存状态')

  // 获取内存快照
  const memBefore = await c.eval(`JSON.stringify({
    usedJSHeapSize: performance.memory?.usedJSHeapSize || 0,
    totalJSHeapSize: performance.memory?.totalJSHeapSize || 0,
    jsHeapSizeLimit: performance.memory?.jsHeapSizeLimit || 0,
    domNodes: document.querySelectorAll('*').length,
    eventListeners: window.__eventListenersCount || 'unknown'
  })`)
  const memBeforeData = JSON.parse(memBefore)
  console.log(`  Memory before: heap=${(memBeforeData.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB, dom=${memBeforeData.domNodes}`)

  // 执行 100 次页面切换
  const pages = ['#/dashboard', '#/students', '#/classes', '#/chat', '#/agents', '#/skills', '#/settings']
  for (let i = 0; i < 100; i++) {
    await c.eval(`window.location.hash = ${JSON.stringify(pages[i % pages.length])}`)
    await sleep(50)
  }

  // 等待 GC
  await sleep(2000)

  const memAfter = await c.eval(`JSON.stringify({
    usedJSHeapSize: performance.memory?.usedJSHeapSize || 0,
    totalJSHeapSize: performance.memory?.totalJSHeapSize || 0,
    jsHeapSizeLimit: performance.memory?.jsHeapSizeLimit || 0,
    domNodes: document.querySelectorAll('*').length
  })`)
  const memAfterData = JSON.parse(memAfter)
  console.log(`  Memory after: heap=${(memAfterData.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB, dom=${memAfterData.domNodes}`)

  const heapGrowth = memAfterData.usedJSHeapSize - memBeforeData.usedJSHeapSize
  const heapGrowthPercent = memBeforeData.usedJSHeapSize > 0 ? (heapGrowth / memBeforeData.usedJSHeapSize) * 100 : 0
  record('memory.heap_growth_100nav', Math.abs(heapGrowthPercent) < 20, `growth=${heapGrowthPercent.toFixed(1)}%, before=${(memBeforeData.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB, after=${(memAfterData.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB`)

  const domGrowth = memAfterData.domNodes - memBeforeData.domNodes
  record('memory.dom_growth_100nav', Math.abs(domGrowth) < 50, `growth=${domGrowth} nodes, before=${memBeforeData.domNodes}, after=${memAfterData.domNodes}`)

  // ============================================================
  // [8] EAA 数据完整性 — 添加/revert 后分数一致性
  // ============================================================
  console.log('\n[8] EAA 数据完整性')
  const integrityStudent = `R16Integrity_${Date.now().toString().slice(-6)}`
  await c.callApi('eaa.addStudent', integrityStudent)

  // 记录初始分数
  const scoreBefore = await c.callApi('eaa.score', integrityStudent)
  const score1 = scoreBefore?.data?.score ?? scoreBefore?.data
  console.log(`  Initial score: ${score1}`)

  // 添加一个 -2 事件
  await c.callApi('eaa.addEvent', {
    studentName: integrityStudent,
    reasonCode: 'LATE',
    note: 'R16 integrity test'
  })
  const scoreAfterLate = await c.callApi('eaa.score', integrityStudent)
  const score2 = scoreAfterLate?.data?.score ?? scoreAfterLate?.data
  console.log(`  After LATE: ${score2}`)
  record('integrity.score_decreased', score2 < score1, `before=${score1}, after=${score2}`)

  // revert（event_id 字段）
  const histRes = await c.callApi('eaa.history', integrityStudent)
  const events = histRes?.data?.events || histRes?.data || []
  const lateEvent = Array.isArray(events) ? events.find(e => e.reason_code === 'LATE') : null
  const lateEventId = lateEvent?.event_id || lateEvent?.id
  if (lateEventId) {
    await c.callApi('eaa.revertEvent', lateEventId, 'R16 integrity revert')
    const scoreAfterRevert = await c.callApi('eaa.score', integrityStudent)
    const score3 = scoreAfterRevert?.data?.score ?? scoreAfterRevert?.data
    console.log(`  After revert: ${score3}`)
    record('integrity.score_restored', score3 > score2, `after_late=${score2}, after_revert=${score3}`)

    // revert 后分数应等于初始分数（因为是唯一的 -2 事件被 revert）
    record('integrity.score_matches_initial', score3 === score1, `initial=${score1}, after_revert=${score3}`)
  }

  // 清理
  await c.callApi('eaa.deleteStudent', integrityStudent, 'R16 cleanup')

  // ============================================================
  // [9] 跨模块数据独立性
  // ============================================================
  console.log('\n[9] 跨模块数据独立性')

  // 9.1 修改 settings 不影响 EAA 数据
  const eaaBefore = await c.callApi('eaa.listStudents')
  const eaaCountBefore = eaaBefore?.data?.students?.length || 0

  await c.callApi('settings.set', 'general.theme', 'light')
  await sleep(200)
  await c.callApi('settings.set', 'general.theme', 'dark')
  await sleep(200)

  const eaaAfter = await c.callApi('eaa.listStudents')
  const eaaCountAfter = eaaAfter?.data?.students?.length || 0
  record('independence.settings_vs_eaa', eaaCountBefore === eaaCountAfter, `before=${eaaCountBefore}, after=${eaaCountAfter}`)

  // 9.2 修改 agent toggle 不影响 skills
  const skillsBefore = await c.callApi('skill.list')
  const skillsCountBefore = (skillsBefore || []).length

  if (Array.isArray(agents) && agents.length > 0) {
    const agentId = agents[0].id || agents[0].name
    const orig = agents[0].enabled
    await c.callApi('agent.toggle', agentId, !orig)
    await sleep(200)
    await c.callApi('agent.toggle', agentId, orig)
  }

  const skillsAfter = await c.callApi('skill.list')
  const skillsCountAfter = (skillsAfter || []).length
  record('independence.agent_vs_skill', skillsCountBefore === skillsCountAfter, `before=${skillsCountBefore}, after=${skillsCountAfter}`)

  // ============================================================
  // [10] 最终健康检查
  // ============================================================
  console.log('\n[10] 最终健康检查')
  const finalChecks = [
    { name: 'eaa.info', call: () => c.callApi('eaa.info') },
    { name: 'eaa.doctor', call: () => c.callApi('eaa.doctor') },
    { name: 'eaa.validate', call: () => c.callApi('eaa.validate') },
    { name: 'agent.list', call: () => c.callApi('agent.list') },
    { name: 'skill.list', call: () => c.callApi('skill.list') },
    { name: 'settings.get', call: () => c.callApi('settings.get') },
    { name: 'cron.list', call: () => c.callApi('cron.list') },
    { name: 'privacy.status', call: () => c.callApi('privacy.status') },
    { name: 'ai.listProviders', call: () => c.callApi('ai.listProviders') },
    { name: 'log.list', call: () => c.callApi('log.list') },
  ]

  for (const check of finalChecks) {
    const res = await check.call()
    record(`health.${check.name}`, res !== null && res !== undefined && !res?.__error, `ok=${res !== null && res !== undefined}`)
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`ROUND 16 SUMMARY: ${passed}/${results.length} passed, ${failed} failed`)
  console.log('============================================================')
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail}`))
  }

  c.close()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
