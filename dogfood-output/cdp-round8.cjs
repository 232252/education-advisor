// ============================================================
// 第八轮：i18n / 主题 / Chat 会话 / Agent 执行监控 / 设置持久化
// 目标：覆盖前 7 轮未深入的 UI 行为与跨进程状态同步
// ============================================================
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('timeout')))
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
  console.log('ROUND 8: i18n / Theme / Chat Sessions / Agent / Settings')
  console.log('============================================================')

  // ---------- 1. i18n 切换 ----------
  console.log('\n[1] i18n 语言切换')
  const langBefore = await c.eval(`localStorage.getItem('education-advisor.lang') || 'zh'`)
  record('i18n.lang_before', typeof langBefore === 'string', `lang=${langBefore}`)

  // i18n 模块的 setLang 函数未暴露到 window，需要通过 Settings 页面的语言下拉框触发
  // 导航到 settings
  await c.eval(`window.location.hash = '#/settings'`)
  await sleep(800)

  // 找到语言 select (包含 "中文" / "English" 选项)
  const langSelectFound = await c.eval(`(() => {
    const selects = [...document.querySelectorAll('select')];
    const langSelect = selects.find(s => [...s.options].some(o => o.text === '中文') || [...s.options].some(o => o.text === 'English'));
    return langSelect ? true : false;
  })()`)
  record('i18n.settings_lang_select_found', langSelectFound === true, `found=${langSelectFound}`)

  if (langSelectFound) {
    // 用 native setter 触发 React onChange (直接设 value 不会触发 React state 更新)
    // 注意:页面有两个语言 select:
    //   1. header select: option value="zh" / "en" (i18n 值)
    //   2. SettingRow select: option value="zh-CN" / "en-US" (settings 值)
    // 我们用 header select (option value="en")
    await c.eval(`(() => {
      const selects = [...document.querySelectorAll('select')];
      const langSelect = selects.find(s => [...s.options].some(o => o.value === 'zh') && [...s.options].some(o => o.value === 'en'));
      if (!langSelect) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(langSelect, 'en');
      langSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
    await sleep(600)  // 动态 import('../../i18n') 是异步的,需要等

    const langAfterEn = await c.eval(`localStorage.getItem('education-advisor.lang')`)
    record('i18n.switch_to_en', langAfterEn === 'en', `lang=${langAfterEn}`)

    // 检查 nav 文案是否变成英文
    const navTextEn = await c.eval(`document.querySelector('nav a')?.textContent || ''`)
    record('i18n.nav_text_en', /Dashboard|Chat|Students|Classes/i.test(navTextEn), `nav="${navTextEn.slice(0, 30)}"`)

    // 切回 zh
    await c.eval(`(() => {
      const selects = [...document.querySelectorAll('select')];
      const langSelect = selects.find(s => [...s.options].some(o => o.value === 'zh') && [...s.options].some(o => o.value === 'en'));
      if (!langSelect) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(langSelect, 'zh');
      langSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
    await sleep(600)
    const langAfterZh = await c.eval(`localStorage.getItem('education-advisor.lang')`)
    record('i18n.switch_back_zh', langAfterZh === 'zh', `lang=${langAfterZh}`)

    const navTextZh = await c.eval(`document.querySelector('nav a')?.textContent || ''`)
    record('i18n.nav_text_zh', /仪表盘|对话|学生|班级|智能体|模型|技能|日程|隐私|设置/u.test(navTextZh), `nav="${navTextZh.slice(0, 30)}"`)
  }

  // ---------- 2. 主题切换 ----------
  console.log('\n[2] 主题切换')
  const rootClassBefore = await c.eval(`document.documentElement.className`)
  record('theme.before', typeof rootClassBefore === 'string', `class="${rootClassBefore}"`)

  await c.eval(`window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }));`)
  await sleep(300)
  const rootClassLight = await c.eval(`document.documentElement.className`)
  record('theme.switch_to_light', !rootClassLight.includes('dark'), `class="${rootClassLight}"`)

  await c.eval(`window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }));`)
  await sleep(300)
  const rootClassDark = await c.eval(`document.documentElement.className`)
  record('theme.switch_to_dark', rootClassDark.includes('dark'), `class="${rootClassDark}"`)

  await c.eval(`window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'system' }));`)
  await sleep(300)
  const rootClassSystem = await c.eval(`document.documentElement.className`)
  record('theme.switch_to_system', typeof rootClassSystem === 'string', `class="${rootClassSystem}"`)

  // 通过 settings.set 持久化主题
  const themeSetResult = await c.callApi('settings.set', 'general.theme', 'dark')
  if (themeSetResult?.__error) {
    record('theme.persist_via_settings', false, themeSetResult.__error.slice(0, 100))
  } else {
    const s = await c.callApi('settings.get')
    record('theme.persist_via_settings', s && !s.__error && s.general?.theme === 'dark', `theme=${s?.general?.theme}`)
  }

  // ---------- 3. Chat 会话管理 ----------
  console.log('\n[3] Chat 会话管理')
  // handler 返回 { success, sessions } 包裹对象
  let sessionsResp = await c.callApi('chat.listSessions')
  let sessions = sessionsResp?.sessions || []
  if (sessionsResp?.__error) {
    record('chat.list_sessions', false, sessionsResp.__error.slice(0, 100))
  } else {
    record('chat.list_sessions', sessionsResp?.success === true && Array.isArray(sessions), `count=${sessions.length}`)
  }
  const countBefore = sessions.length

  // 创建测试会话 (saveMessage 返回 { success, id })
  const testSessionId = `test-r8-${Date.now()}`
  const saveResult = await c.callApi('chat.saveMessage', {
    sessionId: testSessionId,
    role: 'user',
    content: 'Round 8 test message',
    timestamp: Date.now()
  })
  record('chat.save_message', saveResult?.success === true, saveResult?.__error ? saveResult.__error.slice(0, 100) : `id=${saveResult?.id}`)

  // 加载消息 (返回 { success, messages })
  const msgsResp = await c.callApi('chat.loadMessages', testSessionId)
  if (msgsResp?.__error) {
    record('chat.load_messages', false, msgsResp.__error.slice(0, 100))
  } else {
    const msgs = msgsResp?.messages || []
    record('chat.load_messages', msgsResp?.success === true && msgs.length >= 1, `count=${msgs.length}`)
  }

  // 验证会话出现在列表
  const sessions2Resp = await c.callApi('chat.listSessions')
  const sessions2 = sessions2Resp?.sessions || []
  if (sessions2Resp?.__error) {
    record('chat.session_appears_in_list', false, sessions2Resp.__error.slice(0, 100))
  } else {
    const found = sessions2.some(s => s.id === testSessionId)
    record('chat.session_appears_in_list', found, `total=${sessions2.length}`)
  }

  // 删除会话 (返回 { success })
  const delResult = await c.callApi('chat.deleteSession', testSessionId)
  record('chat.delete_session', delResult?.success === true, delResult?.__error ? delResult.__error.slice(0, 100) : '')

  // 验证删除后不在列表
  const sessions3Resp = await c.callApi('chat.listSessions')
  const sessions3 = sessions3Resp?.sessions || []
  if (sessions3Resp?.__error) {
    record('chat.session_removed_from_list', false, sessions3Resp.__error.slice(0, 100))
  } else {
    const gone = !sessions3.some(s => s.id === testSessionId)
    record('chat.session_removed_from_list', gone)
  }

  // ---------- 4. Agent 执行监控 ----------
  console.log('\n[4] Agent 执行监控')
  let agents = await c.callApi('agent.list')
  if (agents?.__error) {
    record('agent.list', false, agents.__error.slice(0, 100))
    agents = []
  } else {
    record('agent.list', Array.isArray(agents), `count=${agents?.length || 0}`)
  }

  const enabledAgent = Array.isArray(agents) ? agents.find(a => a.enabled) : null
  if (enabledAgent) {
    record('agent.found_enabled', true, `id=${enabledAgent.id}, name=${enabledAgent.name}`)

    const soul = await c.callApi('agent.getSoul', enabledAgent.id)
    record('agent.get_soul', !soul?.__error && typeof soul === 'string' && soul.length > 0, `len=${soul?.length || 0}`)

    const rules = await c.callApi('agent.getRules', enabledAgent.id)
    record('agent.get_rules', !rules?.__error && typeof rules === 'string', `len=${rules?.length || 0}`)

    const history = await c.callApi('agent.getHistory', enabledAgent.id)
    const oldCount = Array.isArray(history) ? history.length : 0
    record('agent.get_history', !history?.__error && Array.isArray(history), `count=${oldCount}`)

    // runManual 简短 prompt
    const runResult = await c.callApi('agent.runManual', enabledAgent.id, '回复一个字: 好', [])
    record('agent.run_manual_started', !runResult?.__error && (runResult === true || runResult?.success !== false), `result=${JSON.stringify(runResult).slice(0, 100)}`)

    // 等待 12s 看是否产生状态更新
    console.log('    waiting 12s for agent execution...')
    await sleep(12000)

    const history2 = await c.callApi('agent.getHistory', enabledAgent.id)
    const newCount = Array.isArray(history2) ? history2.length : 0
    record('agent.history_grew', newCount > oldCount, `before=${oldCount}, after=${newCount}`)
  } else {
    record('agent.found_enabled', false, 'no enabled agent')
  }

  // ---------- 5. 设置持久化验证 ----------
  console.log('\n[5] 设置持久化验证')
  const settingsBefore = await c.callApi('settings.get')
  if (settingsBefore?.__error) {
    record('settings.get_all', false, settingsBefore.__error.slice(0, 100))
  } else {
    record('settings.get_all', settingsBefore && typeof settingsBefore === 'object', `keys=${Object.keys(settingsBefore || {}).join(',')}`)
  }

  const originalLogLevel = settingsBefore?.general?.logLevel
  const logLevelResult = await c.callApi('settings.set', 'general.logLevel', 'debug')
  if (logLevelResult?.__error) {
    record('settings.set_loglevel_debug', false, logLevelResult.__error.slice(0, 100))
  } else {
    const s2 = await c.callApi('settings.get')
    record('settings.set_loglevel_debug', s2?.general?.logLevel === 'debug', `level=${s2?.general?.logLevel}`)
  }

  if (originalLogLevel) {
    await c.callApi('settings.set', 'general.logLevel', originalLogLevel)
    const s3 = await c.callApi('settings.get')
    record('settings.restore_loglevel', s3?.general?.logLevel === originalLogLevel, `level=${s3?.general?.logLevel}`)
  }

  // minimizeToTray 切换
  const origMTT = settingsBefore?.general?.minimizeToTray
  const newMTT = !origMTT
  const mttResult = await c.callApi('settings.set', 'general.minimizeToTray', newMTT)
  if (mttResult?.__error) {
    record('settings.toggle_minimize_to_tray', false, mttResult.__error.slice(0, 100))
  } else {
    const s4 = await c.callApi('settings.get')
    record('settings.toggle_minimize_to_tray', s4?.general?.minimizeToTray === newMTT, `before=${origMTT}, after=${s4?.general?.minimizeToTray}`)
    // 改回
    await c.callApi('settings.set', 'general.minimizeToTray', origMTT)
  }

  // ---------- 6. UI 导航压力测试 ----------
  console.log('\n[6] UI 导航压力测试 (10次快速切换)')
  const navItems = [
    '#/dashboard', '#/chat', '#/students', '#/classes', '#/agents',
    '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings'
  ]
  let navErrors = 0
  for (let i = 0; i < 10; i++) {
    const path = navItems[i % navItems.length]
    try {
      await c.eval(`window.location.hash = ${JSON.stringify(path)}`)
      await sleep(150)
      const hash = await c.eval(`window.location.hash`)
      if (!hash.includes(path.slice(1))) navErrors++
    } catch {
      navErrors++
    }
  }
  record('ui.nav_stress_10x', navErrors === 0, `errors=${navErrors}`)

  // ---------- 7. 内存监控 ----------
  console.log('\n[7] 内存监控')
  const heap = await c.eval(`JSON.stringify(performance.memory ? {
    used: performance.memory.usedJSHeapSize,
    total: performance.memory.totalJSHeapSize,
    limit: performance.memory.jsHeapSizeLimit
  } : null)`)
  record('perf.memory_snapshot', typeof heap === 'string', `heap=${heap}`)

  // ---------- 8. EAA dashboard 路径验证 ----------
  console.log('\n[8] EAA Dashboard 生成路径')
  const dashDefault = await c.callApi('eaa.dashboard')
  if (dashDefault?.__error) {
    record('eaa.dashboard.default', false, dashDefault.__error.slice(0, 100))
  } else {
    record('eaa.dashboard.default', dashDefault?.exitCode === 0 || dashDefault?.data?.parsed !== false, `exit=${dashDefault?.exitCode}`)
  }

  const tmpDir = `C:\\Users\\sq199\\AppData\\Roaming\\Education Advisor\\eaa-data\\test-dashboard-${Date.now()}`
  const dashCustom = await c.callApi('eaa.dashboard', tmpDir)
  if (dashCustom?.__error) {
    record('eaa.dashboard.custom_dir', false, dashCustom.__error.slice(0, 100))
  } else {
    record('eaa.dashboard.custom_dir', dashCustom?.exitCode === 0, `exit=${dashCustom?.exitCode}`)
  }

  // ---------- 9. EAA revert 分数计算验证 ----------
  console.log('\n[9] EAA revert 分数计算验证')
  // EAA score 返回 { success, data: { score, ... } }
  // EAA history 返回 { success, data: { events: [{ event_id, ... }] } }
  const revertStudent = `RevertTest-${Date.now()}`
  const addStu = await c.callApi('eaa.addStudent', revertStudent)
  record('revert.add_student', !addStu?.__error, addStu?.__error ? addStu.__error.slice(0, 100) : '')

  const setMeta = await c.callApi('eaa.setStudentMeta', {
    name: revertStudent,
    group: 'test',
    role: 'student',
    classId: 'TEST-R8'
  })
  record('revert.set_meta', !setMeta?.__error, setMeta?.__error ? setMeta.__error.slice(0, 100) : '')

  // 查询分数 - 新学生默认 100
  const scoreResp = await c.callApi('eaa.score', revertStudent)
  const scoreBefore = scoreResp?.data?.score
  record('revert.score_before', typeof scoreBefore === 'number', `score=${scoreBefore}`)

  // 添加 -2 事件 (LATE)
  await c.callApi('eaa.addEvent', {
    studentName: revertStudent,
    reasonCode: 'LATE'
  })
  const hist = await c.callApi('eaa.history', revertStudent)
  const events = hist?.data?.events || []
  let eventId
  if (Array.isArray(events) && events.length > 0) {
    eventId = events[events.length - 1].event_id
  }
  record('revert.add_late_event', !!eventId, `eventId=${eventId}`)

  // 查询分数 (应该 -2)
  const scoreResp2 = await c.callApi('eaa.score', revertStudent)
  const scoreAfterLate = scoreResp2?.data?.score
  record('revert.score_after_late', scoreAfterLate === (scoreBefore - 2), `score=${scoreAfterLate}, expected=${scoreBefore - 2}`)

  // revert 事件
  if (eventId) {
    const revResult = await c.callApi('eaa.revertEvent', eventId, 'test revert')
    record('revert.revert_event', !revResult?.__error && revResult?.exitCode === 0, `exit=${revResult?.exitCode}`)

    // 查询分数 (应该恢复到 scoreBefore)
    const scoreResp3 = await c.callApi('eaa.score', revertStudent)
    const scoreAfterRevert = scoreResp3?.data?.score
    const expected = scoreBefore
    const ok = scoreAfterRevert === expected
    record('revert.score_after_revert', ok, `score=${scoreAfterRevert}, expected=${expected}`)
    if (!ok) {
      console.log(`    !!! BUG: revert 后分数=${scoreAfterRevert}, 期望=${expected}, before=${scoreBefore}, afterLate=${scoreAfterLate}`)
    }
  }

  // 清理
  const cleanup = await c.callApi('eaa.deleteStudent', revertStudent)
  record('revert.cleanup', !cleanup?.__error, cleanup?.__error ? cleanup.__error.slice(0, 100) : '')

  // ---------- SUMMARY ----------
  console.log('\n============================================================')
  console.log('ROUND 8 SUMMARY')
  console.log('============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  results.filter(r => !r.ok).forEach(r => {
    console.log(`  FAIL: ${r.name} :: ${r.detail}`)
  })
  console.log(`\nTotal: ${passed} ok, ${failed} fail, ${results.length} tests`)

  fs.writeFileSync(
    'c:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round8.json',
    JSON.stringify({ round: 8, timestamp: new Date().toISOString(), results, passed, failed, total: results.length }, null, 2)
  )

  c.close()
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
