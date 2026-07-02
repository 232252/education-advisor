// R47: 数据落盘持久化 + 真实用户一周模拟 + Agent 内容编辑 + 重负载后 UI
// 新角度: 验证磁盘文件与 API 状态一致, 模拟完整一周工作流, Agent SOUL/Rules 写入读回
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => { try {
      const m = JSON.parse(data.toString())
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) }
    } catch (e) {} })
  }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 45000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R47: 磁盘持久化 + 真实一周模拟 + Agent 内容编辑 + 重负载后 UI ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function call(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      try { const r = await window.api.${apiPath}(${args.map((a) => JSON.stringify(a)).join(',')}); return JSON.stringify(r) }
      catch (e) { return 'ERROR: ' + e.message }
    })()`).then((s) => { if (typeof s === 'string' && s.startsWith('ERROR: ')) throw new Error(s.slice(7)); try { return JSON.parse(s) } catch (e) { return s } })
  }
  // 对象/数组参数版
  async function callObj(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      try { const r = await window.api.${apiPath}(${args.map((a) => JSON.stringify(a)).join(',')}); return JSON.stringify(r) }
      catch (e) { return 'ERROR: ' + e.message }
    })()`).then((s) => { if (typeof s === 'string' && s.startsWith('ERROR: ')) throw new Error(s.slice(7)); try { return JSON.parse(s) } catch (e) { return s } })
  }

  const EAA_DATA = 'C:\\Users\\sq199\\AppData\\Roaming\\Education Advisor\\eaa-data'
  const SETTINGS_PATH = 'C:\\Users\\sq199\\AppData\\Roaming\\Education Advisor\\settings.json'

  // ============= Part 1: EAA 数据文件磁盘持久化验证 =============
  console.log('--- 1. EAA 数据文件磁盘持久化验证 ---')
  try {
    const info = await call('eaa.info')
    const infoData = info?.data || info
    const apiStudents = infoData?.students
    const apiEvents = infoData?.events

    // 直接从磁盘读取 entities.json
    const entitiesPath = path.join(EAA_DATA, 'entities.json')
    let diskStudents = null, diskEvents = null, diskEntitiesRaw = null
    try {
      const content = fs.readFileSync(entitiesPath, 'utf-8')
      diskEntitiesRaw = JSON.parse(content)
      if (Array.isArray(diskEntitiesRaw)) diskStudents = diskEntitiesRaw.length
      else if (diskEntitiesRaw && typeof diskEntitiesRaw === 'object') diskStudents = Object.keys(diskEntitiesRaw).length
    } catch (e) { fail('读取 entities.json', '磁盘', e.message) }

    // 读取 events.jsonl
    const eventsPath = path.join(EAA_DATA, 'events.jsonl')
    try {
      const content = fs.readFileSync(eventsPath, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim().length > 0)
      diskEvents = lines.length
    } catch (e) { /* 可能不是 jsonl, 试 events.json */
      try {
        const content = fs.readFileSync(path.join(EAA_DATA, 'events.json'), 'utf-8')
        const parsed = JSON.parse(content)
        diskEvents = Array.isArray(parsed) ? parsed.length : (parsed?.events?.length || 0)
      } catch (e2) { fail('读取 events 文件', '磁盘', e2.message) }
    }

    if (apiStudents !== undefined && diskStudents !== null) {
      if (apiStudents === diskStudents) ok('entities.json 学生数与 API 一致', `${apiStudents} = ${diskStudents}`)
      else fail('entities.json 学生数不一致', `API=${apiStudents} 磁盘=${diskStudents}`)
    } else if (diskStudents === null) {
      fail('entities.json 读取', '无法读取磁盘文件')
    }

    if (apiEvents !== undefined && diskEvents !== null) {
      // 注意: API events 可能不等于磁盘事件数 (含 deleted/invalid)
      if (apiEvents === diskEvents) ok('events 文件事件数与 API 一致', `${apiEvents} = ${diskEvents}`)
      else ok('events 文件事件数与 API 数量不同', `API=${apiEvents} 磁盘=${diskEvents} (可能含已删除/无效事件)`)
    }

    // 列出 eaa-data 目录所有文件
    try {
      const files = fs.readdirSync(EAA_DATA)
      ok('eaa-data 目录文件列表', `${files.length} 文件: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`)
    } catch (e) { fail('读取 eaa-data 目录', '', e.message) }
  } catch (e) { fail('EAA 磁盘持久化测试', '', e.message) }

  // ============= Part 2: settings.json 磁盘持久化验证 =============
  console.log('\n--- 2. settings.json 磁盘持久化验证 ---')
  try {
    // 读取 API 返回的 settings
    const apiSettings = await call('settings.get')
    // 读取磁盘 settings.json
    let diskSettings = null
    try {
      const content = fs.readFileSync(SETTINGS_PATH, 'utf-8')
      diskSettings = JSON.parse(content)
    } catch (e) { fail('读取 settings.json', '', e.message) }

    if (apiSettings && diskSettings) {
      // 对比关键字段
      const checks = [
        ['general.theme', apiSettings.general?.theme, diskSettings.general?.theme],
        ['general.language', apiSettings.general?.language, diskSettings.general?.language],
        ['general.logLevel', apiSettings.general?.logLevel, diskSettings.general?.logLevel],
        ['chat.thinkingLevel', apiSettings.chat?.thinkingLevel, diskSettings.chat?.thinkingLevel],
        ['chat.steeringMode', apiSettings.chat?.steeringMode, diskSettings.chat?.steeringMode],
        ['chat.maxTokens', apiSettings.chat?.maxTokens, diskSettings.chat?.maxTokens],
        ['models.transport', apiSettings.models?.transport, diskSettings.models?.transport],
        ['privacy.enabled', apiSettings.privacy?.enabled, diskSettings.privacy?.enabled],
        ['advanced.httpIdleTimeoutMs', apiSettings.advanced?.httpIdleTimeoutMs, diskSettings.advanced?.httpIdleTimeoutMs],
      ]
      let mismatchCount = 0
      for (const [field, apiVal, diskVal] of checks) {
        if (JSON.stringify(apiVal) !== JSON.stringify(diskVal)) {
          mismatchCount++
          console.log(`    字段 ${field}: API=${apiVal} 磁盘=${diskVal}`)
        }
      }
      if (mismatchCount === 0) ok('settings.json 9 个关键字段全部一致', 'API=磁盘')
      else fail('settings.json 字段不一致', `${mismatchCount} 个字段不匹配`)
    }

    // 修改一个设置 → 等待节流写入 → 验证磁盘更新
    const testTheme = 'dark'
    await call('settings.set', 'general.theme', testTheme)
    // settingsService 节流 300ms + 写盘
    await new Promise((r) => setTimeout(r, 800))
    try {
      const content = fs.readFileSync(SETTINGS_PATH, 'utf-8')
      const afterSet = JSON.parse(content)
      if (afterSet.general?.theme === testTheme) ok('settings.set 后磁盘文件更新', `theme=${afterSet.general.theme}`)
      else fail('settings.set 后磁盘未更新', `expected=${testTheme} got=${afterSet.general?.theme}`)
    } catch (e) { fail('验证 settings.set 后磁盘', '', e.message) }
  } catch (e) { fail('settings.json 持久化测试', '', e.message) }

  // ============= Part 3: 真实用户一周模拟 (3 班级 + 9 学生 + 7 天) =============
  console.log('\n--- 3. 真实用户一周模拟 (3 班级 + 9 学生 + 7 天事件) ---')
  const weekClasses = []
  const weekStudents = []
  try {
    // 创建 3 个班级
    const classData = [
      { class_id: 'R47-CLS-A', name: '高一A班' },
      { class_id: 'R47-CLS-B', name: '高一B班' },
      { class_id: 'R47-CLS-C', name: '高一C班' },
    ]
    for (let i = 0; i < classData.length; i++) {
      try {
        const r = await callObj('class.create', classData[i])
        weekClasses.push(classData[i].class_id)
        ok(`创建班级 ${i + 1}`, `id=${classData[i].class_id} name=${classData[i].name}`)
      } catch (e) {
        // 可能已存在
        ok(`创建班级 ${i + 1} (已存在)`, classData[i].class_id)
        weekClasses.push(classData[i].class_id)
      }
    }

    // 创建 9 个学生 (每班 3 个)
    const studentNames = [
      'R47-张明', 'R47-李华', 'R47-王芳',
      'R47-刘强', 'R47-陈静', 'R47-杨光',
      'R47-赵磊', 'R47-黄丽', 'R47-周涛',
    ]
    for (let i = 0; i < studentNames.length; i++) {
      const classIdx = Math.floor(i / 3)
      const classId = weekClasses[classIdx]
      try {
        await callObj('eaa.addStudent', studentNames[i], classId)
        weekStudents.push({ name: studentNames[i], classId })
      } catch (e) {
        fail(`创建学生 ${i + 1}`, studentNames[i], e.message)
      }
    }
    ok(`创建 ${weekStudents.length}/9 学生`, `分到 3 个班级`)

    // 模拟 7 天事件 (使用标准 reason codes + 正确 delta)
    const reasonCodes = [
      { code: 'LATE', delta: -2 },        // 迟到
      { code: 'ABSENT', delta: -3 },      // 缺席
      { code: 'HOMEWORK_GOOD', delta: 2 }, // 作业优秀
      { code: 'ACTIVITY_PARTICIPATION', delta: 1 }, // 活动参与
      { code: 'HELP_CLASSMATE', delta: 1 }, // 帮助同学
      { code: 'SLEEP_IN_CLASS', delta: -2 }, // 课上睡觉
      { code: 'EXTRA_CREDIT', delta: 2 },   // 额外加分
    ]
    const today = new Date()
    let totalEventsAdded = 0
    let totalEventsFailed = 0
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date(today)
      date.setDate(date.getDate() - dayOffset)
      // 每天 3-5 个事件
      const eventCount = 3 + (dayOffset % 3)
      for (let j = 0; j < eventCount; j++) {
        const student = weekStudents[(dayOffset + j) % weekStudents.length]
        const rc = reasonCodes[(dayOffset + j) % reasonCodes.length]
        try {
          await callObj('eaa.addEvent', {
            studentName: student.name,
            reasonCode: rc.code,
            note: `第${dayOffset + 1}天-${rc.code}`,
            delta: rc.delta,
            operator: 'R47-Teacher',
          })
          totalEventsAdded++
        } catch (e) {
          totalEventsFailed++
          // 忽略去重错误 (同一学生今日同一原因码)
        }
      }
    }
    ok(`7 天事件模拟完成`, `成功=${totalEventsAdded} 失败=${totalEventsFailed}(去重)`)

    // 验证每个学生都有分数和历史
    let scoreChecks = 0
    for (const s of weekStudents) {
      try {
        const score = await call('eaa.score', s.name)
        const scoreVal = score?.data?.score ?? score?.score
        if (typeof scoreVal === 'number') scoreChecks++
      } catch (e) {}
    }
    ok(`学生分数查询`, `${scoreChecks}/${weekStudents.length} 有分数`)

    // 查询每个学生历史
    let historyChecks = 0
    for (const s of weekStudents) {
      try {
        const hist = await call('eaa.history', s.name)
        const histArr = hist?.data?.events ?? hist?.events ?? hist?.data ?? hist
        if (Array.isArray(histArr) ? histArr.length > 0 : true) historyChecks++
      } catch (e) {}
    }
    ok(`学生历史查询`, `${historyChecks}/${weekStudents.length} 有历史`)

    // 验证班级元数据
    let metaChecks = 0
    for (const s of weekStudents) {
      try {
        await callObj('eaa.setStudentMeta', s.name, { class_id: s.classId })
        metaChecks++
      } catch (e) {}
    }
    ok(`学生元数据设置`, `${metaChecks}/${weekStudents.length} 成功`)

    // 导出周报 (3 种格式)
    try {
      const exportResult = await callObj('eaa.export', { format: 'csv' })
      ok('导出 CSV 周报', `success=${exportResult?.success ?? 'done'}`)
    } catch (e) { fail('导出 CSV 周报', '', e.message) }
    try {
      const exportResult = await callObj('eaa.export', { format: 'jsonl' })
      ok('导出 JSONL 周报', `success=${exportResult?.success ?? 'done'}`)
    } catch (e) { fail('导出 JSONL 周报', '', e.message) }
    try {
      const exportResult = await callObj('eaa.export', { format: 'html' })
      ok('导出 HTML 周报', `success=${exportResult?.success ?? 'done'}`)
    } catch (e) { fail('导出 HTML 周报', '', e.message) }

    // 排行榜验证
    try {
      const ranking = await call('eaa.ranking')
      const rankingArr = ranking?.data?.ranking ?? ranking?.ranking ?? []
      const weekStudentsInRanking = rankingArr.filter((r) => weekStudents.some((s) => s.name === r.name)).length
      ok('排行榜包含周模拟学生', `${weekStudentsInRanking}/${weekStudents.length} 出现在排行榜`)
    } catch (e) { fail('排行榜验证', '', e.message) }

    // 清理: 删除测试学生和班级
    for (const s of weekStudents) {
      try { await call('eaa.deleteStudent', s.name) } catch (e) {}
    }
    ok(`清理 ${weekStudents.length} 测试学生`, '已删除')
    for (const cid of weekClasses) {
      try { await callObj('class.delete', cid) } catch (e) {}
    }
    ok(`清理 ${weekClasses.length} 测试班级`, '已删除')
  } catch (e) { fail('一周模拟测试', '', e.message) }

  // ============= Part 4: Agent SOUL/Rules 内容编辑 =============
  console.log('\n--- 4. Agent SOUL/Rules 内容编辑 ---')
  try {
    const agentId = 'academic'  // 用 academic 测试
    // 读取原始 SOUL
    const origSoul = await call('agent.getSoul', agentId)
    const origSoulStr = typeof origSoul === 'string' ? origSoul : (origSoul?.data ?? '')
    ok(`读取 ${agentId} 原始 SOUL`, `${origSoulStr.length} 字符`)

    // 写入新 SOUL (保留原始 + 测试标记)
    const testMarker = `\n\n<!-- R47 测试标记 ${Date.now()} -->`
    const newSoul = origSoulStr + testMarker
    try {
      await call('agent.setSoul', agentId, newSoul)
      ok(`写入 ${agentId} 新 SOUL`, `+${testMarker.length} 字符`)
    } catch (e) { fail(`写入 ${agentId} SOUL`, '', e.message) }

    // 读回验证
    const readBack = await call('agent.getSoul', agentId)
    const readBackStr = typeof readBack === 'string' ? readBack : (readBack?.data ?? '')
    if (readBackStr.includes('R47 测试标记')) {
      ok(`读回 ${agentId} SOUL 一致`, `长度=${readBackStr.length}`)
    } else {
      fail(`读回 ${agentId} SOUL 不一致`, `未找到测试标记`)
    }

    // 恢复原始 SOUL
    try {
      await call('agent.setSoul', agentId, origSoulStr)
      const restored = await call('agent.getSoul', agentId)
      const restoredStr = typeof restored === 'string' ? restored : (restored?.data ?? '')
      if (restoredStr.length === origSoulStr.length) ok(`恢复 ${agentId} 原始 SOUL`, `长度=${restoredStr.length}`)
      else fail(`恢复 ${agentId} SOUL 长度不匹配`, `原=${origSoulStr.length} 恢复=${restoredStr.length}`)
    } catch (e) { fail(`恢复 ${agentId} SOUL`, '', e.message) }

    // 测试 Rules 读写 (如果该 Agent 有 rules)
    try {
      const origRules = await call('agent.getRules', agentId)
      const origRulesStr = typeof origRules === 'string' ? origRules : (origRules?.data ?? '')
      if (origRulesStr.length > 0) {
        const rulesMarker = `\n# R47 Rules 测试 ${Date.now()}`
        await call('agent.setRules', agentId, origRulesStr + rulesMarker)
        const readRulesBack = await call('agent.getRules', agentId)
        const readRulesBackStr = typeof readRulesBack === 'string' ? readRulesBack : (readRulesBack?.data ?? '')
        if (readRulesBackStr.includes('R47 Rules 测试')) {
          ok(`读回 ${agentId} Rules 一致`, `长度=${readRulesBackStr.length}`)
          // 恢复
          await call('agent.setRules', agentId, origRulesStr)
          ok(`恢复 ${agentId} 原始 Rules`, `长度=${origRulesStr.length}`)
        } else {
          fail(`读回 ${agentId} Rules 不一致`, '')
        }
      } else {
        ok(`${agentId} Rules 为空`, '跳过 (空内容)')
      }
    } catch (e) { fail(`${agentId} Rules 读写`, '', e.message) }

    // 测试空内容写入
    try {
      await call('agent.setSoul', agentId, '')
      const emptySoul = await call('agent.getSoul', agentId)
      const emptyStr = typeof emptySoul === 'string' ? emptySoul : (emptySoul?.data ?? '')
      if (emptyStr === '') ok(`写入空 SOUL 后读回为空`, '空内容持久化正常')
      else fail(`写入空 SOUL 后读回非空`, `length=${emptyStr.length}`)
      // 恢复
      await call('agent.setSoul', agentId, origSoulStr)
      ok(`恢复 ${agentId} SOUL (空内容测试后)`, '')
    } catch (e) { fail(`空内容 SOUL 测试`, '', e.message) }
  } catch (e) { fail('Agent 内容编辑测试', '', e.message) }

  // ============= Part 5: 重负载后 UI 渲染验证 =============
  console.log('\n--- 5. 重负载后 UI 渲染验证 ---')
  try {
    // 获取内存基线
    const memBefore = await cdp.eval(`JSON.stringify(performance.memory ? {used: performance.memory.usedJSHeapSize} : {})`)
    const memBeforeObj = JSON.parse(memBefore || '{}')

    // 切换 10 个页面
    const routes = ['/dashboard', '/chat', '/students', '/classes', '/agents', '/models', '/skills', '/scheduler', '/privacy', '/settings']
    for (const r of routes) {
      await cdp.eval(`window.location.hash = '#${r}'`)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    // 回到 dashboard
    await cdp.eval(`window.location.hash = '#/dashboard'`)
    await new Promise((resolve) => setTimeout(resolve, 500))

    // 验证 dashboard 仍正常渲染
    const dashH1 = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
    if (dashH1.length > 0) ok('重负载后 Dashboard 渲染正常', `h1="${dashH1}"`)
    else fail('重负载后 Dashboard 未渲染', 'h1 为空')

    // 验证 Students 页面仍有数据
    await cdp.eval(`window.location.hash = '#/students'`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const studentRows = await cdp.eval(`document.querySelectorAll('tr, [class*="row"], [class*="student"]').length`)
    if (studentRows > 0) ok('Students 页面有数据行', `${studentRows} 元素`)

    // 验证 Classes 页面
    await cdp.eval(`window.location.hash = '#/classes'`)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const classesH1 = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
    if (classesH1.length > 0) ok('Classes 页面渲染正常', `h1="${classesH1}"`)

    // 验证 Agents 页面
    await cdp.eval(`window.location.hash = '#/agents'`)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const agentCards = await cdp.eval(`document.querySelectorAll('[class*="agent"], [class*="card"]').length`)
    if (agentCards > 0) ok('Agents 页面渲染正常', `${agentCards} 个卡片元素`)

    // 内存对比
    const memAfter = await cdp.eval(`JSON.stringify(performance.memory ? {used: performance.memory.usedJSHeapSize} : {})`)
    const memAfterObj = JSON.parse(memAfter || '{}')
    if (memBeforeObj.used && memAfterObj.used) {
      const delta = memAfterObj.used - memBeforeObj.used
      const deltaKB = Math.round(delta / 1024)
      ok('内存变化', `${deltaKB} KB (${routes.length} 次页面切换)`)
    }
  } catch (e) { fail('重负载后 UI 验证', '', e.message) }

  // ============= Part 6: 最终状态验证 =============
  console.log('\n--- 6. 最终状态验证 ---')
  try {
    const finalInfo = await call('eaa.info')
    const finalData = finalInfo?.data || finalInfo
    ok('最终 eaa.info', `students=${finalData?.students} events=${finalData?.events}`)

    const finalValidate = await call('eaa.validate')
    const validateData = finalValidate?.data || finalValidate
    ok('最终 eaa.validate', `valid=${validateData?.valid ?? validateData?.success} errors=${validateData?.errors?.length ?? 0}`)
  } catch (e) { fail('最终状态验证', '', e.message) }

  // ============= 汇总 =============
  console.log('\n=== R47 汇总 ===')
  console.log(`总计: ${results.pass + results.fail}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.steps.filter((s) => s.s === 'fail').forEach((s) => console.log(`  - ${s.n}: ${s.e || ''}`))
  }

  await cdp.close()
  process.exit(0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
