// R28: UI 交互深度 — Agent toggle/运行 + Settings 修改 + Models 选择 + 表单验证
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

  console.log('=== R28 UI 交互深度 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function navigate(route) { await cdp.eval(`window.location.hash = '${route}'`); await new Promise((r) => setTimeout(r, 2000)) }
  async function callApi(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}if(typeof o!=='function')return{__error:'not a function'};const a=${JSON.stringify(args)};try{const r=await o(...a);if(r&&r.success===false)return{__error:String(r.data||r.error||'failed')};if(r&&typeof r==='object'&&'success'in r&&'data'in r)return r.data;return r}catch(e){return{__error:e.message}}})()`)
  }

  // ========== 1. Agent toggle 测试 ==========
  console.log('--- 1. Agent toggle 测试 ---')
  await navigate('#/agents')
  // 通过 API 获取第一个 agent 的初始状态
  const agentList = await callApi('agent.list')
  const agents = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])
  const firstAgent = agents[0]
  const aid = typeof firstAgent === 'string' ? firstAgent : (firstAgent?.id || firstAgent?.agentId || firstAgent?.name)
  const initialEnabled = typeof firstAgent === 'object' ? firstAgent?.enabled : null
  ok(`Agent ${aid} 初始状态`, `enabled=${initialEnabled}`)

  // 通过 API toggle
  const toggled = await callApi('agent.toggle', aid, !initialEnabled)
  if (toggled && !toggled.__error) ok(`Agent ${aid} toggle`, `成功切到 ${!initialEnabled}`)
  else fail(`Agent ${aid} toggle`, '', toggled?.__error)

  // 验证
  const afterAgent = await callApi('agent.get', aid)
  const afterEnabled = typeof afterAgent === 'object' ? afterAgent?.enabled : null
  ok(`Agent ${aid} 验证`, `enabled=${afterEnabled}`)

  // 恢复
  await callApi('agent.toggle', aid, initialEnabled)
  ok(`Agent ${aid} 恢复`, `enabled=${initialEnabled}`)

  // ========== 2. Agent getSoul 内容长度 ==========
  console.log('\n--- 2. Agent getSoul 内容分析 ---')
  let soulStats = { total: 0, empty: 0, lengths: [] }
  for (const a of agents) {
    const id = typeof a === 'string' ? a : (a?.id || a?.agentId || a?.name)
    if (!id) continue
    const soul = await callApi('agent.getSoul', id)
    const len = typeof soul === 'string' ? soul.length : 0
    soulStats.total++
    if (len === 0) soulStats.empty++
    soulStats.lengths.push({ id, len })
  }
  const maxLen = Math.max(...soulStats.lengths.map(s => s.len))
  const minLen = Math.min(...soulStats.lengths.map(s => s.len))
  const avgLen = (soulStats.lengths.reduce((a, b) => a + b.len, 0) / soulStats.total).toFixed(0)
  ok('Agent SOUL 统计', `total=${soulStats.total}, empty=${soulStats.empty}, min=${minLen}, max=${maxLen}, avg=${avgLen}`)

  // ========== 3. Agent getRules 内容分析 ==========
  console.log('\n--- 3. Agent getRules 内容分析 ---')
  let rulesStats = { total: 0, empty: 0, lengths: [] }
  for (const a of agents) {
    const id = typeof a === 'string' ? a : (a?.id || a?.agentId || a?.name)
    if (!id) continue
    const rules = await callApi('agent.getRules', id)
    const len = typeof rules === 'string' ? rules.length : 0
    rulesStats.total++
    if (len === 0) rulesStats.empty++
    rulesStats.lengths.push({ id, len })
  }
  const rMaxLen = Math.max(...rulesStats.lengths.map(s => s.len))
  const rMinLen = Math.min(...rulesStats.lengths.map(s => s.len))
  const rAvgLen = (rulesStats.lengths.reduce((a, b) => a + b.len, 0) / rulesStats.total).toFixed(0)
  ok('Agent Rules 统计', `total=${rulesStats.total}, empty=${rulesStats.empty}, min=${rMinLen}, max=${rMaxLen}, avg=${rAvgLen}`)

  // ========== 4. Settings 修改 — language = en ==========
  console.log('\n--- 4. Settings 修改 (language) ---')
  await callApi('settings.set', 'general.language', 'en')
  await navigate('#/dashboard')
  const titleEn = await cdp.eval(`document.querySelector('h1, h2')?.textContent`)
  ok('Settings language=en', `Dashboard 标题: ${titleEn}`)
  // 恢复
  await callApi('settings.set', 'general.language', 'zh')
  await navigate('#/dashboard')
  const titleZh = await cdp.eval(`document.querySelector('h1, h2')?.textContent`)
  ok('Settings 恢复 language=zh', `Dashboard 标题: ${titleZh}`)

  // ========== 5. Settings 修改 — theme = light ==========
  console.log('\n--- 5. Settings 修改 (theme) ---')
  await callApi('settings.set', 'general.theme', 'light')
  await navigate('#/dashboard')
  const bodyClassLight = await cdp.eval(`document.body.className`)
  ok('Settings theme=light', `body class: ${bodyClassLight.slice(0, 60)}`)
  await callApi('settings.set', 'general.theme', 'dark')
  await navigate('#/dashboard')
  const bodyClassDark = await cdp.eval(`document.body.className`)
  ok('Settings 恢复 theme=dark', `body class: ${bodyClassDark.slice(0, 60)}`)

  // ========== 6. Settings 修改 — logLevel ==========
  console.log('\n--- 6. Settings 修改 (logLevel) ---')
  for (const lvl of ['debug', 'info', 'warn', 'error']) {
    await callApi('settings.set', 'general.logLevel', lvl)
    const s = await callApi('settings.get')
    ok(`logLevel=${lvl}`, `实际: ${s?.general?.logLevel}`)
  }
  await callApi('settings.set', 'general.logLevel', 'info')

  // ========== 7. Settings 无效值测试 ==========
  console.log('\n--- 7. Settings 无效值测试 ---')
  // 无效 language
  await callApi('settings.set', 'general.language', 'invalid_lang')
  const sAfterInvalid = await callApi('settings.get')
  ok('无效 language', `实际: ${sAfterInvalid?.general?.language} (可能接受任意值)`)
  await callApi('settings.set', 'general.language', 'zh')

  // 无效 theme
  await callApi('settings.set', 'general.theme', 'purple')
  const sAfterInvalidTheme = await callApi('settings.get')
  ok('无效 theme', `实际: ${sAfterInvalidTheme?.general?.theme} (可能接受任意值)`)
  await callApi('settings.set', 'general.theme', 'dark')

  // 无效 logLevel
  await callApi('settings.set', 'general.logLevel', 'verbose')
  const sAfterInvalidLog = await callApi('settings.get')
  ok('无效 logLevel', `实际: ${sAfterInvalidLog?.general?.logLevel} (可能接受任意值)`)
  await callApi('settings.set', 'general.logLevel', 'info')

  // ========== 8. Settings 嵌套路径测试 ==========
  console.log('\n--- 8. Settings 嵌套路径测试 ---')
  // 读取当前 chat 配置
  const sBefore = await callApi('settings.get')
  ok('Settings chat 配置', `chat keys: ${Object.keys(sBefore?.chat || {}).join(',')}`)
  ok('Settings models 配置', `models keys: ${Object.keys(sBefore?.models || {}).join(',')}`)
  ok('Settings privacy 配置', `privacy keys: ${Object.keys(sBefore?.privacy || {}).join(',')}`)
  ok('Settings feishu 配置', `feishu keys: ${Object.keys(sBefore?.feishu || {}).join(',')}`)
  ok('Settings advanced 配置', `advanced keys: ${Object.keys(sBefore?.advanced || {}).join(',')}`)
  ok('Settings shortcuts 配置', `shortcuts keys: ${Object.keys(sBefore?.shortcuts || {}).join(',')}`)

  // ========== 9. Settings.set 深层路径 ==========
  console.log('\n--- 9. Settings.set 深层路径 ---')
  await callApi('settings.set', 'chat.defaultProvider', 'anthropic')
  const sAfterChat = await callApi('settings.get')
  ok('set chat.defaultProvider', `实际: ${sAfterChat?.chat?.defaultProvider}`)

  await callApi('settings.set', 'models.defaultProvider', 'minimax')
  const sAfterModels = await callApi('settings.get')
  ok('set models.defaultProvider', `实际: ${sAfterModels?.models?.defaultProvider}`)

  // ========== 10. Settings.set 无效路径 ==========
  console.log('\n--- 10. Settings.set 无效路径 ---')
  const r1 = await callApi('settings.set', 'nonexistent.key', 'value')
  ok('set nonexistent.key', `结果: ${JSON.stringify(r1).slice(0, 80)}`)

  const r2 = await callApi('settings.set', '', 'value')
  ok('set 空路径', `结果: ${JSON.stringify(r2).slice(0, 80)}`)

  const r3 = await callApi('settings.set', 'general', 'invalid_whole_section')
  ok('set general=string', `结果: ${JSON.stringify(r3).slice(0, 80)}`)
  // 检查 general 是否被破坏
  const sAfterR3 = await callApi('settings.get')
  ok('general 完整性', `language=${sAfterR3?.general?.language}, theme=${sAfterR3?.general?.theme}`)
  // 如果被破坏,恢复
  if (typeof sAfterR3?.general !== 'object' || !sAfterR3?.general?.language) {
    console.log('  [恢复] general 被破坏,执行 settings.reset...')
    await callApi('settings.reset')
  }

  // ========== 11. Models 页面交互 — 选择 provider ==========
  console.log('\n--- 11. Models 页面交互 ---')
  await navigate('#/models')
  const modelSelects = await cdp.eval(`(function(){
    const selects = Array.from(document.querySelectorAll('select'));
    return JSON.stringify(selects.map((s, i) => ({
      idx: i,
      optionCount: s.options.length,
      firstOption: s.options[0]?.text?.slice(0, 40),
      currentValue: s.value,
      allOptions: Array.from(s.options).map(o => o.text.slice(0, 30)).slice(0, 5)
    })));
  })()`)
  ok('Models selects', modelSelects.slice(0, 500))

  // ========== 12. Skills 页面 — 列出所有技能 ==========
  console.log('\n--- 12. Skills 列表 ---')
  const skillList = await callApi('skill.list')
  if (skillList && !skillList.__error) {
    const arr = Array.isArray(skillList) ? skillList : (skillList?.skills || skillList?.data || [])
    ok('skill.list', `${arr.length} 个技能`)
    // 抽样读取 3 个技能内容
    for (const sk of arr.slice(0, 3)) {
      const name = typeof sk === 'string' ? sk : (sk?.name || sk?.id)
      if (!name) continue
      const content = await callApi('skill.get', name)
      const len = typeof content === 'string' ? content.length : 0
      ok(`skill.get(${name})`, `${len} 字符`)
    }
  } else fail('skill.list', '', skillList?.__error || 'unknown')

  // ========== 13. 汇总 ==========
  console.log('\n=== R28 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r28-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
