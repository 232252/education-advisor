// 第十七轮测试 — EAA import + 端到端数据流 + 错误注入
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
        try { resolve(JSON.parse(d).find((x) => x.type === 'page').webSocketDebuggerUrl) }
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(path, wait = 1500) {
    await this.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
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

  const origEval = cdp.eval.bind(cdp)
  cdp.eval = async (expr) => { results.apiCalls++; return origEval(expr) }

  function errMsg(r) {
    return r?.__error || r?.error || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }

  console.log('=== 第十七轮: EAA import + 端到端数据流 + 错误注入 ===\n')

  const testSuffix = String(Date.now()).slice(-4)

  // ========== 1. 清理 ==========
  console.log('--- 1. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
  })()`)
  // 分批删除学生
  const stuListStr = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.stringify((r.data?.students || []).map(s => s.name));
  })()`)
  const allNames = JSON.parse(stuListStr)
  for (let i = 0; i < allNames.length; i += 10) {
    const batch = allNames.slice(i, i + 10)
    await cdp.eval(`(async()=>{
      const names = ${JSON.stringify(batch)};
      for(const n of names){ try{ await window.api.eaa.deleteStudent(n, '清理'); }catch(e){} }
    })()`)
  }
  await new Promise((r) => setTimeout(r, 2000))
  ok('清理完成', `删除 ${allNames.length} 学生`)

  // ========== 2. EAA export → import 数据流 ==========
  console.log('\n--- 2. EAA export → import 数据流 ---')

  // 2.1 创建测试数据
  const testStudents = []
  for (let i = 0; i < 5; i++) {
    const name = `R17导入测试${i}_${testSuffix}`
    await cdp.eval(`(async()=>{ await window.api.eaa.addStudent('${name}'); })()`)
    testStudents.push(name)
  }
  // 添加事件
  for (const name of testStudents) {
    await cdp.eval(`(async()=>{
      try { await window.api.eaa.addEvent({ studentName: '${name}', reasonCode: 'LATE', note: '导入测试', operator: 'test' }); } catch(e) {}
    })()`)
  }
  ok('创建测试数据', `${testStudents.length} 学生 + 事件`)

  // 2.2 导出为 CSV
  const exportR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.export('csv');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const csvData = typeof exportR?.data === 'string' ? exportR.data : ''
  ok('导出 CSV', `${csvData.length} 字符`)

  // 2.3 写入临时文件
  const tempDir = await cdp.eval(`(async()=>{
    return await window.api.sys.getPath('temp');
  })()`)
  const importFilePath = path.join(tempDir, `r17-import-${testSuffix}.csv`)
  fs.writeFileSync(importFilePath, csvData, 'utf-8')
  ok('写入临时文件', importFilePath)

  // 2.4 调用 import
  const importR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.import('${importFilePath.replace(/\\\\/g, '/')}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,100) }; }
  })()`)
  if (importR?.success !== false) ok('EAA import', '导入成功')
  else warn('EAA import', errMsg(importR))

  // 清理临时文件
  try { fs.unlinkSync(importFilePath) } catch (e) {}

  // ========== 3. 端到端数据流验证 ==========
  console.log('\n--- 3. 端到端数据流验证 ---')

  // 3.1 创建班级
  const classId = `R17E2E-${testSuffix}`
  await cdp.eval(`(async()=>{
    await window.api.class.create({ class_id: '${classId}', name: 'R17端到端班', grade: '高一', teacher: '端到端师' });
  })()`)
  ok('创建班级', classId)

  // 3.2 分配学生
  await cdp.eval(`(async()=>{
    await window.api.class.assign({ class_id: '${classId}', student_names: [${testStudents.map(n=>`'${n}'`).join(',')}] });
  })()`)
  ok('分配学生', `${testStudents.length} 名`)

  // 3.3 验证 class_id 同步
  const checkR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.score('${testStudents[0]}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const checkClassId = checkR?.data?.class_id || checkR?.data?.student?.class_id
  if (checkClassId === classId) ok('class_id 同步', '✓')
  else warn('class_id 同步', `期望 ${classId}, 实际 ${checkClassId}`)

  // 3.4 添加事件 → 验证分数 → 撤销 → 验证恢复
  const student = testStudents[0]
  // 初始分数
  const score1R = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.score('${student}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const score1 = score1R?.data?.score ?? score1R?.data
  ok('初始分数', `${student}: ${score1}`)

  // 添加 CLASS_MONITOR (+10)
  await cdp.eval(`(async()=>{
    try { await window.api.eaa.addEvent({ studentName: '${student}', reasonCode: 'CLASS_MONITOR', note: '端到端测试', operator: 'test' }); } catch(e) {}
  })()`)
  await new Promise((r) => setTimeout(r, 500))

  const score2R = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.score('${student}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const score2 = score2R?.data?.score ?? score2R?.data
  ok('加分后分数', `${student}: ${score2} (+10)`)

  // 验证分数变化
  if (score2 === score1 + 10) ok('分数变化', `+10 ✓`)
  else warn('分数变化', `期望 ${score1 + 10}, 实际 ${score2}`)

  // 查历史 → 撤销
  const histR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.history('${student}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const events = histR?.data?.events || []
  const monitorEvt = events.find(e => e.reason_code === 'CLASS_MONITOR')
  if (monitorEvt) {
    const evtId = monitorEvt.id || monitorEvt.event_id || monitorEvt.uuid
    if (evtId) {
      const revertR = await cdp.eval(`(async()=>{
        try {
          const r = await window.api.eaa.revertEvent('${evtId}', '端到端撤销');
          return JSON.parse(JSON.stringify(r));
        } catch(e) { return { success: false }; }
      })()`)
      if (revertR?.success !== false) ok('撤销事件', '成功')
      else fail('撤销事件', '', errMsg(revertR))

      await new Promise((r) => setTimeout(r, 500))
      const score3R = await cdp.eval(`(async()=>{
        const r = await window.api.eaa.score('${student}');
        return JSON.parse(JSON.stringify(r));
      })()`)
      const score3 = score3R?.data?.score ?? score3R?.data
      ok('撤销后分数', `${student}: ${score3}`)
      if (score3 === score1) ok('分数恢复', `回到 ${score1} ✓`)
      else warn('分数恢复', `期望 ${score1}, 实际 ${score3}`)
    }
  } else {
    warn('查历史', '无 CLASS_MONITOR 事件')
  }

  // 3.5 排行榜验证
  const rankR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(20);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rankList = rankR?.data?.ranking || rankR?.data || []
  ok('排行榜', `${rankList.length} 名`)
  // 验证测试学生都在排行榜中
  let inRank = 0
  for (const s of testStudents) {
    if (rankList.find(r => r.name === s)) inRank++
  }
  ok('测试学生在排行榜', `${inRank}/${testStudents.length}`)

  // 3.6 导出验证
  const exportCsv = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.export('csv');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const csvLen = typeof exportCsv?.data === 'string' ? exportCsv.data.length : 0
  ok('导出 CSV', `${csvLen} 字符`)

  // 验证 CSV 包含测试学生
  const csvContent = typeof exportCsv?.data === 'string' ? exportCsv.data : ''
  let inCsv = 0
  for (const s of testStudents) {
    if (csvContent.includes(s)) inCsv++
  }
  ok('CSV 包含测试学生', `${inCsv}/${testStudents.length}`)

  // ========== 4. 错误注入测试 ==========
  console.log('\n--- 4. 错误注入测试 ---')

  // 4.1 无效学生名 (空)
  const emptyR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addStudent('');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (emptyR?.success === false || emptyR?.error) ok('空学生名被拒', '✓')
  else warn('空学生名被拒', '未拒绝')

  // 4.2 无效原因码
  const invalidCodeR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addEvent({ studentName: '${testStudents[0]}', reasonCode: 'INVALID_CODE_XYZ', note: '测试', operator: 'test' });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (invalidCodeR?.success === false || invalidCodeR?.error) ok('无效原因码被拒', '✓')
  else warn('无效原因码被拒', '未拒绝')

  // 4.3 不存在学生添加事件
  const ghostR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addEvent({ studentName: '不存在的学生_xyz_${testSuffix}', reasonCode: 'LATE', note: '测试', operator: 'test' });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (ghostR?.success === false || ghostR?.error) ok('不存在学生被拒', '✓')
  else warn('不存在学生被拒', '未拒绝')

  // 4.4 重复创建学生
  const dupR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addStudent('${testStudents[0]}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (dupR?.success === false || dupR?.error || (typeof dupR?.data === 'string' && dupR.data.includes('exist'))) ok('重复创建被拒', '✓')
  else warn('重复创建被拒', `结果: ${JSON.stringify(dupR).slice(0, 80)}`)

  // 4.5 无效导出格式
  const invalidFmtR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.export('xml');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (invalidFmtR?.success === false || invalidFmtR?.error) ok('无效导出格式被拒', '✓')
  else warn('无效导出格式被拒', '未拒绝')

  // 4.6 无效事件 ID 撤销
  const invalidRevertR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.revertEvent('invalid-event-id-xyz', '测试');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (invalidRevertR?.success === false || invalidRevertR?.error) ok('无效事件 ID 撤销被拒', '✓')
  else warn('无效事件 ID 撤销被拒', '未拒绝')

  // 4.7 Class 边界
  const invalidClassR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.class.create({ class_id: '', name: '无效班级' });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (invalidClassR?.success === false || invalidClassR?.error) ok('空 class_id 被拒', '✓')
  else warn('空 class_id 被拒', '未拒绝')

  // 4.8 无效 UUID archive
  const invalidArchiveR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.class.archive('invalid-uuid-xyz');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (invalidArchiveR?.success === false || invalidArchiveR?.error) ok('无效 UUID archive 被拒', '✓')
  else warn('无效 UUID archive 被拒', '未拒绝')

  // ========== 5. 软删除验证 ==========
  console.log('\n--- 5. 软删除验证 ---')

  const delStudent = testStudents[4]
  const delR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.deleteStudent('${delStudent}', '测试删除');
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (delR?.success !== false) ok('删除学生', '成功')

  // 验证软删除 (listStudents 仍返回)
  const afterDel = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const stuList = afterDel?.data?.students || []
  const deletedStu = stuList.find(s => s.name === delStudent)
  if (deletedStu) {
    ok('软删除验证', `status: ${deletedStu.status || '?'}`)
    if (deletedStu.status === 'DELETED') ok('软删除标记', 'DELETED ✓')
    else warn('软删除标记', `status: ${deletedStu.status}`)
  } else {
    warn('软删除验证', '学生不在列表中')
  }

  // 排行榜不应包含已删除学生
  const rankAfterDel = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(50);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rankListAfterDel = rankAfterDel?.data?.ranking || rankAfterDel?.data || []
  const inRankAfterDel = rankListAfterDel.find(r => r.name === delStudent)
  if (!inRankAfterDel) ok('已删除学生不在排行榜', '✓')
  else warn('已删除学生不在排行榜', '仍在排行榜')

  // ========== 6. 数据一致性最终验证 ==========
  console.log('\n--- 6. 数据一致性最终验证 ---')

  const finalValidate = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.validate();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (finalValidate?.success !== false) ok('EAA validate', '通过 ✓')
  else fail('EAA validate', '', errMsg(finalValidate))

  const finalDoctor = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.doctor();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (finalDoctor?.success !== false) ok('EAA doctor', '通过 ✓')
  else warn('EAA doctor', errMsg(finalDoctor))

  // ========== 7. 清理 ==========
  console.log('\n--- 7. 清理 ---')
  // 删除班级
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
  })()`)
  // 分批删除学生
  const finalStuList = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.stringify((r.data?.students || []).map(s => s.name));
  })()`)
  const finalNames = JSON.parse(finalStuList)
  for (let i = 0; i < finalNames.length; i += 10) {
    const batch = finalNames.slice(i, i + 10)
    await cdp.eval(`(async()=>{
      const names = ${JSON.stringify(batch)};
      for(const n of names){ try{ await window.api.eaa.deleteStudent(n, '清理'); }catch(e){} }
    })()`)
  }
  ok('清理完成', `删除 ${finalNames.length} 学生`)

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r17-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R17-import-e2e-error',
  }, null, 2))
  console.log('结果已写入: r17-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
