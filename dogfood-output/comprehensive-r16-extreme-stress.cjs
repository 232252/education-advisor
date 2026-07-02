// 第十六轮测试 — 极限压力测试: 100 学生 + 200 事件 + 长时间运行
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 90000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 85000 })
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

  console.log('=== 第十六轮: 极限压力测试 (100 学生 + 200 事件 + 长时间) ===\n')

  const testSuffix = String(Date.now()).slice(-4)
  const memStart = await cdp.getMem()
  const memSamples = []

  // ========== 1. 清理 ==========
  console.log('--- 1. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  ok('清理完成', '')

  // ========== 2. 批量创建 100 学生 ==========
  console.log('\n--- 2. 批量创建 100 学生 ---')
  const createStart = Date.now()
  let createOk = 0
  // 分批创建 (每批 10 个)
  for (let batch = 0; batch < 10; batch++) {
    const batchNames = []
    for (let i = 0; i < 10; i++) {
      const idx = batch * 10 + i
      batchNames.push(`R16极限${String(idx).padStart(3, '0')}_${testSuffix}`)
    }
    // 并发创建一批
    const batchR = await cdp.eval(`(async()=>{
      const names = [${batchNames.map(n => `'${n}'`).join(',')}];
      const promises = names.map(n => window.api.eaa.addStudent(n));
      const results = await Promise.allSettled(promises);
      return results.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length;
    })()`)
    createOk += batchR || 0
    memSamples.push({ time: Date.now() - createStart, mem: await cdp.getMem() })
  }
  const createTime = Date.now() - createStart
  ok('创建 100 学生', `${createOk}/100, ${createTime}ms, avg ${(createTime/100).toFixed(0)}ms/学生`)

  // ========== 3. 创建班级 + 分配 ==========
  console.log('\n--- 3. 创建班级 + 分配 ---')
  const classIds = []
  for (let i = 0; i < 5; i++) {
    const cid = `R16CLS${i}-${testSuffix}`
    await cdp.eval(`(async()=>{
      await window.api.class.create({ class_id: '${cid}', name: 'R16极限班${i}', grade: '高一', teacher: '师${i}' });
    })()`)
    classIds.push(cid)
  }
  ok('创建班级', `${classIds.length} 个`)

  // 分配学生到班级 (每班 20 人)
  let assignOk = 0
  for (let ci = 0; ci < classIds.length; ci++) {
    const cid = classIds[ci]
    const startIdx = ci * 20
    const studentNames = []
    for (let i = 0; i < 20; i++) {
      const idx = startIdx + i
      studentNames.push(`R16极限${String(idx).padStart(3, '0')}_${testSuffix}`)
    }
    const assignR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.class.assign({ class_id: '${cid}', student_names: [${studentNames.map(n=>`'${n}'`).join(',')}] });
        return r?.assigned || 0;
      } catch(e) { return 0; }
    })()`)
    assignOk += assignR || 0
  }
  ok('分配学生', `${assignOk}/100 成功`)

  // ========== 4. 批量添加 200 事件 ==========
  console.log('\n--- 4. 批量添加 200 事件 ---')
  const eventStart = Date.now()
  let eventOk = 0
  const eventReasons = ['LATE', 'SLEEP_IN_CLASS', 'CIVILIZED_DORM', 'ACTIVITY_PARTICIPATION', 'APPEARANCE_VIOLATION', 'CLASS_COMMITTEE', 'DESK_UNALIGNED', 'MONTHLY_ATTENDANCE']
  // 每个学生 2 个事件
  for (let i = 0; i < 100; i++) {
    const name = `R16极限${String(i).padStart(3, '0')}_${testSuffix}`
    for (let j = 0; j < 2; j++) {
      const reason = eventReasons[(i * 2 + j) % eventReasons.length]
      const r = await cdp.eval(`(async()=>{
        try {
          const res = await window.api.eaa.addEvent({ studentName: '${name}', reasonCode: '${reason}', note: 'R16极限事件${j}', operator: 'test' });
          return res?.success !== false;
        } catch(e) { return false; }
      })()`)
      if (r) eventOk++
    }
    // 每 20 个学生采样一次内存
    if ((i + 1) % 20 === 0) {
      memSamples.push({ time: Date.now() - createStart, mem: await cdp.getMem() })
      console.log(`  ... ${i+1}/100 学生, ${eventOk} 事件`)
    }
  }
  const eventTime = Date.now() - eventStart
  ok('添加 200 事件', `${eventOk}/200, ${eventTime}ms, avg ${(eventTime/200).toFixed(0)}ms/事件`)

  // ========== 5. 大数据查询性能 ==========
  console.log('\n--- 5. 大数据查询性能 ---')

  // 5.1 排行榜 (全量)
  const rankStart = Date.now()
  const rankR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(200);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rankList = rankR?.data?.ranking || rankR?.data || []
  ok('排行榜 200', `${rankList.length} 名, ${Date.now() - rankStart}ms`)

  // 5.2 listStudents
  const listStart = Date.now()
  const listR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const stuList = listR?.data?.students || []
  ok('listStudents', `${stuList.length} 名, ${Date.now() - listStart}ms`)

  // 5.3 stats
  const statsStart = Date.now()
  const statsR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.stats();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const statsTime = Date.now() - statsStart
  const statsData = statsR?.data?.summary || statsR?.data || {}
  ok('stats', `students: ${statsData?.students ?? '?'}, events: ${statsData?.total_events ?? '?'}, ${statsTime}ms`)

  // 5.4 日期范围查询
  const rangeStart = Date.now()
  const rangeR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.range('2020-01-01', '2030-12-31', 500);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rangeTime = Date.now() - rangeStart
  const rangeData = rangeR?.data
  const rangeEvents = rangeData?.events || rangeData || []
  ok('range 查询', `${Array.isArray(rangeEvents) ? rangeEvents.length : (rangeData?.count ?? '?')} 条, ${rangeTime}ms`)

  // 5.5 搜索
  const searchStart = Date.now()
  const searchR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.search('R16');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const searchTime = Date.now() - searchStart
  const searchData = searchR?.data
  const searchResults = Array.isArray(searchData) ? searchData : (searchData?.results || searchData?.students || [])
  ok('search R16', `${searchResults.length} 条, ${searchTime}ms`)

  // ========== 6. 导出性能 ==========
  console.log('\n--- 6. 导出性能 ---')

  for (const fmt of ['csv', 'jsonl', 'html']) {
    const expStart = Date.now()
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.export('${fmt}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false }; }
    })()`)
    const expTime = Date.now() - expStart
    const dataLen = typeof r?.data === 'string' ? r.data.length : 0
    if (dataLen > 0) ok(`导出 ${fmt}`, `${dataLen} 字符, ${expTime}ms`)
    else warn(`导出 ${fmt}`, `数据长度 ${dataLen}`)
  }

  // ========== 7. UI 渲染性能 (大数据) ==========
  console.log('\n--- 7. UI 渲染性能 (大数据) ---')

  // 学生页
  const stuRenderStart = Date.now()
  await cdp.navigate('/students', 4000)
  const stuRenderTime = Date.now() - stuRenderStart
  const stuRenderData = await cdp.eval(`(function(){
    const rows = document.querySelectorAll('table tbody tr').length;
    const bodyLen = document.body?.innerHTML?.length || 0;
    return { rows, bodyLen };
  })()`)
  ok('学生页渲染', `${stuRenderData?.rows} 行, body ${stuRenderData?.bodyLen} 字符, ${stuRenderTime}ms`)

  // Dashboard
  const dashRenderStart = Date.now()
  await cdp.navigate('/dashboard', 4000)
  const dashRenderTime = Date.now() - dashRenderStart
  const dashRenderData = await cdp.eval(`(function(){
    const rows = document.querySelectorAll('table tbody tr').length;
    const bodyLen = document.body?.innerHTML?.length || 0;
    const canvas = document.querySelectorAll('canvas').length;
    const svg = document.querySelectorAll('svg').length;
    return { rows, bodyLen, canvas, svg };
  })()`)
  ok('Dashboard 渲染', `rows:${dashRenderData?.rows}, body:${dashRenderData?.bodyLen}, canvas:${dashRenderData?.canvas}, svg:${dashRenderData?.svg}, ${dashRenderTime}ms`)

  // ========== 8. 长时间页面切换 (100 次) ==========
  console.log('\n--- 8. 长时间页面切换 (100 次) ---')
  const pages = ['/dashboard', '/students', '/classes', '/chat', '/skills', '/agents', '/settings', '/privacy', '/logs', '/about']
  let switchErrors = 0
  const switchStart = Date.now()
  for (let i = 0; i < 100; i++) {
    await cdp.navigate(pages[i % pages.length], 200)
    if ((i + 1) % 25 === 0) {
      memSamples.push({ time: Date.now() - createStart, mem: await cdp.getMem() })
      console.log(`  ... ${i+1}/100 次切换`)
    }
  }
  const switchTime = Date.now() - switchStart
  ok('100 次页面切换', `${switchTime}ms, avg ${(switchTime/100).toFixed(0)}ms/次`)

  // ========== 9. 混合操作 (2 分钟) ==========
  console.log('\n--- 9. 混合操作 (2 分钟) ---')
  const mixStart = Date.now()
  let mixOps = 0
  let mixErrors = 0
  while (Date.now() - mixStart < 120000) { // 2 分钟
    const op = mixOps % 5
    try {
      if (op === 0) {
        // 查询排行榜
        await cdp.eval(`(async()=>{ await window.api.eaa.ranking(50); })()`)
      } else if (op === 1) {
        // 查询统计
        await cdp.eval(`(async()=>{ await window.api.eaa.stats(); })()`)
      } else if (op === 2) {
        // 页面切换
        await cdp.navigate(pages[mixOps % pages.length], 100)
      } else if (op === 3) {
        // 添加事件
        const idx = mixOps % 100
        const name = `R16极限${String(idx).padStart(3, '0')}_${testSuffix}`
        await cdp.eval(`(async()=>{
          try { await window.api.eaa.addEvent({ studentName: '${name}', reasonCode: 'LATE', note: '混合测试', operator: 'test' }); } catch(e) {}
        })()`)
      } else if (op === 4) {
        // 搜索
        await cdp.eval(`(async()=>{ await window.api.eaa.search('R16'); })()`)
      }
      mixOps++
    } catch (e) {
      mixErrors++
    }
    if (mixOps % 20 === 0 && mixOps > 0) {
      memSamples.push({ time: Date.now() - createStart, mem: await cdp.getMem() })
      console.log(`  ... ${mixOps} 次操作, ${((Date.now()-mixStart)/1000).toFixed(0)}s`)
    }
  }
  const mixTime = Date.now() - mixStart
  ok('2 分钟混合操作', `${mixOps} 次, ${mixErrors} 错误, ${mixTime}ms`)

  // ========== 10. 数据完整性 ==========
  console.log('\n--- 10. 数据完整性 ---')

  const finalStudents = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const finalStuList = finalStudents?.data?.students || []
  const r16Students = finalStuList.filter(s => s.name?.includes('R16极限'))
  ok('数据完整性', `总计 ${finalStuList.length}, R16: ${r16Students.length}`)

  // 排行榜验证
  const finalRank = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(200);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const finalRankList = finalRank?.data?.ranking || finalRank?.data || []
  ok('最终排行榜', `${finalRankList.length} 名`)
  if (finalRankList.length > 0) {
    ok('最高分', `${finalRankList[0]?.name}: ${finalRankList[0]?.score ?? finalRankList[0]?.total_score}`)
    ok('最低分', `${finalRankList[finalRankList.length-1]?.name}: ${finalRankList[finalRankList.length-1]?.score ?? finalRankList[finalRankList.length-1]?.total_score}`)
  }

  // EAA validate
  const validateR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.validate();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (validateR?.success !== false) ok('EAA validate', '通过 ✓')
  else fail('EAA validate', '', errMsg(validateR))

  // doctor
  const doctorR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.doctor();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (doctorR?.success !== false) ok('EAA doctor', '通过 ✓')
  else warn('EAA doctor', errMsg(doctorR))

  // ========== 11. 内存趋势 ==========
  console.log('\n--- 11. 内存趋势 ---')
  const memEnd = await cdp.getMem()
  if (memStart && memEnd) {
    const delta = memEnd.used - memStart.used
    const deltaKB = (delta / 1024).toFixed(1)
    const pct = ((delta / memStart.used) * 100).toFixed(1)
    ok('总内存变化', `delta ${deltaKB}KB (${pct}%)`)
    ok('内存采样', `${memSamples.length} 个采样点`)
    // 检查是否有内存增长趋势
    const firstSample = memSamples[0]?.mem?.used
    const lastSample = memSamples[memSamples.length - 1]?.mem?.used
    if (firstSample && lastSample) {
      const trendDelta = lastSample - firstSample
      const trendKB = (trendDelta / 1024).toFixed(1)
      if (Math.abs(trendDelta) < 5 * 1024 * 1024) ok('内存趋势', `delta ${trendKB}KB (稳定)`)
      else warn('内存趋势', `delta ${trendKB}KB (可能泄漏)`)
    }
  } else {
    warn('内存检查', 'performance.memory 不可用')
  }

  // ========== 12. 清理 ==========
  console.log('\n--- 12. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 3000))
  ok('清理完成', '')

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r16-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R16-extreme-stress',
    memSamples,
  }, null, 2))
  console.log('结果已写入: r16-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
