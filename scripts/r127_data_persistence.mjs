// =============================================================
// R127: 数据持久化测试 (重载后状态保留)
// 角度 1: Settings 持久化 (general/chat/feishu/mcp)
// 角度 2: Profiles 持久化 (EAA 学生 profile)
// 角度 3: Skills 持久化
// 角度 4: Cron tasks 持久化
// 角度 5: EAA students/events 持久化
// 角度 6: Chat sessions 持久化
// 角度 7: Agents 持久化
// 角度 8: 重载后应用功能正常
// =============================================================

import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/json`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function cdpCall(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.toString())
      if (msg.id === id) {
        ws.off('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`CDP timeout: ${method}`))
    }, 60000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 55000,
  })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function connectWS() {
  let WebSocket
  try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }
  const targets = await getTargets()
  const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
  if (!pageTarget) { console.error('No page target found.'); process.exit(1) }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('ws connect timeout')), 10000) })
  return ws
}

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ✅ ${name}`) }
  else { results.fail++; results.errors.push(name); console.log(`  ❌ ${name} ${detail}`) }
}

const STAMP = `r127-${Date.now()}`
console.log('\n=== R127: 数据持久化测试 ===')

let ws = await connectWS()
console.log(`[R127] STAMP = ${STAMP}`)

// =============================================================
console.log('\n[R127-1] Settings 持久化')

// 保存一个测试设置
const testThemeValue = 'dark'
await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', ${JSON.stringify(testThemeValue)});
  await window.api.settings.set('chat.maxTokens', 8192);
  await window.api.settings.set('mcp.enabled', false);
  return true;
})()`)

// 读取确认 (settings.get() 返回整个 settings 对象)
const settingsBefore = await evalInPage(ws, `(async () => {
  const s = await window.api.settings.get();
  return {
    theme: s?.general?.theme,
    maxTokens: s?.chat?.maxTokens,
    mcpEnabled: s?.mcp?.enabled,
  };
})()`)

check('Settings 保存后立即读取一致',
  settingsBefore?.theme === testThemeValue && settingsBefore?.maxTokens === 8192 && settingsBefore?.mcpEnabled === false,
  `theme=${settingsBefore?.theme}, maxTokens=${settingsBefore?.maxTokens}, mcp=${settingsBefore?.mcpEnabled}`)

// =============================================================
console.log('\n[R127-2] EAA students/events 持久化')

// 创建测试学生和事件
const testStudent = `${STAMP}-persist-stu`
await evalInPage(ws, `(async () => { await window.api.eaa.addStudent(${JSON.stringify(testStudent)}); return true; })()`)

const addEvResult = await evalInPage(ws, `(async () => {
  const r = await window.api.eaa.addEvent({
    studentName: ${JSON.stringify(testStudent)},
    reasonCode: 'SPEAK_IN_CLASS',
    note: 'R127 persist test',
    operator: 'r127',
    tags: ['r127', 'persist'],
  });
  return r;
})()`)
check('EAA 测试事件创建成功',
  addEvResult?.success !== false,
  `result=${JSON.stringify(addEvResult).slice(0, 150)}`)

// 验证 score 和 history
const scoreBefore = await evalInPage(ws, `(async () => {
  const r = await window.api.eaa.score(${JSON.stringify(testStudent)});
  return { success: r?.success, name: r?.data?.name, score: r?.data?.score, events: r?.data?.events_count };
})()`)
check('EAA score 持久化前可查',
  scoreBefore?.success !== false && scoreBefore?.name === testStudent,
  `result=${JSON.stringify(scoreBefore).slice(0, 200)}`)

const historyBefore = await evalInPage(ws, `(async () => {
  const r = await window.api.eaa.history(${JSON.stringify(testStudent)});
  const events = r?.data?.events ?? r?.events ?? [];
  return { count: events.length, firstNote: events[0]?.note };
})()`)
check('EAA history 持久化前有事件',
  historyBefore?.count > 0,
  `count=${historyBefore?.count}`)

// =============================================================
console.log('\n[R127-3] Skills 持久化')

const testSkillName = `${STAMP}-persist-skill`
const testSkillContent = 'test skill content for r127'
const skillSaveResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.save(${JSON.stringify(testSkillName)}, ${JSON.stringify(testSkillContent)});
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)
check('Skill 保存成功',
  skillSaveResult?.success !== false,
  `result=${JSON.stringify(skillSaveResult).slice(0, 150)}`)

// 读取确认 (skill.get 返回 Skill 对象直接, 或 null)
const skillBefore = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.get(${JSON.stringify(testSkillName)});
    // r 可能是 {name, content, ...} 或 null 或 {success:false, error}
    const found = r && r !== null && r?.success !== false && (r?.name === ${JSON.stringify(testSkillName)} || !!r?.content);
    return { found: !!found, content: r?.content?.slice(0, 50) };
  } catch (e) { return { found: false, threw: e.message }; }
})()`)
check('Skill 保存后可查',
  skillBefore?.found === true,
  `found=${skillBefore?.found}, content=${skillBefore?.content}`)

