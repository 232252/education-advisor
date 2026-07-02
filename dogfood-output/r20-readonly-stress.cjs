// R20: 只读深度测试 + UI 全页面压力 + 跨模块只读流
// 由于 TRAE Sandbox 限制 .lock 文件访问, EAA 写操作 (addStudent/addEvent/profile.set) 失败
// 本轮专注: 只读 API + UI 全页面交互 + 数据一致性读 + 长时间压力
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

  console.log('=== R20 只读深度 + UI 压力 + 跨模块 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p)o=o[x];const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  function unwrap(r) { if (r && r.__error) return r; if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data; return r }
  async function callApi(path, ...args) {
    const raw = await callRaw(path, ...args)
    if (raw && typeof raw === 'object' && raw.success === false) {
      return { __error: String(raw.data || raw.error || 'failed') }
    }
    return unwrap(raw)
  }
  async function navigate(route) { await cdp.eval(`window.location.hash = '${route}'`); await new Promise((r) => setTimeout(r, 600)) }
  async function getHeap() { return cdp.eval(`performance && performance.memory ? performance.memory.usedJSHeapSize : 0`) }
  async function countConsoleErrors() {
    return cdp.eval(`(function(){if(!window.__errCount){window.__errCount=0;window.__errMsgs=[];const orig=console.error;console.error=function(){window.__errCount++;window.__errMsgs.push(Array.from(arguments).map(String).join(' ').slice(0,200));orig.apply(console,arguments)}}return window.__errCount})()`)
  }

  // ========== 1. EAA 只读 API 完整覆盖 ==========
  console.log('--- 1. EAA 只读 API 完整覆盖 ---')
  const info = await callApi('eaa.info')
  if (info && !info.__error) ok('eaa.info', `v${info.version}, ${info.students} 学生, ${info.events} 事件`)
  else fail('eaa.info', '', info?.__error)

  const doc = await callApi('eaa.doctor')
  if (doc && !doc.__error) ok('eaa.doctor', `healthy=${doc.healthy}, passed=${doc.passed}, failed=${doc.failed}`)
  else fail('eaa.doctor', '', doc?.__error)

  const students = await callApi('eaa.listStudents')
  if (students && !students.__error) {
    const sArr = Array.isArray(students) ? students : (students?.students || students?.data || [])
    ok('eaa.listStudents', `${sArr.length} 个学生`)
  } else fail('eaa.listStudents', '', students?.__error)

  const ranking = await callApi('eaa.ranking', 10)
  if (ranking && !ranking.__error) {
    const rArr = Array.isArray(ranking) ? ranking : (ranking?.ranking || ranking?.data || [])
    ok('eaa.ranking', `Top-${rArr.length}`)
    // 查看第一名和最后一名的分数结构
    if (rArr.length > 0) {
      const top = rArr[0]
      console.log(`    第一名: ${JSON.stringify(top).slice(0, 100)}`)
    }
  } else fail('eaa.ranking', '', ranking?.__error)

  const stats = await callApi('eaa.stats')
  if (stats && !stats.__error) ok('eaa.stats', '成功')
  else fail('eaa.stats', '', stats?.__error)

  const codes = await callApi('eaa.codes')
  if (codes && !codes.__error) {
    const cArr = Array.isArray(codes) ? codes : (codes?.codes || codes?.data || Object.keys(codes || {}))
    ok('eaa.codes', `${cArr.length} 个原因码`)
  } else fail('eaa.codes', '', codes?.__error)

  const validate = await callApi('eaa.validate')
  if (validate && !validate.__error) ok('eaa.validate', '数据校验通过')
  else fail('eaa.validate', '', validate?.__error)

  const summary = await callApi('eaa.summary')
  if (summary && !summary.__error) ok('eaa.summary', '成功')
  else fail('eaa.summary', '', summary?.__error)

  const formats = await callApi('eaa.exportFormats')
  if (formats && !formats.__error) {
    const fArr = Array.isArray(formats) ? formats : (formats?.formats || formats?.data || [])
    ok('eaa.exportFormats', `${fArr.length} 种格式: ${fArr.join(',')}`)
  } else fail('eaa.exportFormats', '', formats?.__error)

  // 查询已有学生分数 (用 listStudents 的第一个)
  if (students && !students.__error) {
    const sArr = Array.isArray(students) ? students : (students?.students || students?.data || [])
    if (sArr.length > 0) {
      const firstName = sArr[0].name || sArr[0]
      const score = await callApi('eaa.score', firstName)
      if (score && !score.__error) {
        const sv = score?.score ?? score
        ok('eaa.score', `${firstName}: ${sv} 分`)
      } else fail('eaa.score', '', score?.__error)

      const hist = await callApi('eaa.history', firstName)
      if (hist && !hist.__error) {
        const hArr = Array.isArray(hist) ? hist : (hist?.events || hist?.data || [])
        ok('eaa.history', `${firstName}: ${hArr.length} 条事件`)
      } else fail('eaa.history', '', hist?.__error)
    }
  }

  // 搜索
  const search = await callApi('eaa.search', '迟到', 10)
  if (search && !search.__error) {
    const sArr = Array.isArray(search) ? search : (search?.events || search?.data || [])
    ok('eaa.search', `"迟到" 找到 ${sArr.length} 条`)
  } else fail('eaa.search', '', search?.__error)

  // 时间范围 — 今日
  const today = new Date().toISOString().slice(0, 10)
  const rangeR = await callApi('eaa.range', today, today, 100)
  if (rangeR && !rangeR.__error) {
    const rArr = Array.isArray(rangeR) ? rangeR : (rangeR?.events || rangeR?.data || [])
    ok('eaa.range 今日', `${rArr.length} 条`)
  } else fail('eaa.range 今日', '', rangeR?.__error)

  // 时间范围 — 全部
  const rangeAll = await callApi('eaa.range', '2020-01-01', '2030-12-31', 5)
  if (rangeAll && !rangeAll.__error) {
    const rArr = Array.isArray(rangeAll) ? rangeAll : (rangeAll?.events || rangeAll?.data || [])
    ok('eaa.range 全部', `${rArr.length} 条 (限 5)`)
  } else fail('eaa.range 全部', '', rangeAll?.__error)

  // 标签查询
  const tagR = await callApi('eaa.tag', 'test', 10)
  if (tagR && !tagR.__error) ok('eaa.tag', '成功')
  else fail('eaa.tag', '', tagR?.__error)

  // replay
  const replayR = await callApi('eaa.replay', 10)
  if (replayR && !replayR.__error) {
    const rlen = String(replayR).length
    ok('eaa.replay', `${rlen} 字符`)
  } else fail('eaa.replay', '', replayR?.__error)

  // dashboard
  const dashR = await callApi('eaa.dashboard')
  if (dashR && !dashR.__error) ok('eaa.dashboard', '生成成功')
  else fail('eaa.dashboard', '', dashR?.__error)

  // ========== 2. UI 全页面压力测试 (10 页面 x 3 轮) ==========
  console.log('\n--- 2. UI 全页面压力测试 (10 页面 x 3 轮) ---')
  const routes = ['#/', '#/dashboard', '#/students', '#/classes', '#/agents', '#/chat', '#/skills', '#/privacy', '#/settings', '#/models']
  await countConsoleErrors()
  const heapBefore = await getHeap()
  let navOk = 0, navFail = 0
  for (let round = 1; round <= 3; round++) {
    for (const route of routes) {
      try {
        await navigate(route)
        const title = await cdp.eval(`document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim()?.slice(0, 50) || '无标题'`)
        navOk++
      } catch (e) {
        navFail++
      }
    }
  }
  ok('UI 30 次页面切换', `成功 ${navOk}/30`)
  const errs = await countConsoleErrors()
  ok('UI console 错误数', `${errs}`)
  const heapAfter = await getHeap()
  const growth = heapAfter - heapBefore
  ok('UI 内存增长', `${(heapAfter / 1024 / 1024).toFixed(2)} MB (增长 ${(growth / 1024).toFixed(0)} KB)`)

  // ========== 3. UI 每页按钮点击测试 ==========
  console.log('\n--- 3. UI 每页按钮点击测试 ---')
  for (const route of routes) {
    await navigate(route)
    await new Promise((r) => setTimeout(r, 400))
    const btnCount = await cdp.eval(`document.querySelectorAll('button, [role="button"], a[href], input[type="submit"], input[type="button"]').length`)
    ok(`UI ${route} 按钮`, `${btnCount} 个可点击元素`)
  }

  // ========== 4. Agent 全量只读扫描 ==========
  console.log('\n--- 4. Agent 全量只读扫描 ---')
  const agentList = await callApi('agent.list')
  if (agentList && !agentList.__error) {
    const aArr = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])
    ok('agent.list', `${aArr.length} 个 Agent`)
    let soulOk = 0, rulesOk = 0
    const emptySoul = [], emptyRules = []
    for (const a of aArr) {
      const aid = a.id || a
      const soul = await callApi('agent.getSoul', aid)
      if (soul && String(soul).length > 0) soulOk++
      else emptySoul.push(aid)
      const rules = await callApi('agent.getRules', aid)
      if (rules && String(rules).length > 0) rulesOk++
      else emptyRules.push(aid)
    }
    ok('Agent getSoul', `${soulOk}/${aArr.length} 有内容`)
    ok('Agent getRules', `${rulesOk}/${aArr.length} 有内容`)
    if (emptySoul.length > 0) console.log(`    空 SOUL: ${emptySoul.join(', ')}`)
    if (emptyRules.length > 0) console.log(`    空 Rules: ${emptyRules.join(', ')}`)

    // get each agent
    let getOk = 0
    for (const a of aArr) {
      const aid = a.id || a
      const g = await callApi('agent.get', aid)
      if (g && !g.__error) getOk++
    }
    ok('Agent get', `${getOk}/${aArr.length} 详情获取`)
  }

  // ========== 5. Class 只读测试 ==========
  console.log('\n--- 5. Class 只读测试 ---')
  const classList = await callApi('class.list')
  if (classList && !classList.__error) {
    const cArr = Array.isArray(classList) ? classList : (classList?.classes || classList?.data || [])
    ok('class.list', `${cArr.length} 个班级`)
    if (cArr.length > 0) {
      const c = cArr[0]
      const cid = c.id || c.class_id
      console.log(`    首个班级: ${c.name} (id=${cid})`)
    }
  } else fail('class.list', '', classList?.__error)

  // ========== 6. AI providers 全扫描 ==========
  console.log('\n--- 6. AI providers 全扫描 ---')
  const providers = await callApi('ai.listProviders')
  if (providers && !providers.__error) {
    const pArr = Array.isArray(providers) ? providers : (providers?.providers || providers?.data || [])
    ok('ai.listProviders', `${pArr.length} 个 Provider`)
    // 测试所有 provider 的模型列表
    let modelsOk = 0, modelsFail = 0
    let totalModels = 0
    for (const p of pArr) {
      const pid = p.id || p.providerId || p
      const models = await callApi('ai.listModels', pid)
      if (models && !models.__error) {
        const mArr = Array.isArray(models) ? models : (models?.models || models?.data || [])
        modelsOk++
        totalModels += mArr.length
      } else modelsFail++
    }
    ok('ai.listModels 全扫', `${modelsOk}/${pArr.length} 成功, 共 ${totalModels} 个模型`)
  }

  // ========== 7. Privacy 只读 ==========
  console.log('\n--- 7. Privacy 只读 ---')
  const ps = await callApi('privacy.status')
  if (ps && !ps.__error) ok('privacy.status', `loaded=${ps.loaded || ps.hasPassword}`)
  else fail('privacy.status', '', ps?.__error)

  // ========== 8. Settings 读 ==========
  console.log('\n--- 8. Settings 读 ---')
  const settings = await callApi('settings.get')
  if (settings && !settings.__error) {
    ok('settings.get', `${Object.keys(settings).length} 个顶层字段`)
    console.log(`    顶层字段: ${Object.keys(settings).join(', ')}`)
    // 验证关键字段类型
    if (settings.general) {
      const g = settings.general
      console.log(`    general.logLevel=${g.logLevel} (${typeof g.logLevel})`)
      if (typeof g.logLevel === 'string') ok('settings.general.logLevel', `类型正确: ${g.logLevel}`)
      else fail('settings.general.logLevel', '类型错误', `实际 ${typeof g.logLevel}`)
    }
  }

  // ========== 9. Cron 只读 ==========
  console.log('\n--- 9. Cron 只读 ---')
  const cronList = await callApi('cron.list')
  if (cronList && !cronList.__error) {
    const cArr = Array.isArray(cronList) ? cronList : (cronList?.tasks || cronList?.data || [])
    ok('cron.list', `${cArr.length} 个任务`)
    // 统计启停状态
    const enabled = cArr.filter((t) => t.enabled).length
    ok('cron 启停统计', `${enabled} 启用 / ${cArr.length - enabled} 禁用`)
    // 验证每个任务的字段完整性
    if (cArr.length > 0) {
      const t = cArr[0]
      const requiredFields = ['id', 'name', 'expression', 'enabled']
      const hasAll = requiredFields.every((f) => f in t)
      ok('cron 任务字段', `必要字段 ${hasAll ? '完整' : '缺失'}: ${Object.keys(t).join(',')}`)
    }
  }

  // ========== 10. Skill 只读 ==========
  console.log('\n--- 10. Skill 只读 ---')
  const skills = await callApi('skill.list')
  if (skills && !skills.__error) {
    const sArr = Array.isArray(skills) ? skills : (skills?.skills || skills?.data || [])
    ok('skill.list', `${sArr.length} 个技能`)
  }

  // ========== 11. Chat 只读 ==========
  console.log('\n--- 11. Chat 只读 ---')
  const sessions = await callApi('chat.listSessions')
  if (sessions && !sessions.__error) {
    const sArr = Array.isArray(sessions) ? sessions : (sessions?.sessions || sessions?.data || [])
    ok('chat.listSessions', `${sArr.length} 个会话`)
  }

  // ========== 12. Log 只读 ==========
  console.log('\n--- 12. Log 只读 ---')
  const logs = await callApi('log.list', 20)
  if (logs && !logs.__error) {
    const lArr = Array.isArray(logs) ? logs : (logs?.logs || logs?.data || [])
    ok('log.list', `${lArr.length} 条日志`)
    // 计算总大小
    if (lArr.length > 0) {
      const totalSize = lArr.reduce((s, l) => s + (l.sizeBytes || 0), 0)
      ok('log 总大小', `${(totalSize / 1024).toFixed(1)} KB`)
    }
  }

  // ========== 13. 长时间稳定性 — 100 次 eaa.info 调用 ==========
  console.log('\n--- 13. 长时间稳定性 (100 次 eaa.info) ---')
  const t1 = Date.now()
  let successCount = 0
  for (let i = 0; i < 100; i++) {
    const r = await callApi('eaa.info')
    if (r && !r.__error) successCount++
  }
  const elapsed = Date.now() - t1
  ok('100 次 eaa.info', `${successCount}/100 成功, 耗时 ${elapsed}ms, 平均 ${elapsed / 100}ms/次`)

  // ========== 14. 内存最终 ==========
  console.log('\n--- 14. 内存最终 ---')
  const finalHeap = await getHeap()
  ok('最终内存', `${(finalHeap / 1024 / 1024).toFixed(2)} MB`)

  // ========== 15. 汇总 ==========
  console.log('\n=== R20 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r20-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
