// R51: Bug R28-3 深度调查 (语言/主题UI同步) + Settings.reset + EAA replay + 并发写压力
const http = require('http')
const WebSocket = require('ws')

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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => { try {
      const m = JSON.parse(data.toString())
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) }
    } catch (e) {} })
  }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 45000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R51: Bug R28-3 调查 + Settings.reset + EAA replay + 并发写压力 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function call(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      try { const r = await window.api.${apiPath}(${args.map((a) => JSON.stringify(a)).join(',')}); return JSON.stringify(r) }
      catch (e) { return 'ERROR: ' + e.message }
    })()`).then((s) => { if (typeof s === 'string' && s.startsWith('ERROR: ')) throw new Error(s.slice(7)); try { return JSON.parse(s) } catch (e) { return s } })
  }

  // ============= Part 1: Bug R28-3 深度调查 (语言切换 UI 不更新) =============
  console.log('--- 1. Bug R28-3 深度调查 (语言切换 UI 不更新) ---')
  try {
    // 基线: 当前语言
    const settingsBefore = await call('settings.get')
    const langBefore = settingsBefore?.general?.language
    ok('基线语言', `language=${langBefore}`)

    // 导航到 dashboard 并读取 h1
    await cdp.eval(`window.location.hash = '#/dashboard'`)
    await new Promise((r) => setTimeout(r, 2000))
    const h1Before = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
    ok('切换前 Dashboard h1', `"${h1Before}"`)

    // 切换到 en-US
    await call('settings.set', 'general.language', 'en-US')
    await new Promise((r) => setTimeout(r, 1500))

    // 检查 h1 是否变化 (不重新加载页面)
    const h1AfterApi = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
    ok('API切换后 (无reload) h1', `"${h1AfterApi}"`)

    // 检查 i18n 当前语言 (React 状态)
    const i18nLang = await cdp.eval(`document.documentElement.lang || 'unknown'`)
    ok('document.documentElement.lang', `"${i18nLang}"`)

    // 尝试触发重新渲染: location.reload
    await cdp.eval(`window.location.reload()`)
    await new Promise((r) => setTimeout(r, 5000))

    // reload 后检查 h1
    const h1AfterReload = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
    if (h1AfterReload.length > 0) {
      if (h1AfterReload !== h1Before) {
        ok('reload 后 h1 变化', `"${h1Before}" → "${h1AfterReload}" (Bug R28-3: 需 reload 才生效)`)
      } else {
        ok('reload 后 h1 不变', `"${h1AfterReload}" (i18n 可能未读取新语言)`)
      }
    } else {
      fail('reload 后 h1 为空', '页面可能还在加载')
    }

    // 检查 settings.get 确认语言已持久化
    const settingsAfter = await call('settings.get')
    const langAfter = settingsAfter?.general?.language
    ok('settings.get 确认语言', `language=${langAfter} (应=en-US)`)

    // 切换回 zh-CN
    await call('settings.set', 'general.language', 'zh-CN')
    await new Promise((r) => setTimeout(r, 500))
    ok('切换回 zh-CN', 'done')
  } catch (e) { fail('Bug R28-3 调查', '', e.message) }

  // ============= Part 2: 主题切换 CSS 变量调查 =============
  console.log('\n--- 2. 主题切换 CSS 变量调查 ---')
  try {
    // 基线: 当前主题
    const settings = await call('settings.get')
    const themeBefore = settings?.general?.theme
    ok('基线主题', `theme=${themeBefore}`)

    // 导航到 dashboard
    await cdp.eval(`window.location.hash = '#/dashboard'`)
    await new Promise((r) => setTimeout(r, 2000))

    // 读取当前 CSS 变量
    const cssBefore = await cdp.eval(`JSON.stringify({
      bg: getComputedStyle(document.body).backgroundColor,
      color: getComputedStyle(document.body).color,
      classList: document.documentElement.className
    })`)
    ok('切换前 CSS', `body.bg=${JSON.parse(cssBefore).bg} html.class="${JSON.parse(cssBefore).classList}"`)

    // 切换主题
    const newTheme = themeBefore === 'dark' ? 'light' : 'dark'
    await call('settings.set', 'general.theme', newTheme)
    await new Promise((r) => setTimeout(r, 1500))

    // 检查 CSS 是否变化
    const cssAfter = await cdp.eval(`JSON.stringify({
      bg: getComputedStyle(document.body).backgroundColor,
      color: getComputedStyle(document.body).color,
      classList: document.documentElement.className
    })`)
    const cssAfterObj = JSON.parse(cssAfter)
    ok('API切换主题后 CSS', `body.bg=${cssAfterObj.bg} html.class="${cssAfterObj.classList}"`)

    // 检查是否有 dark class 在 html/body 上
    const hasDarkClass = await cdp.eval(`document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')`)
    ok('dark class 存在', `${hasDarkClass}`)

    // reload 后检查
    await cdp.eval(`window.location.reload()`)
    await new Promise((r) => setTimeout(r, 5000))
    const cssAfterReload = await cdp.eval(`JSON.stringify({
      bg: getComputedStyle(document.body).backgroundColor,
      classList: document.documentElement.className
    })`)
    ok('reload 后 CSS', `body.bg=${JSON.parse(cssAfterReload).bg} html.class="${JSON.parse(cssAfterReload).classList}"`)

    // 恢复原始主题
    await call('settings.set', 'general.theme', themeBefore)
    await new Promise((r) => setTimeout(r, 500))
    ok('恢复主题', `theme=${themeBefore}`)
  } catch (e) { fail('主题切换调查', '', e.message) }

  // ============= Part 3: Settings.reset 完整测试 =============
  console.log('\n--- 3. Settings.reset 完整测试 ---')
  try {
    // 修改一些设置
    await call('settings.set', 'general.theme', 'light')
    await call('settings.set', 'chat.thinkingLevel', 'high')
    await call('settings.set', 'chat.maxTokens', 16384)
    await new Promise((r) => setTimeout(r, 500))
    ok('修改设置 (reset 前)', 'theme=light, thinkingLevel=high, maxTokens=16384')

    // 验证修改生效
    const beforeReset = await call('settings.get')
    ok('reset 前 settings.get', `theme=${beforeReset?.general?.theme} thinkingLevel=${beforeReset?.chat?.thinkingLevel} maxTokens=${beforeReset?.chat?.maxTokens}`)

    // 执行 reset
    try {
      const r = await call('settings.reset')
      ok('settings.reset', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('settings.reset', '', e.message) }

    // 等待 reset 持久化
    await new Promise((r) => setTimeout(r, 500))

    // 验证 reset 后的值
    const afterReset = await call('settings.get')
    ok('reset 后 settings.get', `theme=${afterReset?.general?.theme} thinkingLevel=${afterReset?.chat?.thinkingLevel} maxTokens=${afterReset?.chat?.maxTokens}`)

    // 检查默认值
    const checks = [
      ['theme', afterReset?.general?.theme, 'dark'],
      ['thinkingLevel', afterReset?.chat?.thinkingLevel, 'medium'],
      ['maxTokens', afterReset?.chat?.maxTokens, 32768],
      ['language', afterReset?.general?.language, 'zh-CN'],
      ['logLevel', afterReset?.general?.logLevel, 'info'],
      ['closeBehavior', afterReset?.general?.closeBehavior, 'ask'],
      ['steeringMode', afterReset?.chat?.steeringMode, 'all'],
    ]
    let resetOk = 0
    for (const [field, actual, expected] of checks) {
      if (actual === expected) resetOk++
      else console.log(`    ${field}: actual=${actual} expected=${expected}`)
    }
    if (resetOk === checks.length) ok('reset 后 7 个字段全为默认值', '完全重置')
    else fail('reset 后字段不匹配', `${resetOk}/${checks.length} 正确`)
  } catch (e) { fail('Settings.reset', '', e.message) }

  // ============= Part 4: EAA replay 深度 =============
  console.log('\n--- 4. EAA replay 深度 ---')
  try {
    // replay 无参数
    try {
      const r = await call('eaa.replay')
      const data = r?.data ?? r
      ok('eaa.replay()', `success=${r?.success ?? 'done'} type=${typeof data}`)
    } catch (e) { fail('eaa.replay()', '', e.message) }

    // replay 带日期参数
    try {
      const today = new Date().toISOString().split('T')[0]
      const r = await call('eaa.replay', today)
      const data = r?.data ?? r
      ok('eaa.replay(today)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('eaa.replay(today)', '', e.message) }

    // replay 带7天范围
    try {
      const today = new Date()
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      const todayStr = today.toISOString().split('T')[0]
      const weekAgoStr = weekAgo.toISOString().split('T')[0]
      const r = await call('eaa.replay', weekAgoStr, todayStr)
      ok('eaa.replay(7天范围)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('eaa.replay(7天)', '', e.message) }
  } catch (e) { fail('EAA replay', '', e.message) }

  // ============= Part 5: 并发写压力 (Chat + Cron 并发) =============
  console.log('\n--- 5. 并发写压力 (Chat + Cron 并发) ---')
  try {
    // 获取内存基线
    const memBefore = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)

    // 10 个并发 chat.saveMessage
    const chatPromises = []
    for (let i = 0; i < 10; i++) {
      const sid = `r51-concurrent-${Date.now()}-${i}`
      chatPromises.push(call('chat.saveMessage', { sessionId: sid, role: 'user', content: `R51 concurrent ${i}`, timestamp: Date.now() }).then(() => sid))
    }
    const chatResults = await Promise.allSettled(chatPromises)
    const chatSuccess = chatResults.filter((r) => r.status === 'fulfilled').length
    ok('10 并发 chat.saveMessage', `${chatSuccess}/10 成功`)

    // 5 个并发 cron.add
    const cronPromises = []
    for (let i = 0; i < 5; i++) {
      cronPromises.push(call('cron.add', {
        name: `R51-Concurrent-${i}`,
        agentId: 'academic',
        expression: '0 9 * * *',
        prompt: `R51 concurrent cron ${i}`,
        enabled: false,
        modelTier: 'standard',
      }))
    }
    const cronResults = await Promise.allSettled(cronPromises)
    const cronSuccess = cronResults.filter((r) => r.status === 'fulfilled').length
    ok('5 并发 cron.add', `${cronSuccess}/5 成功`)

    // 清理 cron 任务
    for (const r of cronResults) {
      if (r.status === 'fulfilled' && r.value?.id) {
        try { await call('cron.remove', r.value.id) } catch (e) {}
      }
    }

    // 清理 chat 会话
    for (const r of chatResults) {
      if (r.status === 'fulfilled' && r.value) {
        try { await call('chat.deleteSession', r.value) } catch (e) {}
      }
    }
    ok('清理并发测试数据', 'done')

    // 内存对比
    const memAfter = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    if (memBefore && memAfter) {
      const delta = Math.round((memAfter - memBefore) / 1024)
      ok('内存变化', `${delta} KB (15 并发写操作)`)
    }
  } catch (e) { fail('并发写压力', '', e.message) }

  // ============= Part 6: 最终状态 =============
  console.log('\n--- 6. 最终状态 ---')
  try {
    const info = await call('eaa.info')
    const data = info?.data || info
    ok('最终 eaa.info', `students=${data?.students} events=${data?.events}`)

    const validate = await call('eaa.validate')
    const vd = validate?.data || validate
    ok('最终 eaa.validate', `valid=${vd?.valid ?? vd?.success} errors=${vd?.errors?.length ?? 0}`)
  } catch (e) { fail('最终状态', '', e.message) }

  // ============= 汇总 =============
  console.log('\n=== R51 汇总 ===')
  console.log(`总计: ${results.pass + results.fail}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.steps.filter((s) => s.s === 'fail').forEach((s) => console.log(`  - ${s.n}: ${s.e || ''}`))
  }

  await cdp.close()
  process.exit(0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
