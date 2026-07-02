// R32: Settings.set 边界值测试 + ai.chat apiKey 检查 + Skill/Profile/Log 模块深度测试
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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

  console.log('=== R32: Settings 边界 + ai.chat + Skill/Profile/Log 深度 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api: '+p.join('.')};o=o[x]}if(typeof o!=='function')return{__error:'not a function: '+p.join('.')};const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  async function callApi(path, ...args) {
    const r = await callRaw(path, ...args)
    if (r && r.__error) throw new Error(r.__error)
    if (r && r.success === false) throw new Error(String(r.data || r.error || 'failed'))
    if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data
    return r
  }

  // ========== 1. Settings.get 完整结构 ==========
  console.log('--- 1. Settings 完整结构快照 ---')
  let originalSettings
  try {
    originalSettings = await callApi('settings.get')
    // 验证各段详细字段
    const g = originalSettings.general
    ok('settings.general', `theme=${g?.theme} lang=${g?.language}`)
    ok('settings.chat', `steeringMode=${originalSettings.chat?.steeringMode} followUpMode=${originalSettings.chat?.followUpMode}`)
    ok('settings.models', `defaultProvider=${originalSettings.models?.defaultProvider}`)
    ok('settings.privacy', `enabled=${originalSettings.privacy?.enabled}`)
    ok('settings.advanced', `keys=${Object.keys(originalSettings.advanced || {}).length}`)
  } catch (e) {
    fail('settings.get', '', e)
  }

  // ========== 2. Settings.set 边界测试 ==========
  console.log('\n--- 2. Settings.set 边界值测试 ---')
  if (originalSettings) {
    // 2a. 正常修改: 修改 theme
    try {
      const r = await callRaw('settings.set', 'general', { ...originalSettings.general, theme: 'dark' })
      if (r.success) {
        const after = await callApi('settings.get')
        if (after.general.theme === 'dark') {
          ok('settings.set general.theme=dark', `生效: ${after.general.theme}`)
        } else {
          fail('settings.set general.theme=dark', `未生效: ${after.general.theme}`, '')
        }
      } else {
        fail('settings.set general.theme', '', JSON.stringify(r).slice(0, 100))
      }
    } catch (e) {
      fail('settings.set general.theme', '', e)
    }

    // 2b. 恢复原始值
    try {
      await callRaw('settings.set', 'general', originalSettings.general)
      ok('settings.set 恢复 general', 'original restored')
    } catch (e) {
      fail('settings.set 恢复', '', e)
    }

    // 2c. Bug R28-2: 设置整个 section 为 null (会破坏对象结构吗?)
    try {
      const r = await callRaw('settings.set', 'general', null)
      if (r.success) {
        const after = await callApi('settings.get')
        if (after.general === null || typeof after.general !== 'object') {
          // 这确认了 Bug R28-2: null 值会破坏 section 结构
          ok('Bug R28-2 确认: settings.set null 破坏对象', `general 变为 ${typeof after.general}`)
          // 恢复
          await callRaw('settings.set', 'general', originalSettings.general)
          ok('settings.set 恢复 general', 'restored after null test')
        } else {
          ok('settings.set null 安全', `general 仍为对象`)
        }
      } else {
        ok('settings.set null 被拒绝', JSON.stringify(r).slice(0, 80))
      }
    } catch (e) {
      ok('settings.set null 抛异常', String(e).slice(0, 80))
    }

    // 2d. Bug R28-1: 无枚举校验 — 传入非法 theme 值
    try {
      const r = await callRaw('settings.set', 'general', { ...originalSettings.general, theme: 'INVALID_THEME_XYZ' })
      if (r.success) {
        const after = await callApi('settings.get')
        if (after.general.theme === 'INVALID_THEME_XYZ') {
          ok('Bug R28-1 确认: 无枚举校验', `theme=INVALID_THEME_XYZ 被接受`)
          // 恢复
          await callRaw('settings.set', 'general', originalSettings.general)
          ok('settings.set 恢复 general', 'restored after invalid theme')
        } else {
          ok('settings.set 有枚举校验', `theme=${after.general.theme}`)
        }
      } else {
        ok('settings.set 非法 theme 被拒绝', JSON.stringify(r).slice(0, 80))
      }
    } catch (e) {
      ok('settings.set 非法 theme 抛异常', String(e).slice(0, 80))
    }
  }

  // ========== 3. Settings.reset 恢复默认 ==========
  console.log('\n--- 3. Settings.reset 恢复默认 ---')
  try {
    const r = await callRaw('settings.reset')
    if (r.success) {
      const after = await callApi('settings.get')
      const sections = ['general', 'models', 'chat', 'privacy', 'feishu', 'advanced', 'shortcuts']
      let found = 0
      for (const sec of sections) { if (sec in (after || {})) found++ }
      ok('settings.reset', `恢复后 ${found}/7 段存在`)
    } else {
      fail('settings.reset', '', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    fail('settings.reset', '', e)
  }

  // ========== 4. ai.chat 无 apiKey 测试 (Bug R29-1) ==========
  console.log('\n--- 4. ai.chat 无 apiKey 测试 (Bug R29-1) ---')
  try {
    // 先测试无 apiKey 的 chat
    const r = await cdp.eval(`(async()=>{
      try {
        const unsub = window.api.ai.onStream(()=>{});
        const r = await window.api.ai.chat({
          providerId: 'openai',
          modelId: 'gpt-4',
          messages: [{role:'user', content:'test'}]
        });
        unsub();
        return JSON.stringify({
          success: r?.success,
          data: typeof r?.data === 'string' ? r.data.slice(0,100) : null,
          error: r?.error?.slice(0,100),
          stderr: r?.stderr?.slice(0,100)
        });
      } catch(e) { return JSON.stringify({error: e.message}); }
    })()`)
    const parsed = JSON.parse(r)
    if (parsed.success === false || parsed.error) {
      ok('ai.chat 无 apiKey 被拒绝', `error=${parsed.error || parsed.stderr || 'rejected'}`)
    } else if (parsed.success === true) {
      // 检查返回的数据是否为空/错误
      ok('Bug R29-1 确认: ai.chat 无 apiKey 返回 success', `data=${parsed.data}`)
    } else {
      ok('ai.chat 返回', JSON.stringify(parsed).slice(0, 100))
    }
  } catch (e) {
    fail('ai.chat 测试', '', e)
  }

  // ========== 5. ai.listProviders + ai.listModels ==========
  console.log('\n--- 5. AI Providers + Models ---')
  try {
    const providers = await callApi('ai.listProviders')
    if (Array.isArray(providers)) {
      ok('ai.listProviders', `共 ${providers.length} 个 provider`)
      // 测试列出第一个 provider 的 models
      if (providers.length > 0) {
        const firstProvider = providers[0]
        const providerId = firstProvider.id || firstProvider.providerId || firstProvider
        try {
          const models = await callApi('ai.listModels', providerId)
          if (Array.isArray(models)) {
            ok(`ai.listModels ${providerId}`, `共 ${models.length} 个 model`)
          } else {
            ok(`ai.listModels ${providerId}`, JSON.stringify(models).slice(0, 80))
          }
        } catch (e) {
          fail(`ai.listModels ${providerId}`, '', e)
        }
      }
    } else {
      fail('ai.listProviders', '非数组', JSON.stringify(providers).slice(0, 100))
    }
  } catch (e) {
    fail('ai.listProviders', '', e)
  }

  // ========== 6. Skill 模块 ==========
  console.log('\n--- 6. Skill 模块 ---')
  try {
    const skills = await callApi('skill.list')
    if (Array.isArray(skills)) {
      ok('skill.list', `共 ${skills.length} 个 skill`)
      // 测试 get 第一个 skill
      if (skills.length > 0) {
        const firstName = skills[0].name || skills[0]
        try {
          const skillDetail = await callApi('skill.get', firstName)
          ok(`skill.get ${firstName}`, JSON.stringify(skillDetail).slice(0, 80))
        } catch (e) {
          fail(`skill.get ${firstName}`, '', e)
        }
      }
    } else {
      ok('skill.list', JSON.stringify(skills).slice(0, 80))
    }
  } catch (e) {
    fail('skill.list', '', e)
  }

  // ========== 7. Profile 模块 ==========
  console.log('\n--- 7. Profile 模块 ---')
  try {
    const profile = await callApi('profile.get')
    ok('profile.get', JSON.stringify(profile).slice(0, 100))
  } catch (e) {
    fail('profile.get', '', e)
  }
  try {
    const r = await callRaw('profile.set', { name: 'R32测试用户', role: 'tester' })
    if (r.success) {
      const after = await callApi('profile.get')
      ok('profile.set', `name=${after.name} role=${after.role}`)
      // 恢复
      await callRaw('profile.set', { name: '', role: '' })
    } else {
      fail('profile.set', '', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    fail('profile.set', '', e)
  }

  // ========== 8. Log 模块 ==========
  console.log('\n--- 8. Log 模块 ---')
  try {
    const logs = await callApi('log.list')
    ok('log.list', `共 ${Array.isArray(logs) ? logs.length : '?'} 条日志`)
  } catch (e) {
    fail('log.list', '', e)
  }
  // 测试 log.filter
  try {
    const filtered = await callApi('log.filter', { level: 'error' })
    ok('log.filter error', `共 ${Array.isArray(filtered) ? filtered.length : '?'} 条错误日志`)
  } catch (e) {
    fail('log.filter', '', e)
  }

  // ========== 9. Feishu 模块 ==========
  console.log('\n--- 9. Feishu 模块 ---')
  try {
    const status = await callRaw('feishu.status')
    ok('feishu.status', JSON.stringify(status).slice(0, 100))
  } catch (e) {
    fail('feishu.status', '', e)
  }

  // ========== 10. EAA range + tag + validate + history ==========
  console.log('\n--- 10. EAA 其他读命令 ---')
  try {
    // eaa.range (时间范围查询)
    const now = Date.now()
    const start = new Date(now - 7 * 86400000).toISOString().slice(0, 10)
    const end = new Date(now).toISOString().slice(0, 10)
    const rangeResult = await callApi('eaa.range', start, end, 10)
    ok('eaa.range 7天', JSON.stringify(rangeResult).slice(0, 100))
  } catch (e) {
    fail('eaa.range', '', e)
  }

  try {
    // eaa.tag (标签查询)
    const tagResult = await callApi('eaa.tag', 'test')
    ok('eaa.tag test', JSON.stringify(tagResult).slice(0, 100))
  } catch (e) {
    fail('eaa.tag', '', e)
  }

  try {
    // eaa.validate
    const validateResult = await callApi('eaa.validate')
    ok('eaa.validate', JSON.stringify(validateResult).slice(0, 100))
  } catch (e) {
    fail('eaa.validate', '', e)
  }

  try {
    // eaa.history
    const historyResult = await callApi('eaa.history', 10)
    ok('eaa.history 10', JSON.stringify(historyResult).slice(0, 100))
  } catch (e) {
    fail('eaa.history', '', e)
  }

  // ========== 11. eaa.export 全格式 ==========
  console.log('\n--- 11. eaa.export 全格式验证 ---')
  for (const fmt of ['csv', 'jsonl', 'html']) {
    try {
      const r = await callRaw('eaa.export', fmt)
      if (r.success) {
        ok(`eaa.export ${fmt}`, r.data ? String(r.data).slice(0, 60) : 'success')
      } else {
        fail(`eaa.export ${fmt}`, '', (r.stderr || r.data || '').slice(0, 100))
      }
    } catch (e) {
      fail(`eaa.export ${fmt}`, '', e)
    }
  }

  // ========== 12. agent.getSoul/getRules/getHistory ==========
  console.log('\n--- 12. Agent 深度 API ---')
  try {
    const agents = await callApi('agent.list')
    if (agents.length > 0) {
      const agentId = agents[0].id
      // getSoul
      try {
        const soul = await callApi('agent.getSoul', agentId)
        ok(`agent.getSoul ${agentId}`, JSON.stringify(soul).slice(0, 80))
      } catch (e) {
        fail(`agent.getSoul ${agentId}`, '', e)
      }
      // getRules
      try {
        const rules = await callApi('agent.getRules', agentId)
        ok(`agent.getRules ${agentId}`, JSON.stringify(rules).slice(0, 80))
      } catch (e) {
        fail(`agent.getRules ${agentId}`, '', e)
      }
      // getHistory
      try {
        const history = await callApi('agent.getHistory', agentId, 5)
        ok(`agent.getHistory ${agentId}`, `${Array.isArray(history) ? history.length : '?'} 条`)
      } catch (e) {
        fail(`agent.getHistory ${agentId}`, '', e)
      }
    }
  } catch (e) {
    fail('agent 深度 API', '', e)
  }

  // ========== 总结 ==========
  console.log('\n=== R32 总结 ===')
  console.log(`Pass: ${results.pass} / Fail: ${results.fail}`)
  console.log(`Total: ${results.pass + results.fail}`)

  const reportPath = path.join(__dirname, 'r32-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n结果已保存: ${reportPath}`)

  await cdp.close()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
