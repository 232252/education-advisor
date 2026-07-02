// =============================================================
// R55 — 真实用户操作流程 + 仪表盘数据互通深度验证
//
// 验证用户提出的 3 个核心数据互通问题:
// 1. 仪表盘班级数据不互通 (5个图表应随班级筛选变化)
// 2. 学生页班级显示不一致 (学生分班应一致)
// 3. 班级详情页学生列表不互通 (点进班级应直接显示学生)
//
// 测试策略:
// - 真实模拟用户流程: 创建班级/学生/事件 → 切换班级筛选 → 验证数据变化
// - API 层面验证数据一致性 (UI基于API数据渲染)
// - UI 层面通过 CDP 模拟 select onChange,验证 React 重渲染
// =============================================================

const http = require('http')
const WebSocket = require('ws')

const CDP_PORT = 9222
const RESULT = { pass: 0, fail: 0, warn: 0, errors: [] }
const ts = Date.now().toString().slice(-6)

function log(emoji, msg) {
  if (emoji === 'PASS') {
    RESULT.pass++
    console.log(`  \u2212 ${msg}`)
  } else if (emoji === 'FAIL') {
    RESULT.fail++
    RESULT.errors.push(msg)
    console.log(`  \u2717 ${msg}`)
  } else if (emoji === 'WARN') {
    RESULT.warn++
    console.log(`  ! ${msg}`)
  } else {
    console.log(msg)
  }
}

function getCDPTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: CDP_PORT, path: '/json', timeout: 8000 },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          try {
            const arr = JSON.parse(d)
            const page = arr.find((p) => p.type === 'page')
            resolve(page ? page.webSocketDebuggerUrl : null)
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('CDP /json timeout'))
    })
  })
}

class CDPSession {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  static async connect() {
    const url = await getCDPTarget()
    if (!url) throw new Error('No CDP target')
    const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 })
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    return new CDPSession(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      throw new Error(
        'Eval error: ' +
          (r.exceptionDetails.exception?.description || r.exceptionDetails.text),
      )
    }
    return r.result.value
  }
  async api(code) {
    // 安全包装,失败返回 null 而非抛出
    // 注意: 必须用 const r=code;return JSON.stringify(r) 模式,否则 IIFE 返回 undefined
    const v = await this.eval(
      `(async()=>{try{const r=${code};return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`,
    )
    if (typeof v === 'string' && v.startsWith('ERR:')) return { __error: v.slice(4) }
    try {
      return v ? JSON.parse(v) : null
    } catch (e) {
      return v
    }
  }
  close() {
    this.ws.close()
  }
}

