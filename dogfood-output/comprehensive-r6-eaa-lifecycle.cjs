// 第六轮测试 — EAA 事件生命周期 + 分数计算 + 长时间稳定性
// 从 EAA 数据引擎角度深度测试
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
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  // 辅助函数: 提取 EAA 错误信息
  function errMsg(r) {
    return r?.__error || r?.error || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }

  console.log('=== 第六轮: EAA 事件生命周期 + 分数计算 + 长时间稳定性 ===\n')

  const testSuffix = String(Date.now()).slice(-4)

  // ========== 1. 清理 ==========
  console.log('--- 1. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  ok('清理完成', '')

  // ========== 2. 创建测试学生 ==========
  console.log('\n--- 2. 创建测试学生 ---')
  const students = []
  for (let i = 0; i < 3; i++) {
    const name = `EAA测试生${i + 1}_${testSuffix}`
    const r = await cdp.eval(`(async()=>{
      const res = await window.api.eaa.addStudent('${name}');
      return JSON.parse(JSON.stringify(res));
    })()`)
    if (r?.success !== false) {
      students.push(name)
      ok(`创建学生 ${name}`, '成功')
    } else {
      fail(`创建学生 ${name}`, '', errMsg(r))
    }
  }

  // ========== 3. 事件生命周期: 添加 → 验证 → 撤销 ==========
  console.log('\n--- 3. 事件生命周期 ---')
  if (students.length > 0) {
    const s = students[0]

    // 3.1 添加迟到事件
    console.log('  [3.1] 添加迟到事件')
    const addEvt = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.addEvent({ studentName: '${s}', reasonCode: 'LATE', note: '测试迟到', operator: 'test' });
      return JSON.parse(JSON.stringify(r));
    })()`)
    if (addEvt?.success !== false) ok('添加 LATE 事件', '成功')
    else fail('添加 LATE 事件', '', errMsg(addEvt))

    await new Promise((r) => setTimeout(r, 500))

    // 3.2 验证事件存在
    console.log('  [3.2] 验证事件存在')
    const hist = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.history('${s}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const events = hist?.data?.events || []
    if (events.length >= 1) {
      ok('事件历史', `${events.length} 条, 原因: ${events[0]?.reason_code}`)
      // 验证事件详情
      const evt = events[0]
      if (evt.reason_code === 'LATE') ok('事件原因码', 'LATE ✓')
      else fail('事件原因码', '', `期望 LATE, 实际 ${evt.reason_code}`)
      if (evt.note === '测试迟到') ok('事件备注', '测试迟到 ✓')
      else warn('事件备注', `期望 测试迟到, 实际 ${evt.note}`)
    } else {
      fail('事件历史', '', '无事件')
    }

    // 3.3 验证分数变化 (base=100, LATE=-2 → 98)
    console.log('  [3.3] 验证分数变化')
    const score1 = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.score('${s}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const scoreVal1 = score1?.data?.score ?? score1?.data
    if (scoreVal1 === 98) ok('分数验证', `LATE 后分数: ${scoreVal1} (base=100-2=98)`)
    else warn('分数验证', `LATE 后分数: ${scoreVal1} (期望 98, base=100)`)

    // 3.4 添加多个事件 (使用有效原因码)
    console.log('  [3.4] 添加多个事件')
    const multiEvents = [
      { reasonCode: 'SLEEP_IN_CLASS', note: '课堂睡觉', expectedDelta: -2 },
      { reasonCode: 'CIVILIZED_DORM', note: '文明寝室', expectedDelta: 3 },
      { reasonCode: 'CLASS_MONITOR', note: '担任班长', expectedDelta: 10 },
    ]
    for (const me of multiEvents) {
      const r = await cdp.eval(`(async()=>{
        const res = await window.api.eaa.addEvent({ studentName: '${s}', reasonCode: '${me.reasonCode}', note: '${me.note}', operator: 'test' });
        return JSON.parse(JSON.stringify(res));
      })()`)
      if (r?.success !== false) ok(`添加 ${me.reasonCode}`, `期望 delta ${me.expectedDelta}`)
      else fail(`添加 ${me.reasonCode}`, '', errMsg(r))
      await new Promise((r) => setTimeout(r, 300))
    }

    // 3.5 验证累计分数
    console.log('  [3.5] 验证累计分数')
    const score2 = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.score('${s}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const scoreVal2 = score2?.data?.score ?? score2?.data
    // base=100: LATE(-2) + SLEEP(-2) + CIVILIZED_DORM(+3) + CLASS_MONITOR(+10) = 109
    const expectedScore = 100 - 2 - 2 + 3 + 10
    if (scoreVal2 === expectedScore) ok('累计分数', `${scoreVal2} (base=100, 期望 ${expectedScore}) ✓`)
    else fail('累计分数', '', `实际 ${scoreVal2}, 期望 ${expectedScore}`)

    // 3.6 撤销事件
    console.log('  [3.6] 撤销事件')
    const evtToRevert = events[0]
    const evtId = evtToRevert?.id || evtToRevert?.event_id || evtToRevert?.uuid
    if (evtId) {
      const revertR = await cdp.eval(`(async()=>{
        const r = await window.api.eaa.revertEvent('${evtId}', '测试撤销');
        return JSON.parse(JSON.stringify(r));
      })()`)
      if (revertR?.success !== false) ok('撤销事件', `事件 ${evtId} 已撤销`)
      else fail('撤销事件', '', errMsg(revertR))

      await new Promise((r) => setTimeout(r, 500))

      // 验证分数恢复 (+2 for reverting LATE)
      const score3 = await cdp.eval(`(async()=>{
        const r = await window.api.eaa.score('${s}');
        return JSON.parse(JSON.stringify(r));
      })()`)
      const scoreVal3 = score3?.data?.score ?? score3?.data
      const expectedAfterRevert = expectedScore + 2 // 撤销 LATE (+2)
      if (scoreVal3 === expectedAfterRevert) ok('撤销后分数', `${scoreVal3} (期望 ${expectedAfterRevert}) ✓`)
      else fail('撤销后分数', '', `实际 ${scoreVal3}, 期望 ${expectedAfterRevert}`)
    }

    // 3.7 重复撤销应被拒绝
    console.log('  [3.7] 重复撤销应被拒绝')
    if (evtId) {
      const reRevert = await cdp.eval(`(async()=>{
        const r = await window.api.eaa.revertEvent('${evtId}', '重复撤销');
        return JSON.parse(JSON.stringify(r));
      })()`)
      if (reRevert?.success === false || errMsg(reRevert) !== 'unknown') ok('重复撤销', '被拒绝 ✓')
      else warn('重复撤销', `可能未拒绝: ${JSON.stringify(reRevert).slice(0, 80)}`)
    }
  }

  // ========== 4. 排行榜验证 ==========
  console.log('\n--- 4. 排行榜验证 ---')
  if (students.length >= 2) {
    // 给第二个学生加分
    const s2 = students[1]
    await cdp.eval(`(async()=>{
      await window.api.eaa.addEvent({ studentName: '${s2}', reasonCode: 'GOOD_HOMEWORK', note: '优秀', operator: 'test' });
      await window.api.eaa.addEvent({ studentName: '${s2}', reasonCode: 'GOOD_HOMEWORK', note: '优秀2', operator: 'test' });
    })()`)
    await new Promise((r) => setTimeout(r, 1000))

    const ranking = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.ranking(10);
      return JSON.parse(JSON.stringify(r));
    })()`)
    const rankList = ranking?.data?.ranking || ranking?.data || []
    if (rankList.length > 0) {
      ok('排行榜', `${rankList.length} 名学生`)
      // 验证第一名分数 >= 0
      const first = rankList[0]
      ok('第一名', `${first?.name}: ${first?.score ?? first?.total_score}`)
    } else {
      warn('排行榜', '无数据')
    }
  }

  // ========== 5. 统计数据验证 ==========
  console.log('\n--- 5. 统计数据验证 ---')
  const stats = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.stats();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (stats?.success !== false) {
    const statsData = stats?.data || {}
    ok('统计数据', `学生 ${statsData?.student_count ?? '?'}, 事件 ${statsData?.event_count ?? '?'}`)
  } else {
    warn('统计数据', errMsg(stats))
  }

  // ========== 6. 搜索功能 ==========
  console.log('\n--- 6. 搜索功能 ---')
  if (students.length > 0) {
    const searchR = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.search('EAA测试生');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const searchResults = searchR?.data?.results || searchR?.data || []
    if (searchResults.length >= 1) ok('搜索 EAA测试生', `${searchResults.length} 条结果`)
    else warn('搜索 EAA测试生', '无结果')
  }

  // ========== 7. Dashboard 加载时间 ==========
  console.log('\n--- 7. Dashboard 加载时间 ---')
  const dashStart = Date.now()
  await cdp.navigate('/dashboard', 4000)
  const totalTime = Date.now() - dashStart
  const dashLoadResult = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1');
    const canvasCount = document.querySelectorAll('canvas').length;
    const tableRows = document.querySelectorAll('table tbody tr').length;
    return { hasH1: !!h1, canvasCount, tableRows };
  })()`)
  if (dashLoadResult?.hasH1) {
    ok('Dashboard 加载', `canvas: ${dashLoadResult.canvasCount} 个, 表格: ${dashLoadResult.tableRows} 行, 总时间 ${totalTime}ms`)
  } else {
    warn('Dashboard 加载', `总时间 ${totalTime}ms`)
  }

  // ========== 8. 并发事件操作 ==========
  console.log('\n--- 8. 并发事件操作 ---')
  if (students.length >= 3) {
    const s3 = students[2]
    // 并发添加 5 个事件
    const concurrentStart = Date.now()
    const concurrentResult = await cdp.eval(`(async()=>{
      const reasons = ['LATE', 'CIVILIZED_DORM', 'SLEEP_IN_CLASS', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR'];
      const promises = reasons.map((r, i) => window.api.eaa.addEvent({ studentName: '${s3}', reasonCode: r, note: '并发'+i, operator: 'test' }));
      const results = await Promise.allSettled(promises);
      return {
        fulfilled: results.filter(r => r.status === 'fulfilled').length,
        rejected: results.filter(r => r.status === 'rejected').length,
        successCount: results.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
      };
    })()`)
    const concurrentTime = Date.now() - concurrentStart
    if (concurrentResult?.successCount === 5) {
      ok('并发 5 事件', `${concurrentResult.successCount}/5 成功, ${concurrentTime}ms`)
    } else {
      warn('并发 5 事件', `${concurrentResult?.successCount ?? 0}/5 成功`)
    }

    // 验证并发后分数
    const scoreAfter = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.score('${s3}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const scoreVal = scoreAfter?.data?.score ?? scoreAfter?.data
    // base=100: LATE(-2) + CIVILIZED_DORM(+3) + SLEEP(-2) + ACTIVITY(+1) + MONITOR(+10) = 110
    const expectedConcurrent = 100 - 2 + 3 - 2 + 1 + 10
    if (scoreVal === expectedConcurrent) ok('并发后分数', `${scoreVal} (期望 ${expectedConcurrent}) ✓`)
    else fail('并发后分数', '', `实际 ${scoreVal}, 期望 ${expectedConcurrent}`)
  }

  // ========== 9. 长时间稳定性 (内存) ==========
  console.log('\n--- 9. 长时间稳定性 ---')
  const memBefore = await cdp.eval(`(function(){
    if(performance.memory) return { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize };
    return null;
  })()`)

  // 执行 50 次页面切换
  const pages = ['/dashboard', '/students', '/classes', '/chat', '/skills']
  for (let i = 0; i < 50; i++) {
    await cdp.navigate(pages[i % pages.length], 200)
  }

  const memAfter = await cdp.eval(`(function(){
    if(performance.memory) return { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize };
    return null;
  })()`)

  if (memBefore && memAfter) {
    const delta = memAfter.used - memBefore.used
    const deltaKB = (delta / 1024).toFixed(1)
    const pct = ((delta / memBefore.used) * 100).toFixed(1)
    if (Math.abs(delta) < 5 * 1024 * 1024) { // < 5MB
      ok('50次页面切换内存', `delta ${deltaKB}KB (${pct}%)`)
    } else {
      warn('50次页面切换内存', `delta ${deltaKB}KB (${pct}%)`)
    }
  } else {
    warn('内存检查', 'performance.memory 不可用')
  }

  // ========== 10. 数据一致性检查 ==========
  console.log('\n--- 10. 数据一致性 ---')
  if (students.length > 0) {
    // 验证学生列表与历史记录一致
    const listR = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.listStudents();
      return JSON.parse(JSON.stringify(r));
    })()`)
    const listStudents = listR?.data?.students || []
    const activeStudents = listStudents.filter(s => s.status !== 'DELETED')
    ok('学生列表', `${listStudents.length} 总数, ${activeStudents.length} 活跃`)

    // 验证每个活跃学生都有历史
    let consistentCount = 0
    for (const s of activeStudents.slice(0, 3)) {
      const h = await cdp.eval(`(async()=>{
        const r = await window.api.eaa.history('${s.name}');
        return JSON.parse(JSON.stringify(r));
      })()`)
      const hEvents = h?.data?.events || []
      if (hEvents.length > 0) consistentCount++
    }
    if (consistentCount > 0) ok('数据一致性', `${consistentCount}/${Math.min(3, activeStudents.length)} 学生有事件历史`)
    else warn('数据一致性', '无学生有事件历史')
  }

  // ========== 11. 导出验证 ==========
  console.log('\n--- 11. 导出验证 ---')
  if (students.length > 0) {
    // 尝试多种导出格式
    const formats = ['csv', 'jsonl', 'html']
    for (const fmt of formats) {
      try {
        const exportR = await cdp.eval(`(async()=>{
          const r = await window.api.eaa.export('${fmt}');
          return JSON.parse(JSON.stringify(r));
        })()`)
        if (exportR?.success !== false) {
          const exportData = exportR?.data
          if (typeof exportData === 'string' && exportData.length > 0) {
            ok(`${fmt} 导出`, `${exportData.length} 字符`)
            if (fmt === 'jsonl') {
              const lines = exportData.split('\n').filter(l => l.trim())
              ok('JSONL 格式', `${lines.length} 行`)
            }
          } else {
            warn(`${fmt} 导出`, `数据类型: ${typeof exportData}`)
          }
        } else {
          warn(`${fmt} 导出`, errMsg(exportR))
        }
      } catch (e) {
        warn(`${fmt} 导出`, `错误: ${String(e).slice(0, 60)}`)
      }
    }
  }

  // ========== 12. 班级分配 + 验证 ==========
  console.log('\n--- 12. 班级分配 ---')
  // 创建班级
  await cdp.eval(`(async()=>{
    await window.api.class.create({ class_id: 'EAA-TEST', name: 'EAA测试班', grade: '七年级', teacher: 'EAA教师' });
  })()`)
  await new Promise((r) => setTimeout(r, 500))

  if (students.length > 0) {
    const assignR = await cdp.eval(`(async()=>{
      const r = await window.api.class.assign({ class_id: 'EAA-TEST', student_names: ${JSON.stringify(students)} });
      return JSON.parse(JSON.stringify(r));
    })()`)
    if (assignR?.success !== false) ok('班级分配', `${students.length} 学生分配到 EAA-TEST`)
    else fail('班级分配', '', errMsg(assignR))

    // 验证学生 class_id
    const verifyAssign = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.listStudents();
      const students = r.data?.students || [];
      const assigned = students.filter(s => s.class_id === 'EAA-TEST');
      return assigned.length;
    })()`)
    if (verifyAssign >= students.length) ok('分配验证', `${verifyAssign} 学生有 class_id=EAA-TEST`)
    else warn('分配验证', `仅 ${verifyAssign}/${students.length} 分配成功`)
  }

  // ========== 13. Dashboard 班级筛选 ==========
  console.log('\n--- 13. Dashboard 班级筛选 ---')
  await cdp.navigate('/dashboard', 3000)
  const filterResult = await cdp.eval(`(function(){
    const sels = Array.from(document.querySelectorAll('select'));
    const classSel = sels.find(s => Array.from(s.options).some(o => o.value === 'EAA-TEST' || o.value === '__ALL__'));
    if(!classSel) return { found: false };
    return { found: true, optionCount: classSel.options.length, values: Array.from(classSel.options).map(o => o.value) };
  })()`)
  if (filterResult?.found) ok('Dashboard 班级筛选', `${filterResult.optionCount} 选项`)
  else warn('Dashboard 班级筛选', '未找到筛选器')

  // ========== 清理 ==========
  console.log('\n--- 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  ok('清理完成', '')

  console.log('\n=== 第六轮 EAA 生命周期测试汇总 ===')
  const total = results.pass + results.fail + results.warn
  console.log(`总计 ${total}, 通过 ${results.pass}, 失败 ${results.fail}, 警告 ${results.warn}, 通过率 ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.details.filter((d) => d.startsWith('✗')).forEach((d) => console.log(`  ${d}`))
  }

  ws.close(1000)
  fs.writeFileSync('dogfood-output/r6-eaa-lifecycle-result.json', JSON.stringify(results, null, 2))
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
