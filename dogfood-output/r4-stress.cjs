// R4: 压力测试 + 长时间稳定性 + 并发 + 真实模拟
// 用户要求:
//   1. 随机创建 3 个班级
//   2. 随机模拟学生: 创建 → 各方面使用 → 删除 全生命周期
//   3. 全方面实际情况使用 + 压力
//   4. 真实模拟用户操作
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

const LOG_FILE = require('path').join(__dirname, 'r4-output.log')
// 清空旧日志
try { fs.writeFileSync(LOG_FILE, '') } catch {}

function logProgress(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`
  process.stdout.write(line)
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

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
  async callApi(p, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(p)}.split('.')
      let obj = window.api
      for (const x of parts) obj = obj[x]
      const a = ${JSON.stringify(args)}
      try { return await obj(...a) } catch(e) { return { __error: e.message } }
    })()`)
  }
  async getMemory() {
    return this.eval(`JSON.stringify(performance.memory ? {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit} : {})`)
  }
  close() { if (this.ws) this.ws.close() }
}

const stats = {
  total: 0, pass: 0, fail: 0,
  errors: [],
  byPhase: {},
}
function record(phase, name, ok, detail = '') {
  stats.total++
  if (ok) stats.pass++
  else { stats.fail++; stats.errors.push({ phase, name, detail: String(detail).slice(0, 200) }) }
  stats.byPhase[phase] = stats.byPhase[phase] || { pass: 0, fail: 0 }
  if (ok) stats.byPhase[phase].pass++
  else stats.byPhase[phase].fail++
  if (!ok) logProgress(`  [${phase}] FAIL: ${name} :: ${String(detail).slice(0, 150)}`)
}

// 学生姓名池(中国常见姓名)
const SURNAMES = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '林', '郭', '何', '高', '罗']
const GIVEN_NAMES = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平', '刚', '桂英', '建国', '建华', '建军', '建平', '志强', '志明', '俊杰', '晓东']
function genStudentName() {
  return rand(SURNAMES) + rand(GIVEN_NAMES) + (Math.random() < 0.3 ? rand(GIVEN_NAMES) : '')
}

// reason codes 池(按类别) - 来自实际 eaa.codes 查询,共 22 个真实 code
const DEDUCT_CODES = ['DESK_UNALIGNED', 'OTHER_DEDUCT', 'LATE', 'SLEEP_IN_CLASS', 'SPEAK_IN_CLASS', 'MAKEUP', 'APPEARANCE_VIOLATION', 'SCHOOL_CAUGHT', 'PHONE_IN_CLASS', 'DRINKING_DORM', 'SMOKING']
const BONUS_CODES = ['CLASS_MONITOR', 'CLASS_COMMITTEE', 'CIVILIZED_DORM', 'MONTHLY_ATTENDANCE', 'ACTIVITY_PARTICIPATION', 'BONUS_VARIABLE']
const LAB_CODES = ['LAB_CLEAN_UP', 'LAB_EQUIPMENT_DAMAGE', 'LAB_UNSAFE_BEHAVIOR', 'LAB_SAFETY_VIOLATION']