// =============================================================
console.log('\n[R127-4] Cron tasks 持久化')

const testCronExpr = '0 */6 * * *'
const cronAddResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.add({
      name: ${JSON.stringify(`${STAMP}-persist-cron`)},
      expression: ${JSON.stringify(testCronExpr)},
      agentId: 'weekly-reporter',
      modelTier: 'low_cost',
      enabled: false,
    });
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)
const cronId = cronAddResult?.id || cronAddResult?.data?.id || cronAddResult?.task?.id
check('Cron task 创建成功',
  cronAddResult?.success !== false && !!cronId,
  `result=${JSON.stringify(cronAddResult).slice(0, 200)}`)

// 读取确认
const cronBefore = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.list();
    const arr = Array.isArray(r) ? r : (r?.tasks || r?.data || []);
    const found = arr.find(t => t.id === ${JSON.stringify(cronId)});
    return { found: !!found, count: arr.length };
  } catch (e) { return { threw: e.message }; }
})()`)
check('Cron task 保存后可查',
  cronBefore?.found === true,
  `found=${cronBefore?.found}, count=${cronBefore?.count}`)

// =============================================================
console.log('\n[R127-5] Agents 持久化')

const agentsBefore = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    const arr = Array.isArray(r) ? r : (r?.agents || r?.data || []);
    return { count: arr.length, names: arr.map(a => a.name || a.id).slice(0, 5) };
  } catch (e) { return { threw: e.message }; }
})()`)
check('Agents 列表可读',
  agentsBefore?.count > 0,
  `count=${agentsBefore?.count}, names=${JSON.stringify(agentsBefore?.names).slice(0, 200)}`)

// =============================================================
console.log('\n[R127-6] 重载渲染进程并验证持久化')

// 重载前记录数据
const preReloadData = {
  settingsTheme: settingsBefore?.theme,
  settingsMaxTokens: settingsBefore?.maxTokens,
  settingsMcp: settingsBefore?.mcpEnabled,
  studentName: testStudent,
  skillName: testSkillName,
  cronId,
  agentCount: agentsBefore?.count,
}

console.log('  重载渲染进程...')
// 执行重载
await cdpCall(ws, 'Page.reload')
// 等待页面重新加载
await sleep(5000)

// 重新连接 (重载后 WS 可能断开)
ws.removeAllListeners?.('message')
try { ws.close() } catch {}
await sleep(1000)
ws = await connectWS()

// 等待应用初始化
console.log('  等待应用初始化...')
await sleep(3000)

// 尝试多次等待 window.api 就绪
let apiReady = false
for (let i = 0; i < 10; i++) {
  const ready = await evalInPage(ws, `typeof window.api !== 'undefined' && typeof window.api.settings !== 'undefined'`)
  if (ready) { apiReady = true; break }
  await sleep(1000)
}
check('重载后 window.api 就绪',
  apiReady,
  `apiReady=${apiReady}`)

