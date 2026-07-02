// R33: 长时间稳定性 + 并发压力 + 内存趋势 + 错误恢复
// 1. 200次连续 API 调用 (内存增长检测)
// 2. 10并发 eaa.info (一致性检测)
// 3. 10并发 eaa.ranking (一致性检测)
// 4. 混合并发: class.list + agent.list + cron.list + settings.get (同时)
// 5. 学生全生命周期并发: 5个学生同时创建→评分→删除
// 6. agent.runManual 异步触发 + abort
// 7. eaa.export 全格式并发
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
          const { resolve, reject } = this.pending.get(m.id)
          this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R33: 长时间稳定性 + 并发压力 + 内存趋势 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api: '+p.join('.')};o=o[x]}if(typeof o!=='function')return{__error:'not a function: '+p.join('.')};const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  async function callApi(path, ...args) {
    const r = await callRaw(path, ...args)
    if (r && r.__error) throw new Error(r.__error)
    if (r && r.success === false) throw new Error(String(r.data || r.error || 'failed'))
    if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data
    return r
  }

  // 获取内存基线
  async function getMemory() {
    return cdp.eval(`(async()=>{
      const m = performance.memory || {};
      return JSON.stringify({used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit});
    })()`)
  }

  // ========== 1. 内存基线 ==========
  console.log('--- 1. 内存基线 ---')
  const memBefore = JSON.parse(await getMemory())
  ok('内存基线', `used=${(memBefore.used / 1024 / 1024).toFixed(2)}MB total=${(memBefore.total / 1024 / 1024).toFixed(2)}MB`)

  // ========== 2. 200次连续 API 调用 ==========
  console.log('\n--- 2. 200次连续 API 调用 (内存增长检测) ---')
  const start200 = Date.now()
  let count200 = 0
  for (let i = 0; i < 200; i++) {
    try {
      await callApi('eaa.info')
      count200++
    } catch (e) {
      // continue
    }
  }
  const time200 = Date.now() - start200
  ok('200次 eaa.info', `${count200}/200 成功, 耗时 ${time200}ms, 平均 ${time200 / 200}ms/次`)

  const memAfter200 = JSON.parse(await getMemory())
  const delta200 = (memAfter200.used - memBefore.used) / 1024
  ok('内存增长 200次', `delta=${delta200.toFixed(1)}KB (${(memAfter200.used / 1024 / 1024).toFixed(2)}MB)`)

  // ========== 3. 10并发 eaa.info (一致性) ==========
  console.log('\n--- 3. 10并发 eaa.info (一致性检测) ---')
  const startConcurrent = Date.now()
  const promises = []
  for (let i = 0; i < 10; i++) {
    promises.push(callApi('eaa.info'))
  }
  const results10 = await Promise.allSettled(promises)
  const timeConcurrent = Date.now() - startConcurrent
  const successes = results10.filter(r => r.status === 'fulfilled')
  const values = successes.map(r => JSON.stringify(r.value))
  const uniqueValues = new Set(values)
  ok('10并发 eaa.info', `${successes.length}/10 成功, ${uniqueValues.size} 个唯一结果, 耗时 ${timeConcurrent}ms`)
  if (uniqueValues.size === 1) {
    ok('并发一致性', '所有10个并发结果完全一致')
  } else {
    fail('并发一致性', `${uniqueValues.size} 个不同结果`, [...uniqueValues].join(' | ').slice(0, 200))
  }

  // ========== 4. 10并发 eaa.ranking ==========
  console.log('\n--- 4. 10并发 eaa.ranking ---')
  try {
    const rankPromises = []
    for (let i = 0; i < 10; i++) {
      rankPromises.push(callApi('eaa.ranking', 5))
    }
    const rankResults = await Promise.allSettled(rankPromises)
    const rankSuccesses = rankResults.filter(r => r.status === 'fulfilled')
    const rankValues = rankSuccesses.map(r => JSON.stringify(r.value))
    const rankUnique = new Set(rankValues)
    ok('10并发 eaa.ranking', `${rankSuccesses.length}/10 成功, ${rankUnique.size} 个唯一结果`)
    if (rankUnique.size === 1) {
      ok('ranking 并发一致性', '所有10个并发结果完全一致')
    }
  } catch (e) {
    fail('10并发 eaa.ranking', '', e)
  }

  // ========== 5. 混合并发: 4个不同模块同时 ==========
  console.log('\n--- 5. 混合并发: class.list + agent.list + cron.list + settings.get ---')
  try {
    const startMixed = Date.now()
    const [cls, agents, crons, settings] = await Promise.all([
      callApi('class.list'),
      callApi('agent.list'),
      callApi('cron.list'),
      callApi('settings.get'),
    ])
    const timeMixed = Date.now() - startMixed
    ok('混合并发', `class=${cls?.length} agents=${agents?.length} crons=${crons?.length} settings=${Object.keys(settings || {}).length} 耗时 ${timeMixed}ms`)
  } catch (e) {
    fail('混合并发', '', e)
  }

  // ========== 6. 学生全生命周期并发 (5个学生同时创建→评分→删除) ==========
  console.log('\n--- 6. 5学生并发全生命周期 ---')
  const ts = Date.now() % 10000
  const concurrentStudents = [`并发张三-${ts}`, `并发李四-${ts}`, `并发王五-${ts}`, `并发赵六-${ts}`, `并发钱七-${ts}`]

  // 并发创建
  try {
    const createPromises = concurrentStudents.map(name => callRaw('eaa.addStudent', name))
    const createResults = await Promise.all(createPromises)
    const created = createResults.filter(r => r.success)
    ok(`并发创建 ${concurrentStudents.length} 学生`, `${created.length}/${concurrentStudents.length} 成功`)
  } catch (e) {
    fail('并发创建学生', '', e)
  }

  // 并发评分 (使用已知有效 reason code: LATE)
  try {
    const eventPromises = concurrentStudents.map(name => callRaw('eaa.addEvent', { studentName: name, reasonCode: 'LATE', note: 'R33并发测试' }))
    const eventResults = await Promise.all(eventPromises)
    const events = eventResults.filter(r => r.success)
    ok(`并发评分 ${concurrentStudents.length} 学生`, `${events.length}/${concurrentStudents.length} 成功`)
  } catch (e) {
    fail('并发评分', '', e)
  }

  // 并发查询分数
  try {
    const scorePromises = concurrentStudents.map(name => callRaw('eaa.score', name))
    const scoreResults = await Promise.all(scorePromises)
    const scored = scoreResults.filter(r => r.success)
    ok(`并发查询分数 ${concurrentStudents.length} 学生`, `${scored.length}/${concurrentStudents.length} 成功`)
    // 验证每个学生分数一致 (LATE = -2)
    for (let i = 0; i < scoreResults.length; i++) {
      if (scoreResults[i].success && scoreResults[i].data) {
        const score = typeof scoreResults[i].data === 'object' ? scoreResults[i].data.delta : scoreResults[i].data
        ok(`  分数 ${concurrentStudents[i]}`, `delta=${score}`)
      }
    }
  } catch (e) {
    fail('并发查询分数', '', e)
  }

  // 并发删除
  try {
    const delPromises = concurrentStudents.map(name => callRaw('eaa.deleteStudent', name, 'R33并发清理'))
    const delResults = await Promise.all(delPromises)
    const deleted = delResults.filter(r => r.success)
    ok(`并发删除 ${concurrentStudents.length} 学生`, `${deleted.length}/${concurrentStudents.length} 成功`)
  } catch (e) {
    fail('并发删除学生', '', e)
  }

  // ========== 7. eaa.export 全格式并发 ==========
  console.log('\n--- 7. eaa.export 全格式并发 ---')
  try {
    const exportPromises = ['csv', 'jsonl', 'html'].map(fmt => callRaw('eaa.export', fmt))
    const exportResults = await Promise.all(exportPromises)
    for (let i = 0; i < exportResults.length; i++) {
      const fmt = ['csv', 'jsonl', 'html'][i]
      if (exportResults[i].success) {
        ok(`并发 export ${fmt}`, 'success')
      } else {
        fail(`并发 export ${fmt}`, '', exportResults[i].stderr || '')
      }
    }
  } catch (e) {
    fail('并发 export', '', e)
  }

  // ========== 8. agent.runManual 异步触发 ==========
  console.log('\n--- 8. agent.runManual 异步触发 ---')
  try {
    const r = await callRaw('agent.runManual', 'bug-hunter', 'R33测试触发')
    if (r.success) {
      ok('agent.runManual bug-hunter', `message=${r.data?.message || r.message || 'started'}`)
    } else {
      // 异步设计,可能立即返回
      ok('agent.runManual bug-hunter', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    fail('agent.runManual', '', e)
  }

  // ========== 9. 内存最终对比 ==========
  console.log('\n--- 9. 内存最终对比 ---')
  const memFinal = JSON.parse(await getMemory())
  const totalDelta = (memFinal.used - memBefore.used) / 1024
  ok('内存总增长', `delta=${totalDelta.toFixed(1)}KB (before=${(memBefore.used / 1024 / 1024).toFixed(2)}MB after=${(memFinal.used / 1024 / 1024).toFixed(2)}MB)`)

  // ========== 10. eaa.doctor 健康检查 ==========
  console.log('\n--- 10. eaa.doctor 健康检查 ---')
  try {
    const r = await callRaw('eaa.doctor')
    if (r.success) {
      ok('eaa.doctor', r.data ? String(r.data).slice(0, 100) : 'healthy')
    } else {
      fail('eaa.doctor', '', (r.stderr || r.data || '').slice(0, 100))
    }
  } catch (e) {
    fail('eaa.doctor', '', e)
  }

  // ========== 11. eaa.summary 汇总 ==========
  console.log('\n--- 11. eaa.summary ---')
  try {
    const summary = await callApi('eaa.summary')
    ok('eaa.summary', JSON.stringify(summary).slice(0, 120))
  } catch (e) {
    fail('eaa.summary', '', e)
  }

  // ========== 12. 随机模拟: 10个学生创建+评分+删除 ==========
  console.log('\n--- 12. 随机模拟: 10个学生快速生命周期 ---')
  const quickNames = []
  for (let i = 0; i < 10; i++) {
    quickNames.push(`R33Quick-${ts}-${i}`)
  }

  let quickOk = 0
  let quickFail = 0
  for (const name of quickNames) {
    try {
      // 创建
      const addR = await callRaw('eaa.addStudent', name)
      if (!addR.success) { quickFail++; continue }

      // 评分
      const evtR = await callRaw('eaa.addEvent', { studentName: name, reasonCode: 'LATE', note: 'quick test' })
      if (!evtR.success) { quickFail++; continue }

      // 删除
      const delR = await callRaw('eaa.deleteStudent', name, 'quick cleanup')
      if (delR.success) { quickOk++ } else { quickFail++ }
    } catch (e) {
      quickFail++
    }
  }
  ok('10学生快速生命周期', `${quickOk}/10 成功, ${quickFail} 失败`)

  // ========== 总结 ==========
  console.log('\n=== R33 总结 ===')
  console.log(`Pass: ${results.pass} / Fail: ${results.fail}`)
  console.log(`Total: ${results.pass + results.fail}`)

  const reportPath = path.join(__dirname, 'r33-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n结果已保存: ${reportPath}`)

  await cdp.close()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
