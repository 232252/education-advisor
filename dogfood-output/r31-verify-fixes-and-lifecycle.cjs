// R31: 验证 Bug 修复 + 真实用户场景 (班级 + 学生全生命周期)
// 1. 验证 Bug R30-1: privacy.enable 在 lock 状态下应失败
// 2. 验证 Bug R29-2: eaa.exportFormats 不应包含 'json'
// 3. 真实模拟: 创建3个班级 + 学生全生命周期 (创建→评分→查询→删除)
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 5000 }, (res) => {
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
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R31: 验证 Bug 修复 + 真实用户场景 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  // 调用 API 并返回完整 result (不自动 unwrap)
  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api: '+p.join('.')};o=o[x]}if(typeof o!=='function')return{__error:'not a function: '+p.join('.')};const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  // 调用 API 并 unwrap data
  async function callApi(path, ...args) {
    const r = await callRaw(path, ...args)
    if (r && r.__error) throw new Error(r.__error)
    if (r && r.success === false) throw new Error(String(r.data || r.error || 'failed'))
    if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data
    return r
  }

  // ========== 1. 验证 Bug R30-1: privacy.enable 在 lock 状态下应失败 ==========
  console.log('--- 1. 验证 Bug R30-1: privacy.enable 锁定状态保护 ---')
  try {
    // 先确认 privacy.status 初始状态
    const statusBefore = await callRaw('privacy.status')
    ok('privacy.status 初始', `unlocked=${statusBefore.unlocked}`)

    // 先 lock 清空密码
    await callRaw('privacy.lock')
    const statusAfterLock = await callRaw('privacy.status')
    ok('privacy.lock 后', `unlocked=${statusAfterLock.unlocked}`)

    // 此时调用 enable 应失败 (R30-1 修复)
    const enableResult = await callRaw('privacy.enable')
    if (enableResult.success === false) {
      ok('R30-1: privacy.enable 锁定状态失败', `stderr=${enableResult.stderr?.slice(0, 60)}`)
    } else if (enableResult.success === true) {
      fail('R30-1: privacy.enable 锁定状态仍成功', '修复未生效!', JSON.stringify(enableResult).slice(0, 150))
    } else {
      // 可能返回 __error 或其他
      const errMsg = enableResult.__error || enableResult.data || 'unknown'
      ok('R30-1: privacy.enable 锁定状态被阻止', `error=${String(errMsg).slice(0, 80)}`)
    }
  } catch (e) {
    fail('R30-1 验证异常', '', e)
  }

  // ========== 2. 验证 Bug R29-2: eaa.exportFormats 不应包含 'json' ==========
  console.log('\n--- 2. 验证 Bug R29-2: exportFormats 不含 json ---')
  try {
    const formats = await callApi('eaa.exportFormats')
    const fmtStr = JSON.stringify(formats)
    if (Array.isArray(formats)) {
      const hasJson = formats.includes('json')
      const hasCsv = formats.includes('csv')
      const hasJsonl = formats.includes('jsonl')
      const hasHtml = formats.includes('html')
      if (!hasJson && hasCsv && hasJsonl && hasHtml) {
        ok('R29-2: exportFormats 正确', `返回 ${formats.length} 个: ${fmtStr}`)
      } else if (hasJson) {
        fail('R29-2: exportFormats 仍含 json', `修复未生效: ${fmtStr}`)
      } else {
        ok('R29-2: exportFormats 不含 json', `格式列表: ${fmtStr}`)
      }
    } else {
      fail('R29-2: exportFormats 非数组', '', fmtStr)
    }
  } catch (e) {
    fail('R29-2 验证异常', '', e)
  }

  // ========== 3. 真实模拟: 创建3个班级 + 学生全生命周期 ==========
  console.log('\n--- 3. 真实模拟: 班级 + 学生全生命周期 ---')

  // 先获取现有班级列表
  let existingClasses
  try {
    existingClasses = await callApi('class.list')
    ok('class.list 初始', `现有 ${existingClasses.length} 个班级`)
  } catch (e) {
    existingClasses = []
    fail('class.list 初始', '', e)
  }

  // 创建3个测试班级 (API 需要 class_id + name)
  const ts = Date.now() % 10000
  const testClasses = [
    { class_id: `R31A-${ts}`, name: `R31-A班-${ts}` },
    { class_id: `R31B-${ts}`, name: `R31-B班-${ts}` },
    { class_id: `R31C-${ts}`, name: `R31-C班-${ts}` },
  ]
  const createdClassIds = []
  for (const cls of testClasses) {
    try {
      const r = await callRaw('class.create', cls)
      if (r.success && r.data) {
        createdClassIds.push(r.data.id)
        ok(`class.create ${cls.name}`, `id=${r.data.id?.slice(0, 8)} class_id=${r.data.class_id}`)
      } else {
        fail(`class.create ${cls.name}`, '', JSON.stringify(r).slice(0, 100))
      }
    } catch (e) {
      fail(`class.create ${cls.name}`, '', e)
    }
  }

  // 创建学生 (每个班级分配几个学生)
  const testStudents = []
  const studentNames = [
    `张三-R31-${Date.now() % 10000}`,
    `李四-R31-${Date.now() % 10000}`,
    `王五-R31-${Date.now() % 10000}`,
    `赵六-R31-${Date.now() % 10000}`,
    `钱七-R31-${Date.now() % 10000}`,
  ]

  for (const name of studentNames) {
    try {
      const r = await callRaw('eaa.addStudent', name)
      if (r.success) {
        testStudents.push(name)
        ok(`eaa.addStudent ${name}`, r.data ? String(r.data).slice(0, 80) : 'success')
      } else {
        fail(`eaa.addStudent ${name}`, '', r.data || r.stderr)
      }
    } catch (e) {
      fail(`eaa.addStudent ${name}`, '', e)
    }
  }

  // 给学生添加评分事件 (API: addEvent({studentName, reasonCode, note}))
  console.log('\n  --- 学生评分事件 ---')
  const reasonCodes = ['LATE', 'PHONE_IN_CLASS', 'LAB_UNSAFE_BEHAVIOR', 'CLASS_COMMITTEE_WORK', 'HOMEWORK_EXCELLENT']
  for (let i = 0; i < testStudents.length; i++) {
    const name = testStudents[i]
    const code = reasonCodes[i % reasonCodes.length]
    try {
      const r = await callRaw('eaa.addEvent', { studentName: name, reasonCode: code, note: `R31测试事件-${i}` })
      if (r.success) {
        ok(`eaa.addEvent ${name} ${code}`, r.data ? String(r.data).slice(0, 80) : 'success')
      } else {
        fail(`eaa.addEvent ${name} ${code}`, '', (r.stderr || r.data || r.__error || '').slice(0, 100))
      }
    } catch (e) {
      fail(`eaa.addEvent ${name} ${code}`, '', e)
    }
  }

  // 查询学生分数和排名
  console.log('\n  --- 查询学生分数/排名 ---')
  for (const name of testStudents) {
    try {
      const score = await callApi('eaa.score', name)
      ok(`eaa.score ${name}`, `score=${JSON.stringify(score).slice(0, 80)}`)
    } catch (e) {
      fail(`eaa.score ${name}`, '', e)
    }
  }

  // 查询排名
  try {
    const ranking = await callApi('eaa.ranking', 10)
    const rankStr = JSON.stringify(ranking).slice(0, 150)
    ok('eaa.ranking top10', rankStr)
  } catch (e) {
    fail('eaa.ranking', '', e)
  }

  // 搜索学生
  if (testStudents.length > 0) {
    try {
      const searchResult = await callApi('eaa.search', testStudents[0])
      ok(`eaa.search ${testStudents[0]}`, JSON.stringify(searchResult).slice(0, 100))
    } catch (e) {
      fail(`eaa.search ${testStudents[0]}`, '', e)
    }
  }

  // 删除学生 (生命周期结束)
  console.log('\n  --- 删除学生 (生命周期结束) ---')
  for (const name of testStudents) {
    try {
      const r = await callRaw('eaa.deleteStudent', name, 'R31测试清理')
      if (r.success) {
        ok(`eaa.deleteStudent ${name}`, 'success')
      } else {
        fail(`eaa.deleteStudent ${name}`, '', (r.stderr || r.data || '').slice(0, 100))
      }
    } catch (e) {
      fail(`eaa.deleteStudent ${name}`, '', e)
    }
  }

  // 删除测试班级
  console.log('\n  --- 清理测试班级 ---')
  for (let i = 0; i < createdClassIds.length; i++) {
    const id = createdClassIds[i]
    try {
      const r = await callRaw('class.delete', id)
      if (r.success) {
        ok(`class.delete ${testClasses[i].name}`, 'success')
      } else {
        fail(`class.delete ${testClasses[i].name}`, '', JSON.stringify(r).slice(0, 100))
      }
    } catch (e) {
      fail(`class.delete ${testClasses[i].name}`, '', e)
    }
  }

  // ========== 4. eaa.info 健康检查 ==========
  console.log('\n--- 4. eaa.info 健康检查 ---')
  try {
    const info = await callApi('eaa.info')
    ok('eaa.info', JSON.stringify(info).slice(0, 120))
  } catch (e) {
    fail('eaa.info', '', e)
  }

  // ========== 5. eaa.codes reason code 验证 ==========
  console.log('\n--- 5. eaa.codes reason code 验证 ---')
  try {
    const codes = await callApi('eaa.codes')
    if (codes && typeof codes === 'object') {
      const codeCount = codes.codes ? Object.keys(codes.codes).length : (Array.isArray(codes) ? codes.length : Object.keys(codes).length)
      ok('eaa.codes', `共 ${codeCount} 个 reason code`)
    } else {
      ok('eaa.codes', JSON.stringify(codes).slice(0, 100))
    }
  } catch (e) {
    fail('eaa.codes', '', e)
  }

  // ========== 6. eaa.stats 统计 ==========
  console.log('\n--- 6. eaa.stats 统计 ---')
  try {
    const stats = await callApi('eaa.stats')
    ok('eaa.stats', JSON.stringify(stats).slice(0, 150))
  } catch (e) {
    fail('eaa.stats', '', e)
  }

  // ========== 7. eaa.dashboard 生成 ==========
  console.log('\n--- 7. eaa.dashboard ---')
  try {
    const r = await callRaw('eaa.dashboard')
    if (r.success) {
      ok('eaa.dashboard', r.data ? String(r.data).slice(0, 80) : 'success')
    } else {
      fail('eaa.dashboard', '', (r.stderr || r.data || '').slice(0, 100))
    }
  } catch (e) {
    fail('eaa.dashboard', '', e)
  }

  // ========== 8. agent.list + agent.toggle 验证 ==========
  console.log('\n--- 8. Agent 列表 + 切换 ---')
  try {
    const agents = await callApi('agent.list')
    if (Array.isArray(agents)) {
      ok('agent.list', `共 ${agents.length} 个 agent`)

      // 测试切换第一个 agent
      if (agents.length > 0) {
        const firstAgent = agents[0]
        const originalEnabled = firstAgent.enabled
        const toggleResult = await callRaw('agent.toggle', firstAgent.id, !originalEnabled)
        if (toggleResult.success) {
          ok(`agent.toggle ${firstAgent.id}`, `${originalEnabled} → ${!originalEnabled}`)
          // 切换回来
          await callRaw('agent.toggle', firstAgent.id, originalEnabled)
          ok(`agent.toggle ${firstAgent.id} 恢复`, `${!originalEnabled} → ${originalEnabled}`)
        } else {
          fail(`agent.toggle ${firstAgent.id}`, '', JSON.stringify(toggleResult).slice(0, 100))
        }
      }
    } else {
      fail('agent.list', '非数组', JSON.stringify(agents).slice(0, 100))
    }
  } catch (e) {
    fail('agent', '', e)
  }

  // ========== 9. cron.list 验证 ==========
  console.log('\n--- 9. Cron 定时任务 ---')
  try {
    const crons = await callApi('cron.list')
    ok('cron.list', `共 ${Array.isArray(crons) ? crons.length : '?'} 个任务`)
  } catch (e) {
    fail('cron.list', '', e)
  }

  // ========== 10. Settings.get 验证 ==========
  console.log('\n--- 10. Settings 7 段结构验证 ---')
  try {
    const settings = await callApi('settings.get')
    const sections = ['general', 'models', 'chat', 'privacy', 'feishu', 'advanced', 'shortcuts']
    let foundSections = 0
    for (const sec of sections) {
      if (settings && typeof settings === 'object' && sec in settings) foundSections++
    }
    if (foundSections === 7) {
      ok('settings.get 7段', `全部存在: ${sections.join(', ')}`)
    } else {
      fail('settings.get 7段', `仅 ${foundSections}/7 段`, JSON.stringify(Object.keys(settings || {})).slice(0, 100))
    }
  } catch (e) {
    fail('settings.get', '', e)
  }

  // ========== 总结 ==========
  console.log('\n=== R31 总结 ===')
  console.log(`Pass: ${results.pass} / Fail: ${results.fail}`)
  console.log(`Total: ${results.pass + results.fail}`)

  // 保存结果
  const reportPath = path.join(__dirname, 'r31-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n结果已保存: ${reportPath}`)

  await cdp.close()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
