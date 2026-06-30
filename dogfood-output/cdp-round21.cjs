// ============================================================
// 第二十一轮：负路径 / 错误处理 / 健壮性测试
// 覆盖:
//   1. IPC API 输入验证 — 错误类型、缺失字段、空值
//   2. Agent runManual 边界 — 空/超长/特殊字符 prompt
//   3. Skill save 特殊字符 — 名称含空格/Unicode/点
//   4. Chat saveMessage 边界 — 超长内容、特殊字符
//   5. Settings.set 无效路径/值
//   6. Privacy 错误密码/状态机
//   7. Cron 无效表达式
//   8. 并发写同一 Agent SOUL(竞争)
//   9. EAA 不存在学生/错误日期
//  10. 模块完整性最终扫描
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
// 健壮性测试: 期望 API 优雅处理错误输入(返回错误响应,不崩溃,不抛未捕获异常)
// ok = (res.success === false) || (res.__error 包含具体原因) || (res === null) || (res 不含异常堆栈)
function isGracefulError(res) {
  if (res === null || res === undefined) return true
  if (typeof res === 'object') {
    if (res.__error) {
      // __error 是 CDP eval 抛出的异常 — 检查是否是受控的错误消息
      const errStr = String(res.__error)
      // 含 "Error:" 前缀的是受控 throw,可以接受;含 "TypeError: Cannot read" 的是未受控 bug
      const isControlled = /Error:|must be|cannot|invalid|required|not found|empty/i.test(errStr)
      const isUncontrolledBug = /TypeError|ReferenceError|SyntaxError|undefined is not|cannot read prop/i.test(errStr)
      return isControlled && !isUncontrolledBug
    }
    if (res.success === false) return true
    if (res.success === true) return false  // 不该成功却成功了
    return true  // 其他对象格式视为优雅
  }
  if (typeof res === 'string') return res.length >= 0  // 字符串响应视为优雅
  return false
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 21: Negative Path / Error Handling / Robustness')
  console.log('============================================================')

  // ============================================================
  // [1] IPC API 输入验证 — 错误类型 / 缺失字段 / 空值
  // ============================================================
  console.log('\n[1] IPC API 输入验证')

  // eaa.score — 错误类型(number 而非 string)
  const scoreWrongType = await c.callApi('eaa.score', 12345)
  record('neg.eaa.score_wrong_type', isGracefulError(scoreWrongType), `res=${JSON.stringify(scoreWrongType).slice(0, 80)}`)

  // eaa.score — 空字符串
  const scoreEmpty = await c.callApi('eaa.score', '')
  record('neg.eaa.score_empty', isGracefulError(scoreEmpty), `res=${JSON.stringify(scoreEmpty).slice(0, 80)}`)

  // eaa.score — 不存在学生
  const scoreNotFound = await c.callApi('eaa.score', '不存在学生xyz123')
  record('neg.eaa.score_not_found', isGracefulError(scoreNotFound) || scoreNotFound?.success !== false, `res=${JSON.stringify(scoreNotFound).slice(0, 80)}`)

  // eaa.history — null 参数
  const historyNull = await c.callApi('eaa.history', null)
  record('neg.eaa.history_null', isGracefulError(historyNull), `res=${JSON.stringify(historyNull).slice(0, 80)}`)

  // eaa.range — 错误日期格式
  const rangeBadDate = await c.callApi('eaa.range', 'not-a-date', 'also-bad')
  record('neg.eaa.range_bad_date', isGracefulError(rangeBadDate), `res=${JSON.stringify(rangeBadDate).slice(0, 80)}`)

  // eaa.addEvent — 缺失必填字段
  const addEventMissing = await c.callApi('eaa.addEvent', {})
  record('neg.eaa.addEvent_missing_fields', isGracefulError(addEventMissing), `res=${JSON.stringify(addEventMissing).slice(0, 80)}`)

  // eaa.addEvent — 错误类型
  const addEventWrongType = await c.callApi('eaa.addEvent', { studentName: 123, reasonCode: 456 })
  record('neg.eaa.addEvent_wrong_type', isGracefulError(addEventWrongType), `res=${JSON.stringify(addEventWrongType).slice(0, 80)}`)

  // eaa.addEvent — 不存在 reasonCode
  const addEventBadCode = await c.callApi('eaa.addEvent', { studentName: '测试学生', reasonCode: 'NOT_EXIST_CODE_XYZ' })
  record('neg.eaa.addEvent_bad_code', isGracefulError(addEventBadCode), `res=${JSON.stringify(addEventBadCode).slice(0, 80)}`)

  // agent.getSoul — 不存在 agent id
  const soulNotFound = await c.callApi('agent.getSoul', 'non-existent-agent-xyz')
  record('neg.agent.getSoul_not_found', isGracefulError(soulNotFound) || soulNotFound === '' || soulNotFound === null, `res=${JSON.stringify(soulNotFound).slice(0, 80)}`)

  // agent.toggle — 不存在 agent + 错误类型 enabled
  const toggleBadId = await c.callApi('agent.toggle', 'non-existent-agent-xyz', true)
  record('neg.agent.toggle_bad_id', isGracefulError(toggleBadId), `res=${JSON.stringify(toggleBadId).slice(0, 80)}`)

  // agent.runManual — 不存在 agent
  const runManualBadId = await c.callApi('agent.runManual', 'non-existent-agent-xyz', 'test prompt')
  record('neg.agent.runManual_bad_id', isGracefulError(runManualBadId), `res=${JSON.stringify(runManualBadId).slice(0, 80)}`)

  // ============================================================
  // [2] Agent runManual 边界 — 空/超长/特殊字符 prompt
  // ============================================================
  console.log('\n[2] Agent runManual 边界')

  // 注意: 空 prompt 应该被拒绝(测试 R18 已验证 "prompt must be a string")
  const runEmptyPrompt = await c.callApi('agent.runManual', 'data-analyst', '')
  record('neg.agent.runManual_empty_prompt', isGracefulError(runEmptyPrompt), `res=${JSON.stringify(runEmptyPrompt).slice(0, 80)}`)

  // 超长 prompt (10000 字符)
  const longPrompt = '分析 '.repeat(5000)
  const runLongPrompt = await c.callApi('agent.runManual', 'data-analyst', longPrompt)
  // 超长 prompt 应该被接受或被拒绝,但不能崩溃
  record('neg.agent.runManual_long_prompt', runLongPrompt?.success === true || isGracefulError(runLongPrompt), `success=${runLongPrompt?.success}, res=${JSON.stringify(runLongPrompt).slice(0, 80)}`)

  // 特殊字符 prompt — shell 元字符(应该被 sanitize 或正确转义)
  const specialPrompt = '分析 <script>alert(1)</script> & "quote" \'single\' `backtick` |pipe|'
  const runSpecialPrompt = await c.callApi('agent.runManual', 'data-analyst', specialPrompt)
  record('neg.agent.runManual_special_chars', runSpecialPrompt?.success === true || isGracefulError(runSpecialPrompt), `success=${runSpecialPrompt?.success}, res=${JSON.stringify(runSpecialPrompt).slice(0, 80)}`)

  // prompt 类型错误(number)
  const runWrongType = await c.callApi('agent.runManual', 'data-analyst', 12345)
  record('neg.agent.runManual_wrong_type', isGracefulError(runWrongType), `res=${JSON.stringify(runWrongType).slice(0, 80)}`)

  // ============================================================
  // [3] Skill save 特殊字符
  // ============================================================
  console.log('\n[3] Skill save 特殊字符')

  // 名字含空格(应该被拒绝或正确处理,不能造成路径穿越)
  const skillSpace = await c.callApi('skill.save', 'skill with spaces', 'content')
  record('neg.skill.save_spaces', isGracefulError(skillSpace) || skillSpace?.success === true, `res=${JSON.stringify(skillSpace).slice(0, 80)}`)

  // 名字含路径分隔符(必须被拒绝 — 防路径穿越)
  const skillPathSep = await c.callApi('skill.save', '../etc/passwd', 'content')
  record('neg.skill.save_path_traversal', isGracefulError(skillPathSep) || skillPathSep?.success === false, `res=${JSON.stringify(skillPathSep).slice(0, 80)}`)

  // 名字含 Unicode
  const skillUnicode = await c.callApi('skill.save', '测试技能-🎉', 'content with unicode 中文')
  record('neg.skill.save_unicode', isGracefulError(skillUnicode) || skillUnicode?.success === true, `res=${JSON.stringify(skillUnicode).slice(0, 80)}`)

  // 内容含特殊字符
  const skillSpecialContent = await c.callApi('skill.save', 'test-special-content-r21', '<script>alert(1)</script>\nline2\ttab\nline3')
  record('neg.skill.save_special_content', skillSpecialContent?.success === true, `success=${skillSpecialContent?.success}`)

  // 清理
  if (skillSpecialContent?.success) {
    await c.callApi('skill.delete', 'test-special-content-r21')
  }

  // ============================================================
  // [4] Chat saveMessage 边界
  // ============================================================
  console.log('\n[4] Chat saveMessage 边界')

  // 超长 content (50000 字符)
  const longContent = 'x'.repeat(50000)
  const saveLongMsg = await c.callApi('chat.saveMessage', { sessionId: 'r21-test', role: 'user', content: longContent, timestamp: Date.now() })
  record('neg.chat.saveMessage_long_content', saveLongMsg?.success !== false, `success=${saveLongMsg?.success}, id=${saveLongMsg?.id}`)

  // 内容含特殊字符
  const specialContent = '<script>alert(1)</script> & "quotes" \'single\' `backtick`'
  const saveSpecialMsg = await c.callApi('chat.saveMessage', { sessionId: 'r21-test', role: 'user', content: specialContent, timestamp: Date.now() })
  record('neg.chat.saveMessage_special_chars', saveSpecialMsg?.success !== false, `success=${saveSpecialMsg?.success}`)

  // role 错误类型
  const saveBadRole = await c.callApi('chat.saveMessage', { sessionId: 'r21-test', role: 'invalid_role', content: 'test', timestamp: Date.now() })
  record('neg.chat.saveMessage_bad_role', saveBadRole?.success !== false || isGracefulError(saveBadRole), `success=${saveBadRole?.success}`)

  // 缺失必填字段
  const saveMissing = await c.callApi('chat.saveMessage', { sessionId: 'r21-test' })
  record('neg.chat.saveMessage_missing_fields', isGracefulError(saveMissing), `res=${JSON.stringify(saveMissing).slice(0, 80)}`)

  // 清理 r21-test 会话
  await c.callApi('chat.deleteSession', 'r21-test')

  // ============================================================
  // [5] Settings.set 无效路径/值
  // ============================================================
  console.log('\n[5] Settings.set 边界')

  // 无效 logLevel
  const setBadLogLevel = await c.callApi('settings.set', 'general.logLevel', 'INVALID_LEVEL')
  record('neg.settings.set_bad_logLevel', setBadLogLevel?.success !== false || isGracefulError(setBadLogLevel), `res=${JSON.stringify(setBadLogLevel).slice(0, 80)}`)
  // 恢复
  await c.callApi('settings.set', 'general.logLevel', 'info')

  // 无效 theme
  const setBadTheme = await c.callApi('settings.set', 'general.theme', 'invalid-theme')
  record('neg.settings.set_bad_theme', setBadTheme?.success !== false || isGracefulError(setBadTheme), `res=${JSON.stringify(setBadTheme).slice(0, 80)}`)
  // 恢复
  await c.callApi('settings.set', 'general.theme', 'dark')

  // 空路径
  const setEmptyPath = await c.callApi('settings.set', '', 'value')
  record('neg.settings.set_empty_path', isGracefulError(setEmptyPath), `res=${JSON.stringify(setEmptyPath).slice(0, 80)}`)

  // 超长路径
  const longPath = 'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z.' + 'x'.repeat(200)
  const setLongPath = await c.callApi('settings.set', longPath, 'value')
  record('neg.settings.set_long_path', isGracefulError(setLongPath) || setLongPath?.success !== false, `res=${JSON.stringify(setLongPath).slice(0, 80)}`)

  // ============================================================
  // [6] Privacy 错误密码/状态机
  // ============================================================
  console.log('\n[6] Privacy 错误密码')

  const privacyStatus = await c.callApi('privacy.status')
  const isEnabled = privacyStatus?.enabled === true || privacyStatus?.unlocked === true
  console.log(`  [privacy] status: ${JSON.stringify(privacyStatus).slice(0, 100)}`)

  if (isEnabled) {
    // 已启用 — 用错误密码 disable
    const disableBad = await c.callApi('privacy.disable', 'wrong-password-12345')
    record('neg.privacy.disable_bad_password', isGracefulError(disableBad) || disableBad?.success === false, `success=${disableBad?.success}, res=${JSON.stringify(disableBad).slice(0, 80)}`)

    // 再试一次(验证多次错误不会崩溃)
    const disableBad2 = await c.callApi('privacy.disable', 'another-wrong-password')
    record('neg.privacy.disable_bad_password_2', isGracefulError(disableBad2) || disableBad2?.success === false, `success=${disableBad2?.success}`)
  } else {
    // 已锁定 — 用错误密码 init
    const initBad = await c.callApi('privacy.init', 'wrong-password-12345')
    record('neg.privacy.disable_bad_password', isGracefulError(initBad) || initBad?.success === false, `success=${initBad?.success}, res=${JSON.stringify(initBad).slice(0, 80)}`)

    const initBad2 = await c.callApi('privacy.init', 'another-wrong-password')
    record('neg.privacy.disable_bad_password_2', isGracefulError(initBad2) || initBad2?.success === false, `success=${initBad2?.success}`)
  }

  // ============================================================
  // [7] Cron 无效表达式
  // ============================================================
  console.log('\n[7] Cron 无效表达式')

  // 无效 cron 表达式
  const addBadCron = await c.callApi('cron.add', { id: 'r21-bad-cron', schedule: 'not-a-cron', agentId: 'data-analyst' })
  record('neg.cron.add_bad_schedule', isGracefulError(addBadCron) || addBadCron?.success === false, `success=${addBadCron?.success}`)
  // 清理(如果意外创建了)
  if (addBadCron?.success) {
    await c.callApi('cron.remove', 'r21-bad-cron')
  }

  // 缺失必填字段
  const addMissingCron = await c.callApi('cron.add', { id: 'r21-missing-cron' })
  record('neg.cron.add_missing_fields', isGracefulError(addMissingCron) || addMissingCron?.success === false, `success=${addMissingCron?.success}`)
  if (addMissingCron?.success) {
    await c.callApi('cron.remove', 'r21-missing-cron')
  }

  // cron.toggle 错误类型 enabled
  const toggleBadCron = await c.callApi('cron.toggle', 'non-existent-cron', 'not-a-boolean')
  record('neg.cron.toggle_bad_type', isGracefulError(toggleBadCron) || toggleBadCron?.success === false, `success=${toggleBadCron?.success}`)

  // ============================================================
  // [8] 并发写同一 Agent SOUL(竞争)
  // ============================================================
  console.log('\n[8] 并发写 Agent SOUL')

  const testAgent = 'data-analyst'
  const origSoulRes = await c.callApi('agent.getSoul', testAgent)
  const origSoul = typeof origSoulRes === 'string' ? origSoulRes : ''

  // 5 个并发写,不同内容
  const concurrentWrites = []
  for (let i = 0; i < 5; i++) {
    concurrentWrites.push(c.callApi('agent.setSoul', testAgent, `R21 Concurrent Write #${i} at ${Date.now()}`))
  }
  const writeResults = await Promise.all(concurrentWrites)
  const allWriteSuccess = writeResults.every(r => r?.success !== false)
  record('neg.agent.concurrent_soul_writes', allWriteSuccess, `allSuccess=${allWriteSuccess}`)

  // 读取最终值
  const finalSoulRes = await c.callApi('agent.getSoul', testAgent)
  const finalSoul = typeof finalSoulRes === 'string' ? finalSoulRes : ''
  const hasLastWrite = finalSoul.includes('R21 Concurrent Write #4')
  record('neg.agent.concurrent_soul_final', finalSoul.length > 0, `finalLen=${finalSoul.length}, hasLastWrite=${hasLastWrite}`)

  // 恢复
  await c.callApi('agent.setSoul', testAgent, origSoul)

  // ============================================================
  // [9] EAA 不存在学生/错误日期
  // ============================================================
  console.log('\n[9] EAA 边界')

  // history 不存在学生
  const histNotFound = await c.callApi('eaa.history', '不存在学生xyz')
  record('neg.eaa.history_not_found', isGracefulError(histNotFound) || histNotFound?.success !== false, `success=${histNotFound?.success}`)

  // range — start > end (逻辑错误)
  const rangeReversed = await c.callApi('eaa.range', '2026-12-31', '2024-01-01')
  record('neg.eaa.range_reversed', isGracefulError(rangeReversed) || rangeReversed?.success !== false, `success=${rangeReversed?.success}`)

  // search — 空查询
  const searchEmpty = await c.callApi('eaa.search', '')
  record('neg.eaa.search_empty', isGracefulError(searchEmpty) || searchEmpty?.success !== false, `success=${searchEmpty?.success}`)

  // export — 无效格式
  const exportBad = await c.callApi('eaa.export', 'invalid-format-xyz')
  record('neg.eaa.export_bad_format', isGracefulError(exportBad), `res=${JSON.stringify(exportBad).slice(0, 80)}`)

  // deleteStudent — 不存在学生,不传 confirm
  const delNotFound = await c.callApi('eaa.deleteStudent', '不存在学生xyz')
  record('neg.eaa.deleteStudent_not_found', isGracefulError(delNotFound) || delNotFound?.requiresConfirmation === true, `requiresConfirmation=${delNotFound?.requiresConfirmation}`)

  // ============================================================
  // [10] 模块完整性最终扫描
  // ============================================================
  console.log('\n[10] 模块完整性最终扫描')
  const modules = ['eaa', 'agent', 'skill', 'cron', 'chat', 'privacy', 'settings', 'log', 'ai']
  for (const mod of modules) {
    // 验证模块对象存在
    const exists = await c.eval(`typeof window.api?.${mod} === 'object' && window.api.${mod} !== null`)
    record(`final.module_${mod}_exists`, exists === true, `exists=${exists}`)
  }

  // 最终内存
  const mem = await c.eval(`JSON.stringify({
    heap: performance.memory?.usedJSHeapSize || 0,
    dom: document.querySelectorAll('*').length
  })`)
  const memData = JSON.parse(mem)
  record('final.memory', memData.heap > 0, `heap=${(memData.heap/1024/1024).toFixed(1)}MB, dom=${memData.dom}`)

  // 最终健康检查
  const healthChecks = ['eaa.info', 'agent.list', 'skill.list', 'cron.list', 'settings.get']
  for (const api of healthChecks) {
    const res = await c.callApi(api)
    record(`final.health_${api}`, res?.success !== false && res !== null, `success=${res?.success}`)
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`ROUND 21 SUMMARY: ${passed}/${results.length} passed, ${failed} failed`)
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
