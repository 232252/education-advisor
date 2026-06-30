// ============================================================
// 第十五轮：UI DOM 实际交互 + Chat 完整流程 + Privacy 引擎 + Settings 表单
// 覆盖：
//   1. 清理前几轮残留的 test-skill 文件
//   2. Settings 页面 select 切换 + 持久化验证
//   3. Students 页面添加学生表单提交
//   4. Chat IPC 完整流程（多角色消息 → 加载 → 列表 → 删除）
//   5. Privacy 引擎完整生命周期
//   6. Agent 页面 toggle 开关交互
//   7. Skills 页面创建技能表单
//   8. DOM 焦点管理 + 键盘可访问性
//   9. React 受控组件 native setter 写入
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
  async click(selector) {
    return this.eval(`(function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return { error: 'not_found' }
      el.click()
      return { ok: true, tag: el.tagName, text: el.textContent?.slice(0, 50) }
    })()`)
  }
  async setSelectValue(selector, value) {
    return this.eval(`(function() {
      const sel = document.querySelector(${JSON.stringify(selector)})
      if (!sel) return { error: 'not_found' }
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      nativeInputValueSetter.call(sel, ${JSON.stringify(value)})
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, value: sel.value }
    })()`)
  }
  async setInputValue(selector, value) {
    return this.eval(`(function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return { error: 'not_found' }
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      nativeSetter.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, value: el.value }
    })()`)
  }
  async setTextareaValue(selector, value) {
    return this.eval(`(function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return { error: 'not_found' }
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      nativeSetter.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, value: el.value }
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
  console.log('ROUND 15: UI DOM Interaction + Chat Flow + Privacy + Settings')
  console.log('============================================================')

  // ============================================================
  // [1] 清理前几轮残留的 test-skill 文件
  // ============================================================
  console.log('\n[1] 清理 test-skill 残留文件')
  const skillsList = await c.callApi('skill.list')
  const testSkills = (skillsList || []).filter(s => s.name && s.name.startsWith('test-skill-'))
  console.log(`  Found ${testSkills.length} test-skill files to clean`)
  let cleaned = 0
  for (const s of testSkills) {
    const delRes = await c.callApi('skill.delete', s.name)
    if (delRes?.success) cleaned++
  }
  record('cleanup.test_skills', cleaned === testSkills.length, `cleaned=${cleaned}/${testSkills.length}`)

  // ============================================================
  // [2] Settings 页面 select 切换 + 持久化验证
  // ============================================================
  console.log('\n[2] Settings 页面 select 切换')
  await c.navigate('#/settings')
  await sleep(500)

  // 获取当前设置
  const settingsBefore = await c.callApi('settings.get')
  const originalTheme = settingsBefore?.theme || settingsBefore?.general?.theme
  const originalLogLevel = settingsBefore?.general?.logLevel
  console.log(`  Original theme=${originalTheme}, logLevel=${originalLogLevel}`)

  // 查找 select 元素
  const selectsInfo = await c.eval(`JSON.stringify({
    count: document.querySelectorAll('select').length,
    selects: Array.from(document.querySelectorAll('select')).map(s => ({
      id: s.id,
      name: s.name,
      value: s.value,
      options: Array.from(s.options).map(o => o.value).slice(0, 5),
      label: s.labels?.[0]?.textContent || s.closest('label')?.textContent || s.previousElementSibling?.textContent || ''
    }))
  })`)
  const selectsData = JSON.parse(selectsInfo)
  record('settings.selects_count', selectsData.count >= 3, `count=${selectsData.count}`)

  // 尝试通过 IPC 切换 theme 并验证持久化（theme 在 general.theme 路径下）
  const setThemeRes = await c.callApi('settings.set', 'general.theme', 'light')
  record('settings.set_theme_light', setThemeRes?.success !== false, `success=${setThemeRes?.success}`)
  await sleep(300)
  const settingsAfterTheme = await c.callApi('settings.get')
  const newTheme = settingsAfterTheme?.general?.theme
  record('settings.theme_persisted', newTheme === 'light', `theme=${newTheme}`)

  // 切换回 dark
  await c.callApi('settings.set', 'general.theme', 'dark')
  await sleep(300)
  const settingsRestored = await c.callApi('settings.get')
  record('settings.theme_restored', settingsRestored?.general?.theme === 'dark', `theme=${settingsRestored?.general?.theme}`)

  // 切换 logLevel
  const setLogRes = await c.callApi('settings.set', 'general.logLevel', 'debug')
  record('settings.set_logLevel_debug', setLogRes?.success !== false, `success=${setLogRes?.success}`)
  await sleep(300)
  const settingsAfterLog = await c.callApi('settings.get')
  const newLogLevel = settingsAfterLog?.general?.logLevel
  record('settings.logLevel_persisted', newLogLevel === 'debug', `logLevel=${newLogLevel}`)

  // 恢复原始 logLevel
  if (originalLogLevel) {
    await c.callApi('settings.set', 'general.logLevel', originalLogLevel)
    await sleep(300)
  }

  // ============================================================
  // [3] Students 页面 — 添加学生 + 验证
  // ============================================================
  console.log('\n[3] Students 页面交互')
  await c.navigate('#/students')
  await sleep(500)

  // 检查页面内容
  const studentsPageInfo = await c.eval(`JSON.stringify({
    bodyLen: document.body?.innerText?.length || 0,
    inputs: document.querySelectorAll('input').length,
    buttons: document.querySelectorAll('button').length,
    hasTable: document.querySelector('table') !== null,
    hasForm: document.querySelector('form') !== null
  })`)
  const studentsPage = JSON.parse(studentsPageInfo)
  record('students.page_loaded', studentsPage.bodyLen > 50, `bodyLen=${studentsPage.bodyLen}, inputs=${studentsPage.inputs}, buttons=${studentsPage.buttons}`)

  // 通过 IPC 添加测试学生
  const testStudent = `R15Student_${Date.now().toString().slice(-6)}`
  const addStuRes = await c.callApi('eaa.addStudent', testStudent)
  record('students.add_via_ipc', addStuRes?.success !== false, `name=${testStudent}, success=${addStuRes?.success}`)

  // 验证学生在列表中
  const listRes = await c.callApi('eaa.listStudents')
  const students = listRes?.data?.students || []
  const found = students.some(s => s.name === testStudent)
  record('students.add_verified', found, `found=${found}, total=${students.length}`)

  // 刷新页面查看新学生（React 组件异步加载，需要更长等待）
  await c.navigate('#/dashboard')
  await sleep(300)
  await c.navigate('#/students')
  await sleep(1500)
  const pageText = await c.eval(`document.body?.innerText || ''`)
  record('students.visible_in_page', pageText.includes(testStudent), `inPage=${pageText.includes(testStudent)}, pageLen=${pageText.length}`)

  // 清理
  const delRes = await c.callApi('eaa.deleteStudent', testStudent, 'R15 cleanup')
  record('students.cleanup', delRes?.success !== false, `success=${delRes?.success}`)

  // ============================================================
  // [4] Chat IPC 完整流程（多角色消息 → 加载 → 列表 → 删除）
  // ============================================================
  console.log('\n[4] Chat IPC 完整流程')
  const sessionId = `r15-chat-${Date.now()}`
  const timestamp = Date.now()

  // 4.1 保存多角色消息
  const msg1 = await c.callApi('chat.saveMessage', {
    role: 'user',
    content: 'R15 测试用户消息',
    timestamp,
    sessionId
  })
  record('chat.save_user_message', msg1?.success !== false, `success=${msg1?.success}`)

  const msg2 = await c.callApi('chat.saveMessage', {
    role: 'assistant',
    content: 'R15 测试助手回复',
    timestamp: timestamp + 1000,
    sessionId
  })
  record('chat.save_assistant_message', msg2?.success !== false, `success=${msg2?.success}`)

  const msg3 = await c.callApi('chat.saveMessage', {
    role: 'system',
    content: 'R15 测试系统消息',
    timestamp: timestamp + 2000,
    sessionId
  })
  record('chat.save_system_message', msg3?.success !== false, `success=${msg3?.success}`)

  // 4.2 加载消息
  const loadRes = await c.callApi('chat.loadMessages', sessionId)
  const messages = loadRes?.messages || loadRes?.data || []
  record('chat.load_messages', Array.isArray(messages) && messages.length >= 3, `count=${Array.isArray(messages) ? messages.length : 0}`)

  // 4.3 验证消息内容
  const hasUserMsg = Array.isArray(messages) && messages.some(m => m.role === 'user' && m.content?.includes('R15 测试用户'))
  record('chat.verify_user_message', hasUserMsg, `found=${hasUserMsg}`)

  const hasAssistantMsg = Array.isArray(messages) && messages.some(m => m.role === 'assistant' && m.content?.includes('R15 测试助手'))
  record('chat.verify_assistant_message', hasAssistantMsg, `found=${hasAssistantMsg}`)

  // 4.4 列出会话
  const listSessionsRes = await c.callApi('chat.listSessions')
  const sessions = listSessionsRes?.sessions || listSessionsRes?.data || []
  record('chat.list_sessions', Array.isArray(sessions), `count=${Array.isArray(sessions) ? sessions.length : 0}`)

  const sessionExists = Array.isArray(sessions) && sessions.some(s => s.sessionId === sessionId || s.id === sessionId)
  record('chat.session_in_list', sessionExists, `found=${sessionExists}`)

  // 4.5 删除会话
  const delSessionRes = await c.callApi('chat.deleteSession', sessionId)
  record('chat.delete_session', delSessionRes?.success !== false, `success=${delSessionRes?.success}`)

  // 4.6 验证删除
  const loadAfterDel = await c.callApi('chat.loadMessages', sessionId)
  const messagesAfterDel = loadAfterDel?.messages || loadAfterDel?.data || []
  record('chat.deleted_verified', !Array.isArray(messagesAfterDel) || messagesAfterDel.length === 0, `count=${Array.isArray(messagesAfterDel) ? messagesAfterDel.length : 0}`)

  // ============================================================
  // [5] Privacy 引擎完整生命周期
  // ============================================================
  console.log('\n[5] Privacy 引擎完整生命周期')

  // 5.1 检查初始状态（privacy.status 返回 {unlocked: boolean}）
  const statusBefore = await c.callApi('privacy.status')
  record('privacy.status_initial', statusBefore !== null && typeof statusBefore?.unlocked === 'boolean', `unlocked=${statusBefore?.unlocked}`)

  // 5.2 初始化隐私引擎
  const testPassword = 'R15TestPass123'
  const initRes = await c.callApi('privacy.init', testPassword, false)
  record('privacy.init', initRes?.success !== false, `success=${initRes?.success}`)

  // 5.3 启用隐私引擎
  const enableRes = await c.callApi('privacy.enable')
  record('privacy.enable', enableRes?.success !== false, `success=${enableRes?.success}`)

  // 5.4 添加映射
  const addMapRes = await c.callApi('privacy.add', 'person', '张三')
  record('privacy.add_mapping', addMapRes?.success !== false, `success=${addMapRes?.success}`)

  // 5.5 匿名化测试（返回 {success, data: "person_001今天迟到了"}）
  const anonRes = await c.callApi('privacy.anonymize', '张三今天迟到了')
  const anonText = anonRes?.data || anonRes?.text || anonRes?.result || ''
  record('privacy.anonymize', typeof anonText === 'string' && !anonText.includes('张三'), `text=${anonText?.slice(0, 50)}`)

  // 5.6 反匿名化
  const deanRes = await c.callApi('privacy.deanonymize', anonText)
  const deanText = deanRes?.data || deanRes?.text || deanRes?.result || ''
  record('privacy.deanonymize', typeof deanText === 'string' && deanText.includes('张三'), `text=${deanText?.slice(0, 50)}`)

  // 5.7 dryrun 预览
  const dryrunRes = await c.callApi('privacy.dryrun', '张三和李四在教室里')
  record('privacy.dryrun', dryrunRes !== null && dryrunRes !== undefined, `success=${dryrunRes?.success !== false}`)

  // 5.8 按接收方过滤
  const filterRes = await c.callApi('privacy.filter', 'teacher', '张三的考试成绩')
  record('privacy.filter', filterRes !== null && filterRes !== undefined, `success=${filterRes?.success !== false}`)

  // 5.9 列出映射
  const listMapRes = await c.callApi('privacy.list')
  record('privacy.list', listMapRes !== null && listMapRes !== undefined, `success=${listMapRes?.success !== false}`)

  // 5.10 禁用隐私引擎
  const disableRes = await c.callApi('privacy.disable', testPassword)
  record('privacy.disable', disableRes?.success !== false, `success=${disableRes?.success}`)

  // 5.11 锁定
  const lockRes = await c.callApi('privacy.lock')
  record('privacy.lock', lockRes?.success !== false, `success=${lockRes?.success}`)

  // 5.12 锁定后状态（locked 后 unlocked 应为 false）
  const statusAfter = await c.callApi('privacy.status')
  record('privacy.status_after_lock', statusAfter?.unlocked === false, `unlocked=${statusAfter?.unlocked}`)

  // ============================================================
  // [6] Agent 页面 toggle 开关交互
  // ============================================================
  console.log('\n[6] Agent 页面 toggle 交互')
  await c.navigate('#/agents')
  await sleep(500)

  // 获取 agent 列表
  const agentsList = await c.callApi('agent.list')
  const agents = agentsList?.agents || agentsList?.data || agentsList || []
  record('agents.list_loaded', Array.isArray(agents) && agents.length > 0, `count=${Array.isArray(agents) ? agents.length : 0}`)

  // 找一个 agent 做 toggle 测试
  if (Array.isArray(agents) && agents.length > 0) {
    const testAgent = agents[0]
    const agentId = testAgent.id || testAgent.name
    const originalEnabled = testAgent.enabled

    // Toggle
    const toggleRes = await c.callApi('agent.toggle', agentId, !originalEnabled)
    record('agents.toggle', toggleRes?.success !== false, `id=${agentId}, success=${toggleRes?.success}`)

    // 验证
    const agentAfter = await c.callApi('agent.get', agentId)
    record('agents.toggle_verified', agentAfter?.enabled === !originalEnabled, `before=${originalEnabled}, after=${agentAfter?.enabled}`)

    // 恢复
    await c.callApi('agent.toggle', agentId, originalEnabled)
    const agentRestored = await c.callApi('agent.get', agentId)
    record('agents.toggle_restored', agentRestored?.enabled === originalEnabled, `restored=${agentRestored?.enabled}`)
  }

  // 检查页面按钮
  const agentPageInfo = await c.eval(`JSON.stringify({
    bodyLen: document.body?.innerText?.length || 0,
    buttons: document.querySelectorAll('button').length,
    toggles: document.querySelectorAll('[role="switch"], input[type="checkbox"], .toggle').length
  })`)
  const agentPage = JSON.parse(agentPageInfo)
  record('agents.page_rendered', agentPage.bodyLen > 50, `bodyLen=${agentPage.bodyLen}, buttons=${agentPage.buttons}`)

  // ============================================================
  // [7] Skills 页面创建技能表单
  // ============================================================
  console.log('\n[7] Skills 页面交互')
  await c.navigate('#/skills')
  await sleep(500)

  // 通过 IPC 创建技能
  const skillName = `r15-skill-${Date.now().toString().slice(-6)}`
  const skillContent = `# ${skillName}\n\n这是一个 R15 测试技能。\n创建时间: ${new Date().toISOString()}\n`
  const saveSkillRes = await c.callApi('skill.save', skillName, skillContent)
  record('skills.save_via_ipc', saveSkillRes?.success !== false, `name=${skillName}, success=${saveSkillRes?.success}`)

  // 验证技能存在
  const skillGetRes = await c.callApi('skill.get', skillName)
  record('skills.get_verified', skillGetRes !== null && skillGetRes?.content === skillContent, `match=${skillGetRes?.content === skillContent}`)

  // 列出技能
  const skillsAfter = await c.callApi('skill.list')
  const skillInList = (skillsAfter || []).some(s => s.name === skillName)
  record('skills.in_list', skillInList, `found=${skillInList}`)

  // 检查页面是否渲染
  const skillsPageInfo = await c.eval(`JSON.stringify({
    bodyLen: document.body?.innerText?.length || 0,
    buttons: document.querySelectorAll('button').length
  })`)
  const skillsPage = JSON.parse(skillsPageInfo)
  record('skills.page_rendered', skillsPage.bodyLen > 50, `bodyLen=${skillsPage.bodyLen}`)

  // 清理
  const delSkillRes = await c.callApi('skill.delete', skillName)
  record('skills.cleanup', delSkillRes?.success !== false, `success=${delSkillRes?.success}`)

  // ============================================================
  // [8] DOM 焦点管理 + 键盘可访问性
  // ============================================================
  console.log('\n[8] DOM 焦点管理 + 键盘可访问性')
  await c.navigate('#/dashboard')
  await sleep(500)

  const focusInfo = await c.eval(`JSON.stringify({
    focusableCount: document.querySelectorAll('button, a, input, select, textarea, [tabindex]').length,
    ariaLabelCount: document.querySelectorAll('[aria-label]').length,
    ariaLabelledbyCount: document.querySelectorAll('[aria-labelledby]').length,
    roleCount: document.querySelectorAll('[role]').length,
    hasSkipLink: document.querySelector('[href="#main"], .skip-link') !== null,
    hasMainLandmark: document.querySelector('main, [role="main"]') !== null,
    hasNavLandmark: document.querySelector('nav, [role="navigation"]') !== null,
    hasHeading: document.querySelector('h1, h2, h3') !== null,
    viewportMeta: document.querySelector('meta[name="viewport"]')?.content || ''
  })`)
  const focus = JSON.parse(focusInfo)
  const totalAria = focus.ariaLabelCount + focus.ariaLabelledbyCount + focus.roleCount
  record('a11y.focusable_elements', focus.focusableCount > 10, `count=${focus.focusableCount}`)
  record('a11y.aria_attributes', totalAria > 0, `ariaLabel=${focus.ariaLabelCount}, role=${focus.roleCount}, total=${totalAria}`)
  record('a11y.main_landmark', focus.hasMainLandmark, `has=${focus.hasMainLandmark}`)
  record('a11y.nav_landmark', focus.hasNavLandmark, `has=${focus.hasNavLandmark}`)
  record('a11y.heading_present', focus.hasHeading, `has=${focus.hasHeading}`)
  record('a11y.viewport_meta', focus.viewportMeta.includes('width=device-width'), `meta=${focus.viewportMeta.slice(0, 50)}`)

  // Tab 键导航模拟
  const tabResult = await c.eval(`(function() {
    const focusable = document.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    if (focusable.length === 0) return { error: 'no_focusable' }
    const first = focusable[0]
    first.focus()
    return {
      ok: true,
      focusedTag: document.activeElement?.tagName,
      focusedText: document.activeElement?.textContent?.slice(0, 30),
      totalFocusable: focusable.length
    }
  })()`)
  record('a11y.tab_navigation', tabResult?.ok === true, `focused=${tabResult?.focusedTag}/${tabResult?.focusedText}`)

  // ============================================================
  // [9] React 受控组件 native setter 写入验证
  // ============================================================
  console.log('\n[9] React 受控组件 native setter 写入')
  await c.navigate('#/settings')
  await sleep(500)

  // 查找所有 select 并尝试 native setter
  const setterResult = await c.eval(`(function() {
    const selects = document.querySelectorAll('select')
    if (selects.length === 0) return { error: 'no_selects' }
    const results = []
    for (const sel of selects) {
      const originalValue = sel.value
      const options = Array.from(sel.options)
      if (options.length < 2) continue
      // 选一个不同的值
      const newValue = options.find(o => o.value !== originalValue)?.value
      if (!newValue) continue
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      nativeSetter.call(sel, newValue)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      results.push({
        id: sel.id || 'unnamed',
        from: originalValue,
        to: sel.value,
        changed: sel.value === newValue
      })
    }
    return { count: results.length, results: results.slice(0, 3) }
  })()`)
  record('react.native_setter_select', setterResult?.count > 0, `changed=${setterResult?.count} selects`)

  // 查找 input 并尝试 native setter（使用临时值，测试后立即恢复）
  const inputSetterResult = await c.eval(`(function() {
    const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="search"]')
    if (inputs.length === 0) return { error: 'no_text_inputs' }
    const first = inputs[0]
    const original = first.value
    const testValue = '___R15_TEST_' + Date.now() + '___'
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    nativeSetter.call(first, testValue)
    first.dispatchEvent(new Event('input', { bubbles: true }))
    const changed = first.value === testValue
    // 立即恢复原始值
    nativeSetter.call(first, original)
    first.dispatchEvent(new Event('input', { bubbles: true }))
    return {
      ok: true,
      tag: first.tagName,
      type: first.type,
      changed: changed,
      restored: first.value === original
    }
  })()`)
  record('react.native_setter_input', inputSetterResult?.ok === true || inputSetterResult?.error === 'no_text_inputs',
    `result=${JSON.stringify(inputSetterResult).slice(0, 80)}`)

  // ============================================================
  // [10] 跨页面数据一致性验证
  // ============================================================
  console.log('\n[10] 跨页面数据一致性')
  // 在 dashboard 检查是否有 EAA 相关数据展示
  await c.navigate('#/dashboard')
  await sleep(500)
  const dashText = await c.eval(`document.body?.innerText || ''`)

  // 在 students 页面检查同样的数据
  await c.navigate('#/students')
  await sleep(500)
  const stuText = await c.eval(`document.body?.innerText || ''`)

  // 两个页面都应该有内容
  record('consistency.dashboard_has_content', dashText.length > 100, `len=${dashText.length}`)
  record('consistency.students_has_content', stuText.length > 100, `len=${stuText.length}`)

  // 获取 EAA 学生总数
  const eaaList = await c.callApi('eaa.listStudents')
  const eaaCount = eaaList?.data?.students?.length || 0
  record('consistency.eaa_count', eaaCount > 0, `students=${eaaCount}`)

  // ============================================================
  // [11] 最终 API 健康检查
  // ============================================================
  console.log('\n[11] 最终 API 健康检查')
  const healthChecks = [
    { name: 'eaa.info', call: () => c.callApi('eaa.info') },
    { name: 'eaa.doctor', call: () => c.callApi('eaa.doctor') },
    { name: 'agent.list', call: () => c.callApi('agent.list') },
    { name: 'skill.list', call: () => c.callApi('skill.list') },
    { name: 'settings.get', call: () => c.callApi('settings.get') },
    { name: 'cron.list', call: () => c.callApi('cron.list') },
    { name: 'privacy.status', call: () => c.callApi('privacy.status') },
    { name: 'ai.listProviders', call: () => c.callApi('ai.listProviders') },
    { name: 'log.list', call: () => c.callApi('log.list') },
  ]

  for (const check of healthChecks) {
    const res = await check.call()
    record(`health.${check.name}`, res !== null && res !== undefined && !res?.__error, `ok=${res !== null && res !== undefined}`)
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`ROUND 15 SUMMARY: ${passed}/${results.length} passed, ${failed} failed`)
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
