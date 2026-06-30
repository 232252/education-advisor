// 第七轮:Agent 执行监控 + 导出文件验证
// 1. Agent runManual 后监控执行状态和历史
// 2. 验证 dashboard HTML 文件
// 3. 测试 EAA export 带 outputFile 参数
// 4. 测试更多 EAA 命令组合
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
  console.log('CDP connected. Round 7: Agent execution + file verification...\n')

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
  // 1. Agent 执行监控
  // =========================================================
  console.log('=== 1. Agent 执行监控 ===')
  const agentList = await callApi('agent.list')
  if (!agentList.__error && Array.isArray(agentList)) {
    // 找一个 enabled 的 agent,或者用第一个
    const testAgent = agentList.find(a => a.enabled) || agentList[0]
    console.log(`  Testing agent: ${testAgent.name} (${testAgent.id}), enabled=${testAgent.enabled}`)

    // 触发执行
    const runRes = await callApi('agent.runManual', testAgent.id, '请回复"测试成功"', [])
    console.log('  Run result:', JSON.stringify(runRes).slice(0, 200))
    record('agent.runManual', !runRes.__error, JSON.stringify(runRes).slice(0, 100))

    // 等待 5 秒后检查历史
    console.log('  Waiting 5s for agent execution...')
    await new Promise(r => setTimeout(r, 5000))

    // 检查执行历史
    const histRes = await callApi('agent.getHistory', testAgent.id)
    console.log('  History:', JSON.stringify(histRes).slice(0, 300))
    const hasHistory = !histRes.__error && (Array.isArray(histRes) ? histRes.length > 0 : (histRes?.data?.length > 0 || histRes?.executions?.length > 0))
    record('agent.history_after_run', !histRes.__error, `History retrieved`)
  }

  // =========================================================
  // 2. EAA export 带输出文件
  // =========================================================
  console.log('\n=== 2. EAA export 带输出文件 ===')
  const userDataPath = await callApi('sys.getPath', 'userData')
  const exportFilePath = userDataPath ? path.join(userDataPath, 'test-export.csv') : null

  if (exportFilePath) {
    console.log(`  Export to: ${exportFilePath}`)
    const exportRes = await callApi('eaa.export', 'csv', exportFilePath)
    console.log('  Export result:', JSON.stringify(exportRes).slice(0, 200))
    record('eaa.export.with_file', !exportRes.__error, JSON.stringify(exportRes).slice(0, 100))

    // 检查文件是否已创建
    await new Promise(r => setTimeout(r, 1000))
    const fileExists = fs.existsSync(exportFilePath)
    record('eaa.export.file_exists', fileExists, exportFilePath)

    if (fileExists) {
      const stat = fs.statSync(exportFilePath)
      record('eaa.export.file_size', stat.size > 0, `${stat.size} bytes`)

      // 验证 CSV 内容
      const content = fs.readFileSync(exportFilePath, 'utf-8')
      const hasCsvHeader = content.includes('姓名') || content.includes('name')
      record('eaa.export.csv_content', hasCsvHeader, `First line: ${content.split('\n')[0].slice(0, 50)}`)

      // 清理
      fs.unlinkSync(exportFilePath)
    }
  }

  // =========================================================
  // 3. Dashboard HTML 文件验证
  // =========================================================
  console.log('\n=== 3. Dashboard HTML 文件验证 ===')
  const dashboardDir = path.join(process.cwd(), 'eaa-dashboard')
  console.log(`  Dashboard dir: ${dashboardDir}`)

  // 生成 dashboard
  const dashRes = await callApi('eaa.dashboard')
  console.log('  Dashboard result:', JSON.stringify(dashRes).slice(0, 200))
  record('eaa.dashboard.generate', !dashRes.__error, JSON.stringify(dashRes).slice(0, 100))

  // 检查 HTML 文件
  await new Promise(r => setTimeout(r, 1000))
  const dashHtmlPath = path.join(dashboardDir, 'index.html')
  const htmlExists = fs.existsSync(dashHtmlPath)
  record('eaa.dashboard.html_exists', htmlExists, dashHtmlPath)

  if (htmlExists) {
    const htmlContent = fs.readFileSync(dashHtmlPath, 'utf-8')
    const hasHtml = htmlContent.includes('<html') || htmlContent.includes('<!DOCTYPE')
    const hasData = htmlContent.length > 1000
    record('eaa.dashboard.html_content', hasHtml && hasData, `${htmlContent.length} chars, has html: ${hasHtml}`)

    // 清理
    try { fs.rmSync(dashboardDir, { recursive: true }) } catch {}
  }

  // =========================================================
  // 4. EAA 多命令组合测试
  // =========================================================
  console.log('\n=== 4. EAA 多命令组合 ===')
  const comboStudent = '__combo_' + Date.now()

  // addStudent → addEvent(LATE) → addEvent(SLEEP) → addEvent(ACTIVITY) → score → history → revert → score
  await callApi('eaa.addStudent', comboStudent)
  await callApi('eaa.addEvent', { studentName: comboStudent, reasonCode: 'LATE' })
  await callApi('eaa.addEvent', { studentName: comboStudent, reasonCode: 'SLEEP_IN_CLASS' })
  await callApi('eaa.addEvent', { studentName: comboStudent, reasonCode: 'ACTIVITY_PARTICIPATION' })

  // 验证分数: 100 - 2 - 2 + 1 = 97
  const comboScore = await callApi('eaa.score', comboStudent)
  record('combo.score_3_events', comboScore.data?.score === 97, `score=${comboScore.data?.score} (expected 97)`)

  // 验证历史: 3 个事件
  const comboHist = await callApi('eaa.history', comboStudent)
  record('combo.history_3_events', comboHist.data?.events?.length === 3, `events=${comboHist.data?.events?.length}`)

  // 验证 stats
  const comboStats = await callApi('eaa.stats')
  record('combo.stats', !comboStats.__error, JSON.stringify(comboStats.data).slice(0, 100))

  // 验证 ranking 包含测试学生
  const comboRank = await callApi('eaa.ranking', 100)
  let inRanking = false
  if (!comboRank.__error && comboRank.data) {
    const ranks = comboRank.data.ranking || comboRank.data || []
    if (Array.isArray(ranks)) {
      inRanking = ranks.some(r => r.name === comboStudent)
    }
  }
  record('combo.ranking_contains', inRanking, 'Test student in ranking')

  // 清理
  await callApi('eaa.deleteStudent', comboStudent, 'cleanup')

  // =========================================================
  // 5. EAA tag 测试
  // =========================================================
  console.log('\n=== 5. EAA tag 测试 ===')
  const tagList = await callApi('eaa.tag')
  record('eaa.tag.list', !tagList.__error, JSON.stringify(tagList.data).slice(0, 100))

  // =========================================================
  // 6. EAA summary 带时间范围
  // =========================================================
  console.log('\n=== 6. EAA summary 带时间范围 ===')
  const summaryRes = await callApi('eaa.summary', '2025-01-01', '2026-12-31')
  record('eaa.summary.range', !summaryRes.__error, JSON.stringify(summaryRes.data).slice(0, 150))

  // =========================================================
  // 7. Privacy 完整流程
  // =========================================================
  console.log('\n=== 7. Privacy 完整流程 ===')
  // init → anonymize → deanonymize → add → list → lock
  const privInit = await callApi('privacy.init', 'round7pass', false)
  record('privacy.init', !privInit.__error, JSON.stringify(privInit).slice(0, 100))

  const anonText = '张三同学和李四同学今天迟到了'
  const anonRes = await callApi('privacy.anonymize', anonText)
  record('privacy.anonymize', !anonRes.__error, JSON.stringify(anonRes).slice(0, 100))

  const deanonRes = await callApi('privacy.deanonymize', anonRes.data || anonRes)
  record('privacy.deanonymize', !deanonRes.__error, JSON.stringify(deanonRes).slice(0, 100))

  const addMap = await callApi('privacy.add', 'person', '王测试')
  record('privacy.add', !addMap.__error, JSON.stringify(addMap).slice(0, 100))

  const listMap = await callApi('privacy.list')
  record('privacy.list', !listMap.__error, JSON.stringify(listMap).slice(0, 100))

  const lockRes = await callApi('privacy.lock')
  record('privacy.lock', !lockRes.__error, JSON.stringify(lockRes).slice(0, 100))

  // =========================================================
  // 汇总
  // =========================================================
  console.log('\n\n============================================================')
  console.log('ROUND 7 SUMMARY')
  console.log('============================================================')
  let ok = 0, fail = 0
  for (const r of results) { if (r.ok) ok++; else { fail++; console.log(`  FAIL: ${r.name} :: ${r.detail}`) } }
  console.log(`\nTotal: ${ok} ok, ${fail} fail, ${results.length} tests`)

  fs.writeFileSync('C:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round7.json', JSON.stringify({ summary: { ok, fail, total: results.length }, results }, null, 2))

  cdp.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
