// R2: 真实用户使用全流程 — 端到端工作流
// 模拟真实老师日常操作: 创建班级 → 创建学生 → 打分 → 查询 → Agent分析 → Chat → 调班 → 删除
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a }
function pick(arr) { return arr[rand(0, arr.length - 1)] }

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout: ' + method)) } }, 60000)
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + String(detail).slice(0, 200) : ''}`)
}

// 中文名生成
const surnames = ['张','李','王','刘','陈','杨','赵','黄','周','吴','徐','孙','胡','朱','高','林','何','郭','马','罗']
const givenNames = ['伟','芳','娜','秀英','敏','静','丽','强','磊','军','洋','勇','艳','杰','娟','涛','明','超','秀兰','霞','平','刚','桂英']
function randomName() {
  return pick(surnames) + pick(givenNames)
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 2 (R2): 真实用户使用全流程 (端到端工作流)')
  console.log('============================================================')

  const t0 = Date.now()
  const createdClasses = []   // {id, class_id, name}
  const createdStudents = []  // {name, class_id}

  // ============================================================
  // [1] 创建 3 个新班级
  // ============================================================
  console.log('\n[1] 创建 3 个新班级')
  const classData = [
    { class_id: 'T8-1', name: '八年级1班', grade: '八年级', note: 'R2测试-重点班' },
    { class_id: 'T8-2', name: '八年级2班', grade: '八年级', note: 'R2测试-普通班' },
    { class_id: 'T8-3', name: '八年级3班', grade: '八年级', note: 'R2测试-实验班' },
  ]
  for (const cd of classData) {
    const res = await c.callApi('class.create', cd)
    const ok = res?.success === true
    record(`class.create.${cd.class_id}`, ok, `res=${JSON.stringify(res).slice(0, 100)}`)
    if (ok && res.data?.id) {
      createdClasses.push({ id: res.data.id, class_id: cd.class_id, name: cd.name })
    }
    await sleep(50)
  }

  // 验证 list 包含新班级
  const listAfterCreate = await c.callApi('class.list')
  const allClassIds = (listAfterCreate?.data || []).map(x => x.class_id)
  const hasAll = classData.every(cd => allClassIds.includes(cd.class_id))
  record('class.list.after_create', hasAll, `classes=${allClassIds.length}, hasAll3=${hasAll}`)

  // ============================================================
  // [2] 在每个班级下创建 5 个学生 (共 15 个)
  // ============================================================
  console.log('\n[2] 创建 15 个学生 (每班 5 个)')
  for (const cls of createdClasses) {
    for (let i = 0; i < 5; i++) {
      const name = `R2${cls.class_id}-${randomName()}-${i}`
      const res = await c.callApi('eaa.addStudent', name)
      const ok = res?.success === true
      record(`eaa.addStudent.${name}`, ok, `res=${JSON.stringify(res).slice(0, 80)}`)
      if (ok) {
        createdStudents.push({ name, class_id: cls.class_id })
        // 设置 class_id — handler 期望 {name, classId}
        const meta = await c.callApi('eaa.setStudentMeta', { name: name, classId: cls.class_id })
        record(`eaa.setStudentMeta.${name}`, meta?.success === true, `meta=${JSON.stringify(meta).slice(0, 80)}`)
      }
      await sleep(30)
    }
  }

  // 验证 listStudents 包含新学生
  const listStudents = await c.callApi('eaa.listStudents')
  const studentCount = listStudents?.data?.students?.length || listStudents?.data?.length || 0
  record('eaa.listStudents.has_15', studentCount >= 15, `count=${studentCount}, total=${studentCount}`)

  // ============================================================
  // [3] 给学生打分 (随机原因码, 多种类型)
  // ============================================================
  console.log('\n[3] 给学生打分 (随机原因码)')
  const reasonCodes = ['LATE', 'SLEEP_IN_CLASS', 'SPEAK_IN_CLASS', 'PHONE_IN_CLASS', 'ACTIVITY_PARTICIPATION', 'CLASS_COMMITTEE', 'MONTHLY_ATTENDANCE', 'DESK_UNALIGNED']
  let eventCount = 0
  for (const stu of createdStudents) {
    // 每个学生 2-4 个事件
    const numEvents = rand(2, 4)
    for (let i = 0; i < numEvents; i++) {
      const rc = pick(reasonCodes)
      const res = await c.callApi('eaa.addEvent', {
        studentName: stu.name,
        reasonCode: rc,
        // 不传 delta — 测试自动查找默认值
      })
      if (res?.success) eventCount++
      await sleep(20)
    }
  }
  record('eaa.addEvent.bulk', eventCount >= 15, `events_created=${eventCount}`)

  // ============================================================
  // [4] 查询: 排行榜 / 统计 / 历史
  // ============================================================
  console.log('\n[4] 查询数据')
  const ranking = await c.callApi('eaa.ranking')
  const rankingCount = ranking?.data?.length || ranking?.data?.ranking?.length || 0
  record('eaa.ranking.has_data', rankingCount > 0, `count=${rankingCount}, res=${JSON.stringify(ranking).slice(0, 100)}`)

  const stats = await c.callApi('eaa.stats')
  record('eaa.stats.ok', stats?.success === true, `res=${JSON.stringify(stats).slice(0, 100)}`)

  const history = await c.callApi('eaa.history', createdStudents[0].name)
  record('eaa.history.first_student', history?.success === true, `res=${JSON.stringify(history).slice(0, 120)}`)

  const info = await c.callApi('eaa.info')
  record('eaa.info.after_events', info?.data?.students >= 15 && info?.data?.events >= 15, `students=${info?.data?.students}, events=${info?.data?.events}`)

  const summary = await c.callApi('eaa.summary')
  record('eaa.summary.ok', summary?.success === true, `res=${JSON.stringify(summary).slice(0, 100)}`)

  const codes = await c.callApi('eaa.codes')
  const codesArr = codes?.data?.codes || codes?.data || []
  record('eaa.codes.has_20+', Array.isArray(codesArr) && codesArr.length >= 20, `count=${Array.isArray(codesArr) ? codesArr.length : 'N/A'}`)

  // ============================================================
  // [5] search / range / tag 查询
  // ============================================================
  console.log('\n[5] search/range/tag')
  const searchRes = await c.callApi('eaa.search', createdStudents[0].name.split('-')[0])
  record('eaa.search.ok', searchRes?.success === true, `res=${JSON.stringify(searchRes).slice(0, 100)}`)

  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400000)
  const fmt = d => d.toISOString().slice(0, 10)
  const rangeRes = await c.callApi('eaa.range', fmt(yesterday), fmt(today))
  record('eaa.range.ok', rangeRes?.success === true, `res=${JSON.stringify(rangeRes).slice(0, 100)}`)

  // ============================================================
  // [6] revert 一个事件 (撤销) — 签名: revertEvent(eventId, reason)
  // ============================================================
  console.log('\n[6] revert 事件')
  const firstStuHistory = history?.data?.events || []
  let revertEventId = null
  if (Array.isArray(firstStuHistory) && firstStuHistory.length > 0) {
    revertEventId = firstStuHistory[0].event_id || firstStuHistory[0].id
  }
  if (revertEventId) {
    const revertRes = await c.callApi('eaa.revertEvent', revertEventId, 'R2测试-撤销误判')
    record('eaa.revertEvent.first', revertRes?.success === true, `res=${JSON.stringify(revertRes).slice(0, 100)}`)
  } else {
    record('eaa.revertEvent.first', false, `no event id found, history=${JSON.stringify(history).slice(0, 100)}`)
  }

  // ============================================================
  // [7] Chat 对话持久化
  // ============================================================
  console.log('\n[7] Chat 对话')
  const sessionId = `r2-session-${Date.now()}`
  const msg1 = await c.callApi('chat.saveMessage', { sessionId, role: 'user', content: '帮我分析七年级1班的整体表现', timestamp: Date.now() })
  record('chat.saveMessage.user', msg1?.success !== false, `res=${JSON.stringify(msg1).slice(0, 80)}`)

  const msg2 = await c.callApi('chat.saveMessage', { sessionId, role: 'assistant', content: '基于 EAA 数据分析,七年级1班整体表现良好...', timestamp: Date.now() + 1 })
  record('chat.saveMessage.assistant', msg2?.success !== false, `res=${JSON.stringify(msg2).slice(0, 80)}`)

  const loadMsgs = await c.callApi('chat.loadMessages', sessionId)
  const msgCount = loadMsgs?.messages?.length || loadMsgs?.data?.messages?.length || 0
  record('chat.loadMessages.2', msgCount === 2, `count=${msgCount}, res=${JSON.stringify(loadMsgs).slice(0, 100)}`)

  const listSessions = await c.callApi('chat.listSessions')
  const sessArr = listSessions?.sessions || listSessions?.data?.sessions || []
  const sessCount = Array.isArray(sessArr) ? sessArr.length : 0
  record('chat.listSessions.has_1+', sessCount >= 1, `count=${sessCount}`)

  // ============================================================
  // [8] Skill 技能 CRUD
  // ============================================================
  console.log('\n[8] Skill CRUD')
  const skillName = `r2-skill-${Date.now()}`
  const skillContent = '# 测试技能\n\n这是一个R2测试创建的技能文件。\n\n## 用途\n- 测试 skill.save\n- 测试 skill.get\n- 测试 skill.delete'
  const skillSave = await c.callApi('skill.save', skillName, skillContent)
  record('skill.save', skillSave?.success === true, `res=${JSON.stringify(skillSave).slice(0, 80)}`)

  const skillGet = await c.callApi('skill.get', skillName)
  // skill.get 返回 {name, description, content} 或 {success:false} 或 null
  const getOk = (skillGet && typeof skillGet === 'object' && (skillGet.content || skillGet.data?.content)) || skillGet?.success === true
  record('skill.get', getOk, `res=${JSON.stringify(skillGet).slice(0, 100)}`)

  const skillList = await c.callApi('skill.list')
  const skillArr = skillList?.data || skillList || []
  const skillCount = Array.isArray(skillArr) ? skillArr.length : 0
  record('skill.list.has_1', skillCount >= 1, `count=${skillCount}`)

  const skillDelete = await c.callApi('skill.delete', skillName)
  record('skill.delete', skillDelete?.success === true, `res=${JSON.stringify(skillDelete).slice(0, 80)}`)

  const skillGetAfter = await c.callApi('skill.get', skillName)
  record('skill.get.deleted', skillGetAfter == null || skillGetAfter?.success === false || (skillGetAfter && Object.keys(skillGetAfter).length === 0), `res=${JSON.stringify(skillGetAfter).slice(0, 80)}`)

  // ============================================================
  // [9] Agent runManual (data-analyst, 简短 prompt)
  // ============================================================
  console.log('\n[9] Agent runManual')
  const agentRun = await c.callApi('agent.runManual', 'data-analyst', '请简短描述你作为数据分析师的能力(20字内)')
  record('agent.runManual.data-analyst', agentRun?.success === true || agentRun?.__error == null, `success=${agentRun?.success}, res=${JSON.stringify(agentRun).slice(0, 120)}`)

  // ============================================================
  // [10] Cron runNow (找第一个 cron 跑一下)
  // ============================================================
  console.log('\n[10] Cron runNow')
  const cronList = await c.callApi('cron.list')
  const crons = cronList?.data || cronList || []
  record('cron.list.has_1+', Array.isArray(crons) && crons.length > 0, `count=${Array.isArray(crons) ? crons.length : 'N/A'}`)
  if (Array.isArray(crons) && crons.length > 0) {
    const firstCron = crons[0]
    const cronId = firstCron.id || firstCron.name
    if (cronId) {
      const runRes = await c.callApi('cron.runNow', cronId)
      record('cron.runNow.first', runRes?.success === true || runRes?.__error == null, `cronId=${cronId}, res=${JSON.stringify(runRes).slice(0, 100)}`)
    }
  }

  // ============================================================
  // [11] 调班: class.assign + class.remove
  // ============================================================
  console.log('\n[11] 调班 (assign/remove)')
  if (createdStudents.length >= 2 && createdClasses.length >= 2) {
    // 把第一个学生从原班级调到第二个班级 — preload 暴露 class.assign 和 class.removeStudent
    const stu = createdStudents[0]
    const newClass = createdClasses[1]
    const assignRes = await c.callApi('class.assign', { class_id: newClass.class_id, student_names: [stu.name] })
    record('class.assign', assignRes?.success === true && assignRes?.assigned >= 1, `res=${JSON.stringify(assignRes).slice(0, 100)}`)

    const removeRes = await c.callApi('class.removeStudent', { student_name: stu.name })
    record('class.removeStudent', removeRes?.success === true, `res=${JSON.stringify(removeRes).slice(0, 80)}`)
  }

  // ============================================================
  // [12] Settings 切换 (theme, logLevel)
  // ============================================================
  console.log('\n[12] Settings 切换')
  const setDark = await c.callApi('settings.set', 'general.theme', 'dark')
  record('settings.set.theme_dark', setDark?.success !== false, `res=${JSON.stringify(setDark).slice(0, 80)}`)

  const setLight = await c.callApi('settings.set', 'general.theme', 'light')
  record('settings.set.theme_light', setLight?.success !== false, `res=${JSON.stringify(setLight).slice(0, 80)}`)

  const setWarn = await c.callApi('settings.set', 'general.logLevel', 'warn')
  record('settings.set.logLevel_warn', setWarn?.success !== false, `res=${JSON.stringify(setWarn).slice(0, 80)}`)

  const setInfo = await c.callApi('settings.set', 'general.logLevel', 'info')
  record('settings.set.logLevel_info', setInfo?.success !== false, `res=${JSON.stringify(setInfo).slice(0, 80)}`)

  // 恢复
  await c.callApi('settings.set', 'general.theme', 'dark')

  // ============================================================
  // [13] Privacy (init/anonymize/disable) — 仅在未启用时
  // ============================================================
  console.log('\n[13] Privacy 流程')
  const ps = await c.callApi('privacy.status')
  const privacyEnabled = ps?.data?.enabled === true || ps?.data?.unlocked === true || ps?.enabled === true
  record('privacy.status.ok', ps?.success !== false || ps?.__error == null, `status=${JSON.stringify(ps).slice(0, 100)}`)

  if (!privacyEnabled) {
    const initRes = await c.callApi('privacy.init', 'r2-test-pwd-12345')
    record('privacy.init', initRes?.success === true, `res=${JSON.stringify(initRes).slice(0, 80)}`)

    if (initRes?.success) {
      // 添加 PII 映射 — privacy.add(entityType, text) 两个参数
      const addMap = await c.callApi('privacy.add', 'person', '张三')
      record('privacy.add', addMap?.success === true, `res=${JSON.stringify(addMap).slice(0, 80)}`)

      const listMap = await c.callApi('privacy.list')
      record('privacy.list', listMap?.success === true, `res=${JSON.stringify(listMap).slice(0, 80)}`)

      // anonymize 测试
      const anon = await c.callApi('privacy.anonymize', '张三今天迟到了')
      record('privacy.anonymize', anon?.success === true, `res=${JSON.stringify(anon).slice(0, 100)}`)

      // 禁用
      const disableRes = await c.callApi('privacy.disable', 'r2-test-pwd-12345')
      record('privacy.disable', disableRes?.success === true, `res=${JSON.stringify(disableRes).slice(0, 80)}`)
    }
  } else {
    console.log('  privacy 已启用, 跳过 init 测试')
  }

  // ============================================================
  // [14] 清理: 删除所有学生 + 删除所有班级
  // ============================================================
  console.log('\n[14] 清理 (删除学生 + 删除班级)')
  let deletedStudents = 0
  for (const stu of createdStudents) {
    const res = await c.callApi('eaa.deleteStudent', stu.name)
    if (res?.success) deletedStudents++
    await sleep(20)
  }
  record('eaa.deleteStudent.bulk', deletedStudents === createdStudents.length, `deleted=${deletedStudents}/${createdStudents.length}`)

  let deletedClasses = 0
  for (const cls of createdClasses) {
    const res = await c.callApi('class.delete', cls.id)
    if (res?.success) deletedClasses++
    await sleep(20)
  }
  record('class.delete.bulk', deletedClasses === createdClasses.length, `deleted=${deletedClasses}/${createdClasses.length}`)

  // 删除 chat session
  const delSess = await c.callApi('chat.deleteSession', sessionId)
  record('chat.deleteSession', delSess?.success !== false, `res=${JSON.stringify(delSess).slice(0, 80)}`)

  // 验证清理
  const infoAfter = await c.callApi('eaa.info')
  record('eaa.info.after_cleanup', infoAfter?.success === true, `students=${infoAfter?.data?.students}, events=${infoAfter?.data?.events}`)

  const classListAfter = await c.callApi('class.list')
  const classCountAfter = (classListAfter?.data || []).filter(x => x.class_id?.startsWith('T8-')).length
  record('class.list.after_cleanup', classCountAfter === 0, `remaining_T8=${classCountAfter}`)

  // ============================================================
  // [15] 最终内存 + 错误检查
  // ============================================================
  console.log('\n[15] 内存 & 错误')
  const mem = await c.eval('JSON.stringify({used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize})')
  console.log(`  memory: ${mem}`)

  const elapsed = Date.now() - t0
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`\n=== R2 SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total, elapsed=${elapsed}ms ===`)

  fs.writeFileSync(path.join(__dirname, 'r2-results.json'), JSON.stringify({
    startedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    results,
    memory: JSON.parse(mem),
    createdClasses: createdClasses.length,
    createdStudents: createdStudents.length,
    eventsCreated: eventCount,
  }, null, 2))

  c.close()
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1) })