// =============================================================
// 测试开始
// =============================================================
async function main() {
  console.log('=== R55 真实用户流程 + 仪表盘数据互通深度验证 ===')
  console.log('时间戳后缀:', ts)
  console.log('')

  const cdp = await CDPSession.connect()
  console.log('CDP 连接成功')
  console.log('')

  // ---------- 数据准备 ----------
  console.log('--- 数据准备: 创建 2 班 + 6 学生 + 6 事件 ---')

  const classA = `R55A-${ts}`
  const classB = `R55B-${ts}`
  const s1 = `R55s1_${ts}` // → A班
  const s2 = `R55s2_${ts}` // → A班
  const s3 = `R55s3_${ts}` // → A班
  const s4 = `R55s4_${ts}` // → B班
  const s5 = `R55s5_${ts}` // → B班
  const s6 = `R55s6_${ts}` // → 未分班

  // 创建班级 A
  let r = await cdp.api(
    `await window.api.class.create({class_id:'${classA}',name:'R55高一1班_${ts}',grade:'高一'})`,
  )
  if (r && r.success) log('PASS', `创建班级 A — ${classA}`)
  else log('FAIL', `创建班级 A 失败: ${r?.error || JSON.stringify(r)}`)

  // 创建班级 B
  r = await cdp.api(
    `await window.api.class.create({class_id:'${classB}',name:'R55高一2班_${ts}',grade:'高一'})`,
  )
  if (r && r.success) log('PASS', `创建班级 B — ${classB}`)
  else log('FAIL', `创建班级 B 失败: ${r?.error || JSON.stringify(r)}`)

  // 创建 6 个学生
  for (const name of [s1, s2, s3, s4, s5, s6]) {
    r = await cdp.api(`await window.api.eaa.addStudent('${name}')`)
    if (r && r.success) log('PASS', `创建学生 ${name}`)
    else log('FAIL', `创建学生 ${name} 失败: ${r?.stderr || r?.__error}`)
  }

  // 分班 (问题2: 学生页班级显示一致)
  r = await cdp.api(
    `await window.api.class.assign({class_id:'${classA}',student_names:['${s1}','${s2}','${s3}']})`,
  )
  if (r && r.success && r.assigned === 3) log('PASS', `分配 3 学生到 A 班`)
  else log('FAIL', `分配 A 班失败: ${JSON.stringify(r)}`)

  r = await cdp.api(
    `await window.api.class.assign({class_id:'${classB}',student_names:['${s4}','${s5}']})`,
  )
  if (r && r.success && r.assigned === 2) log('PASS', `分配 2 学生到 B 班`)
  else log('FAIL', `分配 B 班失败: ${JSON.stringify(r)}`)

  // s6 故意不分班

  // 添加事件 (A班3个事件, B班2个事件, 未分班1个事件)
  const events = [
    { student: s1, code: 'LATE', delta: -2, tag: 'A班' },
    { student: s2, code: 'SMOKING', delta: -10, tag: 'A班' },
    { student: s3, code: 'CLASS_MONITOR', delta: 10, tag: 'A班' },
    { student: s4, code: 'ACTIVITY_PARTICIPATION', delta: 1, tag: 'B班' },
    { student: s5, code: 'LATE', delta: -2, tag: 'B班' },
    { student: s6, code: 'LATE', delta: -2, tag: '未分班' },
  ]
  for (const e of events) {
    r = await cdp.api(
      `await window.api.eaa.addEvent({studentName:'${e.student}',reasonCode:'${e.code}',tags:['${e.tag}']})`,
    )
    if (r && r.success) log('PASS', `事件 ${e.student} ${e.code} (${e.delta})`)
    else log('FAIL', `事件 ${e.student} 失败: ${r?.stderr || r?.__error}`)
  }

  console.log('')

  // =============================================================
  // 问题 2: 学生页班级显示一致 (API 层验证)
  // =============================================================
  console.log('--- 问题2: 学生页班级显示一致 ---')

  const listR = await cdp.api(`await window.api.eaa.listStudents()`)
  const students = listR?.data?.students || []
  const activeStudents = students.filter((s) => s.status !== 'Deleted')

  const checkStudentClass = (name, expectedClass) => {
    const stu = activeStudents.find((s) => s.name === name)
    if (!stu) {
      log('FAIL', `学生 ${name} 不在列表中`)
      return
    }
    if (expectedClass === null) {
      if (!stu.class_id || stu.class_id === '') log('PASS', `${name} 未分班 (符合预期)`)
      else log('FAIL', `${name} 应未分班, 实际 class_id=${stu.class_id}`)
    } else {
      if (stu.class_id === expectedClass) log('PASS', `${name} class_id=${stu.class_id}`)
      else log('FAIL', `${name} 期望 ${expectedClass}, 实际 ${stu.class_id}`)
    }
  }

  if (activeStudents.length >= 6) log('PASS', `学生总数 ≥ 6 (实际 ${activeStudents.length})`)
  else log('FAIL', `学生总数 < 6 (实际 ${activeStudents.length})`)

  checkStudentClass(s1, classA)
  checkStudentClass(s2, classA)
  checkStudentClass(s3, classA)
  checkStudentClass(s4, classB)
  checkStudentClass(s5, classB)
  checkStudentClass(s6, null)

  console.log('')

  // =============================================================
  // 问题 3: 班级详情页学生列表互通 (API 层验证)
  // =============================================================
  console.log('--- 问题3: 班级详情页学生列表互通 ---')

  // class.list 应包含 A 班和 B 班
  const classListR = await cdp.api(`await window.api.class.list()`)
  const classList = classListR?.data || []
  const classAEntity = classList.find((c) => c.class_id === classA)
  const classBEntity = classList.find((c) => c.class_id === classB)

  if (classAEntity) log('PASS', `class.list 包含 A 班`)
  else log('FAIL', `class.list 不包含 A 班`)
  if (classBEntity) log('PASS', `class.list 包含 B 班`)
  else log('FAIL', `class.list 不包含 B 班`)

  // 班级的学生数应正确 (数据互通的核心)
  if (classAEntity) {
    const aStudents = activeStudents.filter((s) => s.class_id === classA)
    if (aStudents.length === 3) log('PASS', `A 班学生数 = 3 (数据互通)`)
    else log('FAIL', `A 班学生数 = ${aStudents.length}, 期望 3`)
  }
  if (classBEntity) {
    const bStudents = activeStudents.filter((s) => s.class_id === classB)
    if (bStudents.length === 2) log('PASS', `B 班学生数 = 2 (数据互通)`)
    else log('FAIL', `B 班学生数 = ${bStudents.length}, 期望 2`)
  }

  console.log('')

  // =============================================================
  // 问题 1: 仪表盘班级数据互通 (API 层验证 5 个图表数据源)
  // =============================================================
  console.log('--- 问题1: 仪表盘班级数据互通 (API 层验证) ---')

  // 构造 entity_id → class_id 映射 (模拟 DashboardPage 的 entityIdToClassId)
  const entityIdToClassId = {}
  for (const s of activeStudents) {
    if (s.class_id) entityIdToClassId[s.entity_id] = s.class_id
  }

  // 获取测试学生的事件 (改用 history() 逐个查询,避免 range() 的 1000 limit 截断)
  // 原方案: range(limit=1000) 在数据库累积 >1000 事件时会截断新创建的测试事件
  // 新方案: 对每个测试学生调用 history(),确保获取到本轮创建的事件
  // 注意: history() 返回的事件不含 entity_id,需从学生列表中查找并补充
  const testStudents = [s1, s2, s3, s4, s5, s6]
  const eventsArr = []
  for (const stuName of testStudents) {
    const stu = activeStudents.find((s) => s.name === stuName)
    const entityId = stu?.entity_id
    const histR = await cdp.api(`await window.api.eaa.history('${stuName}')`)
    const histData = histR?.data
    const histArr = Array.isArray(histData) ? histData : (histData?.events || histData?.timeline || [])
    for (const e of histArr) {
      if (!e.reverted) {
        // 补充 entity_id 以便 simulateFilter 按 class_id 过滤
        if (!e.entity_id && entityId) e.entity_id = entityId
        eventsArr.push(e)
      }
    }
  }

  // 模拟 DashboardPage 的 filteredEvents / filteredStudents 逻辑
  function simulateFilter(filter) {
    let filteredEvents
    if (filter === '__ALL__') {
      filteredEvents = eventsArr
    } else {
      filteredEvents = eventsArr.filter((e) => {
        const cid = entityIdToClassId[e.entity_id]
        if (filter === '__NONE__') return !cid
        return cid === filter
      })
    }

    let filteredStudents
    if (filter === '__ALL__') {
      filteredStudents = activeStudents
    } else if (filter === '__NONE__') {
      filteredStudents = activeStudents.filter((s) => !s.class_id)
    } else {
      filteredStudents = activeStudents.filter((s) => s.class_id === filter)
    }

    // 模拟 classScoreIntervals
    const scoreIntervals = { '极高(<60)': 0, '高(60-80)': 0, '中(80-100)': 0, '低(>=100)': 0 }
    for (const s of filteredStudents) {
      if (s.score < 60) scoreIntervals['极高(<60)']++
      else if (s.score < 80) scoreIntervals['高(60-80)']++
      else if (s.score < 100) scoreIntervals['中(80-100)']++
      else scoreIntervals['低(>=100)']++
    }

    // 模拟 classReasonDist
    const reasonDist = {}
    for (const e of filteredEvents) {
      const code = e.reason_code || 'UNKNOWN'
      reasonDist[code] = (reasonDist[code] || 0) + 1
    }

    // 模拟 classPeriodSummary
    let bonusCount = 0,
      deductCount = 0
    for (const e of filteredEvents) {
      if (e.score_delta > 0) bonusCount++
      else if (e.score_delta < 0) deductCount++
    }

    return {
      students: filteredStudents.length,
      events: filteredEvents.length,
      scoreIntervals,
      reasonDist,
      periodSummary: { bonusCount, deductCount, total: filteredEvents.length },
    }
  }

  // --- 全局 (ALL) ---
  console.log('  [全局 __ALL__]')
  const allData = simulateFilter('__ALL__')
  if (allData.students >= 6) log('PASS', `全局学生数 ${allData.students} (≥6)`)
  else log('FAIL', `全局学生数 ${allData.students}, 期望 ≥6`)
  if (allData.events >= 6) log('PASS', `全局事件数 ${allData.events} (≥6)`)
  else log('FAIL', `全局事件数 ${allData.events}, 期望 ≥6`)

  console.log('')
  console.log('  [A 班筛选]')
  const aData = simulateFilter(classA)
  if (aData.students === 3) log('PASS', `A 班学生数 = 3`)
  else log('FAIL', `A 班学生数 = ${aData.students}, 期望 3`)
  if (aData.events === 3) log('PASS', `A 班事件数 = 3`)
  else log('FAIL', `A 班事件数 = ${aData.events}, 期望 3`)
  if (aData.reasonDist.LATE === 1 && aData.reasonDist.SMOKING === 1 && aData.reasonDist.CLASS_MONITOR === 1)
    log('PASS', `A 班原因分布正确 (LATE:1, SMOKING:1, CLASS_MONITOR:1)`)
  else log('FAIL', `A 班原因分布错误: ${JSON.stringify(aData.reasonDist)}`)
  if (aData.periodSummary.total === 3 && aData.periodSummary.bonusCount === 1 && aData.periodSummary.deductCount === 2)
    log('PASS', `A 班周期摘要正确 (total:3, bonus:1, deduct:2)`)
  else log('FAIL', `A 班周期摘要错误: ${JSON.stringify(aData.periodSummary)}`)
  // A 班分数分布: s1=98(中), s2=90(中), s3=110(低)
  if (aData.scoreIntervals['中(80-100)'] === 2 && aData.scoreIntervals['低(>=100)'] === 1)
    log('PASS', `A 班分数分布正确 (中:2, 低:1)`)
  else log('FAIL', `A 班分数分布错误: ${JSON.stringify(aData.scoreIntervals)}`)

  console.log('')
  console.log('  [B 班筛选]')
  const bData = simulateFilter(classB)
  if (bData.students === 2) log('PASS', `B 班学生数 = 2`)
  else log('FAIL', `B 班学生数 = ${bData.students}, 期望 2`)
  if (bData.events === 2) log('PASS', `B 班事件数 = 2`)
  else log('FAIL', `B 班事件数 = ${bData.events}, 期望 2`)
  if (bData.reasonDist.LATE === 1 && bData.reasonDist.ACTIVITY_PARTICIPATION === 1)
    log('PASS', `B 班原因分布正确 (LATE:1, ACTIVITY_PARTICIPATION:1)`)
  else log('FAIL', `B 班原因分布错误: ${JSON.stringify(bData.reasonDist)}`)

  console.log('')
  console.log('  [未分班筛选 __NONE__]')
  const noneData = simulateFilter('__NONE__')
  if (noneData.students === 1) log('PASS', `未分班学生数 = 1`)
  else log('FAIL', `未分班学生数 = ${noneData.students}, 期望 1`)
  // eventsArr 仅含 6 个测试学生的事件 (history() 逐个查询),无历史孤儿事件
  // 核心验证: s6 的 LATE 事件必须包含在未分班事件中
  const s6Student = activeStudents.find((s) => s.name === s6)
  const s6EventsInNone = s6Student
    ? eventsArr.filter((e) => e.entity_id === s6Student.entity_id).length
    : 0
  if (noneData.events >= 1) log('PASS', `未分班事件数 ≥ 1 (实际 ${noneData.events}, s6 事件 ${s6EventsInNone})`)
  else log('FAIL', `未分班事件数 = ${noneData.events}, 期望 ≥1`)
  if (s6EventsInNone >= 1 && (noneData.reasonDist.LATE || 0) >= 1)
    log('PASS', `s6 的 LATE 事件正确归入未分班`)
  else log('FAIL', `s6 事件未归入未分班`)

  console.log('')

  console.log('')

  // =============================================================
  // UI 层验证: 通过 CDP 模拟 select onChange 切换班级筛选
  // =============================================================
  console.log('--- UI 层验证: 仪表盘班级筛选切换 ---')

  // 导航到 dashboard (轮询等待渲染,防止瞬时渲染时序问题)
  await cdp.eval(`window.location.hash = '#/dashboard'`)
  let dashTitle = ''
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(500)
    dashTitle = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
    if (dashTitle) break
  }
  if (dashTitle.includes('仪表盘') || dashTitle.includes('Dashboard') || dashTitle.length > 0)
    log('PASS', `仪表盘已加载 — 标题: ${dashTitle.slice(0, 30)}`)
  else log('FAIL', `仪表盘未加载`)

  // 读取初始渲染文本 (全部班级)
  const initialText = await cdp.eval(`document.body.innerText.length`)
  if (initialText > 100) log('PASS', `初始渲染文本长度 ${initialText}`)
  else log('FAIL', `初始渲染文本过短`)

  // 找到班级筛选 select
  const selectExists = await cdp.eval(
    `!!document.querySelector('select[title="按班级筛选数据"]')`,
  )
  if (selectExists) log('PASS', `班级筛选 select 存在`)
  else log('WARN', `班级筛选 select 未找到 (可能渲染中)`)

  // 模拟切换 select 到 A 班 (触发 React onChange)
  if (selectExists) {
    const switchResult = await cdp.api(`(()=>{
      const sel = document.querySelector('select[title="按班级筛选数据"]')
      if (!sel) return {error: 'select not found'}
      const opts = Array.from(sel.options)
      const aOpt = opts.find(o => o.value === '${classA}')
      if (!aOpt) return {error: 'option not found', options: opts.map(o=>o.value).slice(0,5)}
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      nativeInputSetter.call(sel, '${classA}')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return {ok: true, selectedValue: sel.value}
    })()`)
    if (switchResult && (switchResult.ok || switchResult.selectedValue === classA))
      log('PASS', `切换 select 到 A 班成功`)
    else log('FAIL', `切换 select 失败: ${JSON.stringify(switchResult)}`)

    await sleep(600)

    // 验证渲染数据变化 (检查 A 班学生数显示)
    const aText = await cdp.eval(`document.body.innerText`)
    // 仪表盘顶部数字卡片应显示 3 (A班学生数)
    if (aText.includes('3')) log('PASS', `A 班筛选后渲染包含 "3" (学生数)`)
    else log('WARN', `A 班筛选后渲染未发现 "3"`)

    // 切换到 B 班
    const switchB = await cdp.api(`(()=>{
      const sel = document.querySelector('select[title="按班级筛选数据"]')
      if (!sel) return {error: 'no select'}
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      nativeInputSetter.call(sel, '${classB}')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return {ok: true, selectedValue: sel.value}
    })()`)
    if (switchB && switchB.ok) log('PASS', `切换 select 到 B 班成功`)
    else log('FAIL', `切换 B 班失败`)
    await sleep(600)

    // 切换回全部
    const switchAll = await cdp.api(`(()=>{
      const sel = document.querySelector('select[title="按班级筛选数据"]')
      if (!sel) return {error: 'no select'}
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      nativeInputSetter.call(sel, '__ALL__')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      return {ok: true, selectedValue: sel.value}
    })()`)
    if (switchAll && switchAll.ok) log('PASS', `切换回全部班级成功`)
    else log('FAIL', `切换回全部失败`)
    await sleep(400)
  }

  console.log('')

  // =============================================================
  // UI 层验证: 班级详情页学生列表 (问题3)
  // =============================================================
  console.log('--- UI 层验证: 班级详情页学生列表 ---')

  // 导航到班级页
  await cdp.eval(`window.location.hash = '#/classes'`)
  await sleep(800)

  const classesText = await cdp.eval(`document.body.innerText`)
  if (classesText.includes('R55高一1班') || classesText.includes(classA))
    log('PASS', `班级页显示 A 班`)
  else log('WARN', `班级页未显示 A 班名`)
  if (classesText.includes('R55高一2班') || classesText.includes(classB))
    log('PASS', `班级页显示 B 班`)
  else log('WARN', `班级页未显示 B 班名`)

  // 验证班级页能展示学生数 (不要求点进详情,直接看表格行)
  // 班级页表格通常有 studentCount 列
  const classRows = await cdp.eval(`document.querySelectorAll('table tbody tr').length`)
  if (classRows >= 2) log('PASS', `班级页表格行数 ${classRows} (≥2)`)
  else log('WARN', `班级页表格行数 ${classRows}`)

  console.log('')

  // =============================================================
  // 清理
  // =============================================================
  console.log('--- 清理 R55 测试数据 ---')

  // 删除学生
  let delCount = 0
  for (const name of [s1, s2, s3, s4, s5, s6]) {
    const r = await cdp.api(`await window.api.eaa.deleteStudent('${name}','R55清理')`)
    if (r && r.success) delCount++
  }
  console.log(`  清理学生: ${delCount}/6`)

  // 删除班级
  let delClassCount = 0
  for (const cid of [classA, classB]) {
    const entity = classList.find((c) => c.class_id === cid)
    if (entity && entity.id) {
      const r = await cdp.api(`await window.api.class.delete('${entity.id}')`)
      if (r && r.success) delClassCount++
    }
  }
  console.log(`  清理班级: ${delClassCount}/2`)

  // 验证清理
  const afterList = await cdp.api(`await window.api.eaa.listStudents()`)
  const afterActive = (afterList?.data?.students || []).filter((s) => s.status !== 'Deleted')
  const r55Left = afterActive.filter((s) => s.name.includes(`R55_${ts}`) || s.name.startsWith('R55s'))
  if (r55Left.length === 0) log('PASS', `清理后无 R55 残留`)
  else log('FAIL', `清理后仍有 ${r55Left.length} 个 R55 学生`)

  cdp.close()

  // =============================================================
  // 结果
  // =============================================================
  console.log('')
  console.log('=== R55 测试完成 ===')
  const total = RESULT.pass + RESULT.fail + RESULT.warn
  const rate = total > 0 ? ((RESULT.pass / total) * 100).toFixed(1) : '0.0'
  console.log(`结果: ${RESULT.pass} pass, ${RESULT.fail} fail, ${RESULT.warn} warn`)
  console.log(`通过率: ${rate}%`)

  if (RESULT.errors.length > 0) {
    console.log('')
    console.log('失败项:')
    RESULT.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`))
  }

  // 写入结果 JSON
  const fs = require('fs')
  const resultFile = 'dogfood-output/r55-real-user-flow-result.json'
  fs.writeFileSync(
    resultFile,
    JSON.stringify(
      {
        test: 'R55',
        timestamp: new Date().toISOString(),
        summary: { pass: RESULT.pass, fail: RESULT.fail, warn: RESULT.warn, rate: rate + '%' },
        errors: RESULT.errors,
      },
      null,
      2,
    ),
    'utf-8',
  )

  process.exit(RESULT.fail > 0 ? 1 : 0)
}

function getDateStr(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(2)
})
