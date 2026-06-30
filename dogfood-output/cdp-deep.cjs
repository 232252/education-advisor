// =============================================================
// 第三轮:端到端深度功能测试
// 通过 CDP 调用 window.api.* 测试所有 IPC 通道
// 覆盖: EAA / Agent / Privacy / Settings / Skill / Cron / Chat / Class / Profile / AI / Log
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
  close() {
    if (this.ws) this.ws.close()
  }
}

// 测试结果收集
const results = []
function record(category, name, result) {
  if (result === null || result === undefined) result = { __ok_null: true }
  const entry = {
    category,
    name,
    ok: !result.__error,
    error: result.__error || null,
    data: result.__error ? null : result,
  }
  results.push(entry)
  const status = entry.ok ? 'OK' : 'FAIL'
  console.log(`[${status}] ${category}/${name}${entry.error ? ' :: ' + entry.error.slice(0, 120) : ''}`)
  return entry
}

async function main() {
  const cdp = new CDPClient()
  await cdp.connect()
  console.log('CDP connected. Starting deep functional tests...\n')

  // 辅助:调用 window.api.xxx.yyy(args)
  async function callApi(path, ...args) {
    const argsStr = JSON.stringify(args).slice(1, -1) // 去掉外层 []
    // 注意:参数需要安全序列化
    const expr = `(async () => {
      const parts = '${path}'.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      if (typeof obj !== 'function') throw new Error('API ${path} is not a function')
      return await obj(${argsStr})
    })()`
    // 用更安全的方式传参
    const safeExpr = `(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      if (typeof obj !== 'function') throw new Error('API ' + ${JSON.stringify(path)} + ' is not a function')
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`
    return cdp.eval(safeExpr)
  }

  // =========================================================
  // 1. EAA 数据操作
  // =========================================================
  console.log('\n=== 1. EAA 数据操作 ===')

  // 1.1 基础读取
  record('eaa', 'info', await callApi('eaa.info'))
  record('eaa', 'doctor', await callApi('eaa.doctor'))
  record('eaa', 'listStudents', await callApi('eaa.listStudents'))
  record('eaa', 'ranking', await callApi('eaa.ranking', 5))
  record('eaa', 'stats', await callApi('eaa.stats'))
  record('eaa', 'codes', await callApi('eaa.codes'))
  record('eaa', 'validate', await callApi('eaa.validate'))
  record('eaa', 'summary', await callApi('eaa.summary'))
  record('eaa', 'exportFormats', await callApi('eaa.exportFormats'))

  // 1.2 学生查询
  const studentsRes = await callApi('eaa.listStudents')
  let testStudent = null
  if (!studentsRes.__error && Array.isArray(studentsRes.data)) {
    testStudent = studentsRes.data[0]
  } else if (!studentsRes.__error && studentsRes.data) {
    // 可能是其他结构
    const s = studentsRes.data
    if (Array.isArray(s)) testStudent = s[0]
    else if (s.students) testStudent = s.students[0]
    else if (s.data) testStudent = s.data[0]
  }

  if (testStudent) {
    const name = typeof testStudent === 'string' ? testStudent : (testStudent.name || testStudent.student_name)
    if (name) {
      record('eaa', 'score', await callApi('eaa.score', name))
      record('eaa', 'history', await callApi('eaa.history', name))
    }
  }

  // 1.3 搜索/范围/标签
  record('eaa', 'search', await callApi('eaa.search', '陈', 10))
  record('eaa', 'range', await callApi('eaa.range', '2025-01-01', '2026-12-31', 10))
  record('eaa', 'tag', await callApi('eaa.tag'))

  // 1.4 回放
  record('eaa', 'replay', await callApi('eaa.replay'))

  // 1.5 新增测试学生(后清理)
  const testStudentName = '__test_student_' + Date.now()
  record('eaa', 'addStudent', await callApi('eaa.addStudent', testStudentName))

  // 1.6 设置学生元数据
  record('eaa', 'setStudentMeta', await callApi('eaa.setStudentMeta', {
    name: testStudentName,
    group: 'TestClass',
    role: 'student',
  }))

  // 1.7 新增事件
  record('eaa', 'addEvent', await callApi('eaa.addEvent', {
    studentName: testStudentName,
    reasonCode: 'ACTIVITY_PARTICIPATION',
    delta: 2.0,
    note: '测试加分事件',
  }))

  // 1.8 导出(测试格式)
  record('eaa', 'export.csv', await callApi('eaa.export', 'csv'))
  record('eaa', 'export.jsonl', await callApi('eaa.export', 'jsonl'))

  // 1.9 删除测试学生
  record('eaa', 'deleteStudent', await callApi('eaa.deleteStudent', testStudentName, 'cleanup'))

  // =========================================================
  // 2. Agent 操作
  // =========================================================
  console.log('\n=== 2. Agent 操作 ===')
  record('agent', 'list', await callApi('agent.list'))

  const agentsRes = await callApi('agent.list')
  let testAgentId = null
  if (!agentsRes.__error && agentsRes.data) {
    const list = Array.isArray(agentsRes.data) ? agentsRes.data : (agentsRes.data.agents || [])
    if (list.length > 0) {
      testAgentId = list[0].id || list[0].agentId
    }
  }

  if (testAgentId) {
    record('agent', 'get', await callApi('agent.get', testAgentId))
    record('agent', 'getSoul', await callApi('agent.getSoul', testAgentId))
    record('agent', 'getRules', await callApi('agent.getRules', testAgentId))
    record('agent', 'getHistory', await callApi('agent.getHistory', testAgentId))
    // 不测试 runManual(需要 API key,会在 AI 部分验证)
    // 不测试 toggle(避免改变 agent 启用状态)
  }

  // =========================================================
  // 3. Privacy 引擎
  // =========================================================
  console.log('\n=== 3. Privacy 引擎 ===')
  record('privacy', 'status', await callApi('privacy.status'))

  // 测试匿名化(不需要密码的 dry-run)
  record('privacy', 'dryrun', await callApi('privacy.dryrun', '张三同学今天表现很好'))

  // 初始化隐私引擎
  record('privacy', 'init', await callApi('privacy.init', 'test1234', false))
  record('privacy', 'status_after_init', await callApi('privacy.status'))

  // 匿名化/反匿名化
  record('privacy', 'anonymize', await callApi('privacy.anonymize', '李四同学迟到了'))
  record('privacy', 'list', await callApi('privacy.list'))
  record('privacy', 'filter', await callApi('privacy.filter', 'teacher', '王五同学没交作业'))

  // 添加映射
  record('privacy', 'add', await callApi('privacy.add', 'person', '测试学生赵六'))

  // 锁定
  record('privacy', 'lock', await callApi('privacy.lock'))
  record('privacy', 'status_after_lock', await callApi('privacy.status'))

  // =========================================================
  // 4. Settings
  // =========================================================
  console.log('\n=== 4. Settings ===')
  record('settings', 'get', await callApi('settings.get'))

  // logLevel 切换测试(调查循环 bug)
  const settingsRes = await callApi('settings.get')
  let originalLogLevel = 'info'
  if (!settingsRes.__error && settingsRes.data) {
    originalLogLevel = settingsRes.data.general?.logLevel || 'info'
  }
  console.log(`  original logLevel = ${originalLogLevel}`)

  record('settings', 'set.logLevel.debug', await callApi('settings.set', 'general.logLevel', 'debug'))
  record('settings', 'get.after_debug', await callApi('settings.get'))
  record('settings', 'set.logLevel.info', await callApi('settings.set', 'general.logLevel', 'info'))
  record('settings', 'get.after_info', await callApi('settings.get'))
  record('settings', 'set.logLevel.warn', await callApi('settings.set', 'general.logLevel', 'warn'))
  record('settings', 'set.logLevel.error', await callApi('settings.set', 'general.logLevel', 'error'))
  record('settings', 'set.logLevel.off', await callApi('settings.set', 'general.logLevel', 'off'))
  // 恢复
  record('settings', 'set.logLevel.restore', await callApi('settings.set', 'general.logLevel', originalLogLevel))

  // =========================================================
  // 5. Skills
  // =========================================================
  console.log('\n=== 5. Skills ===')
  record('skill', 'list', await callApi('skill.list'))

  // 保存测试技能
  const testSkillName = '__test_skill_' + Date.now()
  record('skill', 'save', await callApi('skill.save', testSkillName, '# Test Skill\n\nThis is a test skill for testing.'))
  record('skill', 'get', await callApi('skill.get', testSkillName))
  record('skill', 'list_after_save', await callApi('skill.list'))
  record('skill', 'delete', await callApi('skill.delete', testSkillName))
  record('skill', 'get_after_delete', await callApi('skill.get', testSkillName))

  // =========================================================
  // 6. Cron 定时任务
  // =========================================================
  console.log('\n=== 6. Cron ===')
  record('cron', 'list', await callApi('cron.list'))

  const cronListRes = await callApi('cron.list')
  let testTaskId = null
  if (!cronListRes.__error && cronListRes.data) {
    const list = Array.isArray(cronListRes.data) ? cronListRes.data : (cronListRes.data.tasks || [])
    if (list.length > 0) {
      testTaskId = list[0].id || list[0].taskId
    }
  }

  if (testTaskId) {
    record('cron', 'getLogs', await callApi('cron.getLogs', testTaskId))
    record('cron', 'getLogs_all', await callApi('cron.getLogs'))
    // 不测试 runNow(可能触发 agent 执行需要 API key)
  }

  // =========================================================
  // 7. Chat 持久化
  // =========================================================
  console.log('\n=== 7. Chat 持久化 ===')
  record('chat', 'listSessions', await callApi('chat.listSessions'))

  const testSessionId = '__test_session_' + Date.now()
  record('chat', 'saveMessage', await callApi('chat.saveMessage', {
    sessionId: testSessionId,
    role: 'user',
    content: '测试消息',
    timestamp: Date.now(),
  }))
  record('chat', 'saveMessage.assistant', await callApi('chat.saveMessage', {
    sessionId: testSessionId,
    role: 'assistant',
    content: '测试回复',
    timestamp: Date.now() + 1,
  }))
  record('chat', 'loadMessages', await callApi('chat.loadMessages', testSessionId))
  record('chat', 'listSessions_after', await callApi('chat.listSessions'))
  record('chat', 'deleteSession', await callApi('chat.deleteSession', testSessionId))

  // =========================================================
  // 8. Class 班级管理
  // =========================================================
  console.log('\n=== 8. Class 班级管理 ===')
  record('class', 'list', await callApi('class.list'))

  const testClassName = '测试班级_' + Date.now()
  record('class', 'create', await callApi('class.create', {
    name: testClassName,
    grade: '2026',
    remark: '自动化测试创建',
  }))

  const classListRes = await callApi('class.list')
  let testClassId = null
  if (!classListRes.__error && classListRes.data) {
    const list = Array.isArray(classListRes.data) ? classListRes.data : (classListRes.data.classes || [])
    const found = list.find((c) => c.name === testClassName)
    if (found) testClassId = found.id || found.classId
  }

  if (testClassId) {
    record('class', 'update', await callApi('class.update', testClassId, { remark: '更新后的备注' }))
    record('class', 'archive', await callApi('class.archive', testClassId))
    record('class', 'restore', await callApi('class.restore', testClassId))
    record('class', 'delete', await callApi('class.delete', testClassId))
  }

  // =========================================================
  // 9. Profile 学生档案
  // =========================================================
  console.log('\n=== 9. Profile 学生档案 ===')
  if (testStudent) {
    const name = typeof testStudent === 'string' ? testStudent : (testStudent.name || testStudent.student_name)
    if (name) {
      record('profile', 'get', await callApi('profile.get', name))
      record('profile', 'set', await callApi('profile.set', name, {
        note: '测试档案更新',
        updatedAt: Date.now(),
      }))
      record('profile', 'get_after_set', await callApi('profile.get', name))
    }
  } else {
    record('profile', 'get', { __error: 'No test student available' })
  }

  // =========================================================
  // 10. AI / LLM
  // =========================================================
  console.log('\n=== 10. AI / LLM ===')
  record('ai', 'listProviders', await callApi('ai.listProviders'))

  const providersRes = await callApi('ai.listProviders')
  if (!providersRes.__error && providersRes.data) {
    const providers = Array.isArray(providersRes.data) ? providersRes.data : (providersRes.data.providers || [])
    for (const p of providers.slice(0, 3)) {
      const pid = typeof p === 'string' ? p : (p.id || p.providerId)
      if (pid) {
        record('ai', `listModels.${pid}`, await callApi('ai.listModels', pid))
      }
    }
  }

  // =========================================================
  // 11. Log 日志系统
  // =========================================================
  console.log('\n=== 11. Log 日志系统 ===')
  record('log', 'list', await callApi('log.list'))

  const logListRes = await callApi('log.list')
  if (!logListRes.__error && logListRes.data) {
    const logs = Array.isArray(logListRes.data) ? logListRes.data : (logListRes.data.logs || [])
    if (logs.length > 0) {
      const logName = typeof logs[0] === 'string' ? logs[0] : (logs[0].name || logs[0].filename)
      if (logName) {
        record('log', 'read', await callApi('log.read', logName, 20))
        record('log', 'filter', await callApi('log.filter', logName, ['error', 'warn'], 20))
        record('log', 'search', await callApi('log.search', logName, 'error', 10))
      }
    }
  }

  // =========================================================
  // 12. Feishu 飞书
  // =========================================================
  console.log('\n=== 12. Feishu ===')
  record('feishu', 'status', await callApi('feishu.status'))

  // =========================================================
  // 13. System
  // =========================================================
  console.log('\n=== 13. System ===')
  record('sys', 'getPath.userData', await callApi('sys.getPath', 'userData'))

  // =========================================================
  // 汇总
  // =========================================================
  console.log('\n\n============================================================')
  console.log('DEEP FUNCTIONAL TEST SUMMARY')
  console.log('============================================================')
  const byCategory = {}
  let totalOk = 0, totalFail = 0
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { ok: 0, fail: 0, fails: [] }
    if (r.ok) {
      byCategory[r.category].ok++
      totalOk++
    } else {
      byCategory[r.category].fail++
      byCategory[r.category].fails.push(r.name + ': ' + (r.error || '').slice(0, 80))
      totalFail++
    }
  }
  for (const [cat, s] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${s.ok} ok, ${s.fail} fail`)
    for (const f of s.fails) console.log(`    - ${f}`)
  }
  console.log(`\nTotal: ${totalOk} ok, ${totalFail} fail, ${results.length} tests`)

  // 保存详细结果
  const fs = require('fs')
  const outPath = 'C:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round3-deep.json'
  fs.writeFileSync(outPath, JSON.stringify({
    summary: { total: results.length, ok: totalOk, fail: totalFail },
    byCategory,
    results,
  }, null, 2))
  console.log(`Report: ${outPath}`)

  cdp.close()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
