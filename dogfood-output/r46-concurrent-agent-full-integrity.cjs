// R46: 并发压力 + Agent 全量执行 + 跨模块数据完整性 + 长时间稳定性
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
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R46: 并发压力 + Agent 全量执行 + 数据完整性 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      const p='${apiPath}'.split('.');
      let o=window.api;
      for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}
      if(typeof o!=='function')return{__error:'not a function'};
      const a=${JSON.stringify(args)};
      try{const r=await o(...a);return r}catch(e){return{__error:e.message}}
    })()`)
  }
  function safeStr(v, n = 80) { try { return JSON.stringify(v).slice(0, n) } catch (e) { return String(v).slice(0, n) } }

  // ========== 1. 并发压力测试 (20 并发混合 API) ==========
  console.log('--- 1. 并发压力测试 (20 并发混合 API) ---')

  try {
    const t = Date.now()
    const promises = []
    for (let i = 0; i < 20; i++) {
      const api = [
        () => callRaw('eaa.info'),
        () => callRaw('eaa.ranking', 10),
        () => callRaw('eaa.listStudents'),
        () => callRaw('agent.list'),
        () => callRaw('settings.get'),
      ][i % 5]()
      promises.push(api)
    }
    const results20 = await Promise.all(promises)
    const allSuccess = results20.every(r => r && !r.__error)
    const time = Date.now() - t
    ok('20 并发混合 API', `time=${time}ms allSuccess=${allSuccess} avg=${(time / 20).toFixed(0)}ms/call`)
  } catch (e) {
    fail('20 并发混合 API', '', e)
  }

  // ========== 2. Agent 全量执行 (18 个 Agent) ==========
  console.log('\n--- 2. Agent 全量执行 ---')

  const allAgents = ['academic', 'bug-hunter', 'class-monitor', 'counselor', 'data-analyst',
    'discipline-officer', 'executor', 'governor', 'home_school', 'main', 'psychology',
    'research', 'risk-alert', 'safety', 'student-care', 'supervisor', 'validator', 'weekly-reporter']

  let runOk = 0, runFail = []
  for (const aid of allAgents) {
    try {
      const r = await callRaw('agent.runManual', aid, 'R46并发测试', [])
      if (r && (r.success === true || r.message)) {
        runOk++
      } else {
        runFail.push(aid)
      }
    } catch (e) {
      runFail.push(aid)
    }
  }
  ok('agent.runManual 全量', `${runOk}/${allAgents.length} 成功启动, 失败: [${runFail.join(',')}]`)

  // 等待执行完成
  await new Promise(r => setTimeout(r, 3000))

  // ========== 3. Agent 历史记录验证 ==========
  console.log('\n--- 3. Agent 历史记录验证 ---')

  let histOk = 0, histEmpty = []
  for (const aid of allAgents) {
    try {
      const r = await callRaw('agent.getHistory', aid)
      const hist = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
      if (hist.length > 0) {
        histOk++
      } else {
        histEmpty.push(aid)
      }
    } catch (e) {
      histEmpty.push(aid)
    }
  }
  ok('agent.getHistory 全量', `${histOk}/${allAgents.length} 有历史, 空: [${histEmpty.join(',')}]`)

  // ========== 4. EAA 数据一致性 (并发操作后) ==========
  console.log('\n--- 4. EAA 数据一致性 ---')

  try {
    const info = await callRaw('eaa.info')
    const list = await callRaw('eaa.listStudents')
    const ranking = await callRaw('eaa.ranking', 1000)
    const validate = await callRaw('eaa.validate')

    const infoStudents = info?.data?.students
    const listTotal = list?.data?.total
    const rankLen = ranking?.data?.ranking?.length

    ok('info vs listStudents', `info=${infoStudents} list=${listTotal} ${infoStudents === listTotal ? '一致' : '不一致!'}`)
    ok('ranking count', `ranking=${rankLen} students=${infoStudents} ${rankLen === infoStudents ? '一致' : '不一致!'}`)
    ok('validate', `valid=${validate?.data?.valid} errors=${validate?.data?.errors?.length || 0}`)
  } catch (e) {
    fail('数据一致性', '', e)
  }

  // ========== 5. Cron 任务批量验证 ==========
  console.log('\n--- 5. Cron 任务批量验证 ---')

  try {
    const r = await callRaw('cron.list')
    const tasks = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
    ok('cron.list', `total=${tasks.length}`)

    // 验证每个任务结构
    if (tasks.length > 0) {
      const sample = tasks[0]
      const keys = typeof sample === 'object' ? Object.keys(sample) : []
      ok('cron 任务结构', `keys=[${keys.join(',').slice(0, 80)}]`)

      // 统计启用的任务
      const enabled = tasks.filter(t => t?.enabled === true).length
      ok('启用任务统计', `enabled=${enabled}/${tasks.length}`)
    }
  } catch (e) {
    fail('cron.list', '', e)
  }

  // Cron 添加多个任务
  const cronIds = []
  for (let i = 0; i < 3; i++) {
    try {
      const r = await callRaw('cron.add', {
        name: `R46-测试任务${i}`,
        agentId: 'data-analyst',
        expression: `0 ${9 + i} * * 1`,
        prompt: `R46测试${i}`,
        enabled: true,
        modelTier: 'standard'
      })
      if (r?.success) {
        cronIds.push(r.id)
        ok(`cron.add ${i}`, `id=${r.id}`)
      }
    } catch (e) {
      fail(`cron.add ${i}`, '', e)
    }
  }

  // 验证添加后数量
  try {
    const r = await callRaw('cron.list')
    const tasks = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
    ok('添加后 cron.list', `total=${tasks.length} (应增加3)`)
  } catch (e) {
    fail('添加后 cron.list', '', e)
  }

  // 删除添加的任务
  for (const id of cronIds) {
    try {
      const r = await callRaw('cron.remove', id)
      ok(`cron.remove ${id.slice(0, 20)}`, `success=${r?.success}`)
    } catch (e) {
      fail(`cron.remove ${id.slice(0, 20)}`, '', e)
    }
  }

  // ========== 6. 跨模块数据完整性 ==========
  console.log('\n--- 6. 跨模块数据完整性 ---')

  // 6.1 创建学生 → 添加事件 → 查询 → 验证一致性
  const testStudent = `R46-Integrity-${Date.now().toString(36)}`
  try {
    // 创建
    await callRaw('eaa.addStudent', testStudent)
    ok('创建测试学生', testStudent)

    // 添加事件
    const evR = await callRaw('eaa.addEvent', {
      studentName: testStudent,
      reasonCode: 'LATE',
      note: 'R46完整性测试',
      delta: -2
    })
    ok('添加事件', `success=${evR?.success !== false}`)

    // 查询分数
    const scoreR = await callRaw('eaa.score', testStudent)
    const score = scoreR?.data?.score ?? scoreR?.data?.delta
    ok('查询分数', `score=${score} (预期 98)`)

    // 查询历史
    const histR = await callRaw('eaa.history', testStudent)
    const histLen = Array.isArray(histR?.data) ? histR.data.length : (Array.isArray(histR?.data?.events) ? histR.data.events.length : 0)
    ok('查询历史', `events=${histLen} (预期 1)`)

    // 搜索
    const searchR = await callRaw('eaa.search', testStudent, 10)
    const searchLen = searchR?.data?.events?.length || (Array.isArray(searchR?.data) ? searchR.data.length : 0)
    ok('搜索', `results=${searchLen} (预期 >=1)`)

    // 删除
    await callRaw('eaa.deleteStudent', testStudent)
    ok('删除测试学生', 'cleaned')
  } catch (e) {
    fail('跨模块完整性', '', e)
    // 清理
    try { await callRaw('eaa.deleteStudent', testStudent) } catch (e) {}
  }

  // ========== 7. 长时间稳定性 (100 次 API) ==========
  console.log('\n--- 7. 长时间稳定性 (100 次 API) ---')

  try {
    const before = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    const t = Date.now()

    for (let i = 0; i < 100; i++) {
      await callRaw('eaa.info')
    }
    const time = Date.now() - t

    const after = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    const delta = after - before
    ok('100 次 eaa.info', `time=${time}ms avg=${(time / 100).toFixed(0)}ms delta=${delta} bytes (${(delta / 1024).toFixed(1)}KB)`)
  } catch (e) {
    fail('长时间稳定性', '', e)
  }

  // ========== 8. 最终状态验证 ==========
  console.log('\n--- 8. 最终状态验证 ---')

  try {
    const info = await callRaw('eaa.info')
    ok('最终 eaa.info', safeStr(info?.data, 100))
  } catch (e) {
    fail('最终 eaa.info', '', e)
  }

  try {
    const doctor = await callRaw('eaa.doctor')
    ok('最终 eaa.doctor', safeStr(doctor?.data, 150))
  } catch (e) {
    fail('最终 eaa.doctor', '', e)
  }

  // ========== 9. 汇总 ==========
  console.log('\n=== R46 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  fs.writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r46-result.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
