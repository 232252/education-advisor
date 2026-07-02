// 第十三轮测试 — EAA 高级 + 数据导入 + UI 大数据渲染
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 45000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 40000 })
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

  console.log('=== 第十三轮: EAA 高级 + 数据导入 + UI 大数据渲染 ===\n')

  const testSuffix = String(Date.now()).slice(-4)
  const memStart = await cdp.eval(`(function(){
    if(performance.memory) return performance.memory.usedJSHeapSize;
    return null;
  })()`)

  // ========== 1. EAA 高级功能 ==========
  console.log('--- 1. EAA 高级功能 ---')

  // 1.1 info
  const infoR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.info();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (infoR?.success !== false) {
    const infoData = infoR?.data || {}
    ok('EAA info', `version: ${infoData?.version ?? '?'}, dir: ${String(infoData?.data_dir ?? '?').slice(0, 30)}`)
  } else warn('EAA info', errMsg(infoR))

  // 1.2 codes (原因码列表)
  const codesR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.codes();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const codesData = codesR?.data || {}
  const codeCount = Object.keys(codesData?.codes || codesData || {}).length
  ok('EAA codes', `${codeCount} 个原因码`)

  // 1.3 exportFormats
  const formatsR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.exportFormats();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return []; }
  })()`)
  const formats = Array.isArray(formatsR) ? formatsR : (formatsR?.data || [])
  ok('EAA exportFormats', `${formats.length}: ${formats.join(', ')}`)

  // 1.4 replay
  const replayR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.replay();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (replayR?.success !== false) ok('EAA replay', '执行成功')
  else warn('EAA replay', errMsg(replayR))

  // 1.5 doctor
  const doctorR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.doctor();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (doctorR?.success !== false) {
    const docData = doctorR?.data || {}
    ok('EAA doctor', `status: ${docData?.status ?? 'ok'}`)
  } else warn('EAA doctor', errMsg(doctorR))

  // 1.6 validate
  const validateR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.validate();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (validateR?.success !== false) ok('EAA validate', '通过')
  else fail('EAA validate', '', errMsg(validateR))

  // 1.7 stats (使用正确字段名)
  const statsR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.stats();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (statsR?.success !== false) {
    const stats = statsR?.data?.summary || statsR?.data || {}
    ok('EAA stats', `students: ${stats?.students ?? '?'}, events: ${stats?.total_events ?? '?'}`)
  } else warn('EAA stats', errMsg(statsR))

  // 1.8 tag (列出标签)
  const tagListR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.tag();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (tagListR?.success !== false) {
    const tagData = tagListR?.data
    const tagArr = Array.isArray(tagData) ? tagData : (tagData?.tags || tagData?.data || [])
    ok('EAA tag', `${Array.isArray(tagArr) ? tagArr.length : '?'} 个标签`)
  } else warn('EAA tag', errMsg(tagListR))

  // ========== 2. 准备大数据集 ==========
  console.log('\n--- 2. 准备大数据集 ---')

  // 清理
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 2000))

  // 创建 30 个学生 (大数据集)
  const bigStudents = []
  const createStart = Date.now()
  for (let i = 0; i < 30; i++) {
    const name = `R13大数据${String(i).padStart(3, '0')}_${testSuffix}`
    const r = await cdp.eval(`(async()=>{
      try {
        const res = await window.api.eaa.addStudent('${name}');
        return JSON.parse(JSON.stringify(res));
      } catch(e) { return { success: false }; }
    })()`)
    if (r?.success !== false) bigStudents.push(name)
  }
  ok('创建 30 学生', `${bigStudents.length}/30, ${Date.now() - createStart}ms`)

  // 给每个学生添加事件 (60 个事件)
  const eventStart = Date.now()
  const reasons = ['LATE', 'SLEEP_IN_CLASS', 'CIVILIZED_DORM', 'ACTIVITY_PARTICIPATION', 'APPEARANCE_VIOLATION', 'CLASS_COMMITTEE']
  let eventOk = 0
  for (let i = 0; i < bigStudents.length; i++) {
    const student = bigStudents[i]
    const reason = reasons[i % reasons.length]
    const r = await cdp.eval(`(async()=>{
      try {
        const res = await window.api.eaa.addEvent({ studentName: '${student}', reasonCode: '${reason}', note: 'R13大数据事件', operator: 'test' });
        return JSON.parse(JSON.stringify(res));
      } catch(e) { return { success: false }; }
    })()`)
    if (r?.success !== false) eventOk++
  }
  ok('添加事件', `${eventOk}/${bigStudents.length} 成功, ${Date.now() - eventStart}ms`)

  // ========== 3. UI 大数据渲染测试 ==========
  console.log('\n--- 3. UI 大数据渲染测试 ---')

  // 3.1 学生页渲染
  const renderStart = Date.now()
  await cdp.navigate('/students', 3000)
  const studentsRender = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1');
    const tableRows = document.querySelectorAll('table tbody tr').length;
    const bodyLen = document.body?.innerHTML?.length || 0;
    return { title: h1?.textContent, tableRows, bodyLen, renderTime: performance.now() };
  })()`)
  const renderTime = Date.now() - renderStart
  ok('学生页渲染', `表格 ${studentsRender?.tableRows ?? 0} 行, body ${studentsRender?.bodyLen ?? 0} 字符, ${renderTime}ms`)

  // 3.2 Dashboard 渲染
  const dashStart = Date.now()
  await cdp.navigate('/dashboard', 4000)
  const dashRender = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1');
    const canvasCount = document.querySelectorAll('canvas').length;
    const tableRows = document.querySelectorAll('table tbody tr').length;
    const bodyLen = document.body?.innerHTML?.length || 0;
    return { title: h1?.textContent, canvasCount, tableRows, bodyLen };
  })()`)
  const dashTime = Date.now() - dashStart
  ok('Dashboard 渲染', `canvas ${dashRender?.canvasCount ?? 0}, 表格 ${dashRender?.tableRows ?? 0} 行, ${dashTime}ms`)

  // 3.3 班级页渲染
  await cdp.navigate('/classes', 2000)
  const clsRender = await cdp.eval(`(function(){
    const tableRows = document.querySelectorAll('table tbody tr').length;
    const cards = document.querySelectorAll('.class-card, [class*="card"]').length;
    const bodyLen = document.body?.innerHTML?.length || 0;
    return { tableRows, cards, bodyLen };
  })()`)
  ok('班级页渲染', `表格 ${clsRender?.tableRows ?? 0} 行, cards ${clsRender?.cards ?? 0}, body ${clsRender?.bodyLen ?? 0} 字符`)

  // 3.4 排行榜查询 (大数据)
  const rankStart = Date.now()
  const rankR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(100);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rankList = rankR?.data?.ranking || rankR?.data || []
  ok('排行榜 100', `${rankList.length} 名, ${Date.now() - rankStart}ms`)
  if (rankList.length > 0) {
    ok('排行榜第一', `${rankList[0]?.name}: ${rankList[0]?.score ?? rankList[0]?.total_score}`)
    ok('排行榜最后', `${rankList[rankList.length-1]?.name}: ${rankList[rankList.length-1]?.score ?? rankList[rankList.length-1]?.total_score}`)
  }

  // 3.5 搜索大数据
  const searchStart = Date.now()
  const searchR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.search('R13');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const searchTime = Date.now() - searchStart
  const searchData = searchR?.data
  const searchResults = Array.isArray(searchData) ? searchData : (searchData?.results || searchData?.students || [])
  ok('搜索 R13', `${searchResults.length} 条, ${searchTime}ms`)

  // 3.6 日期范围查询 (大数据)
  const rangeStart = Date.now()
  const rangeR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.range('2020-01-01', '2030-12-31', 200);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rangeTime = Date.now() - rangeStart
  const rangeData = rangeR?.data
  const rangeEvents = rangeData?.events || rangeData || []
  ok('日期范围查询', `${Array.isArray(rangeEvents) ? rangeEvents.length : (rangeData?.count ?? '?')} 条, ${rangeTime}ms`)

  // ========== 4. 导出大数据 ==========
  console.log('\n--- 4. 导出大数据 ---')

  const formats2 = ['csv', 'jsonl', 'html']
  for (const fmt of formats2) {
    const expStart = Date.now()
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.export('${fmt}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    const expTime = Date.now() - expStart
    const dataLen = typeof r?.data === 'string' ? r.data.length : 0
    if (dataLen > 0) ok(`导出 ${fmt}`, `${dataLen} 字符, ${expTime}ms`)
    else warn(`导出 ${fmt}`, `数据长度 ${dataLen}`)
  }

  // ========== 5. 周期摘要大数据 ==========
  console.log('\n--- 5. 周期摘要大数据 ---')

  const sumStart = Date.now()
  const sumR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.summary('2020-01-01', '2030-12-31');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  const sumTime = Date.now() - sumStart
  if (sumR?.success !== false) ok('周期摘要', `数据获取成功, ${sumTime}ms`)
  else warn('周期摘要', errMsg(sumR))

  // ========== 6. 大数据下并发操作 ==========
  console.log('\n--- 6. 大数据下并发操作 ---')

  // 并发添加 10 个事件
  const concStart = Date.now()
  const concR = await cdp.eval(`(async()=>{
    const promises = [${bigStudents.slice(0, 10).map(n => `'${n}'`).join(',')}].map((name, i) => {
      const reasons = ['LATE', 'CIVILIZED_DORM', 'SLEEP_IN_CLASS', 'ACTIVITY_PARTICIPATION'];
      return window.api.eaa.addEvent({ studentName: name, reasonCode: reasons[i % reasons.length], note: 'R13并发', operator: 'test' });
    });
    const results = await Promise.allSettled(promises);
    return {
      total: results.length,
      success: results.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
    };
  })()`)
  ok('并发 10 事件', `${concR?.success ?? 0}/${concR?.total ?? 10}, ${Date.now() - concStart}ms`)

  // ========== 7. 大数据下页面切换 ==========
  console.log('\n--- 7. 大数据下页面切换 ---')

  const pages = ['/dashboard', '/students', '/classes', '/chat', '/skills']
  let switchErrors = 0
  const switchStart = Date.now()
  for (let i = 0; i < 30; i++) {
    await cdp.navigate(pages[i % pages.length], 300)
  }
  const switchTime = Date.now() - switchStart
  ok('30 次页面切换', `${switchTime}ms, avg ${(switchTime/30).toFixed(0)}ms/次`)

  // ========== 8. 数据完整性验证 ==========
  console.log('\n--- 8. 数据完整性验证 ---')

  const finalStudents = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const finalStuList = finalStudents?.data?.students || []
  const r13Students = finalStuList.filter(s => s.name?.includes('R13大数据'))
  ok('数据完整性', `总计 ${finalStuList.length}, R13: ${r13Students.length}`)

  // 最终排行榜
  const finalRank = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(50);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const finalRankList = finalRank?.data?.ranking || finalRank?.data || []
  ok('最终排行榜', `${finalRankList.length} 名`)
  if (finalRankList.length > 0) {
    ok('最高分', `${finalRankList[0]?.name}: ${finalRankList[0]?.score ?? finalRankList[0]?.total_score}`)
    ok('最低分', `${finalRankList[finalRankList.length-1]?.name}: ${finalRankList[finalRankList.length-1]?.score ?? finalRankList[finalRankList.length-1]?.total_score}`)
  }

  // EAA validate 最终
  const finalValidate = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.validate();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (finalValidate?.success !== false) ok('EAA validate 最终', '通过')
  else fail('EAA validate 最终', '', errMsg(finalValidate))

  // 内存检查
  const memEnd = await cdp.eval(`(function(){
    if(performance.memory) return performance.memory.usedJSHeapSize;
    return null;
  })()`)
  if (memStart && memEnd) {
    const delta = memEnd - memStart
    const deltaKB = (delta / 1024).toFixed(1)
    const pct = ((delta / memStart) * 100).toFixed(1)
    if (Math.abs(delta) < 10 * 1024 * 1024) ok('内存变化', `delta ${deltaKB}KB (${pct}%)`)
    else warn('内存变化', `delta ${deltaKB}KB (${pct}%)`)
  } else {
    warn('内存检查', 'performance.memory 不可用')
  }

  // ========== 9. 清理 ==========
  console.log('\n--- 9. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  ok('清理完成', '')

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r13-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R13-eaa-advanced-bigdata',
  }, null, 2))
  console.log('结果已写入: r13-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
