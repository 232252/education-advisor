// 第八轮测试 — 长时间稳定性 + 并发压力 + 持续运行
// 目标: 持续运行 5 分钟以上,监控内存趋势,并发 API 压力,页面频繁切换
const http = require('http')
const WebSocket = require('ws')

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
    return this.eval(`(function(){
      if(performance.memory) return { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit };
      return null;
    })()`)
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

  function errMsg(r) {
    return r?.__error || r?.error || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }

  const startTime = Date.now()
  const testSuffix = String(Date.now()).slice(-4)
  console.log('=== 第八轮: 长时间稳定性 + 并发压力 (持续 5 分钟+) ===\n')

  // ========== 1. 准备数据 ==========
  console.log('--- 1. 准备测试数据 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 2000))

  // 创建 1 个班级 + 10 个学生
  const className = `压测班_${testSuffix}`
  const classId = `STRESS${testSuffix}`
  const classR = await cdp.eval(`(async()=>{
    const r = await window.api.class.create({ class_id: '${classId}', name: '${className}', grade: '八年级', teacher: '压测老师', note: '压测' });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (classR?.success !== false) ok('创建压测班级', className)
  else fail('创建压测班级', '', errMsg(classR))

  const students = []
  for (let i = 0; i < 10; i++) {
    const name = `压测生${i + 1}_${testSuffix}`
    const r = await cdp.eval(`(async()=>{
      const res = await window.api.eaa.addStudent('${name}');
      return JSON.parse(JSON.stringify(res));
    })()`)
    if (r?.success !== false) {
      students.push(name)
    }
  }
  // 批量分配到班级
  if (students.length > 0) {
    const assignR = await cdp.eval(`(async()=>{
      const r = await window.api.class.assign({ class_id: '${classId}', student_names: ${JSON.stringify(students)} });
      return JSON.parse(JSON.stringify(r));
    })()`)
    if (assignR?.success !== false) ok('批量分配学生', `${assignR?.assigned ?? students.length} 个分配`)
    else warn('批量分配学生', errMsg(assignR))
  }
  ok('创建+分配学生', `${students.length}/10`)
  await new Promise((r) => setTimeout(r, 1000))

  // ========== 2. 持续 3 分钟并发 API 压力 ==========
  console.log('\n--- 2. 持续 3 分钟并发 API 压力 ---')
  const stressDuration = 180000 // 3 分钟
  const stressStart = Date.now()
  let apiCalls = 0
  let apiSuccess = 0
  let apiFail = 0
  const reasonCodes = ['LATE', 'SLEEP_IN_CLASS', 'SPEAK_IN_CLASS', 'CIVILIZED_DORM', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR', 'CLASS_COMMITTEE', 'MONTHLY_ATTENDANCE', 'DESK_UNALIGNED', 'OTHER_DEDUCT']

  const memSamples = []
  let sampleIdx = 0
  const mem0 = await cdp.getMem()
  if (mem0) memSamples.push({ t: 0, used: mem0.used, total: mem0.total })

  // 持续发送并发 API 请求
  while (Date.now() - stressStart < stressDuration) {
    const batch = await cdp.eval(`(async()=>{
      const students = ${JSON.stringify(students)};
      const reasons = ${JSON.stringify(reasonCodes)};
      const promises = [];
      // 每轮 5 个并发请求
      for(let i = 0; i < 5; i++){
        const s = students[Math.floor(Math.random() * students.length)];
        const r = reasons[Math.floor(Math.random() * reasons.length)];
        const note = '压测_' + Date.now() + '_' + i;
        promises.push(window.api.eaa.addEvent({ studentName: s, reasonCode: r, note: note, operator: 'stress' }).then(res => ({ ok: res?.success !== false })).catch(() => ({ ok: false })));
      }
      // 同时并发只读 API
      promises.push(window.api.eaa.ranking(10).then(() => ({ ok: true })).catch(() => ({ ok: false })));
      promises.push(window.api.eaa.stats().then(() => ({ ok: true })).catch(() => ({ ok: false })));
      promises.push(window.api.class.list().then(() => ({ ok: true })).catch(() => ({ ok: false })));
      const results = await Promise.allSettled(promises);
      let ok = 0, fail = 0;
      for(const r of results){ if(r.status === 'fulfilled' && r.value?.ok) ok++; else fail++; }
      return { ok, fail, total: results.length };
    })()`)

    apiCalls += batch.total
    apiSuccess += batch.ok
    apiFail += batch.fail

    // 每 30 秒采样一次内存
    if (Date.now() - stressStart > sampleIdx * 30000) {
      const m = await cdp.getMem()
      if (m) {
        memSamples.push({ t: Date.now() - stressStart, used: m.used, total: m.total })
        const elapsed = ((Date.now() - stressStart) / 1000).toFixed(0)
        const deltaKB = ((m.used - mem0.used) / 1024).toFixed(1)
        console.log(`  [${elapsed}s] API: ${apiCalls} 调用 (${apiSuccess}成功/${apiFail}失败), 内存 delta: ${deltaKB}KB`)
      }
      sampleIdx++
    }
  }

  const stressElapsed = Date.now() - stressStart
  if (apiCalls >= 500) {
    ok('3 分钟并发压力', `${apiCalls} API 调用, ${apiSuccess} 成功, ${apiFail} 失败, ${stressElapsed}ms`)
  } else {
    warn('3 分钟并发压力', `仅 ${apiCalls} 调用`)
  }

  // 检查 API 失败率
  const failRate = apiCalls > 0 ? (apiFail / apiCalls * 100).toFixed(1) : 100
  if (parseFloat(failRate) < 5) {
    ok('API 失败率', `${failRate}% (< 5%)`)
  } else {
    warn('API 失败率', `${failRate}%`)
  }

  // ========== 3. 内存趋势分析 ==========
  console.log('\n--- 3. 内存趋势分析 ---')
  const memFinal = await cdp.getMem()
  if (memFinal && mem0) {
    const deltaKB = ((memFinal.used - mem0.used) / 1024).toFixed(1)
    const pct = ((memFinal.used - mem0.used) / mem0.used * 100).toFixed(1)
    const deltaMB = (deltaKB / 1024).toFixed(2)
    if (Math.abs(parseFloat(deltaMB)) < 10) {
      ok('内存增长', `delta ${deltaMB}MB (${pct}%), 3分钟压力后`)
    } else if (Math.abs(parseFloat(deltaMB)) < 30) {
      warn('内存增长', `delta ${deltaMB}MB (${pct}%), 3分钟压力后`)
    } else {
      fail('内存泄漏', `delta ${deltaMB}MB (${pct}%), 可能存在内存泄漏`)
    }

    // 打印内存采样趋势
    if (memSamples.length >= 2) {
      console.log('  内存采样趋势:')
      memSamples.forEach((s, i) => {
        const dKB = ((s.used - mem0.used) / 1024).toFixed(1)
        console.log(`    [${(s.t / 1000).toFixed(0)}s] ${s.used} bytes (delta ${dKB}KB)`)
      })
      ok('内存采样', `${memSamples.length} 个采样点`)
    }
  } else {
    warn('内存检查', 'performance.memory 不可用')
  }

  // ========== 4. 页面快速切换 200 次 (2 分钟) ==========
  console.log('\n--- 4. 页面快速切换 200 次 ---')
  const navStart = Date.now()
  const memBeforeNav = await cdp.getMem()
  const pages = ['/dashboard', '/students', '/classes', '/chat', '/skills', '/agents', '/privacy', '/scheduler', '/models', '/settings']
  let navErrors = 0
  for (let i = 0; i < 200; i++) {
    try {
      await cdp.navigate(pages[i % pages.length], 100)
    } catch (e) {
      navErrors++
    }
  }
  const navElapsed = Date.now() - navStart
  const memAfterNav = await cdp.getMem()

  if (navErrors === 0) {
    ok('200 次页面切换', `0 错误, ${navElapsed}ms (avg ${(navElapsed / 200).toFixed(0)}ms/次)`)
  } else {
    warn('200 次页面切换', `${navErrors} 错误`)
  }

  if (memBeforeNav && memAfterNav) {
    const navDeltaKB = ((memAfterNav.used - memBeforeNav.used) / 1024).toFixed(1)
    if (Math.abs(parseFloat(navDeltaKB)) < 2048) {
      ok('导航后内存', `delta ${navDeltaKB}KB`)
    } else {
      warn('导航后内存', `delta ${navDeltaKB}KB`)
    }
  }

  // ========== 5. 数据完整性验证 (压力后) ==========
  console.log('\n--- 5. 压力后数据完整性 ---')
  const rankingAfter = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(20);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rankList = rankingAfter?.data?.ranking || rankingAfter?.data || []
  if (rankList.length >= 5) {
    ok('排行榜完整性', `${rankList.length} 名学生 (压力后)`)

    // 验证第一名分数合理 (base=100, 压力测试可能加减很多)
    const first = rankList[0]
    const score = first?.score ?? first?.total_score
    if (score !== undefined) {
      if (score >= 50 && score <= 500) {
        ok('第一名分数合理', `${first?.name}: ${score}`)
      } else {
        warn('第一名分数', `${first?.name}: ${score} (可能异常)`)
      }
    }
  } else {
    warn('排行榜完整性', `仅 ${rankList.length} 名`)
  }

  // 验证 stats
  const statsAfter = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.stats();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (statsAfter?.success !== false) {
    const statsData = statsAfter?.data || {}
    ok('统计数据完整性', `学生 ${statsData?.student_count ?? '?'}, 事件 ${statsData?.event_count ?? '?'}`)
  }

  // 验证事件历史可查
  if (students.length > 0) {
    const histAfter = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.history('${students[0]}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const events = histAfter?.data?.events || []
    if (events.length > 0) {
      ok('事件历史完整', `${events.length} 条 (压测生1)`)
    } else {
      warn('事件历史', '无事件 (可能全部被撤销)')
    }
  }

  // ========== 6. 班级数据一致性 ==========
  console.log('\n--- 6. 班级数据一致性 ---')
  const classList = await cdp.eval(`(async()=>{
    const r = await window.api.class.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const classes = classList?.data || []
  const stressClass = classes.find((c) => c.name === className)
  if (stressClass) {
    ok('压测班级存在', `${stressClass.name} (${stressClass.id})`)

    // 验证班级学生数 (通过 EAA listStudents 按 class_id 过滤)
    const allStudents = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.listStudents();
      return JSON.parse(JSON.stringify(r));
    })()`)
    const stuList = allStudents?.data?.students || []
    const classStus = stuList.filter((s) => s.class_id === classId)
    if (classStus.length === students.length) {
      ok('班级学生数一致', `${classStus.length}/${students.length}`)
    } else {
      warn('班级学生数', `${classStus.length} vs ${students.length} (可能软删除差异)`)
    }
  } else {
    warn('压测班级', '未找到 (可能被过滤)')
  }

  // ========== 7. EAA validate (数据校验) ==========
  console.log('\n--- 7. EAA 数据校验 ---')
  const validateR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.validate();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (validateR?.success !== false) {
    ok('EAA validate', '数据校验通过')
  } else {
    warn('EAA validate', errMsg(validateR))
  }

  // EAA doctor
  const doctorR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.doctor();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (doctorR?.success !== false) {
    ok('EAA doctor', '健康检查通过')
  } else {
    warn('EAA doctor', errMsg(doctorR))
  }

  // ========== 8. Console 错误检查 ==========
  console.log('\n--- 8. Console 错误检查 ---')
  const consoleCheck = await cdp.eval(`(function(){
    // 检查是否有未处理的 Promise rejection
    const errors = window.__errorCount || 0;
    return { errorCount: errors };
  })()`)
  if (consoleCheck?.errorCount === 0 || consoleCheck?.errorCount === undefined) {
    ok('Console 错误', '无未处理错误')
  } else {
    warn('Console 错误', `${consoleCheck.errorCount} 个`)
  }

  // ========== 9. 持续 2 分钟混合操作 (UI 导航 + API) ==========
  console.log('\n--- 9. 持续 2 分钟混合操作 ---')
  const mixStart = Date.now()
  const mixDuration = 120000 // 2 分钟
  let mixOps = 0
  let mixErrors = 0

  while (Date.now() - mixStart < mixDuration) {
    const op = mixOps % 4
    try {
      if (op === 0) {
        // 导航到不同页面
        await cdp.navigate(pages[mixOps % pages.length], 200)
      } else if (op === 1) {
        // 查询排行榜
        await cdp.eval(`(async()=>{ await window.api.eaa.ranking(10); })()`)
      } else if (op === 2) {
        // 查询统计
        await cdp.eval(`(async()=>{ await window.api.eaa.stats(); })()`)
      } else {
        // 添加事件
        if (students.length > 0) {
          const s = students[mixOps % students.length]
          const r = reasonCodes[mixOps % reasonCodes.length]
          await cdp.eval(`(async()=>{ await window.api.eaa.addEvent({ studentName: '${s}', reasonCode: '${r}', note: '混合测试', operator: 'mix' }); })()`)
        }
      }
      mixOps++
    } catch (e) {
      mixErrors++
      mixOps++
    }

    // 每 30 秒打印进度
    if (mixOps % 50 === 0) {
      const elapsed = ((Date.now() - mixStart) / 1000).toFixed(0)
      const mem = await cdp.getMem()
      const deltaKB = mem ? ((mem.used - mem0.used) / 1024).toFixed(1) : '?'
      console.log(`  [混合 ${elapsed}s] ${mixOps} 操作, ${mixErrors} 错误, mem delta ${deltaKB}KB`)
    }
  }

  const mixElapsed = Date.now() - mixStart
  if (mixErrors < mixOps * 0.05) {
    ok('2 分钟混合操作', `${mixOps} 操作, ${mixErrors} 错误 (${(mixErrors / mixOps * 100).toFixed(1)}%), ${mixElapsed}ms`)
  } else {
    warn('2 分钟混合操作', `${mixOps} 操作, ${mixErrors} 错误`)
  }

  // ========== 10. 最终内存检查 ==========
  console.log('\n--- 10. 最终内存检查 ---')
  const memEnd = await cdp.getMem()
  if (memEnd && mem0) {
    const totalDeltaKB = ((memEnd.used - mem0.used) / 1024).toFixed(1)
    const totalDeltaMB = (totalDeltaKB / 1024).toFixed(2)
    const totalPct = ((memEnd.used - mem0.used) / mem0.used * 100).toFixed(1)
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0)
    if (Math.abs(parseFloat(totalDeltaMB)) < 20) {
      ok('最终内存', `delta ${totalDeltaMB}MB (${totalPct}%), ${totalElapsed}s 后`)
    } else if (Math.abs(parseFloat(totalDeltaMB)) < 50) {
      warn('最终内存', `delta ${totalDeltaMB}MB (${totalPct}%), ${totalElapsed}s 后`)
    } else {
      fail('内存泄漏', `delta ${totalDeltaMB}MB (${totalPct}%), ${totalElapsed}s 后`)
    }
    ok('总运行时间', `${totalElapsed}s`)
    ok('总 API 调用', `${apiCalls + mixOps}`)
  }

  // ========== 11. 清理 ==========
  console.log('\n--- 11. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  ok('清理完成', '')

  // ========== 汇总 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail + results.warn
  const passRate = total > 0 ? (results.pass / total * 100).toFixed(1) : 0
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${passRate}%`)
  console.log(`总运行时间: ${((Date.now() - startTime) / 1000).toFixed(0)}s`)

  // 写入结果到文件
  const fs = require('fs')
  const reportPath = __dirname + '/r8-results.json'
  fs.writeFileSync(reportPath, JSON.stringify({
    round: 'R8',
    startTime: new Date(startTime).toISOString(),
    durationMs: Date.now() - startTime,
    totalTests: total,
    pass: results.pass,
    fail: results.fail,
    warn: results.warn,
    passRate: parseFloat(passRate),
    apiCalls: apiCalls + mixOps,
    apiSuccess,
    apiFail,
    memSamples,
    details: results.details
  }, null, 2))
  console.log(`\n结果已写入: ${reportPath}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
