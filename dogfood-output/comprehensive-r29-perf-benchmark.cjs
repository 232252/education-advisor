// 第二十九轮测试 — 性能基准测试
// 目标: 测量班级页加载时间、页面切换延迟、大数据渲染性能
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
  async navigate(p, wait = 0) {
    const start = Date.now()
    await this.eval(`window.location.hash='${p}'`)
    // 等待页面渲染完成(检测 h1 或 body 内容变化)
    await new Promise((r) => setTimeout(r, wait || 500))
    return Date.now() - start
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
  console.log(`=== 第二十九轮: 性能基准测试 ===\n`)

  // ========== 1. 准备大数据集 ==========
  console.log('--- 1. 准备大数据集(50学生+100事件) ---')
  const classId = `R29Perf-${testSuffix}`
  await cdp.eval(`(async()=>{ await window.api.class.create({ class_id: '${classId}', name: 'R29性能班', grade: '九年级' }); })()`)

  const students = []
  for (let i = 0; i < 50; i++) {
    const name = `R29PerfStu${i}_${testSuffix}`
    students.push(name)
  }
  // 批量创建(5个一批)
  for (let i = 0; i < students.length; i += 5) {
    const batch = students.slice(i, i + 5)
    await cdp.eval(`(async()=>{ ${batch.map(n => `try{await window.api.eaa.addStudent('${n}');}catch(e){}`).join('\n')} })()`)
  }
  await cdp.eval(`(async()=>{ await window.api.class.assign({ class_id: '${classId}', student_names: ${JSON.stringify(students)} }); })()`)
  await new Promise((r) => setTimeout(r, 2000))
  ok('创建50学生', '完成')

  // 添加100事件
  const codes = ['LATE', 'SPEAK_IN_CLASS', 'CLASS_MONITOR', 'BONUS_VARIABLE', 'ACTIVITY_PARTICIPATION']
  for (let i = 0; i < 100; i++) {
    const stu = students[i % students.length]
    const code = codes[i % codes.length]
    await cdp.eval(`(async()=>{ try{ await window.api.eaa.addEvent({ studentName: '${stu}', reasonCode: '${code}', note: 'R29Perf', operator: 'R29' }); }catch(e){} })()`)
  }
  await new Promise((r) => setTimeout(r, 1000))
  ok('添加100事件', '完成')

  // ========== 2. 班级页加载时间 ==========
  console.log('\n--- 2. 班级页加载时间 ---')
  // 先预热一次
  await cdp.navigate('/classes', 2000)

  // 测量 5 次
  const classLoadTimes = []
  for (let i = 0; i < 5; i++) {
    await cdp.navigate('/dashboard', 1000)
    const t = await cdp.navigate('/classes', 2000)
    classLoadTimes.push(t)
    console.log(`  班级页加载 #${i+1}: ${t}ms`)
  }
  const avgClassLoad = classLoadTimes.reduce((a, b) => a + b, 0) / classLoadTimes.length
  const maxClassLoad = Math.max(...classLoadTimes)
  const minClassLoad = Math.min(...classLoadTimes)
  ok('班级页加载', `avg ${avgClassLoad.toFixed(0)}ms, min ${minClassLoad}ms, max ${maxClassLoad}ms`)
  if (avgClassLoad < 3000) ok('班级页性能', '良好(<3s)')
  else if (avgClassLoad < 5000) warn('班级页性能', '一般(3-5s)')
  else fail('班级页性能', '', `慢(>5s)`)

  // ========== 3. 学生页加载时间 ==========
  console.log('\n--- 3. 学生页加载时间 ---')
  const stuLoadTimes = []
  for (let i = 0; i < 5; i++) {
    await cdp.navigate('/dashboard', 1000)
    const t = await cdp.navigate('/students', 2000)
    stuLoadTimes.push(t)
    console.log(`  学生页加载 #${i+1}: ${t}ms`)
  }
  const avgStuLoad = stuLoadTimes.reduce((a, b) => a + b, 0) / stuLoadTimes.length
  ok('学生页加载', `avg ${avgStuLoad.toFixed(0)}ms`)

  // ========== 4. 仪表盘加载时间 ==========
  console.log('\n--- 4. 仪表盘加载时间 ---')
  const dashLoadTimes = []
  for (let i = 0; i < 5; i++) {
    await cdp.navigate('/classes', 1000)
    const t = await cdp.navigate('/dashboard', 2000)
    dashLoadTimes.push(t)
    console.log(`  仪表盘加载 #${i+1}: ${t}ms`)
  }
  const avgDashLoad = dashLoadTimes.reduce((a, b) => a + b, 0) / dashLoadTimes.length
  ok('仪表盘加载', `avg ${avgDashLoad.toFixed(0)}ms`)

  // ========== 5. 全页面切换基准 ==========
  console.log('\n--- 5. 全页面切换基准 ---')
  const pages = ['/dashboard', '/students', '/classes', '/chat', '/settings', '/agents', '/skills', '/privacy', '/logs', '/about']
  const pageTimes = {}
  for (const p of pages) {
    const times = []
    for (let i = 0; i < 3; i++) {
      const t = await cdp.navigate(p, 1000)
      times.push(t)
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    pageTimes[p] = Math.round(avg)
    ok(`页面 ${p}`, `avg ${Math.round(avg)}ms`)
  }

  // ========== 6. API 调用延迟 ==========
  console.log('\n--- 6. API 调用延迟 ---')

  // EAA listStudents
  const apiTimes = {}
  let start = Date.now()
  await cdp.eval(`(async()=>{ await window.api.eaa.listStudents(); })()`)
  apiTimes.listStudents = Date.now() - start
  ok('API listStudents', `${apiTimes.listStudents}ms`)

  start = Date.now()
  await cdp.eval(`(async()=>{ await window.api.eaa.ranking(100); })()`)
  apiTimes.ranking = Date.now() - start
  ok('API ranking(100)', `${apiTimes.ranking}ms`)

  start = Date.now()
  await cdp.eval(`(async()=>{ await window.api.eaa.stats(); })()`)
  apiTimes.stats = Date.now() - start
  ok('API stats', `${apiTimes.stats}ms`)

  start = Date.now()
  await cdp.eval(`(async()=>{ await window.api.class.list(); })()`)
  apiTimes.classList = Date.now() - start
  ok('API class.list', `${apiTimes.classList}ms`)

  start = Date.now()
  await cdp.eval(`(async()=>{ await window.api.eaa.export('csv'); })()`)
  apiTimes.exportCsv = Date.now() - start
  ok('API export csv', `${apiTimes.exportCsv}ms`)

  start = Date.now()
  await cdp.eval(`(async()=>{ await window.api.eaa.range('2026-01-01', '2026-12-31', 500); })()`)
  apiTimes.range = Date.now() - start
  ok('API range', `${apiTimes.range}ms`)

  // ========== 7. 大数据渲染检查 ==========
  console.log('\n--- 7. 大数据渲染检查 ---')
  await cdp.navigate('/students', 2000)
  const stuRows = await cdp.eval(`document.querySelectorAll('table tbody tr, [class*="row"]').length`)
  ok('学生页行数', `${stuRows} 行`)

  const renderTime = await cdp.eval(`(function(){
    // 检查首次渲染时间(performance.timing)
    if (performance.timing) {
      const t = performance.timing
      return {
        domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
        load: t.loadEventEnd - t.navigationStart
      }
    }
    return null;
  })()`)
  if (renderTime) {
    ok('DOM 加载', `DOMContentLoaded: ${renderTime.domContentLoaded}ms, load: ${renderTime.load}ms`)
  }

  // ========== 8. 连续 API 调用延迟 ==========
  console.log('\n--- 8. 连续 API 调用延迟 ---')
  const continuousTimes = []
  for (let i = 0; i < 10; i++) {
    start = Date.now()
    await cdp.eval(`(async()=>{ await window.api.eaa.listStudents(); })()`)
    continuousTimes.push(Date.now() - start)
  }
  const avgContinuous = continuousTimes.reduce((a, b) => a + b, 0) / continuousTimes.length
  const maxContinuous = Math.max(...continuousTimes)
  const minContinuous = Math.min(...continuousTimes)
  ok('连续10次 listStudents', `avg ${avgContinuous.toFixed(0)}ms, min ${minContinuous}ms, max ${maxContinuous}ms`)
  if (maxContinuous < 5000) ok('API 稳定性', `max ${maxContinuous}ms 稳定`)
  else warn('API 稳定性', `max ${maxContinuous}ms 波动`)

  // ========== 9. 内存检查 ==========
  console.log('\n--- 9. 内存检查 ---')
  const memR = await cdp.eval(`(function(){ if(performance && performance.memory){ return { used: Math.round(performance.memory.usedJSHeapSize/1024/1024), total: Math.round(performance.memory.totalJSHeapSize/1024/1024), limit: Math.round(performance.memory.jsHeapSizeLimit/1024/1024) }; } return null; })()`)
  if (memR) ok('内存', `${memR.used} MB / ${memR.total} MB (limit ${memR.limit} MB)`)

  // ========== 10. 性能汇总 ==========
  console.log('\n--- 10. 性能汇总 ---')
  console.log('页面加载时间:')
  for (const [p, t] of Object.entries(pageTimes)) {
    console.log(`  ${p}: ${t}ms`)
  }
  console.log('API 延迟:')
  for (const [api, t] of Object.entries(apiTimes)) {
    console.log(`  ${api}: ${t}ms`)
  }

  // ========== 11. 清理 ==========
  console.log('\n--- 11. 清理 ---')
  try {
    const cls = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
    const target = (cls?.data || []).find(c => c.class_id === classId)
    if (target) await cdp.eval(`(async()=>{ await window.api.class.delete('${target.id}'); })()`)
    // 删除学生(分批)
    for (let i = 0; i < students.length; i += 5) {
      const batch = students.slice(i, i + 5)
      await cdp.eval(`(async()=>{ ${batch.map(s => `try{await window.api.eaa.deleteStudent('${s}', '清理');}catch(e){}`).join('\n')} })()`)
    }
    ok('清理', `${students.length} 学生`)
  } catch (e) {
    warn('清理', String(e).slice(0, 100))
  }

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r29-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results, pageTimes, apiTimes, continuousTimes }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
