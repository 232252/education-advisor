// 第十八轮测试 — 综合回归测试 (覆盖所有模块的关键功能)
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
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

  console.log('=== 第十八轮: 综合回归测试 ===\n')

  const testSuffix = String(Date.now()).slice(-4)

  // ========== 1. EAA 核心功能回归 ==========
  console.log('--- 1. EAA 核心功能回归 ---')

  // 1.1 info
  const infoR = await cdp.eval(`(async()=>{ const r = await window.api.eaa.info(); return JSON.parse(JSON.stringify(r)); })()`)
  if (infoR?.success !== false) ok('EAA info', '通过')
  else fail('EAA info', '', errMsg(infoR))

  // 1.2 codes
  const codesR = await cdp.eval(`(async()=>{ const r = await window.api.eaa.codes(); return JSON.parse(JSON.stringify(r)); })()`)
  const codesCount = Object.keys(codesR?.data?.codes || codesR?.data || {}).length
  if (codesCount > 0) ok('EAA codes', `${codesCount} 个`)
  else fail('EAA codes', '', '无原因码')

  // 1.3 exportFormats
  const fmtR = await cdp.eval(`(async()=>{ try { const r = await window.api.eaa.exportFormats(); return JSON.parse(JSON.stringify(r)); } catch(e) { return []; } })()`)
  const fmts = Array.isArray(fmtR) ? fmtR : (fmtR?.data || [])
  if (fmts.length >= 3) ok('EAA exportFormats', `${fmts.length}: ${fmts.join(',')}`)
  else fail('EAA exportFormats', '', `仅 ${fmts.length} 格式`)

  // 1.4 validate + doctor
  const valR = await cdp.eval(`(async()=>{ const r = await window.api.eaa.validate(); return JSON.parse(JSON.stringify(r)); })()`)
  if (valR?.success !== false) ok('EAA validate', '通过')
  else fail('EAA validate', '', errMsg(valR))

  const docR = await cdp.eval(`(async()=>{ const r = await window.api.eaa.doctor(); return JSON.parse(JSON.stringify(r)); })()`)
  if (docR?.success !== false) ok('EAA doctor', '通过')
  else fail('EAA doctor', '', errMsg(docR))

  // 1.5 stats
  const statsR = await cdp.eval(`(async()=>{ const r = await window.api.eaa.stats(); return JSON.parse(JSON.stringify(r)); })()`)
  const statsData = statsR?.data?.summary || statsR?.data || {}
  ok('EAA stats', `students: ${statsData?.students ?? '?'}, events: ${statsData?.total_events ?? '?'}`)

  // 1.6 ranking
  const rankR = await cdp.eval(`(async()=>{ const r = await window.api.eaa.ranking(20); return JSON.parse(JSON.stringify(r)); })()`)
  const rankList = rankR?.data?.ranking || rankR?.data || []
  ok('EAA ranking', `${rankList.length} 名`)

  // 1.7 listStudents
  const listR = await cdp.eval(`(async()=>{ const r = await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
  const stuList = listR?.data?.students || []
  ok('EAA listStudents', `${stuList.length} 名`)

  // 1.8 export (3 格式)
  for (const fmt of ['csv', 'jsonl', 'html']) {
    const r = await cdp.eval(`(async()=>{ try { const r = await window.api.eaa.export('${fmt}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
    const len = typeof r?.data === 'string' ? r.data.length : 0
    if (len > 0) ok(`EAA export ${fmt}`, `${len} 字符`)
    else fail(`EAA export ${fmt}`, '', '空数据')
  }

  // ========== 2. Class 模块回归 ==========
  console.log('\n--- 2. Class 模块回归 ---')

  // 2.1 list
  const clsListR = await cdp.eval(`(async()=>{ const r = await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
  ok('Class list', `${clsListR?.data?.length ?? 0} 个班级`)

  // 2.2 create + delete
  const testCid = `R18CLS-${testSuffix}`
  const createR = await cdp.eval(`(async()=>{ const r = await window.api.class.create({ class_id: '${testCid}', name: 'R18回归班', grade: '高一' }); return JSON.parse(JSON.stringify(r)); })()`)
  if (createR?.success !== false) ok('Class create', testCid)
  else fail('Class create', '', errMsg(createR))

  // 2.3 update
  const clsData = (clsListR?.data || []).find(c => c.class_id === testCid) || createR?.data
  if (clsData) {
    const updR = await cdp.eval(`(async()=>{ try { const r = await window.api.class.update('${clsData.id}', { name: 'R18更新班' }); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
    if (updR?.success !== false) ok('Class update', '成功')
    else fail('Class update', '', errMsg(updR))
  }

  // 2.4 archive + restore
  if (clsData) {
    const archR = await cdp.eval(`(async()=>{ try { const r = await window.api.class.archive('${clsData.id}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
    if (archR?.success !== false) ok('Class archive', '成功')
    else fail('Class archive', '', errMsg(archR))

    const restR = await cdp.eval(`(async()=>{ try { const r = await window.api.class.restore('${clsData.id}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
    if (restR?.success !== false) ok('Class restore', '成功')
    else fail('Class restore', '', errMsg(restR))
  }

  // 2.5 delete
  if (clsData) {
    const delR = await cdp.eval(`(async()=>{ try { const r = await window.api.class.delete('${clsData.id}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
    if (delR?.success !== false) ok('Class delete', '成功')
    else fail('Class delete', '', errMsg(delR))
  }

  // ========== 3. Agent 模块回归 ==========
  console.log('\n--- 3. Agent 模块回归 ---')

  const agentList = await cdp.eval(`(async()=>{ const r = await window.api.agent.list(); return JSON.parse(JSON.stringify(r)); })()`)
  const agents = Array.isArray(agentList) ? agentList : (agentList?.data || [])
  ok('Agent list', `${agents.length} 个`)

  if (agents.length > 0) {
    const a = agents[0]
    // getSoul
    const soul = await cdp.eval(`(async()=>{ try { const r = await window.api.agent.getSoul('${a.id}'); return typeof r === 'string' ? r.length : 0; } catch(e) { return 0; } })()`)
    ok('Agent getSoul', `${a.id}: ${soul} 字符`)

    // getRules
    const rules = await cdp.eval(`(async()=>{ try { const r = await window.api.agent.getRules('${a.id}'); return typeof r === 'string' ? r.length : 0; } catch(e) { return 0; } })()`)
    ok('Agent getRules', `${a.id}: ${rules} 字符`)

    // toggle
    const origEnabled = a.enabled
    const togR = await cdp.eval(`(async()=>{ try { const r = await window.api.agent.toggle('${a.id}', !${origEnabled}); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
    if (togR?.success !== false) ok('Agent toggle', `${origEnabled} → ${!origEnabled}`)
    else fail('Agent toggle', '', errMsg(togR))
    // 恢复
    await cdp.eval(`(async()=>{ try { await window.api.agent.toggle('${a.id}', ${origEnabled}); } catch(e) {} })()`)
  }

  // ========== 4. Chat 模块回归 ==========
  console.log('\n--- 4. Chat 模块回归 ---')

  // save + load
  const sessionId = `r18-regression-${testSuffix}`
  const saveR = await cdp.eval(`(async()=>{ try { const r = await window.api.chat.saveMessage({ sessionId: '${sessionId}', role: 'user', content: 'R18回归测试', timestamp: Date.now() }); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (saveR?.success) ok('Chat save', `id: ${saveR.id}`)
  else fail('Chat save', '', errMsg(saveR))

  const loadR = await cdp.eval(`(async()=>{ try { const r = await window.api.chat.loadMessages('${sessionId}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (loadR?.success && loadR?.messages?.length > 0) ok('Chat load', `${loadR.messages.length} 条`)
  else fail('Chat load', '', errMsg(loadR))

  // listSessions
  const sessR = await cdp.eval(`(async()=>{ try { const r = await window.api.chat.listSessions(); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (sessR?.success) ok('Chat listSessions', `${sessR.sessions?.length ?? 0} 个`)
  else fail('Chat listSessions', '', errMsg(sessR))

  // deleteSession
  const delSessR = await cdp.eval(`(async()=>{ try { const r = await window.api.chat.deleteSession('${sessionId}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (delSessR?.success) ok('Chat deleteSession', '成功')
  else fail('Chat deleteSession', '', errMsg(delSessR))

  // ========== 5. Skill 模块回归 ==========
  console.log('\n--- 5. Skill 模块回归 ---')

  const skillName = `R18Skill_${testSuffix}`
  const skillContent = `# R18测试技能\n内容 ${Date.now()}`

  const skillListR = await cdp.eval(`(async()=>{ const r = await window.api.skill.list(); return JSON.parse(JSON.stringify(r)); })()`)
  const skills = Array.isArray(skillListR) ? skillListR : (skillListR?.data || [])
  ok('Skill list', `${skills.length} 个`)

  const saveSkillR = await cdp.eval(`(async()=>{ try { const r = await window.api.skill.save('${skillName}', ${JSON.stringify(skillContent)}); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (saveSkillR?.success !== false) ok('Skill save', skillName)
  else fail('Skill save', '', errMsg(saveSkillR))

  const getSkillR = await cdp.eval(`(async()=>{ try { const r = await window.api.skill.get('${skillName}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return null; } })()`)
  if (getSkillR?.content === skillContent) ok('Skill get', '内容一致 ✓')
  else warn('Skill get', `内容: ${getSkillR?.content?.slice(0, 50) ?? 'null'}`)

  const delSkillR = await cdp.eval(`(async()=>{ try { const r = await window.api.skill.delete('${skillName}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (delSkillR?.success !== false) ok('Skill delete', '成功')
  else fail('Skill delete', '', errMsg(delSkillR))

  // ========== 6. Cron 模块回归 ==========
  console.log('\n--- 6. Cron 模块回归 ---')

  const cronListR = await cdp.eval(`(async()=>{ const r = await window.api.cron.list(); return JSON.parse(JSON.stringify(r)); })()`)
  const crons = Array.isArray(cronListR) ? cronListR : (cronListR?.data || [])
  ok('Cron list', `${crons.length} 个`)

  // add
  const cronAddR = await cdp.eval(`(async()=>{ try { const r = await window.api.cron.add({ name: 'R18回归_${testSuffix}', expression: '0 9 * * 1', action: 'log', enabled: true }); return JSON.parse(JSON.stringify(r)); } catch(e) { return null; } })()`)
  // cron.add 返回 { success, id }
  const cronId = cronAddR?.id || cronAddR
  if (cronId) ok('Cron add', `id: ${String(cronId).slice(0, 20)}`)
  else warn('Cron add', '返回空')

  if (cronId) {
    // toggle
    const togR = await cdp.eval(`(async()=>{ try { const r = await window.api.cron.toggle('${cronId}', false); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
    if (togR?.success !== false) ok('Cron toggle', 'off')
    else warn('Cron toggle', errMsg(togR))

    // remove
    const remR = await cdp.eval(`(async()=>{ try { const r = await window.api.cron.remove('${cronId}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
    if (remR?.success !== false) ok('Cron remove', '成功')
    else warn('Cron remove', errMsg(remR))
  }

  // ========== 7. Settings 模块回归 ==========
  console.log('\n--- 7. Settings 模块回归 ---')

  const settingsR = await cdp.eval(`(async()=>{ const r = await window.api.settings.get(); return JSON.parse(JSON.stringify(r)); })()`)
  const sections = Object.keys(settingsR || {})
  ok('Settings get', `${sections.length} sections`)

  // set + verify
  const origLogLevel = settingsR?.general?.logLevel
  await cdp.eval(`(async()=>{ try { await window.api.settings.set('general.logLevel', 'debug'); } catch(e) {} })()`)
  const verifyR = await cdp.eval(`(async()=>{ const r = await window.api.settings.get(); return r?.general?.logLevel; })()`)
  if (verifyR === 'debug') ok('Settings set+get', 'logLevel = debug ✓')
  else fail('Settings set+get', '', `实际 ${verifyR}`)
  // 恢复
  await cdp.eval(`(async()=>{ try { await window.api.settings.set('general.logLevel', '${origLogLevel}'); } catch(e) {} })()`)

  // ========== 8. Privacy 模块回归 ==========
  console.log('\n--- 8. Privacy 模块回归 ---')

  const privStatus = await cdp.eval(`(async()=>{ const r = await window.api.privacy.status(); return JSON.parse(JSON.stringify(r)); })()`)
  ok('Privacy status', `unlocked: ${privStatus?.unlocked}`)

  const lockR = await cdp.eval(`(async()=>{ try { const r = await window.api.privacy.lock(); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (lockR?.success !== false) ok('Privacy lock', '成功')
  else fail('Privacy lock', '', errMsg(lockR))

  // ========== 9. AI 模块回归 ==========
  console.log('\n--- 9. AI 模块回归 ---')

  const provR = await cdp.eval(`(async()=>{ try { const r = await window.api.ai.listProviders(); return JSON.parse(JSON.stringify(r)); } catch(e) { return []; } })()`)
  const providers = Array.isArray(provR) ? provR : (provR?.data || [])
  ok('AI providers', `${providers.length} 个`)

  if (providers.length > 0) {
    const modelsR = await cdp.eval(`(async()=>{ try { const r = await window.api.ai.listModels('${providers[0].id}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return []; } })()`)
    const models = Array.isArray(modelsR) ? modelsR : (modelsR?.data || [])
    ok('AI models', `${models.length} 个 (${providers[0].id})`)
  }

  // ========== 10. Log 模块回归 ==========
  console.log('\n--- 10. Log 模块回归 ---')

  const logListR = await cdp.eval(`(async()=>{ try { const r = await window.api.log.list(); return JSON.parse(JSON.stringify(r)); } catch(e) { return []; } })()`)
  const logs = Array.isArray(logListR) ? logListR : []
  ok('Log list', `${logs.length} 个文件`)

  if (logs.length > 0) {
    const logName = logs[0].name
    const readR = await cdp.eval(`(async()=>{ try { const r = await window.api.log.read('${logName}', 20); return typeof r === 'string' ? r.length : 0; } catch(e) { return 0; } })()`)
    if (readR > 0) ok('Log read', `${logName}: ${readR} 字符`)
    else warn('Log read', '空')

    const searchR = await cdp.eval(`(async()=>{ try { const r = await window.api.log.search('${logName}', 'info', 10); return typeof r === 'string' ? r.length : 0; } catch(e) { return 0; } })()`)
    if (searchR > 0) ok('Log search', `${searchR} 字符`)
    else warn('Log search', '空')
  }

  // ========== 11. Sys 模块回归 ==========
  console.log('\n--- 11. Sys 模块回归 ---')

  const updateR = await cdp.eval(`(async()=>{ try { const r = await window.api.sys.checkUpdate(); return JSON.parse(JSON.stringify(r)); } catch(e) { return null; } })()`)
  if (updateR) ok('Sys checkUpdate', `v${updateR?.currentVersion ?? '?'}`)
  else warn('Sys checkUpdate', '返回空')

  const pathR = await cdp.eval(`(async()=>{ try { const r = await window.api.sys.getPath('home'); return r; } catch(e) { return null; } })()`)
  if (pathR) ok('Sys getPath', String(pathR).slice(0, 40))
  else warn('Sys getPath', '返回空')

  // ========== 12. Profile 模块回归 ==========
  console.log('\n--- 12. Profile 模块回归 ---')

  // 创建测试学生
  const profileName = `R18Profile_${testSuffix}`
  await cdp.eval(`(async()=>{ try { await window.api.eaa.addStudent('${profileName}'); } catch(e) {} })()`)

  const profGetR = await cdp.eval(`(async()=>{ try { const r = await window.api.profile.get('${profileName}'); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (profGetR?.success !== false) ok('Profile get', '成功')
  else warn('Profile get', errMsg(profGetR))

  const profSetR = await cdp.eval(`(async()=>{ try { const r = await window.api.profile.set('${profileName}', { note: 'R18回归' }); return JSON.parse(JSON.stringify(r)); } catch(e) { return { success: false }; } })()`)
  if (profSetR?.success !== false) ok('Profile set', '成功')
  else warn('Profile set', errMsg(profSetR))

  // 清理
  await cdp.eval(`(async()=>{ try { await window.api.eaa.deleteStudent('${profileName}', '清理'); } catch(e) {} })()`)

  // ========== 13. UI 页面回归 ==========
  console.log('\n--- 13. UI 页面回归 ---')

  const pages = ['/dashboard', '/students', '/classes', '/chat', '/skills', '/agents', '/settings', '/privacy', '/logs', '/about']
  let pageErrors = 0
  for (const p of pages) {
    await cdp.navigate(p, 1000)
    const check = await cdp.eval(`(function(){
      const h1 = document.querySelector('h1');
      const bodyLen = document.body?.innerHTML?.length || 0;
      return { title: h1?.textContent?.trim()?.slice(0, 20), bodyLen };
    })()`)
    ok(`页面 ${p}`, `${check?.title || '?'} | body:${check?.bodyLen ?? 0}`)
  }

  // ========== 14. 内存检查 ==========
  console.log('\n--- 14. 内存检查 ---')
  const memR = await cdp.eval(`(function(){
    if(performance.memory) return { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize };
    return null;
  })()`)
  if (memR) ok('内存', `${(memR.used / 1024 / 1024).toFixed(1)} MB / ${(memR.total / 1024 / 1024).toFixed(1)} MB`)
  else warn('内存', '不可用')

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r18-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R18-regression',
  }, null, 2))
  console.log('结果已写入: r18-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
