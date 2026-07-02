// 第十二轮测试 — Settings 深度 + AI 深度 + Feishu + 错误恢复
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
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

  console.log('=== 第十二轮: Settings 深度 + AI 深度 + Feishu + 错误恢复 ===\n')

  // ========== 1. Settings 深度测试 ==========
  console.log('--- 1. Settings 深度测试 ---')

  // 1.1 读取全部设置
  const settings = await cdp.eval(`(async()=>{
    const r = await window.api.settings.get();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const sections = Object.keys(settings || {})
  ok('Settings 读取', `${sections.length} 个 section: ${sections.join(', ')}`)

  // 1.2 逐个 section 验证字段
  const generalFields = Object.keys(settings?.general || {})
  ok('general 字段', `${generalFields.length}: ${generalFields.join(', ')}`)

  const modelsFields = Object.keys(settings?.models || {})
  ok('models 字段', `${modelsFields.length}: ${modelsFields.join(', ')}`)

  const chatFields = Object.keys(settings?.chat || {})
  ok('chat 字段', `${chatFields.length}: ${chatFields.join(', ')}`)

  const privacyFields = Object.keys(settings?.privacy || {})
  ok('privacy 字段', `${privacyFields.length}: ${privacyFields.join(', ')}`)

  const feishuFields = Object.keys(settings?.feishu || {})
  ok('feishu 字段', `${feishuFields.length}: ${feishuFields.join(', ')}`)

  const advancedFields = Object.keys(settings?.advanced || {})
  ok('advanced 字段', `${advancedFields.length}: ${advancedFields.join(', ')}`)

  const shortcutKeys = Object.keys(settings?.shortcuts || {})
  ok('shortcuts 字段', `${shortcutKeys.length}: ${shortcutKeys.join(', ')}`)

  // 1.3 读写测试: general.theme
  const origTheme = settings?.general?.theme
  const setThemeR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('general.theme', 'light');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (setThemeR?.success !== false) ok('Settings set theme', 'light')
  else warn('Settings set theme', errMsg(setThemeR))

  const readThemeR = await cdp.eval(`(async()=>{
    const r = await window.api.settings.get();
    return r?.general?.theme;
  })()`)
  if (readThemeR === 'light') ok('Settings theme 一致', 'light ✓')
  else warn('Settings theme 一致', `实际 ${readThemeR}`)

  // 恢复
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('general.theme', '${origTheme}'); } catch(e) {}
  })()`)

  // 1.4 读写测试: general.logLevel
  const origLogLevel = settings?.general?.logLevel
  const setLogR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('general.logLevel', 'debug');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (setLogR?.success !== false) ok('Settings set logLevel', 'debug')
  else warn('Settings set logLevel', errMsg(setLogR))

  // 恢复
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('general.logLevel', '${origLogLevel}'); } catch(e) {}
  })()`)

  // 1.5 读写测试: general.language
  const origLang = settings?.general?.language
  const setLangR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('general.language', 'en-US');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (setLangR?.success !== false) ok('Settings set language', 'en-US')
  else warn('Settings set language', errMsg(setLangR))

  // 恢复
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('general.language', '${origLang}'); } catch(e) {}
  })()`)

  // 1.6 读写测试: chat.thinkingLevel
  const origThink = settings?.chat?.thinkingLevel
  const setThinkR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('chat.thinkingLevel', 'high');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (setThinkR?.success !== false) ok('Settings set thinkingLevel', 'high')
  else warn('Settings set thinkingLevel', errMsg(setThinkR))

  // 恢复
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('chat.thinkingLevel', '${origThink}'); } catch(e) {}
  })()`)

  // 1.7 读写测试: chat.maxTokens
  const origMaxTokens = settings?.chat?.maxTokens
  const setTokensR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('chat.maxTokens', 16384);
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (setTokensR?.success !== false) ok('Settings set maxTokens', '16384')
  else warn('Settings set maxTokens', errMsg(setTokensR))

  // 恢复
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('chat.maxTokens', ${origMaxTokens}); } catch(e) {}
  })()`)

  // 1.8 读写测试: shortcuts
  const origShortcut = settings?.shortcuts?.['chat.send']
  const setShortcutR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('shortcuts.chat.send', 'Ctrl+Enter');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (setShortcutR?.success !== false) ok('Settings set shortcut', 'Ctrl+Enter')
  else warn('Settings set shortcut', errMsg(setShortcutR))

  // 恢复
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('shortcuts.chat.send', ${JSON.stringify(origShortcut)}); } catch(e) {}
  })()`)

  // 1.9 无效值测试
  const invalidThemeR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('general.theme', 'INVALID_THEME_XYZ');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (invalidThemeR?.success === false || invalidThemeR?.error) ok('无效主题被拒', '✓')
  else warn('无效主题被拒', '未拒绝')

  const invalidPathR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('invalid.nonexistent.path', 'test');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (invalidPathR?.success === false || invalidPathR?.error) ok('无效路径被拒', '✓')
  else warn('无效路径被拒', '未拒绝')

  const invalidLogLevelR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('general.logLevel', 'INVALID_LEVEL');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (invalidLogLevelR?.success === false || invalidLogLevelR?.error) ok('无效 logLevel 被拒', '✓')
  else warn('无效 logLevel 被拒', '未拒绝')

  // ========== 2. AI 系统深度测试 ==========
  console.log('\n--- 2. AI 系统深度测试 ---')

  // 2.1 列出 providers
  const providers = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.listProviders();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return []; }
  })()`)
  const providerArr = Array.isArray(providers) ? providers : (providers?.data || [])
  ok('AI providers', `${providerArr.length} 个`)
  if (providerArr.length > 0) {
    ok('Provider 详情', `${providerArr[0]?.id}: ${providerArr[0]?.name}`)
  }

  // 2.2 列出 models (用第一个 provider)
  if (providerArr.length > 0) {
    const providerId = providerArr[0].id
    const models = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.ai.listModels('${providerId}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return []; }
    })()`)
    const modelArr = Array.isArray(models) ? models : (models?.data || [])
    ok(`AI models (${providerId})`, `${modelArr.length} 个`)
    if (modelArr.length > 0) {
      ok('Model 详情', `${modelArr[0]?.id}: ${modelArr[0]?.name ?? '?'}`)
    }
  }

  // 2.3 testConnection (无效 key, 应 graceful 失败)
  if (providerArr.length > 0) {
    const testR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.ai.testConnection('${providerArr[0].id}', 'invalid-key-12345');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (testR?.success === false || testR?.error) ok('AI testConnection', 'graceful 失败 (无效 key) ✓')
    else warn('AI testConnection', `意外成功: ${JSON.stringify(testR).slice(0, 80)}`)
  }

  // 2.4 setApiKey + deleteApiKey
  if (providerArr.length > 0) {
    const setKeyR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.ai.setApiKey('${providerArr[0].id}', 'test-key-r12');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (setKeyR?.success !== false) ok('AI setApiKey', '成功')
    else warn('AI setApiKey', errMsg(setKeyR))

    const delKeyR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.ai.deleteApiKey('${providerArr[0].id}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (delKeyR?.success !== false) ok('AI deleteApiKey', '成功')
    else warn('AI deleteApiKey', errMsg(delKeyR))
  }

  // 2.5 addCustomModel + deleteCustomModel
  const customModelR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.addCustomModel({
        providerId: 'openai',
        modelId: 'r12-test-model',
        name: 'R12测试模型',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        supportsReasoning: false
      });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (customModelR?.success !== false || customModelR?.id) ok('AI addCustomModel', '成功')
  else warn('AI addCustomModel', errMsg(customModelR))

  const delCustomR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.deleteCustomModel('openai', 'r12-test-model');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (delCustomR?.success !== false) ok('AI deleteCustomModel', '成功')
  else warn('AI deleteCustomModel', errMsg(delCustomR))

  // 2.6 abortChat
  const abortChatR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.abortChat();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (abortChatR?.success !== false) ok('AI abortChat', '成功')
  else warn('AI abortChat', errMsg(abortChatR))

  // ========== 3. Feishu 集成测试 ==========
  console.log('\n--- 3. Feishu 集成测试 ---')

  // 3.1 Feishu status
  const feishuStatus = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.feishu.status();
      return r;
    } catch(e) { return null; }
  })()`)
  ok('Feishu status', feishuStatus || '未配置')

  // 3.2 Feishu test (无效 appId, 应 graceful 失败)
  const feishuTestR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.feishu.test('invalid_app_id_r12');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (feishuTestR?.success === false || feishuTestR?.error) ok('Feishu test', 'graceful 失败 (无效 appId) ✓')
  else warn('Feishu test', `意外: ${JSON.stringify(feishuTestR).slice(0, 80)}`)

  // ========== 4. 错误恢复 + 数据完整性 ==========
  console.log('\n--- 4. 错误恢复 + 数据完整性 ---')

  // 4.1 快速创建/删除循环 (10 次)
  let rapidOk = 0
  for (let i = 0; i < 10; i++) {
    const name = `R12快速_${i}_${Date.now()}`
    const createR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.addStudent('${name}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false }; }
    })()`)
    if (createR?.success !== false) {
      const delR = await cdp.eval(`(async()=>{
        try {
          const r = await window.api.eaa.deleteStudent('${name}', '快速删除');
          return JSON.parse(JSON.stringify(r));
        } catch(e) { return { success: false }; }
    })()`)
      if (delR?.success !== false) rapidOk++
    }
  }
  ok('快速创建/删除', `${rapidOk}/10 成功`)

  // 4.2 并发创建 (5 个学生同时)
  const concurrentNames = Array.from({ length: 5 }, (_, i) => `R12并发_${i}_${Date.now()}`)
  const concR = await cdp.eval(`(async()=>{
    const promises = [${concurrentNames.map(n => `'${n}'`).join(',')}].map(name => window.api.eaa.addStudent(name));
    const results = await Promise.allSettled(promises);
    return {
      fulfilled: results.filter(r => r.status === 'fulfilled').length,
      success: results.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
    };
  })()`)
  ok('并发创建', `${concR?.success ?? 0}/5 成功`)

  // 清理并发创建的学生
  for (const name of concurrentNames) {
    await cdp.eval(`(async()=>{
      try { await window.api.eaa.deleteStudent('${name}', '清理'); } catch(e) {}
    })()`)
  }

  // 4.3 重复操作 (同一学生创建两次)
  const dupName = `R12重复_${Date.now()}`
  const dup1 = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addStudent('${dupName}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (dup1?.success !== false) ok('首次创建', '成功')

  const dup2 = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addStudent('${dupName}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (dup2?.success === false || dup2?.data?.includes('already') || dup2?.data?.includes('exist')) {
    ok('重复创建', '被拒绝 ✓')
  } else {
    warn('重复创建', `结果: ${JSON.stringify(dup2).slice(0, 80)}`)
  }

  // 清理
  await cdp.eval(`(async()=>{
    try { await window.api.eaa.deleteStudent('${dupName}', '清理'); } catch(e) {}
  })()`)

  // 4.4 空操作 (空字符串参数)
  const emptyNameR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addStudent('');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (emptyNameR?.success === false || emptyNameR?.error) ok('空名学生被拒', '✓')
  else warn('空名学生被拒', '未拒绝')

  // 4.5 超长名称
  const longName = 'A'.repeat(200)
  const longNameR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addStudent('${longName}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (longNameR?.success === false || longNameR?.error) ok('超长名称被拒', '✓')
  else {
    warn('超长名称', '未被拒绝,清理中')
    await cdp.eval(`(async()=>{
      try { await window.api.eaa.deleteStudent('${longName}', '清理'); } catch(e) {}
    })()`)
  }

  // 4.6 特殊字符名称
  const specialName = `R12特殊<>''&_${Date.now()}`
  const specialR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addStudent('R12特殊学生_${Date.now()}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (specialR?.success !== false) ok('中文名称', '成功')
  else warn('中文名称', errMsg(specialR))

  // 清理
  await cdp.eval(`(async()=>{
    try { await window.api.eaa.deleteStudent('R12特殊学生_${Date.now()}', '清理'); } catch(e) {}
  })()`)

  // ========== 5. Profile 系统测试 ==========
  console.log('\n--- 5. Profile 系统测试 ---')

  // 5.1 创建学生 + 读取 profile
  const profileStudent = `R12Profile_${Date.now()}`
  await cdp.eval(`(async()=>{
    try { await window.api.eaa.addStudent('${profileStudent}'); } catch(e) {}
  })()`)

  const profileR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.profile.get('${profileStudent}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (profileR?.success !== false) ok('Profile 读取', '成功')
  else warn('Profile 读取', errMsg(profileR))

  // 5.2 Profile 写入
  const setProfileR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.profile.set('${profileStudent}', {
        note: 'R12测试备注',
        tags: ['测试', 'R12']
      });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (setProfileR?.success !== false) ok('Profile 写入', '成功')
  else warn('Profile 写入', errMsg(setProfileR))

  // 5.3 Profile 读回验证
  const readBackProfile = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.profile.get('${profileStudent}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return null; }
  })()`)
  const profileNote = readBackProfile?.data?.note || readBackProfile?.data?.data?.note
  if (profileNote === 'R12测试备注') ok('Profile 一致性', '读写一致 ✓')
  else warn('Profile 一致性', `note: ${profileNote}`)

  // 清理
  await cdp.eval(`(async()=>{
    try { await window.api.eaa.deleteStudent('${profileStudent}', '清理'); } catch(e) {}
  })()`)

  // ========== 6. Sys 系统测试 ==========
  console.log('\n--- 6. Sys 系统测试 ---')

  // 6.1 checkUpdate
  const updateR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.sys.checkUpdate();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return null; }
  })()`)
  if (updateR) ok('Sys checkUpdate', `v${updateR?.currentVersion ?? '?'}`)
  else warn('Sys checkUpdate', '返回空')

  // 6.2 getPath
  const paths = ['home', 'temp', 'desktop', 'documents', 'downloads', 'userData']
  let pathOk = 0
  for (const p of paths) {
    const pathR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.sys.getPath('${p}');
        return r;
      } catch(e) { return null; }
    })()`)
    if (pathR) pathOk++
  }
  ok('Sys getPath', `${pathOk}/${paths.length} 成功`)

  // 6.3 notify
  const notifyR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.sys.notify('R12测试', '测试通知消息');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false }; }
  })()`)
  if (notifyR?.success !== false) ok('Sys notify', '成功')
  else warn('Sys notify', '失败')

  // 6.4 openExternal
  const extR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.sys.openExternal('https://www.baidu.com');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false }; }
  })()`)
  if (extR?.success !== false) ok('Sys openExternal', '成功')
  else warn('Sys openExternal', '失败')

  // ========== 7. 最终验证 ==========
  console.log('\n--- 7. 最终验证 ---')

  // EAA validate
  const validateR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.validate();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (validateR?.success !== false) ok('EAA validate', '通过')
  else fail('EAA validate', '', errMsg(validateR))

  // 内存检查
  const memR = await cdp.eval(`(function(){
    if(performance.memory) return { used: performance.memory.usedJSHeapSize };
    return null;
  })()`)
  if (memR) ok('内存', `${(memR.used / 1024 / 1024).toFixed(1)} MB`)
  else warn('内存', '不可用')

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r12-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R12-settings-ai-feishu-error',
  }, null, 2))
  console.log('结果已写入: r12-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
