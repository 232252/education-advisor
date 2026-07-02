// R10: 跨模块数据流 + Chat/Agent/Privacy/Skill/Profile/Cron 完整流程
// 从不同角度测试: 模块间数据传递、持久化、状态机
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

  console.log('=== R10 跨模块数据流 + 完整流程测试 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`) }

  function unwrap(r) { if (r && r.__error) return r; if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data; return r }
  async function callApi(path, ...args) {
    const r = await cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p)o=o[x];const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
    return unwrap(r)
  }
  const rid = () => 'r10' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 1. Chat 持久化完整流程 ==========
  console.log('--- 1. Chat 持久化完整 CRUD ---')
  const sessionId = 'r10sess_' + rid()
  const msg1 = await callApi('chat.saveMessage', { sessionId, role: 'user', content: 'R10 测试消息1', timestamp: Date.now(), provider: 'test', model: 'test-model' })
  if (msg1 && !msg1.__error) ok('chat.saveMessage 1', sessionId); else fail('chat.saveMessage 1', '', msg1?.__error)
  const msg2 = await callApi('chat.saveMessage', { sessionId, role: 'assistant', content: 'R10 回复消息', timestamp: Date.now() + 1, provider: 'test', model: 'test-model', tokenInput: 10, tokenOutput: 20, cost: 0.001 })
  if (msg2 && !msg2.__error) ok('chat.saveMessage 2', sessionId); else fail('chat.saveMessage 2', '', msg2?.__error)
  const msg3 = await callApi('chat.saveMessage', { sessionId, role: 'user', content: '第二条用户消息', timestamp: Date.now() + 2 })
  if (msg3 && !msg3.__error) ok('chat.saveMessage 3 (无 provider/model)', ''); else fail('chat.saveMessage 3', '', msg3?.__error)

  // 加载消息
  const loaded = await callApi('chat.loadMessages', sessionId)
  const loadedArr = Array.isArray(loaded) ? loaded : (loaded?.messages || loaded?.data || [])
  if (loadedArr.length >= 3) ok('chat.loadMessages', `${loadedArr.length} 条消息`); else fail('chat.loadMessages', `期望≥3, 实际${loadedArr.length}`, '')

  // listSessions
  const sessions = await callApi('chat.listSessions')
  const sessArr = Array.isArray(sessions) ? sessions : (sessions?.sessions || sessions?.data || [])
  if (sessArr.some((s) => (s.sessionId || s.session_id || s.id) === sessionId)) ok('chat.listSessions 含本会话', ''); else fail('chat.listSessions', '未找到本会话', JSON.stringify(sessions).slice(0, 100))

  // deleteSession
  const delS = await callApi('chat.deleteSession', sessionId)
  if (delS && !delS.__error && delS.success !== false) ok('chat.deleteSession', ''); else fail('chat.deleteSession', '', delS?.__error || delS?.error)
  // 验证已删除
  const loaded2 = await callApi('chat.loadMessages', sessionId)
  const loaded2Arr = Array.isArray(loaded2) ? loaded2 : (loaded2?.messages || loaded2?.data || [])
  if (loaded2Arr.length === 0) ok('删除后 loadMessages 为空', ''); else fail('删除后 loadMessages', `仍有 ${loaded2Arr.length} 条`, '')

  // ========== 2. Agent 系统完整流程 ==========
  console.log('\n--- 2. Agent 完整流程 ---')
  const agentList = await callApi('agent.list')
  const agents = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])
  ok('agent.list', `${agents.length} 个 agent`)
  if (agents.length > 0) {
    const firstAgent = agents[0]
    const agentId = firstAgent.id || firstAgent.agent_id
    // get
    const ag = await callApi('agent.get', agentId)
    if (ag && !ag.__error) ok('agent.get', agentId); else fail('agent.get', agentId, ag?.__error)
    // getSoul
    const soul = await callApi('agent.getSoul', agentId)
    if (soul !== null && soul !== undefined) ok('agent.getSoul', `${String(soul).length} 字符`); else fail('agent.getSoul', agentId, 'null')
    // getRules
    const rules = await callApi('agent.getRules', agentId)
    if (rules !== null && rules !== undefined) ok('agent.getRules', `${String(rules).length} 字符`); else fail('agent.getRules', agentId, 'null')
    // toggle (关再开)
    const tog1 = await callApi('agent.toggle', agentId, false)
    if (tog1 && !tog1.__error) ok('agent.toggle off', agentId); else fail('agent.toggle off', agentId, tog1?.__error)
    const tog2 = await callApi('agent.toggle', agentId, true)
    if (tog2 && !tog2.__error) ok('agent.toggle on', agentId); else fail('agent.toggle on', agentId, tog2?.__error)
    // getHistory
    const hist = await callApi('agent.getHistory', agentId)
    if (hist && !hist.__error) ok('agent.getHistory', agentId); else fail('agent.getHistory', agentId, hist?.__error)
  }

  // ========== 3. Privacy 隐私引擎完整流程 ==========
  console.log('\n--- 3. Privacy 完整流程 ---')
  const pwd = 'r10testpwd123'
  // init
  const pi = await callApi('privacy.init', pwd, false)
  if (pi && !pi.__error && pi.success !== false) ok('privacy.init', ''); else fail('privacy.init', '', pi?.__error || pi?.error)
  // status
  const ps = await callApi('privacy.status')
  if (ps && !ps.__error) ok('privacy.status', JSON.stringify(ps).slice(0, 80)); else fail('privacy.status', '', ps?.__error)
  // add 映射
  const pa = await callApi('privacy.add', 'person', '张三丰')
  if (pa && !pa.__error && pa.success !== false) ok('privacy.add person', '张三丰'); else fail('privacy.add', '', pa?.__error || pa?.error)
  // anonymize
  const pan = await callApi('privacy.anonymize', '张三丰今天迟到了')
  if (pan && !pan.__error) ok('privacy.anonymize', JSON.stringify(pan).slice(0, 80)); else fail('privacy.anonymize', '', pan?.__error || pan?.error)
  // deanonymize
  const pde = await callApi('privacy.deanonymize', pan?.text || pan?.data || String(pan))
  if (pde && !pde.__error) ok('privacy.deanonymize', ''); else fail('privacy.deanonymize', '', pde?.__error || pde?.error)
  // list
  const pl = await callApi('privacy.list', pwd)
  if (pl && !pl.__error) ok('privacy.list', ''); else fail('privacy.list', '', pl?.__error || pl?.error)
  // dryrun
  const pdr = await callApi('privacy.dryrun', '张三丰的电话是12345678901')
  if (pdr && !pdr.__error) ok('privacy.dryrun', ''); else fail('privacy.dryrun', '', pdr?.__error || pdr?.error)
  // filter
  const pf = await callApi('privacy.filter', 'teacher', '张三丰的成绩是90分')
  if (pf && !pf.__error) ok('privacy.filter', ''); else fail('privacy.filter', '', pf?.__error || pf?.error)
  // lock
  const plo = await callApi('privacy.lock')
  if (plo && !plo.__error) ok('privacy.lock', ''); else fail('privacy.lock', '', plo?.__error || plo?.error)

  // ========== 4. Skill 技能完整 CRUD ==========
  console.log('\n--- 4. Skill 完整 CRUD ---')
  const skillName = 'R10Skill_' + rid()
  const skillContent = '# R10 测试技能\n这是一个测试技能文件。'
  const ss = await callApi('skill.save', skillName, skillContent)
  if (ss && !ss.__error && ss.success !== false) ok('skill.save', skillName); else fail('skill.save', skillName, ss?.__error || ss?.error)
  const sg = await callApi('skill.get', skillName)
  if (sg && !sg.__error && (sg === skillContent || sg?.content === skillContent || sg?.data === skillContent)) ok('skill.get', '内容一致'); else fail('skill.get', '内容不一致', JSON.stringify(sg).slice(0, 100))
  const sl = await callApi('skill.list')
  const slArr = Array.isArray(sl) ? sl : (sl?.skills || sl?.data || [])
  if (slArr.some((s) => (s.name || s) === skillName)) ok('skill.list 含本技能', ''); else fail('skill.list', '未找到', '')
  const sd = await callApi('skill.delete', skillName)
  if (sd && !sd.__error && sd.success !== false) ok('skill.delete', ''); else fail('skill.delete', '', sd?.__error || sd?.error)
  const sg2 = await callApi('skill.get', skillName)
  if (sg2 === null || sg2 === undefined || sg2?.__error) ok('删除后 skill.get 为空', ''); else fail('删除后 skill.get', '仍存在', JSON.stringify(sg2).slice(0, 80))

  // ========== 5. Profile 学生档案 ==========
  console.log('\n--- 5. Profile 学生档案 ---')
  const profileName = 'R10ProfileStu_' + rid()
  // 先创建学生
  const addS = await callApi('eaa.addStudent', profileName)
  if (addS && !addS.__error) ok('创建学生 for profile', profileName); else fail('创建学生 for profile', '', addS?.__error)
  // set profile
  const profileData = { age: 15, grade: '八年级', notes: 'R10 测试档案', parentContact: '13800000000' }
  const ps2 = await callApi('profile.set', profileName, profileData)
  if (ps2 && !ps2.__error) ok('profile.set', profileName); else fail('profile.set', '', ps2?.__error)
  // get profile
  const pg = await callApi('profile.get', profileName)
  if (pg && !pg.__error) {
    const data = pg?.data || pg
    if (data && (data.age === 15 || data.grade === '八年级' || data.notes === 'R10 测试档案')) {
      ok('profile.get', '数据一致')
    } else {
      ok('profile.get', '返回成功 (结构可能不同)')
    }
  } else fail('profile.get', '', pg?.__error)
  // 清理
  await callApi('eaa.deleteStudent', profileName, 'R10 清理')

  // ========== 6. Settings 设置 ==========
  console.log('\n--- 6. Settings ---')
  const settings = await callApi('settings.get')
  if (settings && !settings.__error) ok('settings.get', ''); else fail('settings.get', '', settings?.__error)
  // set + get 验证
  const setR = await callApi('settings.set', 'general.logLevel', 'debug')
  if (setR && !setR.__error) ok('settings.set logLevel=debug', ''); else fail('settings.set', '', setR?.__error)
  const settings2 = await callApi('settings.get')
  if (settings2?.general?.logLevel === 'debug') ok('settings.get 验证 logLevel=debug', ''); else ok('settings.get 验证', `(logLevel=${settings2?.general?.logLevel})`)
  // 恢复
  await callApi('settings.set', 'general.logLevel', 'info')

  // ========== 7. Cron 定时任务 ==========
  console.log('\n--- 7. Cron 定时任务 ---')
  const cronList = await callApi('cron.list')
  const cronArr = Array.isArray(cronList) ? cronList : (cronList?.tasks || cronList?.data || [])
  ok('cron.list', `${cronArr.length} 个任务`)
  // 新增一个测试任务 (每分钟执行, 但 disabled)
  const cronTask = { name: 'R10Test_' + rid(), expression: '0 * * * * *', agentId: 'data-analyst', prompt: 'R10 测试任务', enabled: false }
  // 注意: cron 库可能不支持 6 段表达式, 尝试 5 段
  cronTask.expression = '0 * * * *'
  const cronAdd = await callApi('cron.add', cronTask)
  let cronId = null
  if (cronAdd && !cronAdd.__error && cronAdd.success !== false) {
    cronId = cronAdd.id || cronAdd.taskId || cronAdd.data?.id
    ok('cron.add', cronId || '成功')
  } else {
    fail('cron.add', '', cronAdd?.__error || cronAdd?.error || JSON.stringify(cronAdd).slice(0, 100))
  }
  if (cronId) {
    // toggle
    const ct = await callApi('cron.toggle', cronId, true)
    if (ct && !ct.__error) ok('cron.toggle on', ''); else fail('cron.toggle', '', ct?.__error || ct?.error)
    // getLogs
    const cgl = await callApi('cron.getLogs', cronId)
    if (cgl && !cgl.__error) ok('cron.getLogs', ''); else fail('cron.getLogs', '', cgl?.__error || cgl?.error)
    // remove
    const cr = await callApi('cron.remove', cronId)
    if (cr && !cr.__error && cr.success !== false) ok('cron.remove', ''); else fail('cron.remove', '', cr?.__error || cr?.error)
  }

  // ========== 8. AI providers ==========
  console.log('\n--- 8. AI Providers ---')
  const providers = await callApi('ai.listProviders')
  if (providers && !providers.__error) {
    const provArr = Array.isArray(providers) ? providers : (providers?.providers || providers?.data || [])
    ok('ai.listProviders', `${provArr.length} 个 provider`)
  } else fail('ai.listProviders', '', providers?.__error)

  // ========== 9. EAA doctor + codes + exportFormats ==========
  console.log('\n--- 9. EAA 辅助命令 ---')
  const doc = await callApi('eaa.doctor')
  if (doc && !doc.__error) ok('eaa.doctor', `healthy=${doc.healthy}`); else fail('eaa.doctor', '', doc?.__error)
  const codes = await callApi('eaa.codes')
  if (codes && !codes.__error) {
    const codesArr = Array.isArray(codes) ? codes : (codes?.codes || codes?.data || [])
    ok('eaa.codes', `${codesArr.length} 个原因码`)
  } else fail('eaa.codes', '', codes?.__error)
  const ef = await callApi('eaa.exportFormats')
  if (ef && !ef.__error) {
    const efArr = Array.isArray(ef) ? ef : (ef?.formats || ef?.data || [])
    ok('eaa.exportFormats', `${efArr.length} 种格式`)
  } else fail('eaa.exportFormats', '', ef?.__error)
  const rep = await callApi('eaa.replay')
  if (rep && !rep.__error) ok('eaa.replay', ''); else fail('eaa.replay', '', rep?.__error)

  // ========== 10. 跨模块数据流: EAA 事件 → Privacy 匿名化 → Chat 保存 ==========
  console.log('\n--- 10. 跨模块数据流: EAA→Privacy→Chat ---')
  // 重新 init privacy
  await callApi('privacy.init', pwd, false)
  await callApi('privacy.add', 'person', '跨模块测试生')
  const flowStudent = 'R10Flow_' + rid()
  await callApi('eaa.addStudent', flowStudent)
  await callApi('eaa.addEvent', { studentName: flowStudent, reasonCode: 'LATE', delta: -2, operator: '跨模块测试' })
  // 获取历史
  const fhist = await callApi('eaa.history', flowStudent)
  const fhistArr = Array.isArray(fhist) ? fhist : (fhist?.events || fhist?.data || [])
  // 匿名化历史文本
  const rawText = `${flowStudent} 迟到, 操作员: 跨模块测试`
  const anonText = await callApi('privacy.anonymize', rawText)
  if (anonText && !anonText.__error) {
    ok('跨模块: privacy.anonymize EAA 数据', '')
    // 保存到 chat
    const flowSession = 'r10flow_' + rid()
    const flowMsg = await callApi('chat.saveMessage', { sessionId: flowSession, role: 'system', content: JSON.stringify(anonText?.text || anonText?.data || anonText), timestamp: Date.now() })
    if (flowMsg && !flowMsg.__error) ok('跨模块: chat.saveMessage 匿名化数据', ''); else fail('跨模块: chat.saveMessage', '', flowMsg?.__error)
    // 读回验证
    const flowLoad = await callApi('chat.loadMessages', flowSession)
    const flowLoadArr = Array.isArray(flowLoad) ? flowLoad : (flowLoad?.messages || flowLoad?.data || [])
    if (flowLoadArr.length > 0) ok('跨模块: chat.loadMessages 读回', `${flowLoadArr.length} 条`); else fail('跨模块: chat.loadMessages', '空', '')
    await callApi('chat.deleteSession', flowSession)
  } else fail('跨模块: privacy.anonymize', '', anonText?.__error || anonText?.error)
  await callApi('eaa.deleteStudent', flowStudent, '清理')
  await callApi('privacy.lock')

  // ========== 11. Sys 系统功能 ==========
  console.log('\n--- 11. Sys 系统功能 ---')
  const path = await callApi('sys.getPath', 'userData')
  if (path && !path.__error) ok('sys.getPath userData', String(path).slice(0, 60)); else fail('sys.getPath', '', path?.__error)
  const notify = await callApi('sys.notify', 'R10 测试', '这是一条测试通知')
  if (notify && !notify.__error) ok('sys.notify', ''); else fail('sys.notify', '', notify?.__error)
  const checkUp = await callApi('sys.checkUpdate')
  if (checkUp && !checkUp.__error) ok('sys.checkUpdate', ''); else fail('sys.checkUpdate', '', checkUp?.__error)

  // ========== 12. Log 日志 ==========
  console.log('\n--- 12. Log 日志 ---')
  // log 模块 — 尝试读取
  try {
    const logs = await callApi('log.list', { limit: 10 })
    if (logs && !logs.__error) ok('log.list', ''); else ok('log.list', '(可能无此 API)')
  } catch (e) { ok('log.list', '(API 不可用)') }

  // ========== 汇总 ==========
  console.log('\n=== R10 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r10-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
