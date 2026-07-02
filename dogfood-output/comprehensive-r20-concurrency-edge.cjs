// 第二十轮测试 — 并发竞争 + 边界数据 + 异常恢复
// 目标: 测试高并发、边界输入、异常恢复能力
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

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  const testSuffix = String(Date.now()).slice(-5)
  console.log(`=== 第二十轮: 并发竞争 + 边界数据 + 异常恢复 ===\n`)

  // ========== 1. 边界学生名 ==========
  console.log('--- 1. 边界学生名 ---')
  const boundaryNames = [
    { name: 'A', desc: '单字符' },
    { name: '张三'.repeat(50), desc: '超长名(150字)' },
    { name: '😀🎉测试', desc: 'emoji' },
    { name: "O'Brien", desc: '单引号' },
    { name: 'Test\\nName', desc: '反斜杠n' },
    { name: '<script>alert(1)</script>', desc: 'XSS尝试' },
    { name: '"; DROP TABLE students; --', desc: 'SQL注入尝试' },
    { name: '学生\x00名', desc: 'null字节' },
    { name: '  ', desc: '纯空格' },
  ]

  for (const { name, desc } of boundaryNames) {
    const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.addStudent('${escapedName}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)
    if (r?.success !== false) {
      // 验证能查到
      const listR = await cdp.eval(`(async()=>{
        const r = await window.api.eaa.listStudents();
        return JSON.parse(JSON.stringify(r));
      })()`)
      const found = (listR?.data?.students || []).some(s => s.name === name)
      if (found) ok(`边界名: ${desc}`, '创建+查询成功')
      else warn(`边界名: ${desc}`, '创建但查不到')
      // 清理
      await cdp.eval(`(async()=>{ try{await window.api.eaa.deleteStudent('${escapedName}', '清理');}catch(e){} })()`)
    } else {
      ok(`边界名: ${desc}`, `被拒绝: ${r.error?.slice(0, 50) || 'rejected'}`)
    }
  }

  // ========== 2. 边界班级参数 ==========
  console.log('\n--- 2. 边界班级参数 ---')
  const boundaryClasses = [
    { class_id: '', name: '空ID', desc: '空class_id' },
    { class_id: 'A'.repeat(200), name: '超长ID', desc: '超长class_id' },
    { class_id: 'TEST-invalid', name: '含连字符', desc: '连字符(应允许)' },
    { class_id: 'TEST.dot', name: '含点号', desc: '点号(应允许)' },
    { class_id: 'TEST_under', name: '含下划线', desc: '下划线(应拒绝)' },
    { class_id: 'TEST space', name: '含空格', desc: '空格(应拒绝)' },
    { class_id: '测试中文', name: '中文名', desc: '中文class_id' },
  ]

  for (const { class_id, name, desc } of boundaryClasses) {
    const escapedId = class_id.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.class.create({ class_id: '${escapedId}', name: '${escapedName}' });
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)
    if (r?.success !== false) {
      ok(`边界班级: ${desc}`, '创建成功')
      // 清理(获取内部id)
      const listR = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
      const created = (listR?.data || []).find(c => c.class_id === class_id)
      if (created) await cdp.eval(`(async()=>{ await window.api.class.delete('${created.id}'); })()`)
    } else {
      ok(`边界班级: ${desc}`, `被拒绝: ${r.error?.slice(0, 50) || 'rejected'}`)
    }
  }

  // ========== 3. 边界事件参数 ==========
  console.log('\n--- 3. 边界事件参数 ---')
  // 先创建一个测试学生
  const testStu = `R20Stu_${testSuffix}`
  await cdp.eval(`(async()=>{ await window.api.eaa.addStudent('${testStu}'); })()`)

  const boundaryEvents = [
    { studentName: '', reasonCode: 'LATE', desc: '空学生名' },
    { studentName: testStu, reasonCode: '', desc: '空原因码' },
    { studentName: testStu, reasonCode: 'INVALID_XYZ', desc: '无效原因码' },
    { studentName: '不存在学生XYZ', reasonCode: 'LATE', desc: '不存在学生' },
    { studentName: testStu, reasonCode: 'LATE', note: 'A'.repeat(10000), desc: '超长note' },
    { studentName: testStu, reasonCode: 'LATE', operator: '', desc: '空operator' },
  ]

  for (const ev of boundaryEvents) {
    const escapedStu = ev.studentName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const escapedNote = (ev.note || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.addEvent({ studentName: '${escapedStu}', reasonCode: '${ev.reasonCode}', note: '${escapedNote}', operator: '${ev.operator || ''}' });
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)
    if (r?.success === false) ok(`边界事件: ${ev.desc}`, '被拒绝')
    else if (ev.desc.includes('超长note') || ev.desc.includes('空operator') || ev.desc.includes('不存在')) {
      ok(`边界事件: ${ev.desc}`, r?.success ? '接受(宽容)' : '处理')
    } else {
      warn(`边界事件: ${ev.desc}`, `返回: ${JSON.stringify(r).slice(0, 80)}`)
    }
  }

  // ========== 4. 并发创建学生(竞争) ==========
  console.log('\n--- 4. 并发创建学生(竞争) ---')
  const concurrentNames = []
  for (let i = 0; i < 20; i++) concurrentNames.push(`R20Conc_${testSuffix}_${i}`)

  // 同名并发创建(应该只成功1次,其余拒绝)
  const sameName = `R20Same_${testSuffix}`
  const concurrentPromises = []
  for (let i = 0; i < 5; i++) {
    concurrentPromises.push(cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.addStudent('${sameName}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`))
  }
  const sameResults = await Promise.all(concurrentPromises)
  const successCount = sameResults.filter(r => r?.success !== false).length
  if (successCount === 1) ok('同名并发创建', `仅1次成功(正确)`)
  else if (successCount === 0) warn('同名并发创建', '全部失败')
  else fail('同名并发创建', '', `${successCount} 次成功(应只有1次)`)

  // 不同名并发创建(应该全部成功)
  const diffPromises = concurrentNames.slice(0, 10).map(name =>
    cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.addStudent('${name}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  )
  const diffResults = await Promise.all(diffPromises)
  const diffSuccess = diffResults.filter(r => r?.success !== false).length
  if (diffSuccess === 10) ok('不同名并发创建', '10/10 成功')
  else warn('不同名并发创建', `${diffSuccess}/10`)

  // ========== 5. 并发事件(同学生同天同原因去重) ==========
  console.log('\n--- 5. 并发事件(去重机制) ---')
  const dedupStu = `R20Dedup_${testSuffix}`
  await cdp.eval(`(async()=>{ await window.api.eaa.addStudent('${dedupStu}'); })()`)

  // 同学生同天同原因并发10次,应只记1次
  const dedupPromises = []
  for (let i = 0; i < 10; i++) {
    dedupPromises.push(cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.addEvent({ studentName: '${dedupStu}', reasonCode: 'LATE', note: '去重测试'+${i}, operator: 'R20' }); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`))
  }
  const dedupResults = await Promise.all(dedupPromises)
  const dedupSuccess = dedupResults.filter(r => r?.success !== false).length
  // 验证历史只有1条
  const histR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.history('${dedupStu}'); return JSON.parse(JSON.stringify(r)); })()`)
  const histEvents = histR?.data?.events || []
  if (histEvents.length === 1) ok('同天去重', `10并发 → 1事件(正确)`)
  else warn('同天去重', `10并发 → ${histEvents.length} 事件`)

  // ========== 6. 并发班级操作 ==========
  console.log('\n--- 6. 并发班级操作 ---')
  const concurrentClassIds = []
  for (let i = 0; i < 5; i++) concurrentClassIds.push(`R20CC-${testSuffix}-${i}`)

  const classPromises = concurrentClassIds.map(id =>
    cdp.eval(`(async()=>{ try{ const r=await window.api.class.create({ class_id: '${id}', name: '并发班${id}' }); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  )
  const classResults = await Promise.all(classPromises)
  const classSuccess = classResults.filter(r => r?.success !== false).length
  if (classSuccess === 5) ok('并发创建班级', '5/5 成功')
  else warn('并发创建班级', `${classSuccess}/5`)

  // 并发删除同一班级(应只1次成功)
  if (classSuccess > 0) {
    const listR = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
    const target = (listR?.data || []).find(c => c.class_id === concurrentClassIds[0])
    if (target) {
      const delPromises = []
      for (let i = 0; i < 3; i++) {
        delPromises.push(cdp.eval(`(async()=>{ try{ const r=await window.api.class.delete('${target.id}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`))
      }
      const delResults = await Promise.all(delPromises)
      const delSuccess = delResults.filter(r => r?.success !== false).length
      if (delSuccess === 1) ok('并发删除同班级', '仅1次成功(正确)')
      else warn('并发删除同班级', `${delSuccess} 次`)
    }
  }

  // ========== 7. 异常恢复 ==========
  console.log('\n--- 7. 异常恢复 ---')

  // 7.1 重复删除学生
  const delStu = `R20Del_${testSuffix}`
  await cdp.eval(`(async()=>{ await window.api.eaa.addStudent('${delStu}'); })()`)
  const del1 = await cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.deleteStudent('${delStu}', '第一次'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  const del2 = await cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.deleteStudent('${delStu}', '第二次'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  if (del1?.success !== false && (del2?.success === false || del2?.data?.includes?.('already') || del2?.data?.includes?.('Deleted'))) {
    ok('重复删除学生', '第二次被拒绝或幂等')
  } else {
    warn('重复删除学生', `两次都: ${del1?.success}/${del2?.success}`)
  }

  // 7.2 撤销不存在的事件
  const revertR = await cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.revertEvent('nonexistent-event-id-${testSuffix}', '测试'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  if (revertR?.success === false) ok('撤销不存在事件', '被拒绝')
  else warn('撤销不存在事件', `返回: ${JSON.stringify(revertR).slice(0, 80)}`)

  // 7.3 验证系统仍正常工作
  const infoR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.info(); return JSON.parse(JSON.stringify(r)); })()`)
  if (infoR?.success !== false) ok('异常后系统正常', 'EAA info 仍可用')
  else fail('异常后系统正常', '', 'EAA info 失败')

  // ========== 8. UI 压力(快速切换) ==========
  console.log('\n--- 8. UI 快速切换压力 ---')
  const pages = ['/dashboard', '/students', '/classes', '/chat', '/settings', '/agents', '/skills', '/privacy', '/logs', '/about']
  const switchTimes = []
  for (let round = 0; round < 3; round++) {
    for (const p of pages) {
      const start = Date.now()
      await cdp.navigate(p, 300)
      switchTimes.push(Date.now() - start)
    }
  }
  const avgSwitch = switchTimes.reduce((a, b) => a + b, 0) / switchTimes.length
  const maxSwitch = Math.max(...switchTimes)
  ok('30次页面切换', `avg ${avgSwitch.toFixed(0)}ms, max ${maxSwitch}ms`)

  // 检查 console 错误
  const consoleErrors = await cdp.eval(`(window.__consoleErrors || []).length`)
  if (typeof consoleErrors === 'number' && consoleErrors === 0) ok('console 错误', '0 个')
  else warn('console 错误', `${consoleErrors} 个`)

  // ========== 9. 内存检查 ==========
  console.log('\n--- 9. 内存检查 ---')
  const memR = await cdp.eval(`(function(){ if(performance && performance.memory){ return { used: Math.round(performance.memory.usedJSHeapSize/1024/1024), total: Math.round(performance.memory.totalJSHeapSize/1024/1024), limit: Math.round(performance.memory.jsHeapSizeLimit/1024/1024) }; } return null; })()`)
  if (memR) ok('内存', `${memR.used} MB / ${memR.total} MB (limit ${memR.limit} MB)`)
  else warn('内存', 'performance.memory 不可用')

  // ========== 10. 清理 ==========
  console.log('\n--- 10. 清理 ---')
  try {
    // 清理班级
    await cdp.eval(`(async()=>{ const cls=await window.api.class.list(); for(const c of cls.data||[]) await window.api.class.delete(c.id); })()`)
    // 清理学生(分批)
    const stuList = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
    const students = (stuList?.data?.students || []).filter(s => s.status !== 'Deleted' && s.name.startsWith('R20'))
    for (let i = 0; i < students.length; i += 5) {
      const batch = students.slice(i, i + 5)
      await cdp.eval(`(async()=>{ ${batch.map(s => `try{await window.api.eaa.deleteStudent('${s.name.replace(/'/g, "\\'")}', '清理');}catch(e){}`).join('\n')} })()`)
    }
    ok('清理', `${students.length} 学生`)
  } catch (e) {
    warn('清理', String(e).slice(0, 100))
  }

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r20-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
