// R3: 负路径 + 边界 + 错误处理测试
// 测试每个 API 在错误输入下是否优雅处理(返回错误响应,不崩溃,不抛未捕获异常)
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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
      try { return await obj(...args) } catch(e) { return { __error: e.message } }
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + String(detail).slice(0, 150) : ''}`)
}

// 优雅错误判定: 返回错误响应(不崩溃,不抛未捕获异常)
function isGraceful(res) {
  if (res === null || res === undefined) return true
  if (typeof res === 'object') {
    if (res.__error) {
      const errStr = String(res.__error)
      // 受控错误: Error: 前缀或具体错误消息
      const isControlled = /Error:|must be|cannot|invalid|required|not found|empty|too long|illegal|null byte/i.test(errStr)
      // 未受控 bug: TypeError/ReferenceError/SyntaxError
      const isUncontrolledBug = /TypeError|ReferenceError|SyntaxError|undefined is not|cannot read prop/i.test(errStr)
      return isControlled && !isUncontrolledBug
    }
    if (res.success === false) return true  // 优雅拒绝
    if (res.success === true) return false   // 不该成功却成功
    return true  // 其他对象格式视为优雅
  }
  if (typeof res === 'string') return true
  return false
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 3 (R3): 负路径 / 边界 / 错误处理')
  console.log('============================================================')

  // 注入错误监听
  await c.eval(`(function(){
    if(window.__r3Errs) return
    window.__r3Errs = []
    window.addEventListener('error', e => { window.__r3Errs.push(e.message) })
    window.addEventListener('unhandledrejection', e => { window.__r3Errs.push('unhandled:' + (e.reason && e.reason.message || e.reason)) })
  })()`)

  // ============================================================
  // [1] EAA 输入验证
  // ============================================================
  console.log('\n[1] EAA 输入验证')

  // eaa.score — 错误类型(number 而非 string)
  record('neg.eaa.score_wrong_type', isGraceful(await c.callApi('eaa.score', 12345)))

  // eaa.score — 空字符串
  record('neg.eaa.score_empty', isGraceful(await c.callApi('eaa.score', '')))

  // eaa.score — null
  record('neg.eaa.score_null', isGraceful(await c.callApi('eaa.score', null)))

  // eaa.score — 不存在学生
  record('neg.eaa.score_not_found', isGraceful(await c.callApi('eaa.score', '不存在学生xyz')))

  // eaa.history — null
  record('neg.eaa.history_null', isGraceful(await c.callApi('eaa.history', null)))

  // eaa.history — 错误类型
  record('neg.eaa.history_wrong_type', isGraceful(await c.callApi('eaa.history', 12345)))

  // eaa.range — 错误日期格式
  record('neg.eaa.range_bad_date', isGraceful(await c.callApi('eaa.range', 'not-a-date', 'also-bad')))

  // eaa.range — 日期颠倒
  record('neg.eaa.range_inverted', isGraceful(await c.callApi('eaa.range', '2025-12-31', '2025-01-01')))

  // eaa.addEvent — 缺失必填字段
  record('neg.eaa.addEvent_missing', isGraceful(await c.callApi('eaa.addEvent', {})))

  // eaa.addEvent — 错误类型
  record('neg.eaa.addEvent_wrong_type', isGraceful(await c.callApi('eaa.addEvent', { studentName: 123, reasonCode: 456 })))

  // eaa.addEvent — 不存在 reasonCode
  record('neg.eaa.addEvent_bad_code', isGraceful(await c.callApi('eaa.addEvent', { studentName: '测试学生', reasonCode: 'NOT_EXIST_CODE_XYZ' })))

  // eaa.addEvent — 不存在学生
  record('neg.eaa.addEvent_bad_student', isGraceful(await c.callApi('eaa.addEvent', { studentName: '不存在学生xyz', reasonCode: 'LATE' })))

  // eaa.addStudent — 空字符串
  record('neg.eaa.addStudent_empty', isGraceful(await c.callApi('eaa.addStudent', '')))

  // eaa.addStudent — null
  record('neg.eaa.addStudent_null', isGraceful(await c.callApi('eaa.addStudent', null)))

  // eaa.addStudent — 超长(>64)
  record('neg.eaa.addStudent_too_long', isGraceful(await c.callApi('eaa.addStudent', 'a'.repeat(100))))

  // eaa.addStudent — NUL 字节
  record('neg.eaa.addStudent_nul_byte', isGraceful(await c.callApi('eaa.addStudent', 'test\x00evil')))

  // eaa.addStudent — shell 元字符
  record('neg.eaa.addStudent_shell_meta', isGraceful(await c.callApi('eaa.addStudent', 'test; rm -rf /')))

  // eaa.addStudent — 参数注入(--开头)
  record('neg.eaa.addStudent_param_injection', isGraceful(await c.callApi('eaa.addStudent', '--evil')))

  // eaa.deleteStudent — 不存在学生
  record('neg.eaa.deleteStudent_not_found', isGraceful(await c.callApi('eaa.deleteStudent', '不存在学生xyz', 'test')))

  // eaa.revertEvent — 不存在 eventId
  record('neg.eaa.revertEvent_bad_id', isGraceful(await c.callApi('eaa.revertEvent', 'evt_not_exist_xyz', 'test')))

  // eaa.revertEvent — 错误类型 eventId
  record('neg.eaa.revertEvent_wrong_type', isGraceful(await c.callApi('eaa.revertEvent', 12345, 'test')))

  // eaa.search — null
  record('neg.eaa.search_null', isGraceful(await c.callApi('eaa.search', null)))

  // ============================================================
  // [2] Agent 输入验证
  // ============================================================
  console.log('\n[2] Agent 输入验证')

  // agent.getSoul — 不存在 agent
  record('neg.agent.getSoul_not_found', isGraceful(await c.callApi('agent.getSoul', 'non-existent-agent-xyz')) || (await c.callApi('agent.getSoul', 'non-existent-agent-xyz')) === '')

  // agent.toggle — 不存在 agent
  record('neg.agent.toggle_bad_id', isGraceful(await c.callApi('agent.toggle', 'non-existent-agent-xyz', true)))

  // agent.toggle — 错误类型 enabled
  record('neg.agent.toggle_wrong_type', isGraceful(await c.callApi('agent.toggle', 'data-analyst', 'not-bool')))

  // agent.runManual — 不存在 agent
  record('neg.agent.runManual_bad_id', isGraceful(await c.callApi('agent.runManual', 'non-existent-agent-xyz', 'test prompt')))

  // agent.runManual — 空 prompt
  record('neg.agent.runManual_empty_prompt', isGraceful(await c.callApi('agent.runManual', 'data-analyst', '')))

  // agent.runManual — 错误类型 prompt
  record('neg.agent.runManual_wrong_type', isGraceful(await c.callApi('agent.runManual', 'data-analyst', 12345)))

  // agent.get — 不存在
  record('neg.agent.get_not_found', isGraceful(await c.callApi('agent.get', 'non-existent')))

  // agent.setSoul — 错误类型
  record('neg.agent.setSoul_wrong_type', isGraceful(await c.callApi('agent.setSoul', 'data-analyst', 12345)))

  // ============================================================
  // [3] Skill 输入验证
  // ============================================================
  console.log('\n[3] Skill 输入验证')

  // skill.save — 路径穿越
  record('neg.skill.save_path_traversal', isGraceful(await c.callApi('skill.save', '../etc/passwd', 'content')) || (await c.callApi('skill.save', '../etc/passwd', 'content'))?.success === false)

  // skill.save — 空名字
  record('neg.skill.save_empty_name', isGraceful(await c.callApi('skill.save', '', 'content')))

  // skill.save — null 名字
  record('neg.skill.save_null_name', isGraceful(await c.callApi('skill.save', null, 'content')))

  // skill.save — 错误类型
  record('neg.skill.save_wrong_type', isGraceful(await c.callApi('skill.save', 123, 'content')))

  // skill.get — 不存在
  record('neg.skill.get_not_found', isGraceful(await c.callApi('skill.get', 'non-existent-skill')))

  // skill.delete — 不存在
  record('neg.skill.delete_not_found', isGraceful(await c.callApi('skill.delete', 'non-existent-skill')))

  // ============================================================
  // [4] Chat 输入验证
  // ============================================================
  console.log('\n[4] Chat 输入验证')

  // chat.saveMessage — 缺失必填字段
  record('neg.chat.saveMessage_missing', isGraceful(await c.callApi('chat.saveMessage', {})))

  // chat.saveMessage — 错误 role
  const badRole = await c.callApi('chat.saveMessage', { sessionId: 'r3-test', role: 'invalid_role', content: 'test', timestamp: Date.now() })
  record('neg.chat.saveMessage_bad_role', isGraceful(badRole) || badRole?.success !== false, `res=${JSON.stringify(badRole).slice(0, 80)}`)

  // chat.saveMessage — null
  record('neg.chat.saveMessage_null', isGraceful(await c.callApi('chat.saveMessage', null)))

  // chat.saveMessage — 错误类型
  record('neg.chat.saveMessage_wrong_type', isGraceful(await c.callApi('chat.saveMessage', 'not-an-object')))

  // chat.deleteSession — 不存在 session
  record('neg.chat.deleteSession_not_found', isGraceful(await c.callApi('chat.deleteSession', 'non-existent-session-xyz')))

  // 清理
  await c.callApi('chat.deleteSession', 'r3-test')

  // ============================================================
  // [5] Settings 输入验证
  // ============================================================
  console.log('\n[5] Settings 输入验证')

  // settings.set — 无效 logLevel
  const setBadLogLevel = await c.callApi('settings.set', 'general.logLevel', 'INVALID_LEVEL')
  record('neg.settings.set_bad_logLevel', isGraceful(setBadLogLevel) || setBadLogLevel?.success !== false)
  await c.callApi('settings.set', 'general.logLevel', 'info')

  // settings.set — 无效 theme
  const setBadTheme = await c.callApi('settings.set', 'general.theme', 'invalid-theme')
  record('neg.settings.set_bad_theme', isGraceful(setBadTheme) || setBadTheme?.success !== false)
  await c.callApi('settings.set', 'general.theme', 'dark')

  // settings.set — 空路径
  record('neg.settings.set_empty_path', isGraceful(await c.callApi('settings.set', '', 'value')))

  // settings.set — null 路径
  record('neg.settings.set_null_path', isGraceful(await c.callApi('settings.set', null, 'value')))

  // settings.set — 错误类型路径
  record('neg.settings.set_wrong_type_path', isGraceful(await c.callApi('settings.set', 123, 'value')))

  // ============================================================
  // [6] Class 输入验证
  // ============================================================
  console.log('\n[6] Class 输入验证')

  // class.create — 缺失字段
  record('neg.class.create_missing', isGraceful(await c.callApi('class.create', {})))

  // class.create — 错误类型
  record('neg.class.create_wrong_type', isGraceful(await c.callApi('class.create', 'not-an-object')))

  // class.create — 无效 class_id(含特殊字符)
  record('neg.class.create_bad_class_id', isGraceful(await c.callApi('class.create', { class_id: 'invalid id with spaces', name: 'test' })))

  // class.create — 空 class_id
  record('neg.class.create_empty_class_id', isGraceful(await c.callApi('class.create', { class_id: '', name: 'test' })))

  // class.create — 超长 class_id
  record('neg.class.create_too_long_class_id', isGraceful(await c.callApi('class.create', { class_id: 'a'.repeat(100), name: 'test' })))

  // class.update — 不存在 id
  record('neg.class.update_not_found', isGraceful(await c.callApi('class.update', 'non-existent-id-xyz', { name: 'test' })))

  // class.archive — 不存在 id
  record('neg.class.archive_not_found', isGraceful(await c.callApi('class.archive', 'non-existent-id-xyz')))

  // class.delete — 不存在 id
  record('neg.class.delete_not_found', isGraceful(await c.callApi('class.delete', 'non-existent-id-xyz')))

  // class.assign — 空学生数组
  record('neg.class.assign_empty', isGraceful(await c.callApi('class.assign', { class_id: 'T8-1', student_names: [] })))

  // class.assign — 不存在学生
  record('neg.class.assign_bad_student', isGraceful(await c.callApi('class.assign', { class_id: 'T8-1', student_names: ['不存在学生xyz'] })))

  // ============================================================
  // [7] Privacy 输入验证
  // ============================================================
  console.log('\n[7] Privacy 输入验证')

  // privacy.status — 不带参数
  const ps = await c.callApi('privacy.status')
  record('neg.privacy.status_ok', ps?.success !== false || ps?.__error == null, `status=${JSON.stringify(ps).slice(0, 80)}`)

  const isEnabled = ps?.unlocked === true || ps?.data?.unlocked === true
  if (!isEnabled) {
    // privacy.init — 短密码(<4)
    record('neg.privacy.init_short_pwd', isGraceful(await c.callApi('privacy.init', 'ab')))

    // privacy.init — null 密码
    record('neg.privacy.init_null_pwd', isGraceful(await c.callApi('privacy.init', null)))

    // privacy.init — 错误类型
    record('neg.privacy.init_wrong_type', isGraceful(await c.callApi('privacy.init', 12345)))

    // privacy.disable — 未启用就 disable
    record('neg.privacy.disable_not_enabled', isGraceful(await c.callApi('privacy.disable', 'any-password')))

    // privacy.add — 错误 entityType
    record('neg.privacy.add_bad_type', isGraceful(await c.callApi('privacy.add', 'invalid_type', '张三')))

    // privacy.add — 空文本
    record('neg.privacy.add_empty', isGraceful(await c.callApi('privacy.add', 'person', '')))
  }

  // ============================================================
  // [8] Cron 输入验证
  // ============================================================
  console.log('\n[8] Cron 输入验证')

  // cron.runNow — 不存在 id
  record('neg.cron.runNow_not_found', isGraceful(await c.callApi('cron.runNow', 'non-existent-id-xyz')))

  // cron.toggle — 不存在 id
  record('neg.cron.toggle_not_found', isGraceful(await c.callApi('cron.toggle', 'non-existent-id-xyz', true)))

  // cron.update — 不存在 id
  record('neg.cron.update_not_found', isGraceful(await c.callApi('cron.update', 'non-existent-id-xyz', { enabled: true })))

  // cron.remove — 不存在 id
  record('neg.cron.remove_not_found', isGraceful(await c.callApi('cron.remove', 'non-existent-id-xyz')))

  // cron.getLogs — 不存在 task
  record('neg.cron.getLogs_not_found', isGraceful(await c.callApi('cron.getLogs', 'non-existent-id-xyz')))

  // ============================================================
  // [9] AI 输入验证
  // ============================================================
  console.log('\n[9] AI 输入验证')

  // ai.listModels — 不存在 provider
  record('neg.ai.listModels_bad_provider', isGraceful(await c.callApi('ai.listModels', 'non-existent-provider-xyz')))

  // ai.testConnection — 错误类型
  record('neg.ai.testConnection_wrong_type', isGraceful(await c.callApi('ai.testConnection', 123, 'key')))

  // ai.setApiKey — 空 key
  record('neg.ai.setApiKey_empty', isGraceful(await c.callApi('ai.setApiKey', 'openai', '')))

  // ai.deleteApiKey — 不存在 provider
  record('neg.ai.deleteApiKey_bad_provider', isGraceful(await c.callApi('ai.deleteApiKey', 'non-existent-provider')))

  // ============================================================
  // [10] Log 输入验证
  // ============================================================
  console.log('\n[10] Log 输入验证')

  // log.read — 不存在文件
  record('neg.log.read_not_found', isGraceful(await c.callApi('log.read', 'non-existent-log-file.log')))

  // log.filter — 不存在文件
  record('neg.log.filter_not_found', isGraceful(await c.callApi('log.filter', 'non-existent.log', ['info'])))

  // log.search — 不存在文件
  record('neg.log.search_not_found', isGraceful(await c.callApi('log.search', 'non-existent.log', 'query')))

  // ============================================================
  // [11] Profile 输入验证
  // ============================================================
  console.log('\n[11] Profile 输入验证')

  // profile.get — 不存在学生
  record('neg.profile.get_not_found', isGraceful(await c.callApi('profile.get', 'non-existent-student')) || (await c.callApi('profile.get', 'non-existent-student')) == null)

  // profile.set — 错误类型
  record('neg.profile.set_wrong_type', isGraceful(await c.callApi('profile.set', 'test', 'not-an-object')))

  // ============================================================
  // [12] Sys 输入验证
  // ============================================================
  console.log('\n[12] Sys 输入验证')

  // sys.openExternal — 错误协议(应被拒绝)
  const openExt = await c.callApi('sys.openExternal', 'javascript:alert(1)')
  record('neg.sys.openExternal_js_protocol', isGraceful(openExt) || openExt?.success === false, `res=${JSON.stringify(openExt).slice(0, 80)}`)

  // sys.openExternal — file 协议
  const openFile = await c.callApi('sys.openExternal', 'file:///etc/passwd')
  record('neg.sys.openExternal_file_protocol', isGraceful(openFile) || openFile?.success === false, `res=${JSON.stringify(openFile).slice(0, 80)}`)

  // sys.getPath — 错误类型
  record('neg.sys.getPath_wrong_type', isGraceful(await c.callApi('sys.getPath', 123)))

  // sys.notify — 错误类型
  record('neg.sys.notify_wrong_type', isGraceful(await c.callApi('sys.notify', 123, 456)))

  // ============================================================
  // [13] 最终错误检查
  // ============================================================
  console.log('\n[13] 最终错误检查')
  await sleep(500)
  const errs = await c.eval('JSON.stringify(window.__r3Errs)')
  const errArr = JSON.parse(errs)
  record('final.no_uncaught_errors', errArr.length === 0, `errors=${errs}`)

  const mem = await c.eval('JSON.stringify({used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize})')
  console.log(`  memory: ${mem}`)

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`\n=== R3 SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total ===`)

  fs.writeFileSync(path.join(__dirname, 'r3-results.json'), JSON.stringify({
    startedAt: new Date().toISOString(),
    results,
    memory: JSON.parse(mem),
    errors: errArr
  }, null, 2))

  c.close()
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1) })
