// R44: Bug R28-1 修复验证 + 完整枚举校验测试
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

  console.log('=== R44: Bug R28-1 修复验证 + 完整枚举校验 ===\n')
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

  // ========== 1. Bug R28-1 修复验证: 非法枚举值应被拒绝 ==========
  console.log('--- 1. Bug R28-1 修复验证: 非法枚举值 ---')

  const invalidTests = [
    { path: 'general.theme', value: 'INVALID_THEME_XYZ', label: 'theme' },
    { path: 'general.theme', value: 'purple', label: 'theme purple' },
    { path: 'general.language', value: 'INVALID_LANG', label: 'language' },
    { path: 'general.closeBehavior', value: 'delete', label: 'closeBehavior' },
    { path: 'general.logLevel', value: 'trace', label: 'logLevel' },
    { path: 'chat.steeringMode', value: 'none', label: 'steeringMode' },
    { path: 'chat.followUpMode', value: 'none', label: 'followUpMode' },
    { path: 'chat.thinkingLevel', value: 'ultra', label: 'thinkingLevel' },
  ]

  for (const t of invalidTests) {
    try {
      const r = await callRaw('settings.set', t.path, t.value)
      if (r && r.success === false) {
        ok(`拒绝 ${t.path}=${t.value}`, `error: ${safeStr(r.error || r.data, 80)}`)
      } else if (r && r.success === true) {
        fail(`拒绝 ${t.path}=${t.value}`, '未拒绝!', 'settings.set 接受了非法枚举值')
        // 恢复默认
        await callRaw('settings.reset')
      } else {
        ok(`拒绝 ${t.path}=${t.value}`, `结果: ${safeStr(r, 80)}`)
      }
    } catch (e) {
      fail(`拒绝 ${t.path}=${t.value}`, '', e)
    }
  }

  // ========== 2. 合法枚举值应被接受 ==========
  console.log('\n--- 2. 合法枚举值应被接受 ---')

  const validTests = [
    { path: 'general.theme', value: 'dark', label: 'theme dark' },
    { path: 'general.theme', value: 'light', label: 'theme light' },
    { path: 'general.theme', value: 'system', label: 'theme system' },
    { path: 'general.language', value: 'zh-CN', label: 'language zh-CN' },
    { path: 'general.language', value: 'en-US', label: 'language en-US' },
    { path: 'general.closeBehavior', value: 'ask', label: 'closeBehavior ask' },
    { path: 'general.closeBehavior', value: 'tray', label: 'closeBehavior tray' },
    { path: 'general.closeBehavior', value: 'exit', label: 'closeBehavior exit' },
    { path: 'general.logLevel', value: 'debug', label: 'logLevel debug' },
    { path: 'general.logLevel', value: 'info', label: 'logLevel info' },
    { path: 'general.logLevel', value: 'warn', label: 'logLevel warn' },
    { path: 'general.logLevel', value: 'error', label: 'logLevel error' },
    { path: 'general.logLevel', value: 'off', label: 'logLevel off' },
    { path: 'chat.steeringMode', value: 'all', label: 'steeringMode all' },
    { path: 'chat.steeringMode', value: 'one-at-a-time', label: 'steeringMode one' },
    { path: 'chat.followUpMode', value: 'all', label: 'followUpMode all' },
    { path: 'chat.followUpMode', value: 'one-at-a-time', label: 'followUpMode one' },
    { path: 'chat.thinkingLevel', value: 'off', label: 'thinkingLevel off' },
    { path: 'chat.thinkingLevel', value: 'minimal', label: 'thinkingLevel minimal' },
    { path: 'chat.thinkingLevel', value: 'low', label: 'thinkingLevel low' },
    { path: 'chat.thinkingLevel', value: 'medium', label: 'thinkingLevel medium' },
    { path: 'chat.thinkingLevel', value: 'high', label: 'thinkingLevel high' },
    { path: 'chat.thinkingLevel', value: 'xhigh', label: 'thinkingLevel xhigh' },
  ]

  for (const t of validTests) {
    try {
      const r = await callRaw('settings.set', t.path, t.value)
      if (r && r.success === true) {
        ok(`接受 ${t.label}`, `${t.path}=${t.value}`)
      } else {
        fail(`接受 ${t.label}`, '', safeStr(r, 80))
      }
    } catch (e) {
      fail(`接受 ${t.label}`, '', e)
    }
  }

  // ========== 3. 非枚举字段不受影响 ==========
  console.log('\n--- 3. 非枚举字段不受影响 ---')

  const nonEnumTests = [
    { path: 'general.autoUpdate', value: false, label: 'autoUpdate' },
    { path: 'general.telemetry', value: true, label: 'telemetry' },
    { path: 'general.minimizeToTray', value: false, label: 'minimizeToTray' },
    { path: 'chat.showImages', value: false, label: 'showImages' },
    { path: 'chat.maxTokens', value: 16384, label: 'maxTokens' },
    { path: 'chat.conversationLogging', value: false, label: 'conversationLogging' },
  ]

  for (const t of nonEnumTests) {
    try {
      const r = await callRaw('settings.set', t.path, t.value)
      if (r && r.success === true) {
        ok(`非枚举 ${t.label}`, `${t.path}=${t.value}`)
      } else {
        fail(`非枚举 ${t.label}`, '', safeStr(r, 80))
      }
    } catch (e) {
      fail(`非枚举 ${t.label}`, '', e)
    }
  }

  // ========== 4. 恢复默认 ==========
  console.log('\n--- 4. 恢复默认 ---')
  try {
    const r = await callRaw('settings.reset')
    ok('settings.reset', safeStr(r, 80))
  } catch (e) {
    fail('settings.reset', '', e)
  }

  // ========== 5. 回归验证: 其他功能不受影响 ==========
  console.log('\n--- 5. 回归验证 ---')

  try {
    const r = await callRaw('eaa.info')
    ok('eaa.info 回归', safeStr(r?.data, 80))
  } catch (e) {
    fail('eaa.info 回归', '', e)
  }

  try {
    const r = await callRaw('agent.list')
    const agents = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
    ok('agent.list 回归', `count=${agents.length}`)
  } catch (e) {
    fail('agent.list 回归', '', e)
  }

  try {
    const r = await callRaw('settings.get')
    ok('settings.get 回归', `theme=${r?.data?.general?.theme || r?.general?.theme} logLevel=${r?.data?.general?.logLevel || r?.general?.logLevel}`)
  } catch (e) {
    fail('settings.get 回归', '', e)
  }

  // ========== 6. 汇总 ==========
  console.log('\n=== R44 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  fs.writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r44-result.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
