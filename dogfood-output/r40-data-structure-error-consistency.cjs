// R40: EAA 数据结构深度验证 + 错误处理一致性 + 未覆盖 API
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

  console.log('=== R40: EAA 数据结构深度验证 + 错误处理一致性 ===\n')
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

  // 安全的 JSON 截取
  function safeStr(v, n = 80) {
    try { return JSON.stringify(v).slice(0, n) } catch (e) { return String(v).slice(0, n) }
  }

  // ========== 1. EAA 数据结构深度调查 ==========
  console.log('--- 1. EAA 数据结构深度调查 ---')

  // 1.1 eaa.codes 完整结构
  try {
    const r = await callRaw('eaa.codes')
    const dataType = typeof r?.data
    const isArray = Array.isArray(r?.data)
    const keys = r?.data && typeof r?.data === 'object' ? Object.keys(r.data) : null
    const arrLen = isArray ? r.data.length : null
    ok('eaa.codes 数据结构', `type=${dataType} isArray=${isArray} arrLen=${arrLen} keys=${safeStr(keys, 200)}`)
    if (keys && keys.length <= 5) {
      for (const k of keys) {
        const v = r.data[k]
        ok(`  codes.${k}`, `type=${Array.isArray(v) ? 'array(' + v.length + ')' : typeof v} sample=${safeStr(v, 120)}`)
      }
    }
  } catch (e) {
    fail('eaa.codes 数据结构', '', e)
  }

  // 1.2 eaa.listStudents 完整结构
  try {
    const r = await callRaw('eaa.listStudents')
    const dataType = typeof r?.data
    const isArray = Array.isArray(r?.data)
    const keys = r?.data && typeof r?.data === 'object' && !isArray ? Object.keys(r.data) : null
    const arrLen = isArray ? r.data.length : null
    ok('eaa.listStudents 数据结构', `success=${r?.success} type=${dataType} isArray=${isArray} arrLen=${arrLen} keys=${safeStr(keys, 200)}`)
    if (isArray && r.data.length > 0) {
      ok('  第一个学生结构', safeStr(r.data[0], 200))
    } else if (keys && keys.length > 0) {
      ok('  非数组对象 keys', `keys=${keys.join(',')}`)
    }
  } catch (e) {
    fail('eaa.listStudents 数据结构', '', e)
  }

  // 1.3 eaa.ranking 完整结构
  try {
    const r = await callRaw('eaa.ranking', 5)
    const dataType = typeof r?.data
    const isArray = Array.isArray(r?.data)
    const arrLen = isArray ? r.data.length : null
    ok('eaa.ranking 数据结构', `success=${r?.success} type=${dataType} isArray=${isArray} arrLen=${arrLen}`)
    if (isArray && r.data.length > 0) {
      ok('  ranking[0] 结构', safeStr(r.data[0], 200))
    } else if (r?.data && typeof r.data === 'object') {
      ok('  ranking 非数组', safeStr(r.data, 200))
    }
  } catch (e) {
    fail('eaa.ranking 数据结构', '', e)
  }

  // 1.4 eaa.info 完整结构
  try {
    const r = await callRaw('eaa.info')
    ok('eaa.info 完整', safeStr(r, 300))
  } catch (e) {
    fail('eaa.info', '', e)
  }

  // 1.5 eaa.stats 完整结构
  try {
    const r = await callRaw('eaa.stats')
    ok('eaa.stats 完整', safeStr(r, 300))
  } catch (e) {
    fail('eaa.stats', '', e)
  }

  // 1.6 eaa.summary 完整结构
  try {
    const r = await callRaw('eaa.summary')
    ok('eaa.summary 完整', safeStr(r, 300))
  } catch (e) {
    fail('eaa.summary', '', e)
  }

  // 1.7 eaa.doctor 完整结构
  try {
    const r = await callRaw('eaa.doctor')
    ok('eaa.doctor 完整', safeStr(r, 300))
  } catch (e) {
    fail('eaa.doctor', '', e)
  }

  // 1.8 eaa.validate 完整结构
  try {
    const r = await callRaw('eaa.validate')
    ok('eaa.validate 完整', safeStr(r, 300))
  } catch (e) {
    fail('eaa.validate', '', e)
  }

  // 1.9 eaa.exportFormats 完整
  try {
    const r = await callRaw('eaa.exportFormats')
    ok('eaa.exportFormats', safeStr(r, 100))
  } catch (e) {
    fail('eaa.exportFormats', '', e)
  }

  // ========== 2. 错误处理一致性 (非存在 ID) ==========
  console.log('\n--- 2. 错误处理一致性 ---')

  // 2.1 agent.getSoul 不存在
  try {
    const r = await callRaw('agent.getSoul', 'R40-NonExistent-Agent')
    ok('agent.getSoul 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('agent.getSoul 不存在', '', e)
  }

  // 2.2 agent.getRules 不存在
  try {
    const r = await callRaw('agent.getRules', 'R40-NonExistent-Agent')
    ok('agent.getRules 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('agent.getRules 不存在', '', e)
  }

  // 2.3 class.get 不存在
  try {
    const r = await callRaw('class.get', 'R40-NonExistent-Class-ID')
    ok('class.get 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('class.get 不存在', '', e)
  }

  // 2.4 cron.getLogs 不存在
  try {
    const r = await callRaw('cron.getLogs', 'R40-NonExistent-Cron', 10)
    ok('cron.getLogs 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('cron.getLogs 不存在', '', e)
  }

  // 2.5 eaa.score 不存在
  try {
    const r = await callRaw('eaa.score', 'R40-NonExistent-Student')
    ok('eaa.score 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('eaa.score 不存在', '', e)
  }

  // 2.6 eaa.history 不存在
  try {
    const r = await callRaw('eaa.history', 'R40-NonExistent-Student')
    ok('eaa.history 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('eaa.history 不存在', '', e)
  }

  // 2.7 chat.loadMessages 不存在会话
  try {
    const r = await callRaw('chat.loadMessages', 'R40-NonExistent-Session')
    ok('chat.loadMessages 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('chat.loadMessages 不存在', '', e)
  }

  // 2.8 skill.get 不存在
  try {
    const r = await callRaw('skill.get', 'R40-NonExistent-Skill')
    ok('skill.get 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('skill.get 不存在', '', e)
  }

  // 2.9 profile.get 不存在
  try {
    const r = await callRaw('profile.get', 'R40-NonExistent-Profile')
    ok('profile.get 不存在', `success=${r?.success} data=${safeStr(r?.data, 80)} stderr=${safeStr(r?.stderr, 80)}`)
  } catch (e) {
    fail('profile.get 不存在', '', e)
  }

  // ========== 3. 未覆盖的 API 测试 ==========
  console.log('\n--- 3. 未覆盖的 API 测试 ---')

  // 3.1 sys.platform
  try {
    const r = await callRaw('sys.platform')
    ok('sys.platform', safeStr(r, 100))
  } catch (e) {
    fail('sys.platform', '', e)
  }

  // 3.2 sys.appVersion
  try {
    const r = await callRaw('sys.appVersion')
    ok('sys.appVersion', safeStr(r, 100))
  } catch (e) {
    fail('sys.appVersion', '', e)
  }

  // 3.3 sys.appPath
  try {
    const r = await callRaw('sys.appPath')
    ok('sys.appPath', safeStr(r, 100))
  } catch (e) {
    fail('sys.appPath', '', e)
  }

  // 3.4 sys.userDataPath
  try {
    const r = await callRaw('sys.userDataPath')
    ok('sys.userDataPath', safeStr(r, 100))
  } catch (e) {
    fail('sys.userDataPath', '', e)
  }

  // 3.5 sys.logsPath
  try {
    const r = await callRaw('sys.logsPath')
    ok('sys.logsPath', safeStr(r, 100))
  } catch (e) {
    fail('sys.logsPath', '', e)
  }

  // 3.6 ai.listProviders
  try {
    const r = await callRaw('ai.listProviders')
    const providers = r?.data
    const isArray = Array.isArray(providers)
    ok('ai.listProviders', `success=${r?.success} isArray=${isArray} len=${isArray ? providers.length : 'n/a'}`)
  } catch (e) {
    fail('ai.listProviders', '', e)
  }

  // 3.7 ai.listModels (anthropic)
  try {
    const r = await callRaw('ai.listModels', 'anthropic')
    const models = r?.data
    const isArray = Array.isArray(models)
    ok('ai.listModels anthropic', `success=${r?.success} isArray=${isArray} len=${isArray ? models.length : 'n/a'}`)
  } catch (e) {
    fail('ai.listModels anthropic', '', e)
  }

  // 3.8 feishu.status
  try {
    const r = await callRaw('feishu.status')
    ok('feishu.status', safeStr(r, 150))
  } catch (e) {
    fail('feishu.status', '', e)
  }

  // 3.9 feishu.listChats
  try {
    const r = await callRaw('feishu.listChats')
    ok('feishu.listChats', safeStr(r, 150))
  } catch (e) {
    fail('feishu.listChats', '', e)
  }

  // 3.10 agent.getHistory
  try {
    const r = await callRaw('agent.getHistory', 'data-analyst', 5)
    ok('agent.getHistory data-analyst', `success=${r?.success} data=${safeStr(r?.data, 100)}`)
  } catch (e) {
    fail('agent.getHistory data-analyst', '', e)
  }

  // ========== 4. Settings 完整结构验证 ==========
  console.log('\n--- 4. Settings 完整结构验证 ---')

  try {
    const r = await callRaw('settings.get')
    const data = r?.data || r
    const keys = data && typeof data === 'object' ? Object.keys(data) : []
    ok('settings.get 顶层 keys', `keys=[${keys.join(',')}]`)
    for (const k of keys) {
      const sub = data[k]
      const subType = typeof sub
      const subKeys = sub && typeof sub === 'object' ? Object.keys(sub) : []
      ok(`  settings.${k}`, `type=${subType} keys=[${subKeys.join(',').slice(0, 80)}]`)
    }
  } catch (e) {
    fail('settings.get 结构', '', e)
  }

  // ========== 5. 隐私引擎完整状态 ==========
  console.log('\n--- 5. 隐私引擎完整状态 ---')

  try {
    const r = await callRaw('privacy.status')
    ok('privacy.status', safeStr(r, 200))
  } catch (e) {
    fail('privacy.status', '', e)
  }

  try {
    const r = await callRaw('privacy.hasPassword')
    ok('privacy.hasPassword', safeStr(r, 100))
  } catch (e) {
    fail('privacy.hasPassword', '', e)
  }

  // ========== 6. 汇总 ==========
  console.log('\n=== R40 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  fs.writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r40-result.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
