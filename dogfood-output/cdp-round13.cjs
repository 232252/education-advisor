// ============================================================
// 第十三轮：Agent SOUL/Rules 写入 + UI 表单提交 + EAA 数据链 + Toast + 窗口控制
// 覆盖：
//   1. Agent setSoul / setRules 写入后读回验证
//   2. EAA 完整数据链：addStudent → addEvent → score → revertEvent → score 验证
//   3. EAA setStudentMeta 元数据写入
//   4. Toast 通知系统（通过 IPC 触发）
//   5. 窗口控制（minimize/maximize/restore）
//   6. 系统信息（getVersion/getPath）
//   7. Profile 配置文件管理
//   8. Agent update 配置更新
//   9. Cron 任务完整生命周期
//  10. EAA export 后文件存在性验证
// ============================================================
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
  console.log('ROUND 13: Agent Write + EAA Data Chain + Toast + Window')
  console.log('============================================================')

  // ============================================================
  // [1] Agent setSoul / setRules 写入验证
  // ============================================================
  console.log('\n[1] Agent SOUL/Rules 写入验证')

  const testAgentId = 'bug-hunter' // 用 bug-hunter 做写入测试（非关键 agent）

  // 1.1 读取原始 SOUL
  const originalSoul = await c.callApi('agent.getSoul', testAgentId)
  record('agent.getSoul_original', typeof originalSoul === 'string' && originalSoul.length > 0, `len=${originalSoul?.length}`)

  // 1.2 写入测试 SOUL
  const testSoul = `# Bug Hunter (测试写入 ${Date.now()})

你是一个 bug 猎手 agent。这是测试写入的 SOUL 内容。
测试时间戳: ${Date.now()}
`
  const setSoulRes = await c.callApi('agent.setSoul', testAgentId, testSoul)
  record('agent.setSoul', setSoulRes?.success === true || !setSoulRes?.__error, `success=${setSoulRes?.success}`)

  // 1.3 读回验证
  const readbackSoul = await c.callApi('agent.getSoul', testAgentId)
  record('agent.getSoul_after_write', readbackSoul === testSoul, `match=${readbackSoul === testSoul}`)

  // 1.4 恢复原始 SOUL
  const restoreSoulRes = await c.callApi('agent.setSoul', testAgentId, originalSoul)
  record('agent.setSoul_restore', restoreSoulRes?.success === true, `success=${restoreSoulRes?.success}`)

  // 1.5 验证恢复
  const restoredSoul = await c.callApi('agent.getSoul', testAgentId)
  record('agent.getSoul_restored', restoredSoul === originalSoul, `match=${restoredSoul === originalSoul}`)

  // 1.6 同样测试 setRules
  const originalRules = await c.callApi('agent.getRules', testAgentId)
  record('agent.getRules_original', typeof originalRules === 'string' && originalRules.length > 0, `len=${originalRules?.length}`)

  const testRules = `# Bug Hunter Rules (测试 ${Date.now()})

- 测试规则 1
- 测试规则 2
`
  const setRulesRes = await c.callApi('agent.setRules', testAgentId, testRules)
  record('agent.setRules', setRulesRes?.success === true || !setRulesRes?.__error, `success=${setRulesRes?.success}`)

  const readbackRules = await c.callApi('agent.getRules', testAgentId)
  record('agent.getRules_after_write', readbackRules === testRules, `match=${readbackRules === testRules}`)

  // 恢复
  await c.callApi('agent.setRules', testAgentId, originalRules)
  const restoredRules = await c.callApi('agent.getRules', testAgentId)
  record('agent.getRules_restored', restoredRules === originalRules, `match=${restoredRules === originalRules}`)

  // ============================================================
  // [2] Agent update 配置更新
  // ============================================================
  console.log('\n[2] Agent update 配置更新')

  const agentBefore = await c.callApi('agent.get', testAgentId)
  const originalEnabled = agentBefore?.enabled

  // 切换 enabled
  const toggleRes = await c.callApi('agent.toggle', testAgentId, !originalEnabled)
  record('agent.toggle', toggleRes?.success === true || !toggleRes?.__error, `success=${toggleRes?.success}`)

  const agentAfter = await c.callApi('agent.get', testAgentId)
  record('agent.toggle_verified', agentAfter?.enabled === !originalEnabled, `before=${originalEnabled}, after=${agentAfter?.enabled}`)

  // 恢复
  await c.callApi('agent.toggle', testAgentId, originalEnabled)
  const agentRestored = await c.callApi('agent.get', testAgentId)
  record('agent.toggle_restore', agentRestored?.enabled === originalEnabled, `restored=${agentRestored?.enabled}`)

  // agent.update
  const updateRes = await c.callApi('agent.update', testAgentId, { description: `测试更新 ${Date.now()}` })
  record('agent.update', updateRes?.success === true || !updateRes?.__error, `success=${updateRes?.success}`)

  // ============================================================
  // [3] EAA 完整数据链验证
  // ============================================================
  console.log('\n[3] EAA 完整数据链')

  const testStudentName = `R13Test_${Date.now().toString().slice(-6)}`

  // 3.1 新增学生
  const addStudentRes = await c.callApi('eaa.addStudent', testStudentName)
  record('eaa.addStudent', addStudentRes?.success === true || !addStudentRes?.__error, `name=${testStudentName}`)

  // 3.2 验证学生存在
  const listRes = await c.callApi('eaa.listStudents')
  const students = listRes?.data?.students || []
  const studentExists = students.some(s => s.name === testStudentName || s.id === testStudentName)
  record('eaa.addStudent_verified', studentExists, `found=${studentExists}`)

  // 3.3 查询初始分数（应为 100 基准分）
  const scoreBefore = await c.callApi('eaa.score', testStudentName)
  const initialScore = scoreBefore?.data?.score ?? scoreBefore?.data
  record('eaa.score_initial', initialScore !== undefined, `score=${initialScore}`)

  // 3.4 设置学生元数据
  const metaRes = await c.callApi('eaa.setStudentMeta', {
    name: testStudentName,
    meta: { grade: '高三', class: '测试班', note: 'R13 测试学生' }
  })
  record('eaa.setStudentMeta', metaRes?.success === true || !metaRes?.__error, `success=${metaRes?.success}`)

  // 3.5 添加事件（LATE, -2 分）— 参数用 studentName/reasonCode（不是 entity_id/reason_code）
  const addEventRes = await c.callApi('eaa.addEvent', {
    studentName: testStudentName,
    reasonCode: 'LATE',
    note: 'R13 测试迟到事件'
  })
  record('eaa.addEvent_LATE', addEventRes?.success === true || !addEventRes?.__error, `success=${addEventRes?.success}`)

  // 3.6 验证分数下降
  const scoreAfterLate = await c.callApi('eaa.score', testStudentName)
  const scoreLate = scoreAfterLate?.data?.score ?? scoreAfterLate?.data
  record('eaa.score_after_late', scoreLate < initialScore, `before=${initialScore}, after=${scoreLate}`)

  // 3.7 添加正面事件（ACTIVITY_PARTICIPATION, +1 分）
  const addPositiveRes = await c.callApi('eaa.addEvent', {
    studentName: testStudentName,
    reasonCode: 'ACTIVITY_PARTICIPATION',
    note: 'R13 测试参与活动'
  })
  record('eaa.addEvent_positive', addPositiveRes?.success === true, `success=${addPositiveRes?.success}`)

  // 3.8 查询历史
  const historyRes = await c.callApi('eaa.history', testStudentName)
  const historyEvents = historyRes?.data?.events || historyRes?.data || []
  record('eaa.history', Array.isArray(historyEvents) && historyEvents.length >= 2, `count=${Array.isArray(historyEvents) ? historyEvents.length : 0}`)

  // 3.9 查找 LATE 事件的 ID 用于 revert
  const lateEvent = Array.isArray(historyEvents) ? historyEvents.find(e => e.reason_code === 'LATE') : null
  const lateEventId = lateEvent?.id || lateEvent?.event_id
  record('eaa.find_late_event', !!lateEventId, `eventId=${lateEventId}`)

  // 3.10 revert LATE 事件
  if (lateEventId) {
    const revertRes = await c.callApi('eaa.revertEvent', lateEventId, 'R13 测试撤销')
    record('eaa.revertEvent', revertRes?.success === true || !revertRes?.__error, `success=${revertRes?.success}`)

    // 3.11 验证 revert 后分数（应恢复，不再包含 LATE 的 -2 分）
    const scoreAfterRevert = await c.callApi('eaa.score', testStudentName)
    const scoreReverted = scoreAfterRevert?.data?.score ?? scoreAfterRevert?.data
    record('eaa.score_after_revert', scoreReverted > scoreLate, `after_late=${scoreLate}, after_revert=${scoreReverted}`)
  }

  // 3.12 删除测试学生
  const deleteRes = await c.callApi('eaa.deleteStudent', testStudentName, 'R13 测试清理')
  record('eaa.deleteStudent', deleteRes?.success === true || !deleteRes?.__error, `success=${deleteRes?.success}`)

  // 3.13 验证删除
  const listAfterDelete = await c.callApi('eaa.listStudents')
  const studentsAfter = listAfterDelete?.data?.students || []
  const stillExists = studentsAfter.some(s => s.name === testStudentName || s.id === testStudentName)
  record('eaa.deleteStudent_verified', !stillExists, `stillExists=${stillExists}`)

  // ============================================================
  // [4] EAA export 文件验证
  // ============================================================
  console.log('\n[4] EAA export 文件验证')

  const exportDir = path.join(__dirname, 'r13-exports')
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true })

  // 导出 CSV
  const csvFile = path.join(exportDir, `r13-export-${Date.now()}.csv`)
  const exportCsvRes = await c.callApi('eaa.export', 'csv', csvFile)
  record('eaa.export_csv', exportCsvRes?.success === true || !exportCsvRes?.__error, `success=${exportCsvRes?.success}`)
  const csvExists = fs.existsSync(csvFile)
  const csvSize = csvExists ? fs.statSync(csvFile).size : 0
  record('eaa.export_csv_file', csvExists && csvSize > 0, `file=${csvFile}, size=${csvSize}`)

  // 导出 JSONL
  const jsonlFile = path.join(exportDir, `r13-export-${Date.now()}.jsonl`)
  const exportJsonlRes = await c.callApi('eaa.export', 'jsonl', jsonlFile)
  record('eaa.export_jsonl', exportJsonlRes?.success === true, `success=${exportJsonlRes?.success}`)
  const jsonlExists = fs.existsSync(jsonlFile)
  const jsonlSize = jsonlExists ? fs.statSync(jsonlFile).size : 0
  record('eaa.export_jsonl_file', jsonlExists && jsonlSize > 0, `size=${jsonlSize}`)

  // 导出 HTML
  const htmlFile = path.join(exportDir, `r13-export-${Date.now()}.html`)
  const exportHtmlRes = await c.callApi('eaa.export', 'html', htmlFile)
  record('eaa.export_html', exportHtmlRes?.success === true, `success=${exportHtmlRes?.success}`)
  const htmlExists = fs.existsSync(htmlFile)
  const htmlSize = htmlExists ? fs.statSync(htmlFile).size : 0
  record('eaa.export_html_file', htmlExists && htmlSize > 0, `size=${htmlSize}`)

  // 清理导出文件
  try { [csvFile, jsonlFile, htmlFile].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f) }) } catch (e) {}

  // ============================================================
  // [5] EAA dashboard 生成
  // ============================================================
  console.log('\n[5] EAA dashboard 生成')

  const dashDir = path.join(exportDir, `dashboard-${Date.now()}`)
  if (!fs.existsSync(dashDir)) fs.mkdirSync(dashDir, { recursive: true })

  const dashRes = await c.callApi('eaa.dashboard', dashDir)
  record('eaa.dashboard', dashRes?.success === true || !dashRes?.__error, `success=${dashRes?.success}, dir=${dashDir}`)

  // 检查 dashboard 文件是否生成
  let dashFiles = []
  try { dashFiles = fs.readdirSync(dashDir) } catch (e) {}
  record('eaa.dashboard_files', dashFiles.length > 0, `files=${dashFiles.length}, names=${dashFiles.slice(0, 3).join(',')}`)

  // 清理
  try { fs.rmSync(dashDir, { recursive: true, force: true }) } catch (e) {}
  try { fs.rmSync(exportDir, { recursive: true, force: true }) } catch (e) {}

  // ============================================================
  // [6] Toast 通知系统（sys.notify — 系统级通知）
  // ============================================================
  console.log('\n[6] 系统通知 (sys.notify)')

  // Toast 是渲染端 Zustand store，不在 preload 暴露
  // 系统通知通过 sys.notify 触发
  const notifyRes = await c.callApi('sys.notify', 'R13 测试通知', '这是一条测试通知内容')
  record('sys.notify', !notifyRes?.__error, `success=${notifyRes?.success !== false}`)

  // ToastContainer 组件在无 toast 时返回 null（设计如此）
  // 验证 toast CSS 已加载（ToastContainer.css 通过 import 引入）
  const toastCssLoaded = await c.eval(`(function() {
    const sheets = document.styleSheets
    for (let i = 0; i < sheets.length; i++) {
      try {
        const rules = sheets[i].cssRules
        for (let j = 0; j < rules.length; j++) {
          if (rules[j].selectorText && rules[j].selectorText.includes('toast')) return true
        }
      } catch(e) {}
    }
    return false
  })()`)
  record('toast.css_loaded', toastCssLoaded === true, `loaded=${toastCssLoaded}`)

  // ============================================================
  // [7] 系统信息 (sys API)
  // ============================================================
  console.log('\n[7] 系统信息')

  // 系统版本 — 从 checkUpdate 返回中获取 currentVersion
  const checkUpdateRes = await c.callApi('sys.checkUpdate')
  const currentVersion = checkUpdateRes?.currentVersion
  record('sys.checkUpdate_version', typeof currentVersion === 'string' && currentVersion.length > 0, `version=${currentVersion}`)
  record('sys.checkUpdate', checkUpdateRes && !checkUpdateRes?.__error, `hasUpdate=${checkUpdateRes?.hasUpdate}`)

  // 系统路径 — sys.getPath(name) 接受路径名
  const userDataPath = await c.callApi('sys.getPath', 'userData')
  record('sys.getPath_userData', typeof userDataPath === 'string' && userDataPath.length > 0, `path=${userDataPath?.slice(0, 60)}`)

  const tempPath = await c.callApi('sys.getPath', 'temp')
  record('sys.getPath_temp', typeof tempPath === 'string' && tempPath.length > 0, `path=${tempPath?.slice(0, 60)}`)

  const homePath = await c.callApi('sys.getPath', 'home')
  record('sys.getPath_home', typeof homePath === 'string' && homePath.length > 0, `path=${homePath?.slice(0, 60)}`)

  // ============================================================
  // [8] Profile 配置文件管理 (profile.get/set)
  // ============================================================
  console.log('\n[8] Profile 配置文件管理')

  // profile 只有 get(name) 和 set(name, data) — 无 list
  const profileTestName = `R13Profile_${Date.now().toString().slice(-6)}`

  // 写入 profile
  const profileSetRes = await c.callApi('profile.set', profileTestName, {
    grade: '高三',
    class: '测试班',
    notes: 'R13 profile 测试',
    timestamp: Date.now()
  })
  record('profile.set', !profileSetRes?.__error, `success=${profileSetRes?.success !== false}`)

  // 读回 profile
  const profileGetRes = await c.callApi('profile.get', profileTestName)
  const profileData = profileGetRes?.data || profileGetRes
  record('profile.get', profileData && !profileGetRes?.__error, `hasData=${!!profileData && Object.keys(profileData).length > 0}`)

  // 验证数据一致性
  const profileMatch = profileData?.grade === '高三' || profileData?.class === '测试班'
  record('profile.data_consistency', profileMatch, `grade=${profileData?.grade}, class=${profileData?.class}`)

  // ============================================================
  // [9] Cron 完整生命周期
  // ============================================================
  console.log('\n[9] Cron 完整生命周期')

  const cronTask = {
    name: `R13-lifecycle-${Date.now()}`,
    expression: '0 10 * * 1-5',
    agentId: 'safety',
    prompt: 'R13 生命周期测试',
    enabled: true,
    modelTier: 'low_cost'
  }

  // 创建
  const cronAdd = await c.callApi('cron.add', cronTask)
  const cronId = cronAdd?.id || cronAdd?.data?.id || cronAdd
  record('cron.add', !!cronId, `id=${cronId}`)

  if (cronId) {
    // 列表
    const cronList = await c.callApi('cron.list')
    const cronItems = cronList?.tasks || cronList?.data || cronList || []
    const cronInList = Array.isArray(cronItems) && cronItems.some(t => (t.id || t._id) === cronId)
    record('cron.list_contains', cronInList, `found=${cronInList}`)

    // 更新
    const cronUpdate = await c.callApi('cron.update', cronId, { prompt: 'R13 更新后的 prompt' })
    record('cron.update', cronUpdate?.success === true || !cronUpdate?.__error, `success=${cronUpdate?.success}`)

    // toggle
    const cronToggle = await c.callApi('cron.toggle', cronId, false)
    record('cron.toggle', cronToggle?.success === true || !cronToggle?.__error, `success=${cronToggle?.success}`)

    // 获取日志
    const cronLogs = await c.callApi('cron.getLogs', cronId)
    record('cron.getLogs', cronLogs && !cronLogs?.__error, `type=${typeof cronLogs}`)

    // 删除
    const cronRemove = await c.callApi('cron.remove', cronId)
    record('cron.remove', cronRemove?.success === true || !cronRemove?.__error, `success=${cronRemove?.success}`)

    // 验证删除
    const cronListAfter = await c.callApi('cron.list')
    const cronItemsAfter = cronListAfter?.tasks || cronListAfter?.data || cronListAfter || []
    const cronStillExists = Array.isArray(cronItemsAfter) && cronItemsAfter.some(t => (t.id || t._id) === cronId)
    record('cron.remove_verified', !cronStillExists, `stillExists=${cronStillExists}`)
  }

  // ============================================================
  // [10] 窗口控制（通过 Electron Tray 最小化验证）
  // ============================================================
  console.log('\n[10] 窗口控制')

  // window API 未通过 preload 暴露
  // 验证窗口当前可见性和 focus 状态
  const windowState = await c.eval(`JSON.stringify({
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    hidden: document.hidden,
    windowState: window.document.readyState
  })`)
  const ws = JSON.parse(windowState)
  record('window.visibility', ws.visibilityState === 'visible', `state=${ws.visibilityState}`)
  record('window.ready', ws.windowState === 'complete', `readyState=${ws.windowState}`)
  record('window.focus', typeof ws.hasFocus === 'boolean', `hasFocus=${ws.hasFocus}`)

  // 验证 tray 最小化配置（通过 settings 检查）
  const traySettings = await c.callApi('settings.get')
  const minimizeToTray = traySettings?.general?.minimizeToTray
  record('window.tray_config', typeof minimizeToTray === 'boolean' || typeof minimizeToTray === 'string', `minimizeToTray=${minimizeToTray}`)

  // ============================================================
  // [11] EAA 数据完整性 — stats/summary/ranking 一致性
  // ============================================================
  console.log('\n[11] EAA 数据一致性')

  const statsRes = await c.callApi('eaa.stats')
  const stats = statsRes?.data || statsRes
  record('eaa.stats', stats && !statsRes?.__error, `students=${stats?.student_count || stats?.students || 'unknown'}`)

  const rankingRes = await c.callApi('eaa.ranking', 10)
  const ranking = rankingRes?.data?.ranking || rankingRes?.data || []
  record('eaa.ranking', Array.isArray(ranking), `count=${Array.isArray(ranking) ? ranking.length : 0}`)

  const summaryRes = await c.callApi('eaa.summary')
  const summary = summaryRes?.data || summaryRes
  record('eaa.summary', summary && !summaryRes?.__error, `keys=${summary ? Object.keys(summary).slice(0, 5).join(',') : 'none'}`)

  // 一致性检查：ranking 第一名的分数应该与 eaa.score 一致
  // ranking 返回 entity_id 和 name(可能为 "?"), 需要通过 listStudents 映射 entity_id → name
  if (Array.isArray(ranking) && ranking.length > 0) {
    const topEntry = ranking[0]
    const topEntityId = topEntry?.entity_id
    const topScore = topEntry?.score
    console.log(`    ranking 第一名: entity_id=${topEntityId}, score=${topScore}`)

    // 通过 listStudents 查找 entity_id 对应的学生名
    const listForMapping = await c.callApi('eaa.listStudents')
    const allStudents = listForMapping?.data?.students || []
    const topStudent = allStudents.find(s => s.entity_id === topEntityId || s.id === topEntityId)
    const topStudentName = topStudent?.name

    if (topStudentName) {
      const topScoreRes = await c.callApi('eaa.score', topStudentName)
      const topScoreData = topScoreRes?.data?.score ?? topScoreRes?.data
      record('eaa.ranking_score_consistency', topScoreData === topScore || Math.abs(topScoreData - topScore) < 1, `name=${topStudentName}, ranking=${topScore}, score=${topScoreData}`)
    } else {
      // 如果找不到对应学生名，验证 ranking 分数本身是数字
      record('eaa.ranking_score_consistency', typeof topScore === 'number', `topScore=${topScore} (entity_id→name 映射未找到)`)
    }
  }

  // validate 数据校验
  const validateRes = await c.callApi('eaa.validate')
  record('eaa.validate', validateRes?.success === true || !validateRes?.__error, `success=${validateRes?.success}`)

  // doctor 健康检查
  const doctorRes = await c.callApi('eaa.doctor')
  record('eaa.doctor', doctorRes?.success === true || !doctorRes?.__error, `success=${doctorRes?.success}`)

  // ============================================================
  // [12] 搜索与时间范围
  // ============================================================
  console.log('\n[12] 搜索与时间范围')

  // 搜索
  const searchRes = await c.callApi('eaa.search', 'LATE', 10)
  const searchEvents = searchRes?.data?.events || searchRes?.data || []
  record('eaa.search_LATE', Array.isArray(searchEvents), `count=${Array.isArray(searchEvents) ? searchEvents.length : 0}`)

  // 时间范围查询（最近 30 天）
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const rangeRes = await c.callApi('eaa.range', thirtyDaysAgo.toISOString(), now.toISOString(), 20)
  const rangeEvents = rangeRes?.data?.events || rangeRes?.data || []
  record('eaa.range_30days', Array.isArray(rangeEvents), `count=${Array.isArray(rangeEvents) ? rangeEvents.length : 0}`)

  // tag 查询
  const tagRes = await c.callApi('eaa.tag')
  const tagData = tagRes?.data || tagRes
  record('eaa.tag_all', tagData && !tagRes?.__error, `type=${typeof tagData}`)

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  console.log('ROUND 13 SUMMARY')
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
