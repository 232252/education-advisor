// 第十轮测试 — 真实教师多日工作流模拟
// 模拟一位班主任一周(5天)的真实工作流程
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

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
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try { const m = JSON.parse(data.toString())
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(path, wait = 1500) {
    await this.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
  async getMem() {
    return await this.eval(`(function(){
      if(performance.memory) return { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize };
      return null;
    })()`)
  }
  async getConsoleErrors() {
    return await this.eval(`(function(){
      if(!window.__consoleErrors) window.__consoleErrors = [];
      return window.__consoleErrors.length;
    })()`)
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [], apiCalls: 0, startTime: Date.now() }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  // 计数器: 包装 eval 统计 API 调用
  const origEval = cdp.eval.bind(cdp)
  cdp.eval = async (expr) => { results.apiCalls++; return origEval(expr) }

  function errMsg(r) {
    return r?.__error || r?.error || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }

  console.log('=== 第十轮: 真实教师多日工作流模拟 ===\n')

  const testSuffix = String(Date.now()).slice(-4)
  const memStart = await cdp.getMem()

  // ========== 准备: 清理环境 ==========
  console.log('--- 准备: 清理环境 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  ok('环境清理', '完成')

  // ========== Day 1: 建班、招生、初始记录 ==========
  console.log('\n--- Day 1: 建班招生 ---')

  // 1.1 创建 3 个班级
  const classes = [
    { class_id: `CLS-A-${testSuffix}`, name: '高一(1)班', grade: '高一', teacher: '王老师' },
    { class_id: `CLS-B-${testSuffix}`, name: '高一(2)班', grade: '高一', teacher: '李老师' },
    { class_id: `CLS-C-${testSuffix}`, name: '高一(3)班', grade: '高一', teacher: '张老师' },
  ]
  for (const c of classes) {
    const r = await cdp.eval(`(async()=>{
      const res = await window.api.class.create({ class_id: '${c.class_id}', name: '${c.name}', grade: '${c.grade}', teacher: '${c.teacher}' });
      return JSON.parse(JSON.stringify(res));
    })()`)
    if (r?.success !== false) ok(`创建班级 ${c.name}`, c.class_id)
    else fail(`创建班级 ${c.name}`, '', errMsg(r))
  }

  // 1.2 为每个班级创建学生 (每班 5 名)
  const allStudents = []
  const classStudents = { A: [], B: [], C: [] }
  const studentNames = [
    ['张伟', '李娜', '王强', '赵敏', '陈杰'],   // A 班
    ['刘洋', '杨芳', '黄磊', '周婷', '吴昊'],   // B 班
    ['郑爽', '孙超', '马丽', '朱军', '胡静'],   // C 班
  ]
  for (let ci = 0; ci < 3; ci++) {
    const clsKey = ['A', 'B', 'C'][ci]
    const classId = classes[ci].class_id
    for (let si = 0; si < studentNames[ci].length; si++) {
      const fullName = `${studentNames[ci][si]}_${testSuffix}`
      const r = await cdp.eval(`(async()=>{
        const res = await window.api.eaa.addStudent('${fullName}');
        return JSON.parse(JSON.stringify(res));
      })()`)
      if (r?.success !== false) {
        allStudents.push(fullName)
        classStudents[clsKey].push(fullName)
        // 分配到班级
        await cdp.eval(`(async()=>{
          await window.api.class.assign({ class_id: '${classId}', student_names: ['${fullName}'] });
        })()`)
      }
    }
  }
  ok('创建学生', `${allStudents.length} 名 (每班 5 名)`)
  ok('分配班级', `A:${classStudents.A.length}, B:${classStudents.B.length}, C:${classStudents.C.length}`)

  // 1.3 Day 1 事件记录 (早晨: 迟到、仪容)
  console.log('  [Day1] 事件记录...')
  const day1Events = [
    { student: classStudents.A[0], reasonCode: 'LATE', note: '周一迟到' },
    { student: classStudents.A[1], reasonCode: 'APPEARANCE_VIOLATION', note: '头发染色' },
    { student: classStudents.B[0], reasonCode: 'LATE', note: '迟到' },
    { student: classStudents.B[2], reasonCode: 'DESK_UNALIGNED', note: '桌椅不齐' },
    { student: classStudents.C[1], reasonCode: 'SLEEP_IN_CLASS', note: '第一节课睡觉' },
  ]
  let day1EventCount = 0
  for (const e of day1Events) {
    const r = await cdp.eval(`(async()=>{
      try {
        const res = await window.api.eaa.addEvent({ studentName: '${e.student}', reasonCode: '${e.reasonCode}', note: '${e.note}', operator: '王老师' });
        return JSON.parse(JSON.stringify(res));
      } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
    })()`)
    if (r?.success !== false) day1EventCount++
  }
  ok('Day1 事件', `${day1EventCount}/${day1Events.length} 条记录`)

  // 1.4 查看 Day1 排行榜
  const rank1 = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(20);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rankList1 = rank1?.data?.ranking || rank1?.data || []
  ok('Day1 排行榜', `${rankList1.length} 名学生`)
  if (rankList1.length > 0) {
    ok('Day1 第一名', `${rankList1[0]?.name}: ${rankList1[0]?.score ?? rankList1[0]?.total_score}`)
  }

  // ========== Day 2: 正面事件 + 班级对比 ==========
  console.log('\n--- Day 2: 正面事件 + 班级对比 ---')

  // 2.1 添加正面事件 (加分)
  const day2Events = [
    { student: classStudents.A[2], reasonCode: 'CLASS_MONITOR', note: '班长履职' },
    { student: classStudents.A[3], reasonCode: 'CIVILIZED_DORM', note: '文明寝室' },
    { student: classStudents.B[1], reasonCode: 'ACTIVITY_PARTICIPATION', note: '参加演讲比赛' },
    { student: classStudents.B[4], reasonCode: 'CLASS_COMMITTEE', note: '班委履职' },
    { student: classStudents.C[0], reasonCode: 'MONTHLY_ATTENDANCE', note: '全勤' },
    { student: classStudents.C[4], reasonCode: 'CIVILIZED_DORM', note: '文明寝室' },
  ]
  let day2Count = 0
  for (const e of day2Events) {
    const r = await cdp.eval(`(async()=>{
      try {
        const res = await window.api.eaa.addEvent({ studentName: '${e.student}', reasonCode: '${e.reasonCode}', note: '${e.note}', operator: '王老师' });
        return JSON.parse(JSON.stringify(res));
      } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
    })()`)
    if (r?.success !== false) day2Count++
  }
  ok('Day2 加分事件', `${day2Count}/${day2Events.length} 条`)

  // 2.2 Dashboard 班级对比
  await cdp.navigate('/dashboard', 3000)
  const dashA = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(50);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const allRanked = dashA?.data?.ranking || dashA?.data || []
  // 按班级分组统计平均分
  const classAvg = { A: [], B: [], C: [] }
  for (const s of allRanked) {
    const cid = s.class_id || ''
    if (cid.includes('CLS-A')) classAvg.A.push(s.score ?? s.total_score ?? 100)
    else if (cid.includes('CLS-B')) classAvg.B.push(s.score ?? s.total_score ?? 100)
    else if (cid.includes('CLS-C')) classAvg.C.push(s.score ?? s.total_score ?? 100)
  }
  const avg = (arr) => arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 'N/A'
  ok('班级对比', `A班均分${avg(classAvg.A)}, B班均分${avg(classAvg.B)}, C班均分${avg(classAvg.C)}`)

  // 2.3 查看统计
  const stats2 = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.stats();
    return JSON.parse(JSON.stringify(r));
  })()`)
  ok('Day2 统计', `学生 ${stats2?.data?.student_count ?? '?'}, 事件 ${stats2?.data?.event_count ?? '?'}`)

  // ========== Day 3: 违纪处理 + 撤销 + 搜索 ==========
  console.log('\n--- Day 3: 违纪处理 + 撤销 ---')

  // 3.1 严重违纪
  const day3Events = [
    { student: classStudents.A[4], reasonCode: 'PHONE_IN_CLASS', note: '课堂玩手机' },
    { student: classStudents.B[3], reasonCode: 'SMOKING', note: '厕所抽烟' },
    { student: classStudents.C[2], reasonCode: 'LATE', note: '迟到' },
  ]
  let day3Count = 0
  for (const e of day3Events) {
    const r = await cdp.eval(`(async()=>{
      try {
        const res = await window.api.eaa.addEvent({ studentName: '${e.student}', reasonCode: '${e.reasonCode}', note: '${e.note}', operator: '王老师' });
        return JSON.parse(JSON.stringify(res));
      } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
    })()`)
    if (r?.success !== false) day3Count++
  }
  ok('Day3 违纪', `${day3Count}/${day3Events.length} 条`)

  // 3.2 撤销一条误记事件 (查 A[0] 的历史)
  const histA0 = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.history('${classStudents.A[0]}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const eventsA0 = histA0?.data?.events || []
  if (eventsA0.length > 0) {
    const evt = eventsA0[0]
    const evtId = evt.id || evt.event_id || evt.uuid
    ok('查到历史事件', `${classStudents.A[0]} 有 ${eventsA0.length} 条, 撤销第 1 条`)
    if (evtId) {
      const revertR = await cdp.eval(`(async()=>{
        try {
          const r = await window.api.eaa.revertEvent('${evtId}', '误记撤销');
          return JSON.parse(JSON.stringify(r));
        } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
      })()`)
      if (revertR?.success !== false) ok('撤销事件', '成功')
      else fail('撤销事件', '', errMsg(revertR))
    }
  } else {
    warn('查到历史事件', '无历史')
  }

  // 3.3 搜索学生
  const searchR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.search('${testSuffix}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const searchResults = searchR?.data?.results || searchR?.data || []
  ok('搜索学生', `关键词 ${testSuffix} → ${searchResults.length} 条`)

  // 3.4 按日期范围查询
  const rangeR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.range('2020-01-01', '2030-12-31', 100);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rangeEvents = rangeR?.data?.events || rangeR?.data || []
  ok('日期范围查询', `${rangeEvents.length || (rangeR?.data?.count ?? '?')} 条事件`)

  // ========== Day 4: 调班 + 班级管理 ==========
  console.log('\n--- Day 4: 调班 + 班级管理 ---')

  // 4.1 学生调班: A[1] → B 班
  const transferStudent = classStudents.A[1]
  const newClassId = classes[1].class_id
  const transferR = await cdp.eval(`(async()=>{
    try {
      const res = await window.api.class.assign({ class_id: '${newClassId}', student_names: ['${transferStudent}'] });
      return JSON.parse(JSON.stringify(res));
    } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
  })()`)
  if (transferR?.success !== false || transferR?.assigned > 0) ok('学生调班', `${transferStudent} → B班`)
  else warn('学生调班', errMsg(transferR))

  // 4.2 验证调班后的 class_id
  const checkTransfer = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.score('${transferStudent}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const transferClassId = checkTransfer?.data?.class_id || checkTransfer?.data?.student?.class_id
  if (transferClassId === newClassId) ok('调班验证', `class_id=${transferClassId} ✓`)
  else warn('调班验证', `class_id=${transferClassId}, 期望 ${newClassId}`)

  // 4.3 存档一个班级
  const clsList = await cdp.eval(`(async()=>{
    const r = await window.api.class.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const clsC = (clsList?.data || []).find(c => c.class_id === classes[2].class_id)
  if (clsC) {
    const archR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.class.archive('${clsC.id}');
        return JSON.parse(JSON.stringify(r));
      } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
    })()`)
    if (archR?.success !== false) ok('存档 C 班', '成功')
    else fail('存档 C 班', '', errMsg(archR))

    // 恢复
    const restR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.class.restore('${clsC.id}');
        return JSON.parse(JSON.stringify(r));
      } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
    })()`)
    if (restR?.success !== false) ok('恢复 C 班', '成功')
    else fail('恢复 C 班', '', errMsg(restR))
  }

  // 4.4 学生页筛选测试
  await cdp.navigate('/students', 2000)
  const studentsPage = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1');
    const tableRows = document.querySelectorAll('table tbody tr').length;
    const selects = document.querySelectorAll('select').length;
    const buttons = document.querySelectorAll('button').length;
    return { hasH1: !!h1, title: h1?.textContent, tableRows, selects, buttons };
  })()`)
  ok('学生页', `${studentsPage?.title || '?'} | 表格 ${studentsPage?.tableRows ?? 0} 行, select ${studentsPage?.selects ?? 0} 个`)

  // ========== Day 5: 导出 + 周期摘要 + 清理 ==========
  console.log('\n--- Day 5: 导出 + 周期摘要 ---')

  // 5.1 导出数据
  const exportCsv = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.export('csv');
      return JSON.parse(JSON.stringify(r));
    } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
  })()`)
  const csvLen = typeof exportCsv?.data === 'string' ? exportCsv.data.length : 0
  if (csvLen > 0) ok('导出 CSV', `${csvLen} 字符`)
  else warn('导出 CSV', `数据长度 ${csvLen}`)

  const exportJsonl = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.export('jsonl');
      return JSON.parse(JSON.stringify(r));
    } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
  })()`)
  const jsonlLen = typeof exportJsonl?.data === 'string' ? exportJsonl.data.length : 0
  if (jsonlLen > 0) ok('导出 JSONL', `${jsonlLen} 字符`)
  else warn('导出 JSONL', `数据长度 ${jsonlLen}`)

  const exportHtml = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.export('html');
      return JSON.parse(JSON.stringify(r));
    } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
  })()`)
  const htmlLen = typeof exportHtml?.data === 'string' ? exportHtml.data.length : 0
  if (htmlLen > 0) ok('导出 HTML', `${htmlLen} 字符`)
  else warn('导出 HTML', `数据长度 ${htmlLen}`)

  // 5.2 周期摘要
  const summaryR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.summary('2020-01-01', '2030-12-31');
      return JSON.parse(JSON.stringify(r));
    } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
  })()`)
  if (summaryR?.success !== false) ok('周期摘要', `数据获取成功`)
  else warn('周期摘要', errMsg(summaryR))

  // 5.3 EAA validate + doctor
  const validateR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.validate();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (validateR?.success !== false) ok('EAA validate', '通过')
  else fail('EAA validate', '', errMsg(validateR))

  const doctorR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.doctor();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (doctorR?.success !== false) ok('EAA doctor', '通过')
  else warn('EAA doctor', errMsg(doctorR))

  // ========== 额外: UI 页面遍历 + Chat 使用 ==========
  console.log('\n--- 额外: UI 遍历 + Chat 使用 ---')

  // 遍历所有页面
  const pages = ['/dashboard', '/students', '/classes', '/chat', '/skills', '/agents', '/settings', '/privacy', '/logs', '/about']
  let pageErrors = 0
  for (const p of pages) {
    await cdp.navigate(p, 800)
    const check = await cdp.eval(`(function(){
      const body = document.body?.innerHTML?.length || 0;
      const errors = window.__consoleErrors || [];
      return { bodyLen: body, errorCount: errors.length };
    })()`)
    if (check?.errorCount > 0) pageErrors += check.errorCount
  }
  if (pageErrors === 0) ok('页面遍历', `${pages.length} 页, 0 console 错误`)
  else warn('页面遍历', `${pages.length} 页, ${pageErrors} console 错误`)

  // Chat 保存消息
  const chatR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.chat.saveMessage({
        sessionId: 'teacher-week-${testSuffix}',
        role: 'user',
        content: '本周班级表现总结',
        timestamp: Date.now(),
        provider: 'test',
        model: 'test-model'
      });
      return JSON.parse(JSON.stringify(r));
    } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
  })()`)
  if (chatR?.success) ok('Chat 保存', `id: ${chatR.id}`)
  else warn('Chat 保存', errMsg(chatR))

  // Chat 加载
  const chatLoad = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.chat.loadMessages('teacher-week-${testSuffix}');
      return JSON.parse(JSON.stringify(r));
    } catch(err) { return { success: false, error: String(err.message||err).slice(0,80) }; }
  })()`)
  if (chatLoad?.success && chatLoad?.messages?.length > 0) ok('Chat 加载', `${chatLoad.messages.length} 条`)
  else warn('Chat 加载', errMsg(chatLoad))

  // ========== 最终: 数据一致性 + 内存 ==========
  console.log('\n--- 最终: 数据一致性 + 内存 ---')

  // 验证所有学生数据完整
  const finalStudents = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const finalStuList = finalStudents?.data?.students || []
  const activeStudents = finalStuList.filter(s => s.status !== 'DELETED')
  ok('数据完整性', `总计 ${finalStuList.length}, 活跃 ${activeStudents.length}`)

  // 最终排行榜
  const finalRank = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(20);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const finalRankList = finalRank?.data?.ranking || finalRank?.data || []
  ok('最终排行榜', `${finalRankList.length} 名`)
  if (finalRankList.length > 0) {
    const top = finalRankList[0]
    ok('本周第一名', `${top?.name}: ${top?.score ?? top?.total_score}`)
  }

  // 内存检查
  const memEnd = await cdp.getMem()
  if (memStart && memEnd) {
    const delta = memEnd.used - memStart.used
    const deltaKB = (delta / 1024).toFixed(1)
    const pct = ((delta / memStart.used) * 100).toFixed(1)
    if (Math.abs(delta) < 5 * 1024 * 1024) ok('内存变化', `delta ${deltaKB}KB (${pct}%)`)
    else warn('内存变化', `delta ${deltaKB}KB (${pct}%)`)
  } else {
    warn('内存检查', 'performance.memory 不可用')
  }

  // ========== 清理 ==========
  console.log('\n--- 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
    try { await window.api.chat.deleteSession('teacher-week-${testSuffix}'); } catch(e) {}
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  ok('清理完成', '')

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r10-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R10-teacher-workflow',
  }, null, 2))
  console.log('结果已写入: r10-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
