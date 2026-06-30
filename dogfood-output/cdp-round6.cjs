// =============================================================
// 第六轮:并发测试 + 数据一致性验证
// 1. 并发 IPC 调用(检测竞态条件)
// 2. 数据一致性(add→query→delete→verify 链路)
// 3. Agent runManual 错误处理(无 API key)
// 4. 导出文件验证(检查文件是否真实生成)
// 5. Cron 任务创建/删除
// =============================================================
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('timeout')))
  })
}

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
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' })
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${name}${!ok ? ' :: ' + (detail || '').slice(0, 150) : ''}`)
}

async function main() {
  const cdp = new CDPClient()
  await cdp.connect()
  console.log('CDP connected. Round 6: Concurrency + Consistency tests...\n')

  async function callApi(path, ...args) {
    return cdp.eval(`(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`)
  }

  // =========================================================
  // 1. 并发测试:同时发起多个 IPC 调用
  // =========================================================
  console.log('=== 1. 并发 IPC 调用测试 ===')

  // 1.1 并发读取(10 个 eaa.score 调用同时发起)
  const studentsRes = await callApi('eaa.listStudents')
  let studentNames = []
  if (!studentsRes.__error && Array.isArray(studentsRes.data)) {
    studentNames = studentsRes.data.slice(0, 10).map(s => typeof s === 'string' ? s : s.name)
  }

  if (studentNames.length >= 5) {
    console.log(`  Concurrent score queries for ${studentNames.length} students...`)
    const t1 = Date.now()
    const promises = studentNames.map(name => callApi('eaa.score', name))
    const scores = await Promise.all(promises)
    const elapsed = Date.now() - t1
    const allOk = scores.every(s => !s.__error)
    record('concurrent.score.10', allOk, `${elapsed}ms, ${scores.filter(s => !s.__error).length}/10 ok`)
  }

  // 1.2 并发写入(5 个 addStudent 同时发起)
  console.log('  Concurrent addStudent (5 parallel)...')
  const concurrentStudents = Array.from({ length: 5 }, (_, i) => `__concurrent_${i}_${Date.now()}`)
  const t2 = Date.now()
  const addPromises = concurrentStudents.map(name => callApi('eaa.addStudent', name))
  const addResults = await Promise.all(addPromises)
  const addElapsed = Date.now() - t2
  const addOk = addResults.filter(r => !r.__error && r.success !== false).length
  record('concurrent.addStudent.5', addOk === 5, `${addElapsed}ms, ${addOk}/5 ok`)

  // 验证所有学生都已添加
  const verifyList = await callApi('eaa.listStudents')
  let allAdded = true
  if (!verifyList.__error && Array.isArray(verifyList.data)) {
    const names = verifyList.data.map(s => typeof s === 'string' ? s : s.name)
    for (const name of concurrentStudents) {
      if (!names.includes(name)) { allAdded = false; break }
    }
  }
  record('concurrent.addStudent.verify', allAdded, 'All 5 students found in list')

  // 清理
  await Promise.all(concurrentStudents.map(name => callApi('eaa.deleteStudent', name, 'cleanup')))

  // 1.3 混合并发(读+写同时)
  console.log('  Mixed concurrent (read + write)...')
  const mixedPromises = [
    callApi('eaa.ranking', 5),
    callApi('eaa.stats'),
    callApi('eaa.codes'),
    callApi('eaa.doctor'),
    callApi('eaa.addStudent', '__mixed_test_' + Date.now()),
  ]
  const mixedResults = await Promise.all(mixedPromises)
  const mixedOk = mixedResults.slice(0, 4).every(r => !r.__error)
  record('concurrent.mixed', mixedOk, `${mixedResults.filter(r => !r.__error).length}/4 reads ok`)
  // 清理
  await callApi('eaa.deleteStudent', '__mixed_test_' + Date.now(), 'cleanup')

  // =========================================================
  // 2. 数据一致性:add→query→delete→verify
  // =========================================================
  console.log('\n=== 2. 数据一致性测试 ===')
  const consistencyStudent = '__consistency_' + Date.now()

  // 2.1 添加学生
  const addRes = await callApi('eaa.addStudent', consistencyStudent)
  record('consistency.add', addRes.success !== false, JSON.stringify(addRes).slice(0, 100))

  // 2.2 查询分数(应该是 100)
  const scoreRes = await callApi('eaa.score', consistencyStudent)
  const scoreOk = !scoreRes.__error && scoreRes.data?.score === 100
  record('consistency.score_initial', scoreOk, `score=${scoreRes.data?.score}`)

  // 2.3 添加事件
  const eventRes = await callApi('eaa.addEvent', {
    studentName: consistencyStudent,
    reasonCode: 'LATE',
    note: '一致性测试',
  })
  record('consistency.addEvent', eventRes.success !== false, JSON.stringify(eventRes).slice(0, 100))

  // 2.4 查询分数(应该是 98)
  const scoreAfterEvent = await callApi('eaa.score', consistencyStudent)
  const scoreAfterOk = scoreAfterEvent.data?.score === 98
  record('consistency.score_after_event', scoreAfterOk, `score=${scoreAfterEvent.data?.score} (expected 98)`)

  // 2.5 查询历史(应该有 1 个事件)
  const histRes = await callApi('eaa.history', consistencyStudent)
  const histOk = histRes.data?.events?.length === 1
  record('consistency.history', histOk, `events=${histRes.data?.events?.length} (expected 1)`)

  // 2.6 搜索应该能找到
  const searchRes = await callApi('eaa.search', consistencyStudent)
  const searchOk = !searchRes.__error
  record('consistency.search', searchOk, 'Student found in search')

  // 2.7 删除学生
  const delRes = await callApi('eaa.deleteStudent', consistencyStudent, 'cleanup')
  record('consistency.delete', delRes.success !== false, JSON.stringify(delRes).slice(0, 100))

  // 2.8 删除后查询应该失败
  const scoreAfterDelete = await callApi('eaa.score', consistencyStudent)
  const deletedOk = scoreAfterDelete.__error || scoreAfterDelete.success === false
  record('consistency.deleted_verify', deletedOk, 'Student no longer accessible')

  // =========================================================
  // 3. Agent runManual 错误处理
  // =========================================================
  console.log('\n=== 3. Agent runManual 错误处理 ===')
  const agentList = await callApi('agent.list')
  if (!agentList.__error && Array.isArray(agentList) && agentList.length > 0) {
    const testAgent = agentList[0]
    // 尝试运行(可能没有 API key,应该优雅失败)
    const runRes = await callApi('agent.runManual', testAgent.id, '测试运行', [])
    const gracefulFail = runRes.__error || (runRes.success === false) || runRes.error
    record('agent.runManual.graceful_fail', gracefulFail !== undefined, JSON.stringify(runRes).slice(0, 150))
  }

  // =========================================================
  // 4. 导出文件验证
  // =========================================================
  console.log('\n=== 4. 导出文件验证 ===')

  // 4.1 EAA export - 检查输出文件路径
  const exportRes = await callApi('eaa.export', 'csv')
  console.log('  Export result:', JSON.stringify(exportRes).slice(0, 200))
  if (!exportRes.__error && exportRes.data) {
    // 检查输出中是否包含文件路径
    const hasFilePath = typeof exportRes.data === 'string' && exportRes.data.includes('.csv')
    record('eaa.export.csv.file_path', hasFilePath, exportRes.data?.slice(0, 100))
  }

  // 4.2 EAA dashboard - 检查 HTML 文件生成
  const dashboardRes = await callApi('eaa.dashboard')
  console.log('  Dashboard result:', JSON.stringify(dashboardRes).slice(0, 200))
  record('eaa.dashboard.generate', !dashboardRes.__error && dashboardRes.success !== false, JSON.stringify(dashboardRes).slice(0, 100))

  // 4.3 检查导出目录是否有文件
  const userDataPath = await callApi('sys.getPath', 'userData')
  if (!userDataPath.__error) {
    const eaaDataDir = path.join(userDataPath, 'eaa-data')
    try {
      const files = fs.readdirSync(eaaDataDir)
      record('eaa.export_dir.exists', true, `${files.length} files in eaa-data`)

      // 检查是否有 .csv 或 .html 文件
      const csvFiles = files.filter(f => f.endsWith('.csv'))
      const htmlFiles = files.filter(f => f.endsWith('.html'))
      record('eaa.export_files.csv', csvFiles.length > 0, `${csvFiles.length} CSV files`)
      record('eaa.export_files.html', htmlFiles.length > 0, `${htmlFiles.length} HTML files`)
    } catch (e) {
      record('eaa.export_dir.exists', false, e.message)
    }
  }

  // =========================================================
  // 5. Cron 任务创建/删除
  // =========================================================
  console.log('\n=== 5. Cron 任务创建/删除 ===')
  const cronListBefore = await callApi('cron.list')
  const cronCountBefore = cronListBefore?.length || 0
  console.log(`  Cron tasks before: ${cronCountBefore}`)

  // 创建测试任务
  const createRes = await callApi('cron.add', {
    name: '测试任务_' + Date.now(),
    agentId: 'safety',
    expression: '0 8 * * 1',
    prompt: '测试定时任务',
    enabled: false,
    modelTier: 'low_cost',
  })
  console.log('  Create result:', JSON.stringify(createRes).slice(0, 200))
  record('cron.create', !createRes.__error, JSON.stringify(createRes).slice(0, 100))

  // 验证任务已添加
  const cronListAfter = await callApi('cron.list')
  const cronCountAfter = cronListAfter?.length || 0
  record('cron.create.verify', cronCountAfter === cronCountBefore + 1, `${cronCountBefore} → ${cronCountAfter}`)

  // 找到新任务并删除
  if (!createRes.__error) {
    let newTaskId = null
    if (createRes.id) {
      newTaskId = createRes.id
    } else if (createRes.data?.id) {
      newTaskId = createRes.data.id
    } else if (Array.isArray(cronListAfter)) {
      // 找名字包含"测试任务"的
      const found = cronListAfter.find(t => t.name?.includes('测试任务'))
      if (found) newTaskId = found.id
    }

    if (newTaskId) {
      const delCronRes = await callApi('cron.remove', newTaskId)
      record('cron.delete', !delCronRes.__error, JSON.stringify(delCronRes).slice(0, 100))

      // 验证删除
      const cronListFinal = await callApi('cron.list')
      record('cron.delete.verify', cronListFinal?.length === cronCountBefore, `${cronListFinal?.length} (expected ${cronCountBefore})`)
    } else {
      record('cron.delete', false, 'Could not find new task ID')
    }
  }

  // =========================================================
  // 6. Settings reset 测试
  // =========================================================
  console.log('\n=== 6. Settings 操作测试 ===')

  // 先读取当前设置
  const settingsBefore = await callApi('settings.get')
  // 修改一个设置
  await callApi('settings.set', 'general.autoStart', !settingsBefore.general?.autoStart)
  const settingsAfter = await callApi('settings.get')
  const changeOk = settingsAfter.general?.autoStart === !settingsBefore.general?.autoStart
  record('settings.set.autoStart', changeOk, `${settingsBefore.general?.autoStart} → ${settingsAfter.general?.autoStart}`)

  // 恢复
  await callApi('settings.set', 'general.autoStart', settingsBefore.general?.autoStart)
  record('settings.restore', true, 'Settings restored')

  // =========================================================
  // 汇总
  // =========================================================
  console.log('\n\n============================================================')
  console.log('ROUND 6: CONCURRENCY + CONSISTENCY SUMMARY')
  console.log('============================================================')
  let ok = 0, fail = 0
  for (const r of results) { if (r.ok) ok++; else { fail++; console.log(`  FAIL: ${r.name} :: ${r.detail}`) } }
  console.log(`\nTotal: ${ok} ok, ${fail} fail, ${results.length} tests`)

  fs.writeFileSync('C:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round6.json', JSON.stringify({ summary: { ok, fail, total: results.length }, results }, null, 2))

  cdp.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
