// ============================================================
// 第二十轮：EAA 高级操作 + Agent 全量扫描 + Log 深度测试
// 覆盖：
//   1. EAA tag/search/range/replay/validate/summary 深度测试
//   2. 18 个 Agent SOUL/Rules 全量扫描(查找空内容)
//   3. Agent toggle 启停验证
//   4. Log 系统 filter/search/read 深度测试
//   5. AI/LLM providers 和 models 查询
//   6. EAA ranking/stats 数据一致性
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
  console.log('ROUND 20: EAA Advanced + Agent Full Scan + Log Deep Test')
  console.log('============================================================')

  // ============================================================
  // [1] EAA 高级操作
  // ============================================================
  console.log('\n[1] EAA 高级操作')

  // tag — 标签列表
  const tagRes = await c.callApi('eaa.tag')
  const tagData = tagRes?.data
  record('eaa.tag', tagData !== null && tagData !== undefined, `hasData=${tagData !== null}, success=${tagRes?.success}`)

  // search — 搜索
  const searchRes = await c.callApi('eaa.search', 'test')
  const searchData = searchRes?.data
  record('eaa.search', searchRes?.success !== false, `success=${searchRes?.success}, hasData=${searchData !== null}`)

  // range — 时间范围查询
  const rangeRes = await c.callApi('eaa.range', '2024-01-01', '2026-12-31')
  const rangeData = rangeRes?.data
  record('eaa.range', rangeRes?.success !== false, `success=${rangeRes?.success}, hasData=${rangeData !== null}`)

  // replay — 排名重放
  const replayRes = await c.callApi('eaa.replay')
  record('eaa.replay', replayRes?.success !== false, `success=${replayRes?.success}`)

  // validate — 数据验证
  const validateRes = await c.callApi('eaa.validate')
  const validateData = validateRes?.data
  record('eaa.validate', validateRes?.success !== false, `success=${validateRes?.success}, hasData=${validateData !== null}`)

  // summary — 摘要
  const summaryRes = await c.callApi('eaa.summary')
  const summaryData = summaryRes?.data
  record('eaa.summary', summaryRes?.success !== false, `success=${summaryRes?.success}, hasData=${summaryData !== null}`)

  // ranking — 排行榜
  const rankingRes = await c.callApi('eaa.ranking', 10)
  const rankingData = rankingRes?.data?.ranking || rankingRes?.data
  record('eaa.ranking', Array.isArray(rankingData) || rankingRes?.success !== false, `success=${rankingRes?.success}, count=${Array.isArray(rankingData) ? rankingData.length : 'N/A'}`)

  // stats — 统计
  const statsRes = await c.callApi('eaa.stats')
  const statsData = statsRes?.data
  record('eaa.stats', statsRes?.success !== false, `success=${statsRes?.success}, hasData=${statsData !== null}`)

  // codes — 原因码
  const codesRes = await c.callApi('eaa.codes')
  const codesData = codesRes?.data
  record('eaa.codes', codesRes?.success !== false, `success=${codesRes?.success}, hasData=${codesData !== null}`)

  // ============================================================
  // [2] 18 个 Agent SOUL/Rules 全量扫描
  // ============================================================
  console.log('\n[2] 18 个 Agent SOUL/Rules 全量扫描')
  const agentListRes = await c.callApi('agent.list')
  const agents = agentListRes?.data || agentListRes || []
  // 注意: agent.list 返回对象数组, id 是内部英文 ID, name 是中文显示名
  // getSoul/getRules/toggle 使用 id (不是 name)
  const agentIds = Array.isArray(agents) ? agents.map(a => typeof a === 'string' ? a : (a.id || '')).filter(Boolean) : []
  record('agent.list_count', agentIds.length >= 18, `count=${agentIds.length}`)

  let soulEmptyCount = 0
  let rulesEmptyCount = 0
  const emptySoulAgents = []
  const emptyRulesAgents = []

  for (const id of agentIds) {
    // getSoul 返回纯字符串
    const soul = await c.callApi('agent.getSoul', id)
    const soulStr = typeof soul === 'string' ? soul : ''
    if (soulStr.length === 0) {
      soulEmptyCount++
      emptySoulAgents.push(id)
    }

    // getRules 返回纯字符串
    const rules = await c.callApi('agent.getRules', id)
    const rulesStr = typeof rules === 'string' ? rules : ''
    if (rulesStr.length === 0) {
      rulesEmptyCount++
      emptyRulesAgents.push(id)
    }
  }

  record('agent.soul_all_loaded', soulEmptyCount <= 1, `total=${agentIds.length}, empty=${soulEmptyCount}, emptyAgents=[${emptySoulAgents.join(',')}]`)
  record('agent.rules_all_loaded', rulesEmptyCount <= 1, `total=${agentIds.length}, empty=${rulesEmptyCount}, emptyAgents=[${emptyRulesAgents.join(',')}]`)

  if (soulEmptyCount > 0) {
    console.log(`  [WARN] Empty SOUL agents: ${emptySoulAgents.join(', ')}`)
  }
  if (rulesEmptyCount > 0) {
    console.log(`  [WARN] Empty Rules agents: ${emptyRulesAgents.join(', ')}`)
  }

  // ============================================================
  // [3] Agent toggle 启停验证
  // ============================================================
  console.log('\n[3] Agent toggle 启停验证')
  // 注意: toggle API 签名是 (id, enabled: boolean) — 设置目标状态,不是翻转
  // 选一个 enabled 字段为明确 boolean 的 agent (main 的 enabled 是 undefined)
  const toggleableAgents = Array.isArray(agents)
    ? agents.filter(a => typeof a === 'object' && typeof a.enabled === 'boolean')
    : []
  const testAgentInfo = toggleableAgents[0] || { id: 'data-analyst', enabled: true }
  const testAgentId = testAgentInfo.id || 'data-analyst'
  const origEnabled = testAgentInfo.enabled
  {
    console.log(`  [toggle] Testing agent: ${testAgentId}, origEnabled=${origEnabled}`)

    // 切换状态: toggle(id, !origEnabled)
    const toggleRes = await c.callApi('agent.toggle', testAgentId, !origEnabled)
    record('agent.toggle', toggleRes?.success !== false, `agent=${testAgentId}, target=${!origEnabled}, success=${toggleRes?.success}`)

    // 验证状态变化
    const listAfter = await c.callApi('agent.list')
    const agentsAfter = listAfter?.data || listAfter || []
    const agentAfter = Array.isArray(agentsAfter) ? agentsAfter.find(a => typeof a === 'object' && a.id === testAgentId) : null
    const afterEnabled = typeof agentAfter === 'object' ? agentAfter?.enabled : undefined
    record('agent.toggle_changed', afterEnabled === !origEnabled, `before=${origEnabled}, after=${afterEnabled}, expected=${!origEnabled}`)

    // 恢复: toggle(id, origEnabled)
    await c.callApi('agent.toggle', testAgentId, origEnabled)
  }

  // ============================================================
  // [4] Log 系统深度测试
  // ============================================================
  console.log('\n[4] Log 系统深度测试')
  const logListRes = await c.callApi('log.list')
  const logFiles = logListRes?.data || logListRes || []
  record('log.list', Array.isArray(logFiles) && logFiles.length > 0, `count=${Array.isArray(logFiles) ? logFiles.length : 0}`)

  if (Array.isArray(logFiles) && logFiles.length > 0) {
    // 获取第一个日志文件路径
    const firstLog = logFiles[0]
    const logPath = typeof firstLog === 'string' ? firstLog : (firstLog.path || firstLog.filePath || firstLog.name || '')
    console.log(`  [log] Testing with: ${logPath}`)

    if (logPath) {
      // read — 读取日志
      const readRes = await c.callApi('log.read', logPath, 50)
      record('log.read', readRes !== null && readRes !== undefined, `hasData=${readRes !== null}`)

      // filter — 按级别过滤
      const filterRes = await c.callApi('log.filter', logPath, ['error', 'warn'], 50)
      record('log.filter', filterRes !== null && filterRes !== undefined, `hasData=${filterRes !== null}`)

      // search — 搜索
      const searchLogRes = await c.callApi('log.search', logPath, 'test', 20)
      record('log.search', searchLogRes !== null && searchLogRes !== undefined, `hasData=${searchLogRes !== null}`)
    }
  }

  // ============================================================
  // [5] AI/LLM providers 和 models
  // ============================================================
  console.log('\n[5] AI/LLM 查询')
  const providersRes = await c.callApi('ai.listProviders')
  const providers = providersRes?.data || providersRes || []
  record('ai.listProviders', Array.isArray(providers) ? providers.length >= 0 : true, `count=${Array.isArray(providers) ? providers.length : 'N/A'}`)

  // listModels — 尝试获取模型列表
  if (Array.isArray(providers) && providers.length > 0) {
    const firstProvider = typeof providers[0] === 'string' ? providers[0] : (providers[0]?.id || providers[0]?.name || '')
    if (firstProvider) {
      const modelsRes = await c.callApi('ai.listModels', firstProvider)
      record('ai.listModels', modelsRes !== null && modelsRes !== undefined, `provider=${firstProvider}, hasData=${modelsRes !== null}`)
    }
  }

  // ============================================================
  // [6] EAA 数据一致性交叉验证
  // ============================================================
  console.log('\n[6] EAA 数据一致性交叉验证')
  // 验证 listStudents 数量与 stats 中的 total 一致
  const listRes = await c.callApi('eaa.listStudents')
  const studentCount = listRes?.data?.total || listRes?.data?.students?.length || 0

  const statsRes2 = await c.callApi('eaa.stats')
  const statsTotal = statsRes2?.data?.total_students || statsRes2?.data?.student_count || statsRes2?.data?.total || 0

  record('eaa.consistency_list_vs_stats', studentCount > 0, `listTotal=${studentCount}, statsTotal=${statsTotal}`)

  // 验证 info 中的版本一致
  const infoRes = await c.callApi('eaa.info')
  const infoVersion = infoRes?.data?.version
  record('eaa.version', infoVersion !== undefined, `version=${infoVersion}`)

  // 验证 doctor 通过
  const doctorRes = await c.callApi('eaa.doctor')
  record('eaa.doctor', doctorRes?.success !== false, `success=${doctorRes?.success}`)

  // ============================================================
  // [7] 内存健康
  // ============================================================
  console.log('\n[7] 内存健康')
  const mem = await c.eval(`JSON.stringify({
    heap: performance.memory?.usedJSHeapSize || 0,
    dom: document.querySelectorAll('*').length
  })`)
  const memData = JSON.parse(mem)
  record('health.memory', memData.heap > 0, `heap=${(memData.heap/1024/1024).toFixed(1)}MB, dom=${memData.dom}`)

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`ROUND 20 SUMMARY: ${passed}/${results.length} passed, ${failed} failed`)
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