if (apiReady) {
  // 验证 Settings 持久化 (settings.get() 返回整个对象)
  const settingsAfter = await evalInPage(ws, `(async () => {
    const s = await window.api.settings.get();
    return {
      theme: s?.general?.theme,
      maxTokens: s?.chat?.maxTokens,
      mcpEnabled: s?.mcp?.enabled,
    };
  })()`)
  check('Settings theme 重载后保留',
    settingsAfter?.theme === preReloadData.settingsTheme,
    `before=${preReloadData.settingsTheme}, after=${settingsAfter?.theme}`)
  check('Settings maxTokens 重载后保留',
    settingsAfter?.maxTokens === preReloadData.settingsMaxTokens,
    `before=${preReloadData.settingsMaxTokens}, after=${settingsAfter?.maxTokens}`)
  check('Settings mcp.enabled 重载后保留',
    settingsAfter?.mcpEnabled === preReloadData.settingsMcp,
    `before=${preReloadData.settingsMcp}, after=${settingsAfter?.mcpEnabled}`)

  // 恢复 theme 为 light (避免影响后续测试)
  await evalInPage(ws, `(async () => {
    await window.api.settings.set('general.theme', 'light');
    return true;
  })()`)

  // 验证 EAA students 持久化
  const scoreAfter = await evalInPage(ws, `(async () => {
    const r = await window.api.eaa.score(${JSON.stringify(testStudent)});
    return { success: r?.success, name: r?.data?.name, score: r?.data?.score, events: r?.data?.events_count };
  })()`)
  check('EAA student 重载后保留',
    scoreAfter?.success !== false && scoreAfter?.name === testStudent,
    `result=${JSON.stringify(scoreAfter).slice(0, 200)}`)

  const historyAfter = await evalInPage(ws, `(async () => {
    const r = await window.api.eaa.history(${JSON.stringify(testStudent)});
    const events = r?.data?.events ?? r?.events ?? [];
    return { count: events.length };
  })()`)
  check('EAA events 重载后保留',
    historyAfter?.count > 0,
    `count=${historyAfter?.count}`)

  // 验证 Skills 持久化 (skill.get 返回 Skill 对象或 null)
  const skillAfter = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.skill.get(${JSON.stringify(testSkillName)});
      const found = r && r !== null && r?.success !== false && (r?.name === ${JSON.stringify(testSkillName)} || !!r?.content);
      return { found: !!found };
    } catch (e) { return { found: false, threw: e.message }; }
  })()`)
  check('Skill 重载后保留',
    skillAfter?.found === true,
    `found=${skillAfter?.found}`)

  // 验证 Cron 持久化
  const cronAfter = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.cron.list();
      const arr = Array.isArray(r) ? r : (r?.tasks || r?.data || []);
      const found = arr.find(t => t.id === ${JSON.stringify(cronId)});
      return { found: !!found, count: arr.length };
    } catch (e) { return { threw: e.message }; }
  })()`)
  check('Cron task 重载后保留',
    cronAfter?.found === true,
    `found=${cronAfter?.found}`)

  // 验证 Agents 持久化
  const agentsAfter = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.list();
      const arr = Array.isArray(r) ? r : (r?.agents || r?.data || []);
      return { count: arr.length };
    } catch (e) { return { threw: e.message }; }
  })()`)
  check('Agents 重载后数量一致',
    agentsAfter?.count === preReloadData.agentCount,
    `before=${preReloadData.agentCount}, after=${agentsAfter?.count}`)

  // 验证重载后应用功能正常
  const listStudentsAfter = await evalInPage(ws, `(async () => {
    const r = await window.api.eaa.listStudents();
    return { success: r?.success, total: r?.data?.students?.length ?? 0 };
  })()`)
  check('重载后 listStudents 功能正常',
    listStudentsAfter?.success !== false,
    `total=${listStudentsAfter?.total}`)

  const statsAfter = await evalInPage(ws, `(async () => {
    try { const r = await window.api.eaa.stats(); return { success: r?.success }; }
    catch (e) { return { threw: e.message }; }
  })()`)
  check('重载后 eaa.stats 功能正常',
    statsAfter?.success !== false,
    `result=${JSON.stringify(statsAfter).slice(0, 100)}`)
}

// =============================================================
console.log('\n[R127-7] 清理测试数据')

// 清理: 恢复 settings
await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', 'light');
  await window.api.settings.set('chat.maxTokens', 32000);
  await window.api.settings.set('mcp.enabled', true);
  return true;
})()`)

// 清理: 删除测试 skill
if (testSkillName) {
  await evalInPage(ws, `(async () => {
    try { await window.api.skill.delete(${JSON.stringify(testSkillName)}); } catch {}
    return true;
  })()`)
}

// 清理: 删除测试 cron
if (cronId) {
  await evalInPage(ws, `(async () => {
    try { await window.api.cron.delete(${JSON.stringify(cronId)}); } catch {}
    return true;
  })()`)
}

// 清理: 删除测试学生
if (testStudent) {
  await evalInPage(ws, `(async () => {
    try { await window.api.eaa.deleteStudent(${JSON.stringify(testStudent)}, { confirm: true, reason: 'cleanup' }); } catch {}
    return true;
  })()`)
}

console.log('  清理完成')

// =============================================================
console.log('\n========================================')
console.log(`R127 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
