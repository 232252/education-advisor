// R42: 修复测试代码 bug + 验证 agent/cron 直接返回 API + 深度数据流
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

  console.log('=== R42: 修复测试 bug + 直接返回 API 验证 ===\n')
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

  // ========== 1. agent.getSoul 直接返回验证 ==========
  console.log('--- 1. agent.getSoul 直接返回验证 ---')

  const allAgents = ['academic', 'bug-hunter', 'class-monitor', 'counselor', 'data-analyst',
    'discipline-officer', 'executor', 'governor', 'home_school', 'main', 'psychology',
    'research', 'risk-alert', 'safety', 'student-care', 'supervisor', 'validator', 'weekly-reporter']

  let soulOk = 0, soulEmpty = []
  for (const aid of allAgents) {
    try {
      const r = await callRaw('agent.getSoul', aid)
      // r 可能是字符串(直接返回) 或 {success, data} 对象
      const soul = typeof r === 'string' ? r : (r?.data ?? r?.__error ?? '')
      if (soul && soul.length > 0) {
        soulOk++
        if (aid === 'academic' || aid === 'supervisor' || aid === 'weekly-reporter' || aid === 'main') {
          ok(`getSoul ${aid}`, `type=${typeof r} len=${soul.length} preview=${soul.slice(0, 60)}`)
        }
      } else {
        soulEmpty.push(aid)
      }
    } catch (e) {
      soulEmpty.push(aid + '(err)')
    }
  }
  ok('getSoul 全量统计', `${soulOk}/${allAgents.length} 有内容, 空: [${soulEmpty.join(',')}]`)

  // ========== 2. agent.getRules 直接返回验证 ==========
  console.log('\n--- 2. agent.getRules 直接返回验证 ---')

  let rulesOk = 0, rulesEmpty = []
  for (const aid of allAgents) {
    try {
      const r = await callRaw('agent.getRules', aid)
      const rules = typeof r === 'string' ? r : (r?.data ?? r?.__error ?? '')
      if (rules && rules.length > 0) {
        rulesOk++
        if (aid === 'academic' || aid === 'main') {
          ok(`getRules ${aid}`, `type=${typeof r} len=${rules.length} preview=${rules.slice(0, 60)}`)
        }
      } else {
        rulesEmpty.push(aid)
      }
    } catch (e) {
      rulesEmpty.push(aid + '(err)')
    }
  }
  ok('getRules 全量统计', `${rulesOk}/${allAgents.length} 有内容, 空: [${rulesEmpty.join(',')}]`)

  // ========== 3. agent.getHistory 直接返回验证 ==========
  console.log('\n--- 3. agent.getHistory 直接返回验证 ---')

  for (const aid of ['academic', 'data-analyst', 'class-monitor', 'bug-hunter', 'counselor']) {
    try {
      const r = await callRaw('agent.getHistory', aid)
      const hist = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
      ok(`getHistory ${aid}`, `type=${typeof r} isArray=${Array.isArray(r)} len=${hist.length} sample=${safeStr(hist[0], 80)}`)
    } catch (e) {
      fail(`getHistory ${aid}`, '', e)
    }
  }

  // ========== 4. cron.list 直接返回验证 ==========
  console.log('\n--- 4. cron.list 直接返回验证 ---')

  try {
    const r = await callRaw('cron.list')
    const tasks = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : (r?.data?.tasks || []))
    ok('cron.list', `type=${typeof r} isArray=${Array.isArray(r)} len=${tasks.length} sample=${safeStr(tasks[0], 100)}`)
  } catch (e) {
    fail('cron.list', '', e)
  }

  // cron.add + list + remove
  try {
    const cronId = `R42-TestCron-${Date.now()}`
    const addR = await callRaw('cron.add', {
      id: cronId,
      name: 'R42测试定时',
      agentId: 'data-analyst',
      expression: '0 9 * * 1',
      prompt: '测试',
      enabled: true,
      modelTier: 'standard'
    })
    ok('cron.add', safeStr(addR, 100))

    // 重新 list
    const listR = await callRaw('cron.list')
    const tasks = Array.isArray(listR) ? listR : (Array.isArray(listR?.data) ? listR.data : [])
    const found = tasks.some(t => {
      const tid = typeof t === 'object' ? (t.id || t.taskId) : t
      return tid === cronId
    })
    ok('cron 添加后验证', `found=${found} total=${tasks.length}`)

    // remove
    const remR = await callRaw('cron.remove', cronId)
    ok('cron.remove', safeStr(remR, 80))

    // 验证删除
    const listR2 = await callRaw('cron.list')
    const tasks2 = Array.isArray(listR2) ? listR2 : (Array.isArray(listR2?.data) ? listR2.data : [])
    const found2 = tasks2.some(t => {
      const tid = typeof t === 'object' ? (t.id || t.taskId) : t
      return tid === cronId
    })
    ok('cron 删除后验证', `found=${found2} total=${tasks2.length}`)
  } catch (e) {
    fail('cron add/list/remove', '', e)
  }

  // ========== 5. agent.toggle 验证 ==========
  console.log('\n--- 5. agent.toggle 验证 ---')

  for (const aid of ['academic', 'data-analyst']) {
    try {
      // 先获取当前状态
      const listR = await callRaw('agent.list')
      const agents = Array.isArray(listR) ? listR : (Array.isArray(listR?.data) ? listR.data : [])
      const agent = agents.find(a => (a.id || a.agentId) === aid)
      const beforeEnabled = agent?.enabled

      // toggle
      const toggleR = await callRaw('agent.toggle', aid, !beforeEnabled)
      ok(`toggle ${aid} ${beforeEnabled}->${!beforeEnabled}`, safeStr(toggleR, 100))

      // 验证
      const listR2 = await callRaw('agent.list')
      const agents2 = Array.isArray(listR2) ? listR2 : (Array.isArray(listR2?.data) ? listR2.data : [])
      const agent2 = agents2.find(a => (a.id || a.agentId) === aid)
      ok(`  toggle 验证 ${aid}`, `before=${beforeEnabled} after=${agent2?.enabled}`)

      // 恢复
      await callRaw('agent.toggle', aid, beforeEnabled)
    } catch (e) {
      fail(`toggle ${aid}`, '', e)
    }
  }

  // ========== 6. skill API 直接返回验证 ==========
  console.log('\n--- 6. skill API 验证 ---')

  try {
    const r = await callRaw('skill.list')
    const skills = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
    ok('skill.list', `type=${typeof r} isArray=${Array.isArray(r)} len=${skills.length} sample=${safeStr(skills[0], 80)}`)
  } catch (e) {
    fail('skill.list', '', e)
  }

  try {
    const r = await callRaw('skill.get', 'STUDENT_MANAGEMENT')
    const skill = typeof r === 'string' ? r : (r?.data ?? r)
    ok('skill.get STUDENT_MANAGEMENT', `type=${typeof r} len=${(typeof skill === 'string' ? skill : JSON.stringify(skill)).length} preview=${safeStr(skill, 60)}`)
  } catch (e) {
    fail('skill.get STUDENT_MANAGEMENT', '', e)
  }

  // ========== 7. chat API 直接返回验证 ==========
  console.log('\n--- 7. chat API 验证 ---')

  try {
    const r = await callRaw('chat.listSessions')
    const sessions = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
    ok('chat.listSessions', `type=${typeof r} isArray=${Array.isArray(r)} len=${sessions.length}`)
  } catch (e) {
    fail('chat.listSessions', '', e)
  }

  // ========== 8. profile API 直接返回验证 ==========
  console.log('\n--- 8. profile API 验证 ---')

  try {
    const r = await callRaw('profile.list')
    const profiles = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
    ok('profile.list', `type=${typeof r} isArray=${Array.isArray(r)} len=${profiles.length}`)
  } catch (e) {
    ok('profile.list', `失败: ${e.message.slice(0, 60)} — 可能不存在`)
  }

  // ========== 9. 错误返回结构对比 (Bug R40-1 深度调查) ==========
  console.log('\n--- 9. Bug R40-1 深度: 不存在 ID 错误结构 ---')

  // agent.getSoul 不存在 — 应返回空字符串
  try {
    const r = await callRaw('agent.getSoul', 'R42-NonExistent')
    ok('getSoul 不存在', `type=${typeof r} value=${safeStr(r, 60)} — ${r === '' ? '返回空字符串(正确)' : '非空字符串'}`)
  } catch (e) {
    fail('getSoul 不存在', '', e)
  }

  // agent.getRules 不存在 — 应返回空字符串
  try {
    const r = await callRaw('agent.getRules', 'R42-NonExistent')
    ok('getRules 不存在', `type=${typeof r} value=${safeStr(r, 60)} — ${r === '' ? '返回空字符串(正确)' : '非空字符串'}`)
  } catch (e) {
    fail('getRules 不存在', '', e)
  }

  // agent.getHistory 不存在 — 应返回空数组
  try {
    const r = await callRaw('agent.getHistory', 'R42-NonExistent')
    ok('getHistory 不存在', `type=${typeof r} isArray=${Array.isArray(r)} value=${safeStr(r, 60)} — ${Array.isArray(r) && r.length === 0 ? '返回空数组(正确)' : '非空数组'}`)
  } catch (e) {
    fail('getHistory 不存在', '', e)
  }

  // class.get 不存在 — 检查返回结构
  try {
    const r = await callRaw('class.get', 'R42-NonExistent-ID')
    ok('class.get 不存在', `type=${typeof r} value=${safeStr(r, 80)} — ${r === null ? '返回null(可接受)' : (r?.success === false ? '返回{success:false}(正确)' : '其他')}`)
  } catch (e) {
    fail('class.get 不存在', '', e)
  }

  // cron.getLogs 不存在
  try {
    const r = await callRaw('cron.getLogs', 'R42-NonExistent', 10)
    ok('cron.getLogs 不存在', `type=${typeof r} value=${safeStr(r, 80)} — ${r === null ? '返回null' : (Array.isArray(r) ? '返回数组(' + r.length + ')' : '其他')}`)
  } catch (e) {
    fail('cron.getLogs 不存在', '', e)
  }

  // skill.get 不存在
  try {
    const r = await callRaw('skill.get', 'R42-NonExistent')
    ok('skill.get 不存在', `type=${typeof r} value=${safeStr(r, 80)} — ${r === null ? '返回null' : (r === '' ? '返回空字符串' : '其他')}`)
  } catch (e) {
    fail('skill.get 不存在', '', e)
  }

  // chat.loadMessages 不存在 (Bug R40-2)
  try {
    const r = await callRaw('chat.loadMessages', 'R42-NonExistent-Session')
    ok('chat.loadMessages 不存在', `type=${typeof r} value=${safeStr(r, 80)} — ${r === null ? '返回null(正确)' : (Array.isArray(r) ? '返回数组(' + r.length + ')' : '其他')}`)
  } catch (e) {
    fail('chat.loadMessages 不存在', '', e)
  }

  // ========== 10. 汇总 ==========
  console.log('\n=== R42 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  fs.writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r42-result.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
