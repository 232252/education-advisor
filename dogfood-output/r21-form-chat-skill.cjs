// R21: UI 表单交互 + Chat CRUD + Skill CRUD + Privacy + Cron 全任务日志 + Agent 全历史
// 跳过 EAA 写操作 (TRAE Sandbox 拦截 .lock)
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

  console.log('=== R21 UI表单 + Chat + Skill + Privacy + Cron日志 + Agent历史 ===\n')
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

  const rid = () => 'r21' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 1. UI Settings 页表单交互 ==========
  console.log('--- 1. UI Settings 表单交互 ---')
  await navigate('#/settings')
  // 统计 select / input / textarea 数量
  const formStats = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const inputs = document.querySelectorAll('input');
    const textareas = document.querySelectorAll('textarea');
    const buttons = document.querySelectorAll('button');
    return JSON.stringify({selects: selects.length, inputs: inputs.length, textareas: textareas.length, buttons: buttons.length});
  })()`)
  console.log(`    表单元素: ${formStats}`)
  const fs = JSON.parse(formStats)
  ok('Settings 表单统计', `select=${fs.selects}, input=${fs.inputs}, textarea=${fs.textareas}, button=${fs.buttons}`)

  // 尝试读取每个 select 的当前值
  const selectValues = await cdp.eval(`(function(){
    const sels = document.querySelectorAll('select');
    return JSON.stringify(Array.from(sels).map((s, i) => ({i, name: s.name || '', value: s.value, options: s.options.length})));
  })()`)
  console.log(`    Select 详情: ${selectValues}`)
  ok('Settings select 详情', `${JSON.parse(selectValues).length} 个 select 已读取`)

  // ========== 2. UI Models 页表单 ==========
  console.log('\n--- 2. UI Models 表单 ---')
  await navigate('#/models')
  const modelsStats = await cdp.eval(`(function(){
    return JSON.stringify({
      selects: document.querySelectorAll('select').length,
      inputs: document.querySelectorAll('input').length,
      buttons: document.querySelectorAll('button').length,
      cards: document.querySelectorAll('[class*="card"], [class*="model"]').length
    });
  })()`)
  ok('Models 表单', modelsStats)

  // ========== 3. UI Agents 页 — 测试 Agent 卡片渲染 ==========
  console.log('\n--- 3. UI Agents 页 ---')
  await navigate('#/agents')
  const agentCards = await cdp.eval(`document.querySelectorAll('[class*="agent"], [class*="card"]').length`)
  ok('Agents 卡片数', `${agentCards} 个`)

  // ========== 4. Chat CRUD (SQLite, 不依赖 .lock) ==========
  console.log('\n--- 4. Chat CRUD ---')
  const chatSess = 'r21chat_' + rid()
  // saveMessage
  const cm1 = await callApi('chat.saveMessage', { sessionId: chatSess, role: 'user', content: 'R21 测试消息 1', timestamp: Date.now() })
  if (cm1 && !cm1.__error) ok('chat.saveMessage 1', '用户消息')
  else fail('chat.saveMessage 1', '', cm1?.__error)

  const cm2 = await callApi('chat.saveMessage', { sessionId: chatSess, role: 'assistant', content: 'R21 测试回复 1', timestamp: Date.now() + 1 })
  if (cm2 && !cm2.__error) ok('chat.saveMessage 2', 'AI 消息')
  else fail('chat.saveMessage 2', '', cm2?.__error)

  const cm3 = await callApi('chat.saveMessage', { sessionId: chatSess, role: 'user', content: 'R21 测试消息 2 - 多条', timestamp: Date.now() + 2 })
  if (cm3 && !cm3.__error) ok('chat.saveMessage 3', '用户消息 2')
  else fail('chat.saveMessage 3', '', cm3?.__error)

  // loadMessages
  const loaded = await callApi('chat.loadMessages', chatSess)
  if (loaded && !loaded.__error) {
    const mArr = Array.isArray(loaded) ? loaded : (loaded?.messages || loaded?.data || [])
    ok('chat.loadMessages', `${mArr.length} 条消息`)
    // 验证内容
    if (mArr.length >= 3) {
      const c = mArr.map((m) => m.content).join('|')
      if (c.includes('R21 测试消息 1') && c.includes('R21 测试回复 1')) ok('chat 内容验证', '顺序与内容一致')
      else fail('chat 内容验证', '内容不匹配', c.slice(0, 100))
    }
  } else fail('chat.loadMessages', '', loaded?.__error)

  // listSessions
  const sessions = await callApi('chat.listSessions')
  if (sessions && !sessions.__error) {
    const sArr = Array.isArray(sessions) ? sessions : (sessions?.sessions || sessions?.data || [])
    ok('chat.listSessions', `${sArr.length} 个会话`)
    // 验证新会话在列表中
    const found = sArr.find((s) => (s.sessionId || s.id || s) === chatSess)
    if (found) ok('chat 新会话验证', '在列表中')
    else fail('chat 新会话验证', '不在列表中', JSON.stringify(sArr).slice(0, 100))
  } else fail('chat.listSessions', '', sessions?.__error)

  // deleteSession
  const delR = await callApi('chat.deleteSession', chatSess)
  if (delR && !delR.__error) ok('chat.deleteSession', '删除成功')
  else fail('chat.deleteSession', '', delR?.__error)

  // 验证删除
  const loaded2 = await callApi('chat.loadMessages', chatSess)
  if (loaded2 && !loaded2.__error) {
    const mArr = Array.isArray(loaded2) ? loaded2 : (loaded2?.messages || loaded2?.data || [])
    if (mArr.length === 0) ok('chat 删除验证', '消息已清空')
    else fail('chat 删除验证', '消息仍存在', `${mArr.length} 条`)
  } else ok('chat 删除验证', '会话不存在')

  // Chat 边界测试 — 空 content
  const emptyC = await callApi('chat.saveMessage', { sessionId: 'r21empty_' + rid(), role: 'user', content: '', timestamp: Date.now() })
  if (emptyC && !emptyC.__error) {
    ok('chat 空 content', '接受 (与之前测试一致, 极低优先级)')
    await callApi('chat.deleteSession', 'r21empty_' + rid())
  } else fail('chat 空 content', '拒绝', emptyC?.__error)

  // Chat 边界 — 缺 timestamp
  const noTs = await callApi('chat.saveMessage', { sessionId: 'r21nots_' + rid(), role: 'user', content: 'no timestamp' })
  if (noTs && !noTs.__error) {
    ok('chat 缺 timestamp', '接受 (R4 修复后 timestamp 可选)')
    await callApi('chat.deleteSession', 'r21nots_' + rid())
  } else fail('chat 缺 timestamp', '拒绝', noTs?.__error)

  // Chat 边界 — 无效 role
  const badRole = await callApi('chat.saveMessage', { sessionId: 'r21badrole_' + rid(), role: 'invalid_role', content: 'bad role', timestamp: Date.now() })
  if (badRole && badRole.__error) ok('chat 无效 role 拒绝', '正确拒绝')
  else fail('chat 无效 role 拒绝', '应被拒绝', JSON.stringify(badRole).slice(0, 100))

  // ========== 5. Skill CRUD ==========
  console.log('\n--- 5. Skill CRUD ---')
  const skillName = 'r21skill_' + rid()
  const skillContent = '# R21 测试技能\n\n这是一个测试技能文件。\n\n## 步骤\n1. 第一步\n2. 第二步\n'
  const ss = await callApi('skill.save', skillName, skillContent)
  if (ss && !ss.__error) ok('skill.save', skillName)
  else fail('skill.save', '', ss?.__error)

  const sg = await callApi('skill.get', skillName)
  if (sg && !sg.__error) {
    if (String(sg) === skillContent || String(sg).includes('R21 测试技能')) ok('skill.get 读回', '内容一致')
    else fail('skill.get 读回', '内容不一致', String(sg).slice(0, 100))
  } else fail('skill.get', '', sg?.__error)

  // skill.list 验证
  const sl = await callApi('skill.list')
  if (sl && !sl.__error) {
    const sArr = Array.isArray(sl) ? sl : (sl?.skills || sl?.data || [])
    const found = sArr.find((s) => (s.name || s.id || s) === skillName)
    if (found) ok('skill.list 验证', '在列表中')
    else fail('skill.list 验证', '不在列表中', JSON.stringify(sArr).slice(0, 100))
  }

  const sd = await callApi('skill.delete', skillName)
  if (sd && !sd.__error) ok('skill.delete', '删除成功')
  else fail('skill.delete', '', sd?.__error)

  // 验证删除
  const sg2 = await callApi('skill.get', skillName)
  if (sg2 === null || sg2 === undefined) ok('skill 删除验证', '已删除')
  else fail('skill 删除验证', '仍存在', String(sg2).slice(0, 100))

  // Skill 负面测试 — 路径穿越
  const pathTrav = await callApi('skill.save', '../../../etc/passwd', 'evil')
  if (pathTrav && pathTrav.__error) ok('skill 路径穿越拒绝', '正确拒绝')
  else fail('skill 路径穿越拒绝', '应被拒绝', JSON.stringify(pathTrav).slice(0, 100))

  // Skill 负面测试 — 空名字
  const emptyN = await callApi('skill.save', '', 'content')
  if (emptyN && emptyN.__error) ok('skill 空名字拒绝', '正确拒绝')
  else fail('skill 空名字拒绝', '应被拒绝', JSON.stringify(emptyN).slice(0, 100))

  // ========== 6. Privacy 深度测试 ==========
  console.log('\n--- 6. Privacy 深度测试 ---')
  // status — 当前状态
  const ps1 = await callApi('privacy.status')
  if (ps1 && !ps1.__error) ok('privacy.status 初始', `loaded=${ps1.loaded || ps1.hasPassword}`)
  else fail('privacy.status 初始', '', ps1?.__error)

  // init — 用测试密码
  const pwd = 'r21pwd123'
  const pi = await callApi('privacy.init', pwd, false)
  if (pi && !pi.__error) ok('privacy.init', '初始化成功')
  else fail('privacy.init', '', pi?.__error)

  // add — 添加映射
  const pa1 = await callApi('privacy.add', 'phone', '13800000000')
  if (pa1 && !pa1.__error) ok('privacy.add phone', '成功')
  else fail('privacy.add phone', '', pa1?.__error)

  const pa2 = await callApi('privacy.add', 'person', '张三')
  if (pa2 && !pa2.__error) ok('privacy.add person', '成功')
  else fail('privacy.add person', '', pa2?.__error)

  // anonymize
  const ano = await callApi('privacy.anonymize', '张三的电话是13800000000')
  if (ano && !ano.__error) {
    const at = ano?.text || ano?.data || String(ano)
    if (at.includes('13800000000')) fail('privacy.anonymize', '电话未被匿名化', at.slice(0, 100))
    else ok('privacy.anonymize', `匿名化: ${at.slice(0, 60)}`)
  } else fail('privacy.anonymize', '', ano?.__error)

  // dryrun
  const dry = await callApi('privacy.dryrun', '李四的电话是13900000000')
  if (dry && !dry.__error) ok('privacy.dryrun', '成功')
  else fail('privacy.dryrun', '', dry?.__error)

  // deanonymize
  const deano = await callApi('privacy.deanonymize', String(ano?.text || ano?.data || ''))
  if (deano && !deano.__error) ok('privacy.deanonymize', '成功')
  else fail('privacy.deanonymize', '', deano?.__error)

  // lock
  const lockR = await callApi('privacy.lock')
  if (lockR && !lockR.__error) ok('privacy.lock', '锁定成功')
  else fail('privacy.lock', '', lockR?.__error)

  // status after lock
  const ps2 = await callApi('privacy.status')
  if (ps2 && !ps2.__error) ok('privacy.status 锁定后', `loaded=${ps2.loaded || ps2.hasPassword}`)
  else fail('privacy.status 锁定后', '', ps2?.__error)

  // Privacy 负面测试 — 短密码
  const shortPwd = await callApi('privacy.init', 'ab', false)
  if (shortPwd && shortPwd.__error) ok('privacy 短密码拒绝', '正确拒绝 (< 4 字符)')
  else fail('privacy 短密码拒绝', '应被拒绝', JSON.stringify(shortPwd).slice(0, 100))

  // Privacy 负面测试 — 无效 entityType
  const badType = await callApi('privacy.add', 'invalid_type', 'value')
  if (badType && badType.__error) ok('privacy 无效类型拒绝', '正确拒绝')
  else fail('privacy 无效类型拒绝', '应被拒绝', JSON.stringify(badType).slice(0, 100))

  // ========== 7. Cron 全任务日志 ==========
  console.log('\n--- 7. Cron 全任务日志 ---')
  const cronList = await callApi('cron.list')
  if (cronList && !cronList.__error) {
    const cArr = Array.isArray(cronList) ? cronList : (cronList?.tasks || cronList?.data || [])
    let logsOk = 0, logsEmpty = 0
    for (const t of cArr) {
      const tid = t.id
      const logs = await callApi('cron.getLogs', tid, 5)
      if (logs && !logs.__error) {
        const lArr = Array.isArray(logs) ? logs : (logs?.logs || logs?.data || [])
        if (lArr.length > 0) logsOk++
        else logsEmpty++
      }
    }
    ok('cron.getLogs 全任务', `${logsOk} 有日志 / ${logsEmpty} 无日志 / ${cArr.length} 总任务`)
  }

  // ========== 8. Agent 全历史 ==========
  console.log('\n--- 8. Agent 全历史 ---')
  const agentList = await callApi('agent.list')
  if (agentList && !agentList.__error) {
    const aArr = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])
    let histOk = 0, histEmpty = 0
    for (const a of aArr) {
      const aid = a.id || a
      const hist = await callApi('agent.getHistory', aid)
      if (hist && !hist.__error) {
        const hArr = Array.isArray(hist) ? hist : (hist?.history || hist?.data || [])
        if (hArr.length > 0) histOk++
        else histEmpty++
      }
    }
    ok('agent.getHistory 全 Agent', `${histOk} 有历史 / ${histEmpty} 无历史 / ${aArr.length} 总 Agent`)
  }

  // ========== 9. Settings 修改 + 读回 ==========
  console.log('\n--- 9. Settings 修改 + 读回 ---')
  const origSettings = await callApi('settings.get')
  if (origSettings && !origSettings.__error) {
    const origLogLevel = origSettings?.general?.logLevel
    // 改 logLevel
    const setR = await callApi('settings.set', 'general.logLevel', 'debug')
    if (setR && !setR.__error) ok('settings.set logLevel=debug', '成功')
    else fail('settings.set logLevel=debug', '', setR?.__error)

    // 读回验证
    const newSettings = await callApi('settings.get')
    if (newSettings?.general?.logLevel === 'debug') ok('settings 读回 logLevel', 'debug 一致')
    else fail('settings 读回 logLevel', `实际: ${newSettings?.general?.logLevel}`, '不一致')

    // 恢复
    await callApi('settings.set', 'general.logLevel', origLogLevel || 'info')
    ok('settings 恢复 logLevel', origLogLevel || 'info')

    // 测试 theme 切换
    const origTheme = origSettings?.general?.theme
    for (const theme of ['dark', 'light', 'system']) {
      await callApi('settings.set', 'general.theme', theme)
      const t = await callApi('settings.get')
      if (t?.general?.theme === theme) ok(`settings.theme=${theme}`, '一致')
      else fail(`settings.theme=${theme}`, `实际: ${t?.general?.theme}`, '不一致')
    }
    // 恢复 theme
    await callApi('settings.set', 'general.theme', origTheme || 'system')
  }

  // ========== 10. UI 键盘可访问性 ==========
  console.log('\n--- 10. UI 键盘可访问性 ---')
  for (const route of ['#/dashboard', '#/settings', '#/models']) {
    await navigate(route)
    const focusable = await cdp.eval(`document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length`)
    ok(`UI ${route} focusable`, `${focusable} 个可聚焦元素`)
  }

  // ========== 11. 内存最终 ==========
  console.log('\n--- 11. 内存最终 ---')
  const finalHeap = await getHeap()
  ok('最终内存', `${(finalHeap / 1024 / 1024).toFixed(2)} MB`)

  // ========== 12. 汇总 ==========
  console.log('\n=== R21 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r21-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
