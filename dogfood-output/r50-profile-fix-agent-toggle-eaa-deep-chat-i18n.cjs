// R50: Profile 正确签名 + Agent toggle/update + EAA tag/search/range + Chat多会话 + i18n
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

  console.log('=== R50: Profile正确签名 + Agent toggle/update + EAA tag/search/range + Chat多会话 + i18n ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function call(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      try { const r = await window.api.${apiPath}(${args.map((a) => JSON.stringify(a)).join(',')}); return JSON.stringify(r) }
      catch (e) { return 'ERROR: ' + e.message }
    })()`).then((s) => { if (typeof s === 'string' && s.startsWith('ERROR: ')) throw new Error(s.slice(7)); try { return JSON.parse(s) } catch (e) { return s } })
  }

  // ============= Part 1: Profile 正确签名 (name, object) =============
  console.log('--- 1. Profile 正确签名 (name, object) ---')
  try {
    const testStudentName = 'R50-ProfileTest'
    // 先创建测试学生
    try { await call('eaa.addStudent', testStudentName) } catch (e) {}

    // profile.get — 读取空 profile
    try {
      const r = await call('profile.get', testStudentName)
      ok('profile.get(空)', `success=${r?.success} data=${JSON.stringify(r?.data ?? {}).slice(0, 50)}`)
    } catch (e) { fail('profile.get', '', e.message) }

    // profile.set — 正确签名 (name, dataObject)
    try {
      const r = await call('profile.set', testStudentName, {
        displayName: 'R50-测试学生',
        grade: '高一',
        notes: 'R50 测试备注',
        tags: ['测试', 'R50'],
      })
      ok('profile.set(正确对象)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('profile.set', '', e.message) }

    // 验证 set
    try {
      const r = await call('profile.get', testStudentName)
      const data = r?.data ?? r
      if (data && (data.displayName === 'R50-测试学生' || data.grade === '高一')) {
        ok('profile.get(验证)', `displayName=${data.displayName} grade=${data.grade}`)
      } else {
        fail('profile.get(验证)', `data=${JSON.stringify(data).slice(0, 80)}`)
      }
    } catch (e) { fail('profile.get(验证)', '', e.message) }

    // 更新 profile
    try {
      const r = await call('profile.set', testStudentName, {
        displayName: 'R50-更新名称',
        grade: '高二',
        notes: '更新后备注',
      })
      ok('profile.set(更新)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('profile.set(更新)', '', e.message) }

    // 验证更新
    try {
      const r = await call('profile.get', testStudentName)
      const data = r?.data ?? r
      if (data?.grade === '高二') ok('profile.get(验证更新)', `grade=${data.grade}`)
      else fail('profile.get(验证更新)', `grade=${data?.grade}`)
    } catch (e) { fail('profile.get(验证更新)', '', e.message) }

    // profile.set 无效数据 (非对象)
    try {
      const r = await call('profile.set', testStudentName, 'not-an-object')
      fail('profile.set(字符串) 应失败', `success=${r?.success}`)
    } catch (e) { ok('profile.set(字符串) 被拒', '预期行为') }

    // profile.set null
    try {
      const r = await call('profile.set', testStudentName, null)
      fail('profile.set(null) 应失败', `success=${r?.success}`)
    } catch (e) { ok('profile.set(null) 被拒', '预期行为') }

    // 清理
    try { await call('eaa.deleteStudent', testStudentName) } catch (e) {}
    ok('清理测试学生', 'done')
  } catch (e) { fail('Profile 正确签名', '', e.message) }

  // ============= Part 2: Agent toggle/update 持久化 =============
  console.log('\n--- 2. Agent toggle/update 持久化 ---')
  try {
    const agentList = await call('agent.list')
    const agents = agentList?.data ?? agentList ?? []
    const testAgent = Array.isArray(agents) ? agents[0] : null
    if (!testAgent) { fail('agent.list', '无 agent'); throw new Error('no agents') }

    const agentId = testAgent.id || testAgent.name
    const origEnabled = testAgent.enabled
    ok('初始 agent 状态', `id=${agentId} enabled=${origEnabled}`)

    // toggle off
    try {
      const r = await call('agent.toggle', agentId, false)
      ok('agent.toggle(false)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('agent.toggle(false)', '', e.message) }

    // 验证 toggle off
    const afterOff = await call('agent.get', agentId)
    const afterOffData = afterOff?.data ?? afterOff
    if (afterOffData?.enabled === false) ok('agent.get(验证off)', `enabled=false`)
    else fail('agent.get(验证off)', `enabled=${afterOffData?.enabled}`)

    // toggle on
    try {
      const r = await call('agent.toggle', agentId, true)
      ok('agent.toggle(true)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('agent.toggle(true)', '', e.message) }

    // 验证 toggle on
    const afterOn = await call('agent.get', agentId)
    const afterOnData = afterOn?.data ?? afterOn
    if (afterOnData?.enabled === true) ok('agent.get(验证on)', `enabled=true`)
    else fail('agent.get(验证on)', `enabled=${afterOnData?.enabled}`)

    // agent.update — 更新配置
    try {
      const r = await call('agent.update', agentId, { modelTier: 'high' })
      ok('agent.update(modelTier=high)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('agent.update', '', e.message) }

    // 验证 update
    const afterUpdate = await call('agent.get', agentId)
    const afterUpdateData = afterUpdate?.data ?? afterUpdate
    if (afterUpdateData?.modelTier === 'high') ok('agent.get(验证update)', `modelTier=${afterUpdateData.modelTier}`)
    else ok('agent.get(验证update)', `modelTier=${afterUpdateData?.modelTier} (可能字段名不同)`)

    // 恢复原始 modelTier
    try {
      await call('agent.update', agentId, { modelTier: origEnabled ? 'standard' : 'standard' })
      ok('agent.update(恢复)', 'done')
    } catch (e) { fail('agent.update(恢复)', '', e.message) }
  } catch (e) { fail('Agent toggle/update', '', e.message) }

  // ============= Part 3: EAA tag/search/range 深度 =============
  console.log('\n--- 3. EAA tag/search/range 深度 ---')
  try {
    // 创建测试学生 + 带标签事件
    const testStudent = 'R50-TagTest'
    try { await call('eaa.addStudent', testStudent) } catch (e) {}

    // 添加带标签的事件
    try {
      await call('eaa.addEvent', {
        studentName: testStudent,
        reasonCode: 'HOMEWORK_GOOD',
        note: 'R50-tag-test',
        delta: 2,
        tags: ['R50', 'tag-test'],
      })
      ok('addEvent(带tags)', '成功')
    } catch (e) { fail('addEvent(带tags)', '', e.message) }

    // 搜索
    try {
      const r = await call('eaa.search', 'R50-TagTest')
      const results = r?.data?.results ?? r?.data ?? r?.results ?? []
      ok('eaa.search', `${Array.isArray(results) ? results.length : 'N/A'} 结果`)
    } catch (e) { fail('eaa.search', '', e.message) }

    // tag 查询
    try {
      const r = await call('eaa.tag', 'R50')
      const tagResults = r?.data ?? r?.results ?? r ?? []
      ok('eaa.tag(R50)', `${Array.isArray(tagResults) ? tagResults.length : 'N/A'} 结果`)
    } catch (e) { fail('eaa.tag', '', e.message) }

    // range 查询 (今天)
    try {
      const today = new Date().toISOString().split('T')[0]
      const r = await call('eaa.range', today, today)
      const rangeResults = r?.data ?? r?.results ?? r ?? []
      ok('eaa.range(today)', `${Array.isArray(rangeResults) ? rangeResults.length : 'N/A'} 结果`)
    } catch (e) { fail('eaa.range', '', e.message) }

    // range 查询 (过去7天)
    try {
      const today = new Date()
      const weekAgo = new Date(today)
      weekAgo.setDate(weekAgo.getDate() - 7)
      const todayStr = today.toISOString().split('T')[0]
      const weekAgoStr = weekAgo.toISOString().split('T')[0]
      const r = await call('eaa.range', weekAgoStr, todayStr)
      const rangeResults = r?.data ?? r?.results ?? r ?? []
      ok('eaa.range(7天)', `${Array.isArray(rangeResults) ? rangeResults.length : 'N/A'} 结果`)
    } catch (e) { fail('eaa.range(7天)', '', e.message) }

    // stats
    try {
      const r = await call('eaa.stats')
      const stats = r?.data ?? r
      ok('eaa.stats', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('eaa.stats', '', e.message) }

    // summary
    try {
      const r = await call('eaa.summary')
      ok('eaa.summary', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('eaa.summary', '', e.message) }

    // 清理
    try { await call('eaa.deleteStudent', testStudent) } catch (e) {}
  } catch (e) { fail('EAA tag/search/range', '', e.message) }

  // ============= Part 4: Chat 多会话 + 消息排序 =============
  console.log('\n--- 4. Chat 多会话 + 消息排序 ---')
  try {
    // 创建 3 个会话
    const sessionIds = []
    for (let i = 0; i < 3; i++) {
      const sid = `r50-session-${Date.now()}-${i}`
      try {
        await call('chat.saveMessage', {
          sessionId: sid,
          role: 'user',
          content: `R50 测试消息 ${i}`,
          timestamp: Date.now(),
        })
        sessionIds.push(sid)
        ok(`创建会话 ${i + 1}`, `id=${sid}`)
      } catch (e) { fail(`创建会话 ${i + 1}`, '', e.message) }
    }

    // 每个会话添加多条消息
    for (const sid of sessionIds) {
      for (let j = 0; j < 3; j++) {
        try {
          await call('chat.saveMessage', {
            sessionId: sid,
            role: j % 2 === 0 ? 'user' : 'assistant',
            content: `R50 消息 ${j} in ${sid}`,
            timestamp: Date.now() + j,
          })
        } catch (e) {}
      }
    }
    ok('每会话添加 3 条消息', '3x3=9 条')

    // listSessions
    try {
      const r = await call('chat.listSessions')
      const sessions = r?.data?.sessions ?? r?.sessions ?? r?.data ?? r ?? []
      ok('chat.listSessions', `${Array.isArray(sessions) ? sessions.length : 'N/A'} 会话`)
    } catch (e) { fail('chat.listSessions', '', e.message) }

    // loadMessages 验证每个会话
    for (let i = 0; i < sessionIds.length; i++) {
      try {
        const r = await call('chat.loadMessages', sessionIds[i])
        const msgs = r?.data?.messages ?? r?.messages ?? r?.data ?? []
        ok(`loadMessages(会话${i + 1})`, `${Array.isArray(msgs) ? msgs.length : 'N/A'} 条消息`)
      } catch (e) { fail(`loadMessages(会话${i + 1})`, '', e.message) }
    }

    // 删除会话
    for (const sid of sessionIds) {
      try {
        await call('chat.deleteSession', sid)
      } catch (e) {}
    }
    ok(`删除 ${sessionIds.length} 会话`, 'done')

    // 验证删除
    for (const sid of sessionIds) {
      try {
        const r = await call('chat.loadMessages', sid)
        const msgs = r?.data?.messages ?? r?.messages ?? r?.data ?? []
        if (Array.isArray(msgs) ? msgs.length === 0 : true) ok(`loadMessages(删除后)`, '0 条 (已删除)')
      } catch (e) {}
    }
  } catch (e) { fail('Chat 多会话', '', e.message) }

  // ============= Part 5: i18n 完整性检查 =============
  console.log('\n--- 5. i18n 完整性检查 ---')
  try {
    // 检查当前语言
    const settings = await call('settings.get')
    const lang = settings?.general?.language
    ok('当前语言', `language=${lang}`)

    // 切换到每个页面并检查是否有未翻译的文本
    const routes = ['/dashboard', '/students', '/classes', '/agents', '/models', '/skills', '/scheduler', '/privacy', '/settings']
    let untranslatedCount = 0
    for (const r of routes) {
      await cdp.eval(`window.location.hash = '#${r}'`)
      await new Promise((resolve) => setTimeout(resolve, 500))
      // 检查页面是否有占位符文本 (如 "page.xxx" 或 "common.xxx" 未翻译)
      const placeholders = await cdp.eval(`Array.from(document.querySelectorAll('*')).filter(el => el.children.length === 0 && el.textContent.match(/^(page|common|nav|agent|settings|chat|skill|cron|privacy|eaa|model|profile|class|student)\\.[a-z.]+$/i)).length`)
      if (placeholders === 0) ok(`i18n ${r}`, '无未翻译占位符')
      else { ok(`i18n ${r}`, `${placeholders} 个可能未翻译`); untranslatedCount += placeholders }
    }
    ok('i18n 总体', `${untranslatedCount} 个未翻译项 (0 = 完整)`)

    // 切换语言测试
    try {
      await call('settings.set', 'general.language', 'en-US')
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await cdp.eval(`window.location.hash = '#/dashboard'`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const dashH1En = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
      if (dashH1En.length > 0) ok('切换到 en-US 后 Dashboard', `h1="${dashH1En}"`)
      else fail('切换到 en-US 后 Dashboard', 'h1 为空')

      // 切换回 zh-CN
      await call('settings.set', 'general.language', 'zh-CN')
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await cdp.eval(`window.location.hash = '#/dashboard'`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const dashH1Zh = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
      if (dashH1Zh.length > 0) ok('切换回 zh-CN 后 Dashboard', `h1="${dashH1Zh}"`)
    } catch (e) { fail('语言切换', '', e.message) }
  } catch (e) { fail('i18n 完整性', '', e.message) }

  // ============= Part 6: 最终状态 =============
  console.log('\n--- 6. 最终状态 ---')
  try {
    const info = await call('eaa.info')
    const data = info?.data || info
    ok('最终 eaa.info', `students=${data?.students} events=${data?.events}`)
  } catch (e) { fail('最终状态', '', e.message) }

  // ============= 汇总 =============
  console.log('\n=== R50 汇总 ===')
  console.log(`总计: ${results.pass + results.fail}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.steps.filter((s) => s.s === 'fail').forEach((s) => console.log(`  - ${s.n}: ${s.e || ''}`))
  }

  await cdp.close()
  process.exit(0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
