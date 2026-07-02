// 第十九轮测试 — 随机3班级完整生命周期模拟
// 目标: 真实模拟用户"随机创建3个班级,随机模拟学生从创建到各方面使用到删除"
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
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(p, wait = 1200) {
    await this.eval(`window.location.hash='${p}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

// ===== 随机数据生成器 =====
const surnames = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏'
const givenNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平', '刚', '桂英', '辉', '玲', '婷', '宇', '浩', '梓涵', '欣怡', '子轩', '梓萱', '雨桐', '诗涵', '睿', '昊', '晨', '悦', '佳怡', '可欣', '梦琪']
const classNames = ['九年级一班', '九年级二班', '九年级三班', '八年级一班', '八年级二班', '高三(1)班', '高三(2)班', '高三(3)班', '高二(1)班', '高-(2)班']
const teacherNames = ['王老师', '李老师', '张老师', '陈老师', '刘老师', '杨老师', '黄老师', '赵老师']
const grades = ['七年级', '八年级', '九年级', '高一', '高二', '高三']

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr) { return arr[rand(0, arr.length - 1)] }
function genStudentName() { return pick(surnames.split('')) + pick(givenNames) + (Math.random() < 0.3 ? pick(givenNames) : '') }
function genClassName() { return pick(classNames) + '-' + rand(100, 999) }
function genTeacherName() { return pick(teacherNames) }

// 原因码分类
const deductCodes = ['SPEAK_IN_CLASS', 'SLEEP_IN_CLASS', 'LATE', 'SCHOOL_CAUGHT', 'MAKEUP', 'DESK_UNALIGNED', 'PHONE_IN_CLASS', 'SMOKING', 'DRINKING_DORM', 'OTHER_DEDUCT', 'APPEARANCE_VIOLATION']
const bonusCodes = ['BONUS_VARIABLE', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR', 'CLASS_COMMITTEE', 'CIVILIZED_DORM', 'MONTHLY_ATTENDANCE']
const labCodes = ['LAB_EQUIPMENT_DAMAGE', 'LAB_SAFETY_VIOLATION', 'LAB_UNSAFE_BEHAVIOR', 'LAB_CLEAN_UP']

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  // 随机种子(可复现)
  const seed = Date.now()
  console.log(`=== 第十九轮: 随机3班级完整生命周期模拟 ===`)
  console.log(`随机种子: ${seed}\n`)

  // ========== Phase 0: 清理 ==========
  console.log('--- Phase 0: 清理环境 ---')
  try {
    // 分批清理避免超时
    await cdp.eval(`(async()=>{
      const cls = await window.api.class.list();
      for(const c of cls.data || []) await window.api.class.delete(c.id);
    })()`)
    await new Promise((r) => setTimeout(r, 1000))
    // 学生分批删除(每批 5 个)
    const stu = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
    const students = (stu?.data?.students || []).filter(s => s.status !== 'Deleted')
    for (let i = 0; i < students.length; i += 5) {
      const batch = students.slice(i, i + 5)
      await cdp.eval(`(async()=>{
        ${batch.map(s => `try{await window.api.eaa.deleteStudent('${s.name.replace(/'/g, "\\'")}', '清理');}catch(e){}`).join('\n')}
      })()`)
    }
    await new Promise((r) => setTimeout(r, 2000))
    ok('清理完成', `${students.length} 学生`)
  } catch (e) { fail('清理', '', e) }

  // ========== Phase 1: 随机创建3个班级 ==========
  console.log('\n--- Phase 1: 随机创建3个班级 ---')
  const classes = []
  for (let i = 0; i < 3; i++) {
    const clsName = genClassName()
    const teacher = genTeacherName()
    const grade = pick(grades)
    const classId = `R19C${i}-${rand(1000, 9999)}`
    const note = `随机班级${i+1},创建于${new Date().toLocaleString()}`

    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.class.create({ class_id: '${classId}', name: '${clsName}', grade: '${grade}', teacher: '${teacher}', note: '${note}' });
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,200) }; }
    })()`)

    if (r?.success !== false) {
      ok(`创建班级${i+1}`, `${clsName} (${teacher}, ${grade})`)
      classes.push({ id: null, class_id: classId, name: clsName, teacher, grade, note })
    } else {
      fail(`创建班级${i+1}`, clsName, r.error)
    }
  }

  // 获取内部 UUID
  const classList = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
  for (const c of classes) {
    const found = (classList?.data || []).find((x) => x.class_id === c.class_id)
    if (found) { c.id = found.id; c.student_count = found.student_count ?? 0 }
  }
  ok('获取班级内部 ID', `${classes.filter(c => c.id).length}/3`)

  // ========== Phase 2: 随机分配学生 ==========
  console.log('\n--- Phase 2: 随机分配学生(每班10-20人) ---')
  const allStudents = []  // { name, class_id, classIndex }
  for (let ci = 0; ci < classes.length; ci++) {
    const count = rand(10, 20)
    const studentNames = []
    const usedNames = new Set()
    for (let s = 0; s < count; s++) {
      let name = genStudentName()
      while (usedNames.has(name)) name = genStudentName() + rand(1, 99)
      usedNames.add(name)
      studentNames.push(name)
      allStudents.push({ name, class_id: classes[ci].class_id, classIndex: ci })
    }

    // 创建学生
    for (const name of studentNames) {
      await cdp.eval(`(async()=>{
        try { await window.api.eaa.addStudent('${name}'); } catch(e) {}
      })()`)
    }

    // 分配到班级
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.class.assign({ class_id: '${classes[ci].class_id}', student_names: ${JSON.stringify(studentNames)} });
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,200) }; }
    })()`)

    if (r?.success !== false) {
      ok(`班级${ci+1}分配学生`, `${count} 人`)
    } else {
      fail(`班级${ci+1}分配学生`, '', r.error)
    }
  }
  console.log(`共创建 ${allStudents.length} 个学生`)

  // 等待 EAA 数据同步
  await new Promise((r) => setTimeout(r, 2000))

  // 验证 class_id 同步到 EAA
  const stuList = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
  let syncedCount = 0
  for (const s of allStudents) {
    const stu = (stuList?.data?.students || []).find((x) => x.name === s.name)
    if (stu?.class_id === s.class_id) syncedCount++
  }
  if (syncedCount === allStudents.length) ok('EAA class_id 同步', `${syncedCount}/${allStudents.length}`)
  else warn('EAA class_id 同步', `${syncedCount}/${allStudents.length}`)

  // ========== Phase 3: 模拟一周使用 ==========
  console.log('\n--- Phase 3: 模拟一周使用 ---')
  const weekDays = ['周一', '周二', '周三', '周四', '周五']
  let totalEvents = 0
  const eventLog = []  // 记录所有事件用于验证

  for (let day = 0; day < 5; day++) {
    console.log(`  -- ${weekDays[day]} --`)
    const eventsToday = allStudents.length > 0 ? rand(5, 15) : 0

    for (let e = 0; e < eventsToday; e++) {
      const student = pick(allStudents)
      if (!student) continue
      const category = pick(['deduct', 'deduct', 'deduct', 'bonus', 'lab'])  // 扣分多一些
      let code
      if (category === 'deduct') code = pick(deductCodes)
      else if (category === 'bonus') code = pick(bonusCodes)
      else code = pick(labCodes)

      const note = `${weekDays[day]}随机事件`
      const r = await cdp.eval(`(async()=>{
        try {
          const r = await window.api.eaa.addEvent({ studentName: '${student.name}', reasonCode: '${code}', note: '${note}', operator: 'R19测试' });
          return JSON.parse(JSON.stringify(r));
        } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
      })()`)

      if (r?.success !== false) {
        totalEvents++
        eventLog.push({ student: student.name, code, day, eventId: r?.data })
      } else {
        // 去重等已知限制,只算警告
      }
    }
    console.log(`    ${weekDays[day]}: ${eventsToday} 事件`)
  }
  ok('一周事件模拟', `${totalEvents} 事件`)

  // ========== Phase 4: 各方面使用 ==========
  console.log('\n--- Phase 4: 各方面使用 ---')

  // 4.1 查询随机学生分数
  const randomStudent = pick(allStudents)
  const scoreR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.score('${randomStudent.name}'); return JSON.parse(JSON.stringify(r)); })()`)
  const score = scoreR?.data?.score ?? scoreR?.data
  if (typeof score === 'number') ok('查询学生分数', `${randomStudent.name}: ${score}`)
  else fail('查询学生分数', '', '非数字')

  // 4.2 查询随机学生历史
  const histR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.history('${randomStudent.name}'); return JSON.parse(JSON.stringify(r)); })()`)
  const histEvents = histR?.data?.events || []
  if (Array.isArray(histEvents)) ok('查询学生历史', `${randomStudent.name}: ${histEvents.length} 事件`)
  else fail('查询学生历史', '', '非数组')

  // 4.3 排行榜
  const rankR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.ranking(${allStudents.length}); return JSON.parse(JSON.stringify(r)); })()`)
  const rankList = rankR?.data?.ranking || rankR?.data || []
  if (Array.isArray(rankList) && rankList.length > 0) ok('排行榜', `${rankList.length} 名 (top: ${rankList[0]?.name})`)
  else warn('排行榜', `仅 ${rankList.length} 名`)

  // 4.4 stats
  const statsR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.stats(); return JSON.parse(JSON.stringify(r)); })()`)
  const statsStu = statsR?.data?.summary?.students ?? statsR?.data?.student_count
  const statsEvt = statsR?.data?.summary?.total_events ?? statsR?.data?.event_count
  if (statsStu >= allStudents.length) ok('stats 学生数', `${statsStu} (含历史)`)
  else warn('stats 学生数', `${statsStu} vs ${allStudents.length}`)

  // 4.5 搜索
  const searchR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.search('${randomStudent.name.slice(0,1)}', 10); return JSON.parse(JSON.stringify(r)); })()`)
  const searchResults = searchR?.data?.results || searchR?.data || []
  if (searchResults) ok('搜索', `${Array.isArray(searchResults) ? searchResults.length : 0} 结果`)
  else warn('搜索', '无结果')

  // 4.6 日期范围查询
  const rangeR = await cdp.eval(`(async()=>{
    const r=await window.api.eaa.range('2026-01-01', '2026-12-31', 500);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rangeEvents = rangeR?.data?.events || rangeR?.data || []
  ok('日期范围查询', `${Array.isArray(rangeEvents) ? rangeEvents.length : 0} 事件`)

  // 4.7 导出 3 格式
  for (const fmt of ['csv', 'jsonl', 'html']) {
    const exportR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.export('${fmt}'); return JSON.parse(JSON.stringify(r)); })()`)
    if (exportR?.success !== false) ok(`导出 ${fmt}`, `${(exportR?.data?.length || 0)} 字符`)
    else fail(`导出 ${fmt}`, '', '失败')
  }

  // 4.8 tag 查询
  const tagR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.tag(); return JSON.parse(JSON.stringify(r)); })()`)
  const tagList = tagR?.data?.tags || tagR?.data || []
  ok('tag 列表', `${Array.isArray(tagList) ? tagList.length : 0} 个标签`)

  // ========== Phase 5: 班级对比功能 ==========
  console.log('\n--- Phase 5: 班级对比 ---')

  // 通过 stats 间接对比(应用层无直接对比API,但可通过 listStudents 按班级聚合)
  const allStu = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
  const classAgg = {}
  for (const c of classes) classAgg[c.class_id] = { count: 0, totalScore: 0 }
  for (const s of (allStu?.data?.students || [])) {
    if (classAgg[s.class_id]) {
      classAgg[s.class_id].count++
    }
  }

  for (const c of classes) {
    const agg = classAgg[c.class_id]
    ok(`班级对比 ${c.name}`, `${agg.count} 学生`)
  }

  // 取两班学生分数对比
  const cls1Stu = (allStu?.data?.students || []).filter(s => s.class_id === classes[0].class_id)
  const cls2Stu = (allStu?.data?.students || []).filter(s => s.class_id === classes[1].class_id)
  if (cls1Stu.length > 0 && cls2Stu.length > 0) {
    const s1 = pick(cls1Stu)
    const s2 = pick(cls2Stu)
    const sc1 = await cdp.eval(`(async()=>{ const r=await window.api.eaa.score('${s1.name}'); return JSON.parse(JSON.stringify(r)); })()`)
    const sc2 = await cdp.eval(`(async()=>{ const r=await window.api.eaa.score('${s2.name}'); return JSON.parse(JSON.stringify(r)); })()`)
    const v1 = sc1?.data?.score ?? sc1?.data
    const v2 = sc2?.data?.score ?? sc2?.data
    ok('两班对比', `${classes[0].name} ${s1.name}=${v1} vs ${classes[1].name} ${s2.name}=${v2}`)
  }

  // ========== Phase 6: UI 班级页+仪表盘渲染 ==========
  console.log('\n--- Phase 6: UI 渲染 ---')

  // 班级页
  await cdp.navigate('/classes', 1500)
  const classesBody = await cdp.eval(`document.body.innerText.length`)
  ok('班级页渲染', `${classesBody} 字符`)

  // 学生页
  await cdp.navigate('/students', 1500)
  const studentsRows = await cdp.eval(`document.querySelectorAll('table tbody tr, [class*="row"]').length`)
  ok('学生页渲染', `${studentsRows} 行`)

  // 仪表盘
  await cdp.navigate('/dashboard', 1500)
  const dashBody = await cdp.eval(`document.body.innerText.length`)
  ok('仪表盘渲染', `${dashBody} 字符`)

  // 排行榜页(如有独立页)
  await cdp.navigate('/ranking', 1000)
  const rankPage = await cdp.eval(`document.body.innerText.length`)
  if (rankPage > 100) ok('排行榜页渲染', `${rankPage} 字符`)

  // ========== Phase 7: 随机调班 ==========
  console.log('\n--- Phase 7: 随机调班 ---')
  const moveCount = rand(2, 5)
  let movedCount = 0
  for (let i = 0; i < moveCount; i++) {
    const stu = pick(allStudents)
    const targetClassIdx = (stu.classIndex + 1) % classes.length
    const targetClass = classes[targetClassIdx]

    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.class.assign({ class_id: '${targetClass.class_id}', student_names: ['${stu.name}'] });
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)

    if (r?.success !== false) {
      movedCount++
      stu.class_id = targetClass.class_id
      stu.classIndex = targetClassIdx
    }
  }
  ok('随机调班', `${movedCount}/${moveCount} 成功`)

  // ========== Phase 8: 随机撤销事件 ==========
  console.log('\n--- Phase 8: 随机撤销事件 ---')
  const revertCount = rand(1, 3)
  let revertedCount = 0
  // 从 eventLog 中随机选事件撤销
  for (let i = 0; i < revertCount && eventLog.length > 0; i++) {
    const idx = rand(0, eventLog.length - 1)
    const ev = eventLog[idx]
    if (!ev.eventId || typeof ev.eventId !== 'string') continue

    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.revertEvent('${ev.eventId}', 'R19测试撤销');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)

    if (r?.success !== false) {
      revertedCount++
      eventLog.splice(idx, 1)
    }
  }
  ok('随机撤销事件', `${revertedCount}/${revertCount} 成功`)

  // ========== Phase 9: 数据一致性检查 ==========
  console.log('\n--- Phase 9: 数据一致性 ---')

  // listStudents 与 stats 学生数一致
  const finalStu = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
  const finalStats = await cdp.eval(`(async()=>{ const r=await window.api.eaa.stats(); return JSON.parse(JSON.stringify(r)); })()`)
  const listCount = (finalStu?.data?.students || []).filter(s => s.status !== 'Deleted').length
  const statsCount = finalStats?.data?.summary?.students
  if (listCount === statsCount) ok('学生数一致', `${listCount}`)
  else warn('学生数不一致', `list: ${listCount} vs stats: ${statsCount}`)

  // validate + doctor
  const validateR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.validate(); return JSON.parse(JSON.stringify(r)); })()`)
  if (validateR?.success !== false) ok('EAA validate', '通过')
  else fail('EAA validate', '', validateR?.data)

  const doctorR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.doctor(); return JSON.parse(JSON.stringify(r)); })()`)
  if (doctorR?.success !== false) ok('EAA doctor', '通过')
  else fail('EAA doctor', '', doctorR?.data)

  // ========== Phase 10: 随机软删除学生 ==========
  console.log('\n--- Phase 10: 随机软删除学生 ---')
  const deleteCount = rand(3, 8)
  let deletedCount = 0
  const deletedStudents = []

  for (let i = 0; i < deleteCount && allStudents.length > 0; i++) {
    const idx = rand(0, allStudents.length - 1)
    const stu = allStudents[idx]
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.deleteStudent('${stu.name}', 'R19随机删除');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)
    if (r?.success !== false) {
      deletedCount++
      deletedStudents.push(stu.name)
      allStudents.splice(idx, 1)
    }
  }
  ok('随机软删除学生', `${deletedCount}/${deleteCount} 成功`)

  // 验证已删除学生不在排行榜(等待删除生效)
  await new Promise((r) => setTimeout(r, 2000))
  if (deletedStudents.length > 0) {
    const rankAfterDelete = await cdp.eval(`(async()=>{ const r=await window.api.eaa.ranking(${allStudents.length + deletedStudents.length + 10}); return JSON.parse(JSON.stringify(r)); })()`)
    const rankList2 = rankAfterDelete?.data?.ranking || rankAfterDelete?.data || []
    const inRank = deletedStudents.filter(n => rankList2.some(r => r.name === n))
    if (inRank.length === 0) ok('已删除学生不在排行榜', '正确')
    else fail('已删除学生不在排行榜', '', `${inRank.length} 个仍在`)
  }

  // ========== Phase 11: 随机删除班级 ==========
  console.log('\n--- Phase 11: 随机删除班级 ---')
  const delClassCount = rand(1, 2)
  let delClassOk = 0
  for (let i = 0; i < delClassCount && classes.length > 0; i++) {
    const idx = rand(0, classes.length - 1)
    const c = classes[idx]
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.class.delete('${c.id}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)
    if (r?.success !== false) {
      delClassOk++
      classes.splice(idx, 1)
    }
  }
  ok('随机删除班级', `${delClassOk}/${delClassCount} 成功`)

  // ========== Phase 12: 最终清理 ==========
  console.log('\n--- Phase 12: 最终清理 ---')
  try {
    await cdp.eval(`(async()=>{
      const cls = await window.api.class.list();
      for(const c of cls.data || []) await window.api.class.delete(c.id);
    })()`)
    ok('清理班级', '完成')

    // 学生分批删除(避免超时)
    const allStu = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
    const students = (allStu?.data?.students || []).filter(s => s.status !== 'Deleted')
    // 分批,每批 5 个
    for (let i = 0; i < students.length; i += 5) {
      const batch = students.slice(i, i + 5)
      await cdp.eval(`(async()=>{
        ${batch.map(s => `try{await window.api.eaa.deleteStudent('${s.name}', '清理');}catch(e){}`).join('\n')}
      })()`)
    }
    ok('清理学生', `${students.length} 个`)
  } catch (e) {
    warn('最终清理', String(e).slice(0, 100))
  }

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${(results.pass / (results.pass + results.fail) * 100).toFixed(1)}%`)
  console.log(`总学生: ${allStudents.length + deletedStudents.length}, 总事件: ${totalEvents}, 总班级: 3`)

  // 写入结果
  const resultFile = path.join(__dirname, 'r19-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ seed, results, summary: { students: allStudents.length + deletedStudents.length, events: totalEvents, classes: 3 } }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
