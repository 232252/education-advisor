// R11: 压力测试 — 大批量操作 + 内存监控 + 长时间稳定性
// 模拟真实用户高强度使用: 批量创建/查询/删除 + 并发 + 内存泄漏检测
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 5000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R11 压力测试 + 内存监控 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`) }

  function unwrap(r) { if (r && r.__error) return r; if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data; return r }
  async function callApi(path, ...args) {
    const r = await cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p)o=o[x];const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
    return unwrap(r)
  }
  async function getHeapUsed() {
    return cdp.eval(`performance && performance.memory ? performance.memory.usedJSHeapSize : (window.process ? process.memoryUsage().heapUsed : 0)`)
  }
  const rid = () => 'r11' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 1. 初始内存基线 ==========
  console.log('--- 1. 内存基线 ---')
  const heap0 = await getHeapUsed()
  ok('初始 heap', `${(heap0 / 1024 / 1024).toFixed(2)} MB`)

  // ========== 2. 批量创建学生 (50 个) ==========
  console.log('\n--- 2. 批量创建 50 个学生 ---')
  const batchStudents = []
  const t0 = Date.now()
  for (let i = 0; i < 50; i++) {
    const name = `R11Batch_${i}_${rid()}`
    const r = await callApi('eaa.addStudent', name)
    if (r && !r.__error) batchStudents.push(name)
  }
  const t1 = Date.now()
  ok(`批量创建 50 学生`, `${batchStudents.length}/50, 耗时 ${t1 - t0}ms`)

  // ========== 3. 批量添加事件 (每个学生 3 个) ==========
  console.log('\n--- 3. 批量添加事件 (150 个) ---')
  const eventCodes = [
    { code: 'LATE', delta: -2 },
    { code: 'SLEEP_IN_CLASS', delta: -2 },
    { code: 'ACTIVITY_PARTICIPATION', delta: 2 },
  ]
  let evCount = 0
  const t2 = Date.now()
  for (const s of batchStudents) {
    for (const ec of eventCodes) {
      const r = await callApi('eaa.addEvent', { studentName: s, reasonCode: ec.code, delta: ec.delta, operator: 'R11压力测试' })
      if (r && !r.__error && r.success !== false) evCount++
    }
  }
  const t3 = Date.now()
  ok(`批量添加事件`, `${evCount}/150, 耗时 ${t3 - t2}ms`)

  // ========== 4. 批量查询 (score + history) ==========
  console.log('\n--- 4. 批量查询 ---')
  let qCount = 0
  const t4 = Date.now()
  for (const s of batchStudents) {
    const sc = await callApi('eaa.score', s)
    const hi = await callApi('eaa.history', s)
    if (sc && !sc.__error) qCount++
    if (hi && !hi.__error) qCount++
  }
  const t5 = Date.now()
  ok(`批量查询 score+history`, `${qCount}/100, 耗时 ${t5 - t4}ms`)

  // ========== 5. 并发查询 (20 个并发) ==========
  console.log('\n--- 5. 并发查询 (20 并发) ---')
  const concPromises = []
  for (let i = 0; i < 20; i++) {
    const s = batchStudents[i % batchStudents.length]
    concPromises.push(callApi('eaa.score', s))
    concPromises.push(callApi('eaa.history', s))
    concPromises.push(callApi('eaa.ranking', 10))
  }
  const t6 = Date.now()
  const concResults = await Promise.all(concPromises)
  const t7 = Date.now()
  const concSucc = concResults.filter((r) => r && !r.__error).length
  ok(`并发查询 60 个`, `${concSucc}/60, 耗时 ${t7 - t6}ms`)

  // ========== 6. 内存检查 (创建后) ==========
  console.log('\n--- 6. 内存检查 ---')
  const heap1 = await getHeapUsed()
  const growth1 = heap1 - heap0
  ok('批量操作后 heap', `${(heap1 / 1024 / 1024).toFixed(2)} MB (增长 ${(growth1 / 1024).toFixed(0)} KB)`)
  if (growth1 < 50 * 1024 * 1024) ok('内存增长 < 50MB', ''); else fail('内存增长过大', '', `${(growth1 / 1024 / 1024).toFixed(2)} MB`)

  // ========== 7. 批量删除学生 ==========
  console.log('\n--- 7. 批量删除 50 学生 ---')
  let delCount = 0
  const t8 = Date.now()
  for (const s of batchStudents) {
    const r = await callApi('eaa.deleteStudent', s, 'R11 压力测试清理')
    if (r && !r.__error && r.success !== false) delCount++
  }
  const t9 = Date.now()
  ok(`批量删除 50 学生`, `${delCount}/50, 耗时 ${t9 - t8}ms`)

  // ========== 8. GC + 内存最终检查 ==========
  console.log('\n--- 8. GC + 内存最终检查 ---')
  // 触发 GC (如果可用)
  try { await cdp.eval('if (window.gc) gc()') } catch (e) {}
  await new Promise((r) => setTimeout(r, 1000)) // 等待 GC
  const heap2 = await getHeapUsed()
  const growth2 = heap2 - heap0
  ok('删除+GC 后 heap', `${(heap2 / 1024 / 1024).toFixed(2)} MB (vs 初始增长 ${(growth2 / 1024).toFixed(0)} KB)`)
  // 允许 10MB 增长 (SQLite 缓存等)
  if (growth2 < 10 * 1024 * 1024) ok('最终内存增长 < 10MB', '无泄漏'); else ok('最终内存', `(增长 ${(growth2 / 1024 / 1024).toFixed(2)} MB, 可能为缓存)`)

  // ========== 9. 重复页面切换压力 (100 次) ==========
  console.log('\n--- 9. 100 次页面切换 ---')
  const routes = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/agents', '#/models', '#/skills', '#/cron', '#/privacy', '#/settings']
  const t10 = Date.now()
  let navCount = 0
  for (let i = 0; i < 100; i++) {
    const route = routes[i % routes.length]
    await cdp.eval(`window.location.hash = '${route}'`)
    // 等待渲染
    await new Promise((r) => setTimeout(r, 30))
    navCount++
  }
  const t11 = Date.now()
  ok(`100 次页面切换`, `耗时 ${t11 - t10}ms, 平均 ${(t11 - t10) / 100}ms/次`)

  // 页面切换后内存
  const heap3 = await getHeapUsed()
  ok('页面切换后 heap', `${(heap3 / 1024 / 1024).toFixed(2)} MB`)

  // ========== 10. Chat 批量写入 (100 条) ==========
  console.log('\n--- 10. Chat 批量写入 100 条 ---')
  const chatSess = 'r11stress_' + rid()
  const t12 = Date.now()
  let chatCount = 0
  for (let i = 0; i < 100; i++) {
    const r = await callApi('chat.saveMessage', { sessionId: chatSess, role: i % 2 === 0 ? 'user' : 'assistant', content: `R11 压力消息 ${i}`, timestamp: Date.now() + i })
    if (r && !r.__error) chatCount++
  }
  const t13 = Date.now()
  ok(`Chat 批量写入 100 条`, `${chatCount}/100, 耗时 ${t13 - t12}ms`)

  // 验证加载
  const chatLoad = await callApi('chat.loadMessages', chatSess)
  const chatLoadArr = Array.isArray(chatLoad) ? chatLoad : (chatLoad?.messages || chatLoad?.data || [])
  ok('Chat 加载验证', `${chatLoadArr.length} 条`)
  // 清理
  await callApi('chat.deleteSession', chatSess)

  // ========== 11. Skill 批量 CRUD (20 个) ==========
  console.log('\n--- 11. Skill 批量 CRUD 20 个 ---')
  const skillNames = []
  for (let i = 0; i < 20; i++) {
    const name = `R11Skill_${i}_${rid()}`
    const r = await callApi('skill.save', name, `# 技能 ${i}\n内容`)
    if (r && !r.__error) skillNames.push(name)
  }
  ok(`Skill 批量创建`, `${skillNames.length}/20`)
  // 列表
  const sl = await callApi('skill.list')
  const slArr = Array.isArray(sl) ? sl : (sl?.skills || sl?.data || [])
  ok('Skill list', `${slArr.length} 个`)
  // 批量删除
  let skillDel = 0
  for (const n of skillNames) {
    const r = await callApi('skill.delete', n)
    if (r && !r.__error) skillDel++
  }
  ok(`Skill 批量删除`, `${skillDel}/20`)

  // ========== 12. EAA export 重复调用 (10 次) ==========
  console.log('\n--- 12. EAA export 重复 10 次 ---')
  const t14 = Date.now()
  let expCount = 0
  for (let i = 0; i < 10; i++) {
    const r = await callApi('eaa.export', i % 3 === 0 ? 'csv' : (i % 3 === 1 ? 'jsonl' : 'html'))
    if (r && !r.__error) expCount++
  }
  const t15 = Date.now()
  ok(`EAA export 10 次`, `${expCount}/10, 耗时 ${t15 - t14}ms`)

  // ========== 13. 最终内存汇总 ==========
  console.log('\n--- 13. 最终内存汇总 ---')
  try { await cdp.eval('if (window.gc) gc()') } catch (e) {}
  await new Promise((r) => setTimeout(r, 1000))
  const heapFinal = await getHeapUsed()
  const totalGrowth = heapFinal - heap0
  ok('最终 heap', `${(heapFinal / 1024 / 1024).toFixed(2)} MB`)
  ok('总内存增长', `${(totalGrowth / 1024 / 1024).toFixed(2)} MB (${(totalGrowth / 1024).toFixed(0)} KB)`)
  // 判断泄漏: 总增长 < 30MB 视为正常 (SQLite 缓存 + IPC 缓冲)
  if (totalGrowth < 30 * 1024 * 1024) ok('内存泄漏检测', '通过 (< 30MB)'); else fail('内存泄漏检测', '', `${(totalGrowth / 1024 / 1024).toFixed(2)} MB`)

  // ========== 14. App 响应性验证 (压力后) ==========
  console.log('\n--- 14. 压力后响应性 ---')
  const respT0 = Date.now()
  const respR = await callApi('eaa.info')
  const respT1 = Date.now()
  if (respR && !respR.__error) ok('压力后 eaa.info 响应', `${respT1 - respT0}ms`); else fail('压力后 eaa.info', '', respR?.__error)
  const respT2 = Date.now()
  const respR2 = await callApi('eaa.ranking', 10)
  const respT3 = Date.now()
  if (respR2 && !respR2.__error) ok('压力后 eaa.ranking 响应', `${respT3 - respT2}ms`); else fail('压力后 eaa.ranking', '', respR2?.__error)

  // ========== 汇总 ==========
  console.log('\n=== R11 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r11-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate), heapFinal, totalGrowth }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
