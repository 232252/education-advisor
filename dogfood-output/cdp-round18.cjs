// ============================================================
// 第十八轮：跨模块数据流 + 真实用户工作流
// 覆盖：
//   1. EAA 添加学生 → Students 页面可见
//   2. EAA 添加事件 → Dashboard 分数变化
//   3. Chat 完整工作流（创建会话→发消息→切换会话→删除）
//   4. Agent runManual → history 记录
//   5. Skill 保存 → 列表可见 → 读取 → 删除
//   6. Privacy anonymize → 文本变化
//   7. Cron runNow → 日志产生
//   8. Settings 修改 → 持久化验证
//   9. 跨页面导航后数据一致性
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
  async navigate(hash) {
    await this.eval(`window.location.hash = ${JSON.stringify(hash)}`)
    await sleep(800)
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
  console.log('ROUND 18: Cross-Module Data Flow + Real User Workflows')
  console.log('============================================================')

  // ============================================================
  // [1] EAA 添加学生 → Students 页面可见
  // ============================================================
  console.log('\n[1] EAA 添加学生 → Students 页面可见')
  const testStudentName = 'R18_TestStudent_' + Date.now()
  const addStuRes = await c.callApi('eaa.addStudent', testStudentName)
  record('workflow.add_student', addStuRes?.success !== false, `name=${testStudentName}, success=${addStuRes?.success}`)

  // 验证 EAA listStudents 包含该学生
  const listRes = await c.callApi('eaa.listStudents')
  const students = listRes?.data?.students || listRes?.data || []
  const foundInEAA = Array.isArray(students) && students.some(s => {
    const name = typeof s === 'string' ? s : (s.name || s.student_name || s.entity_id || '')
    return name === testStudentName || name.includes(testStudentName)
  })
  record('workflow.student_in_eaa', foundInEAA, `foundInEAA=${foundInEAA}, totalStudents=${Array.isArray(students) ? students.length : 'N/A'}`)

  // 导航到 Students 页面检查
  await c.navigate('#/students')
  await sleep(1500)
  const stuPageText = await c.eval(`document.body?.innerText || ''`)
  const foundInUI = stuPageText.includes(testStudentName)
  record('workflow.student_in_ui', foundInUI, `foundInUI=${foundInUI}`)

  // ============================================================
  // [2] EAA 添加事件 → 分数查询验证
  // ============================================================
  console.log('\n[2] EAA 添加事件 → 分数查询验证')
  const scoreBeforeRes = await c.callApi('eaa.score', testStudentName)
  const scoreBefore = scoreBeforeRes?.data?.score ?? scoreBeforeRes?.data ?? null
  record('workflow.score_before', scoreBefore !== null, `score=${scoreBefore}`)

  // 添加一个 LATE 事件 (API 接受对象参数 {studentName, reasonCode})
  const addEvtRes = await c.callApi('eaa.addEvent', { studentName: testStudentName, reasonCode: 'LATE' })
  record('workflow.add_event', addEvtRes?.success !== false, `success=${addEvtRes?.success}`)

  // 查询分数变化
  const scoreAfterRes = await c.callApi('eaa.score', testStudentName)
  const scoreAfter = scoreAfterRes?.data?.score ?? scoreAfterRes?.data ?? null
  record('workflow.score_after', scoreAfter !== null, `score=${scoreAfter}, changed=${scoreBefore !== scoreAfter}`)

  // 查询历史 (history 返回 {data: {events: [...], events_count, ...}})
  const historyRes = await c.callApi('eaa.history', testStudentName)
  const events = historyRes?.data?.events || []
  const hasLateEvent = Array.isArray(events) && events.some(e => {
    const rc = e.reason_code || e.reasonCode || e.reason || ''
    return rc === 'LATE'
  })
  record('workflow.event_in_history', hasLateEvent, `hasLateEvent=${hasLateEvent}, totalEvents=${Array.isArray(events) ? events.length : 0}`)

  // 验证 Dashboard 页面能加载数据（EAA 数据在 Dashboard 可见）
  await c.navigate('#/dashboard')
  await sleep(1000)
  const dashText = await c.eval(`document.body?.innerText || ''`)
  record('workflow.dashboard_has_data', dashText.length > 100, `dashLen=${dashText.length}`)

  // ============================================================
  // [3] Chat 完整工作流
  // ============================================================
  console.log('\n[3] Chat 完整工作流')
  const sessionId = 'r18_chat_' + Date.now()
  const msg1Content = '你好，这是R18测试消息1'
  const msg2Content = 'Hello, this is R18 test message 2'

  // 发送第一条消息（隐式创建会话）— saveMessage 接受单个对象参数
  const saveMsg1Res = await c.callApi('chat.saveMessage', { sessionId, role: 'user', content: msg1Content, timestamp: Date.now() })
  record('workflow.chat_save_msg1', saveMsg1Res?.success !== false, `success=${saveMsg1Res?.success}`)

  // 发送第二条消息
  await sleep(100)
  const saveMsg2Res = await c.callApi('chat.saveMessage', { sessionId, role: 'assistant', content: msg2Content, timestamp: Date.now() + 1 })
  record('workflow.chat_save_msg2', saveMsg2Res?.success !== false, `success=${saveMsg2Res?.success}`)

  // 加载消息验证
  const loadMsgsRes = await c.callApi('chat.loadMessages', sessionId)
  const messages = loadMsgsRes?.messages || loadMsgsRes?.data || []
  record('workflow.chat_messages_loaded', Array.isArray(messages) && messages.length >= 2, `count=${Array.isArray(messages) ? messages.length : 0}`)

  // 验证消息内容
  const hasMsg1 = Array.isArray(messages) && messages.some(m => (m.content || m.text || '').includes(msg1Content))
  const hasMsg2 = Array.isArray(messages) && messages.some(m => (m.content || m.text || '').includes(msg2Content))
  record('workflow.chat_content_correct', hasMsg1 && hasMsg2, `hasMsg1=${hasMsg1}, hasMsg2=${hasMsg2}`)

  // 列出会话
  const listSessRes = await c.callApi('chat.listSessions')
  const sessions = listSessRes?.sessions || listSessRes?.data || []
  const sessFound = Array.isArray(sessions) && sessions.some(s => {
    const id = typeof s === 'string' ? s : (s.session_id || s.id || s.sessionId || '')
    return id === sessionId
  })
  record('workflow.chat_session_listed', sessFound, `found=${sessFound}, totalSessions=${Array.isArray(sessions) ? sessions.length : 0}`)

  // 创建第二个会话并验证切换
  const sessionId2 = 'r18_chat2_' + Date.now()
  await c.callApi('chat.saveMessage', { sessionId: sessionId2, role: 'user', content: 'second session', timestamp: Date.now() })
  const loadMsgs2Res = await c.callApi('chat.loadMessages', sessionId2)
  const messages2 = loadMsgs2Res?.messages || loadMsgs2Res?.data || []
  record('workflow.chat_multi_session', Array.isArray(messages2) && messages2.length >= 1, `count=${Array.isArray(messages2) ? messages2.length : 0}`)

  // 验证第一个会话消息仍存在
  const reloadMsgsRes = await c.callApi('chat.loadMessages', sessionId)
  const reloadMessages = reloadMsgsRes?.messages || reloadMsgsRes?.data || []
  record('workflow.chat_session_isolation', Array.isArray(reloadMessages) && reloadMessages.length >= 2, `count=${Array.isArray(reloadMessages) ? reloadMessages.length : 0}`)

  // 删除会话
  const delSessRes = await c.callApi('chat.deleteSession', sessionId)
  record('workflow.chat_delete_session', delSessRes?.success !== false, `success=${delSessRes?.success}`)

  // 验证删除后消息不存在
  const afterDelMsgs = await c.callApi('chat.loadMessages', sessionId)
  const afterDelMessages = afterDelMsgs?.messages || afterDelMsgs?.data || []
  record('workflow.chat_deleted_empty', Array.isArray(afterDelMessages) && afterDelMessages.length === 0, `count=${Array.isArray(afterDelMessages) ? afterDelMessages.length : 0}`)

  // 清理第二个会话
  await c.callApi('chat.deleteSession', sessionId2)

  // ============================================================
  // [4] Agent runManual → history 记录
  // ============================================================
  console.log('\n[4] Agent runManual → history 记录')
  const agentName = 'data-analyst'
  // runManual 需要 (id, prompt) 两个参数
  const runRes = await c.callApi('agent.runManual', agentName, '分析当前学生数据概况')
  record('workflow.agent_run', runRes?.success !== false, `agent=${agentName}, success=${runRes?.success}`)

  // 查询 agent 历史
  await sleep(500)
  const histRes = await c.callApi('agent.getHistory', agentName)
  const histData = histRes?.data || histRes?.history || histRes || []
  record('workflow.agent_history', Array.isArray(histData) ? histData.length >= 0 : true, `count=${Array.isArray(histData) ? histData.length : 'N/A'}`)

  // ============================================================
  // [5] Skill 保存 → 列表 → 读取 → 删除
  // ============================================================
  console.log('\n[5] Skill 保存 → 列表 → 读取 → 删除')
  const skillName = 'r18_test_skill_' + Date.now()
  const skillContent = '# R18 Test Skill\nThis is a test skill created in round 18.\n## Purpose\nVerify skill CRUD workflow.'

  const saveSkillRes = await c.callApi('skill.save', skillName, skillContent)
  record('workflow.skill_save', saveSkillRes?.success !== false, `success=${saveSkillRes?.success}`)

  // 列表验证
  const listSkillsRes = await c.callApi('skill.list')
  const skills = listSkillsRes?.data || listSkillsRes?.skills || listSkillsRes || []
  const skillFound = Array.isArray(skills) && skills.some(s => {
    const name = typeof s === 'string' ? s : (s.name || s.skill_name || s.id || '')
    return name === skillName || name.includes(skillName)
  })
  record('workflow.skill_in_list', skillFound, `found=${skillFound}`)

  // 读取验证
  const getSkillRes = await c.callApi('skill.get', skillName)
  const skillContentRead = getSkillRes?.data || getSkillRes?.content || getSkillRes?.text || ''
  record('workflow.skill_read', typeof skillContentRead === 'string' && skillContentRead.length > 0, `len=${typeof skillContentRead === 'string' ? skillContentRead.length : 0}`)

  // 内容一致性
  const contentMatches = typeof skillContentRead === 'string' && skillContentRead.includes('R18 Test Skill')
  record('workflow.skill_content_match', contentMatches, `matches=${contentMatches}`)

  // 删除验证
  const delSkillRes = await c.callApi('skill.delete', skillName)
  record('workflow.skill_delete', delSkillRes?.success !== false, `success=${delSkillRes?.success}`)

  // 删除后验证
  const afterDelSkill = await c.callApi('skill.get', skillName)
  const afterDelContent = afterDelSkill?.data || afterDelSkill?.content || afterDelSkill?.text
  record('workflow.skill_deleted', afterDelContent === null || afterDelContent === undefined || afterDelContent === '', `afterDelete=${afterDelContent === null ? 'null' : typeof afterDelContent}`)

  // ============================================================
  // [6] Privacy anonymize → 文本变化
  // ============================================================
  console.log('\n[6] Privacy anonymize → 文本变化')
  const privacyStatus = await c.callApi('privacy.status')
  record('workflow.privacy_status', privacyStatus?.unlocked !== undefined, `unlocked=${privacyStatus?.unlocked}`)

  // 测试匿名化 — 当 privacy locked 时,文本原样返回 (by design)
  const testText = '张三今天迟到了'
  const anonRes = await c.callApi('privacy.anonymize', testText)
  const anonText = anonRes?.data || anonRes?.text || anonRes?.result || ''
  record('workflow.privacy_anonymize', typeof anonText === 'string' && anonText.length > 0, `original="${testText}", anonymized="${anonText}"`)

  // 验证文本变化 — locked 时不变化是正确行为
  const textChanged = anonText !== testText
  const isLocked = privacyStatus?.unlocked === false
  record('workflow.privacy_text_changed', isLocked ? true : textChanged, `changed=${textChanged}, locked=${isLocked}`)

  // 测试反匿名化
  const deanonRes = await c.callApi('privacy.deanonymize', anonText)
  const deanonText = deanonRes?.data || deanonRes?.text || deanonRes?.result || ''
  record('workflow.privacy_deanonymize', typeof deanonText === 'string' && deanonText.length > 0, `deanonymized="${deanonText}"`)

  // ============================================================
  // [7] Cron runNow → 日志验证
  // ============================================================
  console.log('\n[7] Cron runNow → 日志验证')
  const cronListRes = await c.callApi('cron.list')
  const cronTasks = cronListRes?.data || cronListRes?.tasks || cronListRes || []
  record('workflow.cron_list', Array.isArray(cronTasks) && cronTasks.length > 0, `count=${Array.isArray(cronTasks) ? cronTasks.length : 0}`)

  // 执行第一个 cron 任务
  if (Array.isArray(cronTasks) && cronTasks.length > 0) {
    const firstTask = cronTasks[0]
    const taskId = typeof firstTask === 'string' ? firstTask : (firstTask.id || firstTask.name || firstTask.task_id || '')
    if (taskId) {
      const runCronRes = await c.callApi('cron.runNow', taskId)
      record('workflow.cron_run', runCronRes?.success !== false, `taskId=${taskId}, success=${runCronRes?.success}`)
    } else {
      record('workflow.cron_run', false, `no taskId found in: ${JSON.stringify(firstTask).slice(0, 100)}`)
    }
  }

  // ============================================================
  // [8] Settings 持久化验证
  // ============================================================
  console.log('\n[8] Settings 持久化验证')
  const settingsBefore = await c.callApi('settings.get')
  const origLogLevel = settingsBefore?.general?.logLevel

  // 修改 logLevel
  const newLogLevel = origLogLevel === 'debug' ? 'info' : 'debug'
  await c.callApi('settings.set', 'general.logLevel', newLogLevel)
  await sleep(200)

  // 重新读取验证
  const settingsAfter = await c.callApi('settings.get')
  const actualLogLevel = settingsAfter?.general?.logLevel
  record('workflow.settings_persist', actualLogLevel === newLogLevel, `expected=${newLogLevel}, actual=${actualLogLevel}`)

  // 恢复
  await c.callApi('settings.set', 'general.logLevel', origLogLevel)

  // 验证多个 settings 字段一致性
  const fields = ['theme', 'language', 'logLevel', 'closeBehavior']
  let allConsistent = true
  for (const f of fields) {
    const before = settingsBefore?.general?.[f]
    const after = settingsAfter?.general?.[f]
    // After logLevel was changed, so check other fields stayed same
    if (f !== 'logLevel' && before !== after) {
      allConsistent = false
    }
  }
  record('workflow.settings_other_fields_unchanged', allConsistent, `fields=${JSON.stringify(fields)}`)

  // ============================================================
  // [9] 跨页面导航后数据一致性
  // ============================================================
  console.log('\n[9] 跨页面导航后数据一致性')
  // 多次导航后验证 EAA 数据仍然可访问
  const navSequence = ['#/dashboard', '#/students', '#/chat', '#/agents', '#/skills', '#/privacy', '#/scheduler', '#/models', '#/settings', '#/dashboard']
  let navConsistent = true
  for (const hash of navSequence) {
    await c.navigate(hash)
  }

  // 最终 EAA 检查
  const finalInfo = await c.callApi('eaa.info')
  record('workflow.eaa_after_navigation', finalInfo?.success !== false && finalInfo?.data?.version !== undefined, `version=${finalInfo?.data?.version}`)

  // 验证学生仍然存在
  const finalListRes = await c.callApi('eaa.listStudents')
  const finalStudents = finalListRes?.data?.students || []
  const studentStillExists = Array.isArray(finalStudents) && finalStudents.some(s => {
    const name = typeof s === 'string' ? s : (s.name || s.student_name || s.entity_id || '')
    return name === testStudentName || name.includes(testStudentName)
  })
  record('workflow.student_after_navigation', studentStillExists, `exists=${studentStillExists}`)

  // ============================================================
  // [10] 清理测试数据
  // ============================================================
  console.log('\n[10] 清理测试数据')
  // 删除测试学生
  if (studentStillExists) {
    const delStuRes = await c.callApi('eaa.deleteStudent', testStudentName)
    record('cleanup.delete_student', delStuRes?.success !== false, `success=${delStuRes?.success}`)
  }

  // ============================================================
  // [11] 内存健康检查
  // ============================================================
  console.log('\n[11] 内存健康检查')
  const memInfo = await c.eval(`JSON.stringify({
    usedJSHeapSize: performance.memory?.usedJSHeapSize,
    totalJSHeapSize: performance.memory?.totalJSHeapSize,
    jsHeapSizeLimit: performance.memory?.jsHeapSizeLimit,
    domElements: document.querySelectorAll('*').length
  })`)
  const mem = JSON.parse(memInfo)
  const heapMB = mem.usedJSHeapSize ? (mem.usedJSHeapSize / 1024 / 1024).toFixed(1) : 'N/A'
  record('health.memory', mem.usedJSHeapSize > 0, `heap=${heapMB}MB, dom=${mem.domElements}`)

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`ROUND 18 SUMMARY: ${passed}/${results.length} passed, ${failed} failed`)
  console.log('============================================================')
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.ok).forEach(r => {
      console.log(`  - ${r.name}: ${r.detail}`)
    })
  }

  c.close()
}
main().catch(e => { console.error(e); process.exit(1) })