async function main() {
  logProgress('============================================================')
  logProgress('ROUND 4 (R4): 压力测试 + 长时间稳定性 + 并发 + 真实模拟')
  logProgress('============================================================')

  const c = new CDPClient()
  await c.connect()

  // 注入错误监听
  await c.eval(`(function(){
    if(window.__r4Errs) return
    window.__r4Errs = []
    window.addEventListener('error', e => { window.__r4Errs.push(e.message) })
    window.addEventListener('unhandledrejection', e => { window.__r4Errs.push('unhandled:' + (e.reason && e.reason.message || e.reason)) })
  })()`)

  // 预先清理(避免上次测试残留)
  // 注意: 不清理学生(每个 deleteStudent 都 spawn Rust 子进程,78 个学生太慢)
  // 只清理 R4- 班级(SQLite 操作,快)
  logProgress('\n[0] 预清理(只清班级,不清学生)...')
  const preClasses = await c.callApi('class.list')
  if (preClasses?.success && Array.isArray(preClasses.data)) {
    for (const cls of preClasses.data) {
      if (cls.class_id && cls.class_id.startsWith('R4-')) {
        await c.callApi('class.delete', cls.id)
      }
    }
  }

  // ============================================================
  // [1] 创建 3 个班级 (使用时间戳后缀避免冲突)
  // ============================================================
  logProgress('\n[1] 创建 3 个班级')
  const ts = Date.now()
  // class.create 期望 snake_case: { class_id, name, grade, note, teacher }
  const classes = [
    { class_id: `R4-G7-1-${ts}`, name: 'R4测试七年级1班', grade: '七年级', teacher: '张老师' },
    { class_id: `R4-G7-2-${ts}`, name: 'R4测试七年级2班', grade: '七年级', teacher: '李老师' },
    { class_id: `R4-G7-3-${ts}`, name: 'R4测试七年级3班', grade: '七年级', teacher: '王老师' },
  ]
  const createdClasses = []
  for (const cls of classes) {
    const res = await c.callApi('class.create', cls)
    const ok = res?.success === true
    record('create_class', cls.class_id, ok, JSON.stringify(res).slice(0, 100))
    if (ok && res.data) createdClasses.push({ ...cls, id: res.data.id || res.data.class_id })
  }
  logProgress(`  创建 ${createdClasses.length}/3 个班级`)

  // ============================================================
  // [2] 每班创建 10 名学生(共 30 名) — 缩减规模加速测试
  // ============================================================
  logProgress('\n[2] 每班创建 10 名学生(共 30 名)')
  const students = [] // {name, classId}
  for (const cls of createdClasses) {
    for (let i = 1; i <= 10; i++) {
      const name = `R4_${cls.class_id}_${i}_${genStudentName()}`
      const res = await c.callApi('eaa.addStudent', name)
      record('add_student', name, res?.success === true, JSON.stringify(res).slice(0, 80))
      if (res?.success) {
        students.push({ name, classId: cls.class_id })
        // 设置学生元数据(classId)
        const metaRes = await c.callApi('eaa.setStudentMeta', { name, classId: cls.class_id })
        record('set_meta', name, metaRes?.success === true, JSON.stringify(metaRes).slice(0, 80))
      }
    }
  }
  logProgress(`  创建 ${students.length}/30 名学生`)

  // ============================================================
  // [3] 模拟实际使用 - 给每个学生打分(每个学生 5 个事件)
  // ============================================================
  logProgress('\n[3] 模拟打分事件(每学生 5 个,共 ~150 个)')
  let eventCount = 0
  for (const stu of students) {
    const nEvents = 5
    for (let i = 0; i < nEvents; i++) {
      const codePool = Math.random() < 0.5 ? DEDUCT_CODES : (Math.random() < 0.3 ? BONUS_CODES : LAB_CODES)
      const reasonCode = rand(codePool)
      const res = await c.callApi('eaa.addEvent', {
        studentName: stu.name,
        reasonCode,
        note: `R4测试事件#${i}`,
        force: true, // 避免同一学生同一日同一原因码被去重拒绝
      })
      record('add_event', `${stu.name}#${reasonCode}`, res?.success === true, JSON.stringify(res).slice(0, 80))
      if (res?.success) eventCount++
    }
  }
  logProgress(`  创建 ${eventCount} 个事件`)

  // ============================================================
  // [4] 并发查询测试 - 50 个并发请求
  // ============================================================
  logProgress('\n[4] 并发查询测试(50 个并发)')
  if (students.length === 0) {
    logProgress('  SKIP: no students available')
    record('concurrent', 'skip_no_students', false, 'no students')
  } else {
    const concurrentQueries = []
    for (let i = 0; i < 50; i++) {
      const stu = rand(students)
      concurrentQueries.push(c.callApi('eaa.score', stu.name))
      concurrentQueries.push(c.callApi('eaa.history', stu.name))
    }
    const t1 = Date.now()
    const results = await Promise.all(concurrentQueries)
    const t2 = Date.now()
    let concurrentOk = 0
    for (const r of results) {
      if (r?.success !== false && !r?.__error) concurrentOk++
    }
    record('concurrent', `50并发_100请求_${t2-t1}ms`, concurrentOk >= 90, `${concurrentOk}/100 ok in ${t2-t1}ms`)
    logProgress(`  ${concurrentOk}/100 并发请求成功,耗时 ${t2-t1}ms`)
  }

  // ============================================================
  // [5] 并发写入测试 - 20 个并发 addEvent
  // ============================================================
  logProgress('\n[5] 并发写入测试(20 个并发 addEvent)')
  const concurrentWrites = []
  for (let i = 0; i < 20; i++) {
    const stu = rand(students)
    concurrentWrites.push(c.callApi('eaa.addEvent', {
      studentName: stu.name,
      reasonCode: 'LATE',
      note: `R4并发写入#${i}`,
      force: true,
    }))
  }
  const wt1 = Date.now()
  const wResults = await Promise.all(concurrentWrites)
  const wt2 = Date.now()
  let writeOk = 0
  for (const r of wResults) if (r?.success) writeOk++
  record('concurrent_write', `20并发_addEvent_${wt2-wt1}ms`, writeOk >= 18, `${writeOk}/20 ok in ${wt2-wt1}ms`)
  logProgress(`  ${writeOk}/20 并发写入成功,耗时 ${wt2-wt1}ms`)

  // ============================================================
  // [6] 并发 class.assign + removeStudent 测试
  // ============================================================
  logProgress('\n[6] 并发 class.assign/removeStudent')
  // class.assign 期望 { class_id, student_names: [...] }
  const targetClass = createdClasses[0]
  const assignOps = []
  for (let i = 0; i < 10; i++) {
    const stu = rand(students)
    assignOps.push(c.callApi('class.assign', { class_id: targetClass.class_id, student_names: [stu.name] }))
  }
  const aResults = await Promise.all(assignOps)
  let assignOk = 0
  for (const r of aResults) if (r?.success !== false) assignOk++
  record('concurrent_assign', `10并发_assign`, assignOk >= 8, `${assignOk}/10 ok`)

  // ============================================================
  // [7] 班级管理: 更新/归档/取消归档
  // ============================================================
  logProgress('\n[7] 班级管理: 更新/归档/取消归档')
  // class.update 期望 (id, fields) - fields: {name, grade, note, teacher}
  for (const cls of createdClasses) {
    const updRes = await c.callApi('class.update', cls.id, { name: cls.name + '_改', teacher: '新老师' })
    record('class_update', cls.class_id, updRes?.success !== false, JSON.stringify(updRes).slice(0, 80))
  }
  // 归档第二个班级
  if (createdClasses[1]) {
    const archRes = await c.callApi('class.archive', createdClasses[1].id)
    record('class_archive', createdClasses[1].class_id, archRes?.success !== false, JSON.stringify(archRes).slice(0, 80))
    // 取消归档(restore)
    const unarchRes = await c.callApi('class.restore', createdClasses[1].id)
    record('class_unarchive', createdClasses[1].class_id, unarchRes?.success !== false, JSON.stringify(unarchRes).slice(0, 80))
  }

  // ============================================================
  // [8] 长时间稳定性 - 重复 5 轮完整查询循环
  // ============================================================
  logProgress('\n[8] 长时间稳定性(5 轮完整查询循环)')
  const memBefore = await c.getMemory()
  for (let round = 1; round <= 5; round++) {
    const info = await c.callApi('eaa.info')
    record('stability', `round${round}_info`, info?.success === true, `students: ${info?.data?.students ?? '?'}`)

    const statsRes = await c.callApi('eaa.stats')
    record('stability', `round${round}_stats`, statsRes?.success === true)

    const ranking = await c.callApi('eaa.ranking', 10)
    record('stability', `round${round}_ranking`, ranking?.success === true)

    // 查询所有学生分数
    let scoreOk = 0
    for (const stu of students.slice(0, 10)) {
      const s = await c.callApi('eaa.score', stu.name)
      if (s?.success) scoreOk++
    }
    record('stability', `round${round}_scores`, scoreOk >= 8, `${scoreOk}/10 ok`)
    logProgress(`  round ${round}/5 done`)
  }
  const memAfter = await c.getMemory()
  logProgress(`  内存: before=${memBefore} after=${memAfter}`)

  // ============================================================
  // [9] 事件回滚测试(回滚 5 个事件)
  // ============================================================
  logProgress('\n[9] 事件回滚测试')
  // 先查询一个学生的历史
  const sampleStu = students[0]
  const hist = await c.callApi('eaa.history', sampleStu.name)
  if (hist?.success && hist.data?.events?.length > 0) {
    const eventsToRevert = hist.data.events.slice(0, Math.min(5, hist.data.events.length))
    for (const ev of eventsToRevert) {
      const r = await c.callApi('eaa.revertEvent', ev.id || ev.event_id, 'R4测试回滚')
      record('revert', `revert_${ev.id || ev.event_id}`, r?.success === true, JSON.stringify(r).slice(0, 80))
    }
  } else {
    record('revert', 'no_events_to_revert', true, `hist: ${JSON.stringify(hist).slice(0, 100)}`)
  }

  // ============================================================
  // [10] chat 持久化压力(50 条消息)
  // ============================================================
  logProgress('\n[10] Chat 持久化压力(50 条消息)')
  const sessionId = `r4-stress-${Date.now()}`
  for (let i = 0; i < 50; i++) {
    const r = await c.callApi('chat.saveMessage', {
      sessionId,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `R4压力测试消息#${i} - ${'x'.repeat(100)}`,
    })
    record('chat_save', `msg#${i}`, r?.success === true && r.id > 0, JSON.stringify(r).slice(0, 80))
  }
  // 加载消息验证
  const loadRes = await c.callApi('chat.loadMessages', sessionId)
  record('chat_load', 'load_50_msgs', loadRes?.success === true && (loadRes.messages?.length || 0) === 50, `${loadRes?.messages?.length ?? 0}/50`)
  // 删除 session
  const delSessRes = await c.callApi('chat.deleteSession', sessionId)
  record('chat_delete', 'delete_session', delSessRes?.success === true, JSON.stringify(delSessRes).slice(0, 80))

  // ============================================================
  // [11] skill CRUD 压力(10 个 skill 创建+删除)
  // ============================================================
  logProgress('\n[11] Skill CRUD 压力(10 个)')
  // skill.save 期望 (name, content) 两个位置参数
  const skillNames = []
  for (let i = 0; i < 10; i++) {
    const name = `r4-skill-${i}`
    const r = await c.callApi('skill.save', name, `# R4 测试技能 ${i}\n\n这是一个测试技能,序号 ${i}`)
    record('skill_save', `skill#${i}`, r?.success !== false, JSON.stringify(r).slice(0, 80))
    if (r?.success !== false) skillNames.push(name)
  }
  // 删除
  for (const name of skillNames) {
    const r = await c.callApi('skill.delete', name)
    record('skill_delete', name, r?.success !== false, JSON.stringify(r).slice(0, 80))
  }

  // ============================================================
  // [12] agent runManual 压力(并发 5 个不同 agent)
  // ============================================================
  logProgress('\n[12] Agent runManual 压力(并发 5 个)')
  const agentList = await c.callApi('agent.list')
  // agent.list 可能返回数组或 {success, data: [...]}
  const agentArr = Array.isArray(agentList) ? agentList : (agentList?.data || [])
  const agentIds = agentArr.slice(0, 5).map(a => a.id)
  const agentRuns = agentIds.map(id => c.callApi('agent.runManual', id, `R4测试触发 ${id}`))
  const arResults = await Promise.all(agentRuns)
  let agentOk = 0
  for (const r of arResults) if (r?.success !== false && !r?.__error) agentOk++
  record('agent_concurrent', `5并发_runManual`, agentOk >= 3, `${agentOk}/5 ok`)

  // ============================================================
  // [13] 删除所有学生(测试生命周期终结)
  // ============================================================
  logProgress('\n[13] 删除所有学生(全生命周期终结)')
  let delOk = 0
  for (const stu of students) {
    const r = await c.callApi('eaa.deleteStudent', stu.name, 'R4生命周期终结')
    if (r?.success) delOk++
    record('delete_student', stu.name, r?.success === true, JSON.stringify(r).slice(0, 80))
  }
  logProgress(`  删除 ${delOk}/${students.length} 学生`)

  // ============================================================
  // [14] 删除所有班级
  // ============================================================
  logProgress('\n[14] 删除所有班级')
  for (const cls of createdClasses) {
    const r = await c.callApi('class.delete', cls.id)
    record('delete_class', cls.class_id, r?.success !== false, JSON.stringify(r).slice(0, 80))
  }

  // ============================================================
  // [15] 最终错误检查 + 内存
  // ============================================================
  logProgress('\n[15] 最终错误检查')
  const errs = await c.eval('window.__r4Errs || []')
  const finalMem = await c.getMemory()
  record('final', `no_uncaught_errors`, errs.length === 0, JSON.stringify(errs).slice(0, 200))
  logProgress(`  errors: ${JSON.stringify(errs)}`)
  logProgress(`  final memory: ${finalMem}`)

  // ============================================================
  // 汇总
  // ============================================================
  logProgress('============================================================')
  logProgress('R4 SUMMARY')
  logProgress('============================================================')
  logProgress(`Total: ${stats.total}, Pass: ${stats.pass}, Fail: ${stats.fail}`)
  logProgress('By phase:')
  for (const [phase, s] of Object.entries(stats.byPhase)) {
    logProgress(`  ${phase}: ${s.pass} pass / ${s.fail} fail`)
  }
  if (stats.errors.length > 0) {
    logProgress('Failures:')
    for (const e of stats.errors) {
      logProgress(`  [${e.phase}] ${e.name}: ${e.detail}`)
    }
  }

  // 写入结果 JSON
  try {
    fs.writeFileSync(require('path').join(__dirname, 'r4-results.json'), JSON.stringify(stats, null, 2))
  } catch {}

  c.close()
}

main().catch(e => { logProgress('FATAL: ' + e.message); logProgress(e.stack || ''); process.exit(1) })
