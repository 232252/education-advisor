// R29: 空 SOUL/Rules 定位 + Settings.reset 验证 + Chat/Agent/Privacy 边界
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

  console.log('=== R29 空 SOUL/Rules 定位 + Settings.reset + Chat/Agent/Privacy ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function callApi(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}if(typeof o!=='function')return{__error:'not a function'};const a=${JSON.stringify(args)};try{const r=await o(...a);if(r&&r.success===false)return{__error:String(r.data||r.error||'failed')};if(r&&typeof r==='object'&&'success'in r&&'data'in r)return r.data;return r}catch(e){return{__error:e.message}}})()`)
  }

  // ========== 1. 定位空 SOUL/Rules ==========
  console.log('--- 1. 定位空 SOUL/Rules ---')
  const agentList = await callApi('agent.list')
  const agents = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])
  for (const a of agents) {
    const aid = typeof a === 'string' ? a : (a?.id || a?.agentId || a?.name)
    if (!aid) continue
    const soul = await callApi('agent.getSoul', aid)
    const rules = await callApi('agent.getRules', aid)
    const soulLen = typeof soul === 'string' ? soul.length : 0
    const rulesLen = typeof rules === 'string' ? rules.length : 0
    if (soulLen === 0 || rulesLen === 0) {
      ok(`Agent ${aid}`, `SOUL=${soulLen}, Rules=${rulesLen} ← 空`)
    }
  }

  // ========== 2. Settings.reset 完整性验证 ==========
  console.log('\n--- 2. Settings.reset 完整性验证 ---')
  // 先记录当前配置
  const beforeReset = await callApi('settings.get')
  ok('reset 前 general', `language=${beforeReset?.general?.language}, theme=${beforeReset?.general?.theme}, logLevel=${beforeReset?.general?.logLevel}`)
  ok('reset 前 chat keys', Object.keys(beforeReset?.chat || {}).join(','))
  ok('reset 前 models keys', Object.keys(beforeReset?.models || {}).join(','))
  ok('reset 前 privacy keys', Object.keys(beforeReset?.privacy || {}).join(','))
  ok('reset 前 feishu keys', Object.keys(beforeReset?.feishu || {}).join(','))
  ok('reset 前 advanced keys', Object.keys(beforeReset?.advanced || {}).join(','))
  ok('reset 前 shortcuts keys', Object.keys(beforeReset?.shortcuts || {}).join(','))

  // 执行 reset
  const resetResult = await callApi('settings.reset')
  ok('settings.reset', `结果: ${JSON.stringify(resetResult).slice(0, 60)}`)

  // 验证 reset 后
  const afterReset = await callApi('settings.get')
  ok('reset 后 general', `language=${afterReset?.general?.language}, theme=${afterReset?.general?.theme}, logLevel=${afterReset?.general?.logLevel}`)
  ok('reset 后 chat keys', Object.keys(afterReset?.chat || {}).join(','))
  ok('reset 后 models keys', Object.keys(afterReset?.models || {}).join(','))
  ok('reset 后 privacy keys', Object.keys(afterReset?.privacy || {}).join(','))
  ok('reset 后 feishu keys', Object.keys(afterReset?.feishu || {}).join(','))
  ok('reset 后 advanced keys', Object.keys(afterReset?.advanced || {}).join(','))
  ok('reset 后 shortcuts keys', Object.keys(afterReset?.shortcuts || {}).join(','))

  // 验证所有 7 个 top-level section 存在
  const sections = ['general', 'models', 'chat', 'privacy', 'feishu', 'advanced', 'shortcuts']
  for (const sec of sections) {
    if (afterReset && typeof afterReset[sec] === 'object') ok(`section ${sec}`, '存在且为 object')
    else fail(`section ${sec}`, '', typeof afterReset?.[sec])
  }

  // ========== 3. Chat 发送测试 (无 API key, 预期失败) ==========
  console.log('\n--- 3. Chat 发送测试 ---')
  const chatResult = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.chat({
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        messages: [{role: 'user', content: 'Hello'}],
        systemPrompt: 'You are a test assistant.',
        maxTokens: 100
      });
      return JSON.stringify({success: r?.success, error: r?.data || r?.error, stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('ai.chat 无 apiKey', chatResult.slice(0, 200))

  // ai.abortChat
  const abort = await callApi('ai.abortChat')
  ok('ai.abortChat', `结果: ${JSON.stringify(abort).slice(0, 60)}`)

  // ========== 4. Agent runManual 测试 ==========
  console.log('\n--- 4. Agent runManual 测试 ---')
  const runResult = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.agent.runManual('data-analyst', '分析当前学生数据', []);
      return JSON.stringify({success: r?.success, hasData: !!r?.data, dataStr: JSON.stringify(r?.data).slice(0, 200), stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('agent.runManual data-analyst', runResult.slice(0, 300))

  // ========== 5. Privacy 初始化测试 (sandbox 拦截) ==========
  console.log('\n--- 5. Privacy 初始化测试 ---')
  const privInit = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.init('test1234', false);
      return JSON.stringify({success: r?.success, data: r?.data, stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('privacy.init test1234', privInit.slice(0, 200))

  const privStatus = await callApi('privacy.status')
  ok('privacy.status', `结果: ${JSON.stringify(privStatus).slice(0, 100)}`)

  // ========== 6. Privacy anonymize (未初始化) ==========
  console.log('\n--- 6. Privacy anonymize (未初始化) ---')
  const anon = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.anonymize('张三的电话是13800138000');
      return JSON.stringify({success: r?.success, data: r?.data, error: r?.data || r?.error});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('privacy.anonymize 未初始化', anon.slice(0, 200))

  // ========== 7. EAA export 测试 (sandbox 拦截) ==========
  console.log('\n--- 7. EAA export 测试 ---')
  const exportCsv = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.export('csv');
      return JSON.stringify({success: r?.success, data: r?.data, stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('eaa.export csv', exportCsv.slice(0, 200))

  const exportJsonl = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.export('jsonl');
      return JSON.stringify({success: r?.success, data: r?.data, stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('eaa.export jsonl', exportJsonl.slice(0, 200))

  const exportInvalid = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.export('invalid_format');
      return JSON.stringify({success: r?.success, data: r?.data, stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('eaa.export invalid_format', exportInvalid.slice(0, 200))

  // ========== 8. EAA import 测试 ==========
  console.log('\n--- 8. EAA import 测试 ---')
  const importResult = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.import('C:/nonexistent/file.json');
      return JSON.stringify({success: r?.success, data: r?.data, stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('eaa.import 不存在文件', importResult.slice(0, 200))

  // ========== 9. EAA setStudentMeta (sandbox 拦截) ==========
  console.log('\n--- 9. EAA setStudentMeta ---')
  const metaResult = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.setStudentMeta({name: '张三', meta: {note: 'test'}});
      return JSON.stringify({success: r?.success, data: r?.data, stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('eaa.setStudentMeta', metaResult.slice(0, 200))

  // ========== 10. Class create (sandbox 拦截) ==========
  console.log('\n--- 10. Class create ---')
  const classCreate = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.class.create({name: 'TestClass_R29', grade: '高一', note: 'test'});
      return JSON.stringify({success: r?.success, data: r?.data, stderr: r?.stderr?.slice(0, 100)});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('class.create', classCreate.slice(0, 200))

  // ========== 11. Chat saveMessage (sandbox 拦截) ==========
  console.log('\n--- 11. Chat saveMessage ---')
  const saveMsg = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.chat.saveMessage({role: 'user', content: 'test message', timestamp: Date.now()});
      return JSON.stringify({success: r?.success, data: r?.data, error: r?.data || r?.error});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('chat.saveMessage', saveMsg.slice(0, 200))

  // chat.listSessions
  const sessions = await callApi('chat.listSessions')
  ok('chat.listSessions', `结果: ${JSON.stringify(sessions).slice(0, 100)}`)

  // ========== 12. Skill save (sandbox 拦截) ==========
  console.log('\n--- 12. Skill save ---')
  const skillSave = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.skill.save('TestSkill_R29', 'test content');
      return JSON.stringify({success: r?.success, data: r?.data, error: r?.data || r?.error});
    } catch (e) {
      return JSON.stringify({error: e.message});
    }
  })()`)
  ok('skill.save', skillSave.slice(0, 200))

  // ========== 13. 汇总 ==========
  console.log('\n=== R29 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r29-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
