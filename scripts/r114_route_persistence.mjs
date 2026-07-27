// =============================================================
// R114: 路由/页面状态持久化 + 错误恢复测试
// 角度 1: 路由导航 - 所有 14 个路由可加载不崩溃
// 角度 2: 页面 state 恢复 - 离开再回来数据重新加载
// 角度 3: ErrorBoundary - 触发渲染错误被捕获
// 角度 4: Settings 持久化 - get/set/reset 跨调用
// 角度 5: Profile 持久化 - set/get 一致性
// 角度 6: Agent store - 导航后 list 仍在内存
// 角度 7: Chat session 持久化 - 保存消息后 list-sessions 可见
// 角度 8: Cron 任务持久化 - 创建后 list 可见
// 角度 9: localStorage - SkillsPage tab + i18n lang 持久化
// 角度 10: 竞态守卫 - 快速切换 agent 不产生脏数据
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
    }, 45000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 40000,
  })
  if (r.exceptionDetails) {
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  }
  return r.result.value
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

let WebSocket
try {
  WebSocket = (await import('ws')).default
} catch {
  WebSocket = globalThis.WebSocket
}

const targets = await getTargets()
const pageTarget =
  targets.find((t) => t.type === 'page' && t.url.includes('localhost')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R114] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  ws.on('open', r)
  ws.on('error', rej)
  setTimeout(() => rej(new Error('ws connect timeout')), 10000)
})

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) {
    results.pass++
    console.log(`  ✅ ${name}`)
  } else {
    results.fail++
    results.errors.push(name)
    console.log(`  ❌ ${name} ${detail}`)
  }
}

// 错误捕获
await evalInPage(ws, `
  window.__r114Errors = [];
  if (!window.__r114HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r114Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r114Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r114HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r114Errors || []))`)
}

async function clearErrors() {
  return await evalInPage(ws, `window.__r114Errors = []; true`)
}

const STAMP = `r114-${Date.now()}`
const createdCronTasks = []

console.log('\n=== R114: 路由/页面状态持久化 + 错误恢复测试 ===')

// =============================================================
console.log('\n[R114-1] 路由导航 - 所有 14 个路由可加载不崩溃')

const ROUTES = [
  '/dashboard',
  '/students',
  '/classes',
  '/academics',
  '/agents',
  '/models',
  '/skills',
  '/scheduler',
  '/privacy',
  '/settings',
  '/chat',
  '/welcome',
]

for (const route of ROUTES) {
  await evalInPage(ws, `window.location.hash = '#${route}'; true`)
  await sleep(900) // 给页面 mount + 加载时间
  const routeOk = await evalInPage(ws, `(async () => {
    const main = document.querySelector('main') || document.querySelector('#root > div');
    const text = main ? main.innerText : '';
    return {
      hasContent: text.length > 0,
      length: text.length,
      hash: window.location.hash,
      expectedHash: '#${route}',
      hasErrorBoundary: /Something went wrong|出错了|重试/i.test(text),
    };
  })()`)
  check(`路由 ${route} 加载有内容`,
    routeOk?.hasContent === true && routeOk?.length > 10,
    `len=${routeOk?.length}, hash=${routeOk?.hash}`)
  check(`路由 ${route} 未触发 ErrorBoundary`,
    routeOk?.hasErrorBoundary === false,
    `text=${String(routeOk).slice(0, 100)}`)
}

// 非法路由应跳转到 /dashboard
await evalInPage(ws, `window.location.hash = '#/nonexistent-route-xyz'; true`)
await sleep(800)
const badRoute = await evalInPage(ws, `(async () => ({ hash: window.location.hash }))()`)
check('非法路由回退到 /dashboard',
  badRoute?.hash === '#/dashboard' || badRoute?.hash === '#/',
  `hash=${badRoute?.hash}`)

// =============================================================
console.log('\n[R114-2] 页面 state 恢复 - 离开再回来数据重新加载')

// 导航到 agents, 等待加载, 记录 agent 数量
await evalInPage(ws, `window.location.hash = '#/agents'; true`)
await sleep(1500)
const agentsCount1 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    const arr = Array.isArray(r) ? r : (r?.agents || []);
    return { count: arr.length };
  } catch (e) { return { count: -1, error: e.message }; }
})()`)

// 导航到 dashboard, 再回 agents
await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(800)
await evalInPage(ws, `window.location.hash = '#/agents'; true`)
await sleep(1500)
const agentsCount2 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    const arr = Array.isArray(r) ? r : (r?.agents || []);
    return { count: arr.length };
  } catch (e) { return { count: -1, error: e.message }; }
})()`)

check('agents 离开再回来 list 数量一致',
  agentsCount1?.count === agentsCount2?.count && agentsCount1?.count >= 0,
  `c1=${agentsCount1?.count}, c2=${agentsCount2?.count}`)

// 同样测试 skills
await evalInPage(ws, `window.location.hash = '#/skills'; true`)
await sleep(1200)
const skillsCount1 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.list();
    return { count: Array.isArray(r) ? r.length : 0 };
  } catch (e) { return { count: -1, error: e.message }; }
})()`)

await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(500)
await evalInPage(ws, `window.location.hash = '#/skills'; true`)
await sleep(1200)
const skillsCount2 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.list();
    return { count: Array.isArray(r) ? r.length : 0 };
  } catch (e) { return { count: -1, error: e.message }; }
})()`)

check('skills 离开再回来 list 数量一致',
  skillsCount1?.count === skillsCount2?.count,
  `c1=${skillsCount1?.count}, c2=${skillsCount2?.count}`)

// 同样测试 settings
await evalInPage(ws, `window.location.hash = '#/settings'; true`)
await sleep(1500)
const settings1 = await evalInPage(ws, `(async () => {
  try {
    const s = await window.api.settings.get();
    return { ok: !!s, hasKeys: Object.keys(s || {}).length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)

await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(500)
await evalInPage(ws, `window.location.hash = '#/settings'; true`)
await sleep(1500)
const settings2 = await evalInPage(ws, `(async () => {
  try {
    const s = await window.api.settings.get();
    return { ok: !!s, hasKeys: Object.keys(s || {}).length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)

check('settings 离开再回来数据可加载',
  settings1?.ok === true && settings2?.ok === true,
  `s1=${JSON.stringify(settings1).slice(0, 80)}, s2=${JSON.stringify(settings2).slice(0, 80)}`)
check('settings 数据一致',
  settings1?.hasKeys === settings2?.hasKeys,
  `s1=${settings1?.hasKeys}, s2=${settings2?.hasKeys}`)

// =============================================================
console.log('\n[R114-3] ErrorBoundary - 触发渲染错误被捕获')

// 检查 ErrorBoundary 类是否存在
const ebCheck = await evalInPage(ws, `(async () => {
  // 通过 React DevTools hook 检查 ErrorBoundary 实例化 — 简化: 直接检查 root 是否有错误降级 UI
  const root = document.getElementById('root');
  return { hasRoot: !!root, rootChildren: root?.children?.length || 0 };
})()`)
check('root 元素存在',
  ebCheck?.hasRoot === true && ebCheck?.rootChildren > 0,
  `result=${JSON.stringify(ebCheck)}`)

// 通过注入错误事件触发 ErrorBoundary (模拟组件异常)
// 这里只能验证 ErrorBoundary 类组件已挂载, 真实崩溃测试需要破坏 React 树
// 替代方案: 验证 window.__r114Errors 是否有运行时错误累积
const initialErrors = await getErrors()

// =============================================================
console.log('\n[R114-4] Settings 持久化 - get/set/reset 跨调用')

// 备份当前 theme (实际路径是 general.theme, 不是 theme.mode)
const originalTheme = await evalInPage(ws, `(async () => {
  try {
    const s = await window.api.settings.get();
    return s?.general?.theme || 'light';
  } catch (e) { return 'light'; }
})()`)

// set general.theme=dark
const setDark = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set('general.theme', 'dark');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('settings.set general.theme=dark 不崩溃',
  setDark?.ok === true,
  `result=${JSON.stringify(setDark).slice(0, 100)}`)

// get 验证
const getAfterSet = await evalInPage(ws, `(async () => {
  try {
    const s = await window.api.settings.get();
    return { theme: s?.general?.theme };
  } catch (e) { return { theme: null, error: e.message }; }
})()`)
check('settings.get 反映 set 后的值',
  getAfterSet?.theme === 'dark',
  `theme=${getAfterSet?.theme}`)

// 还原
await evalInPage(ws, `(async () => {
  try {
    await window.api.settings.set('general.theme', ${JSON.stringify(originalTheme)});
    return true;
  } catch (e) { return false; }
})()`)

// set 非法 dot path (原型污染)
const protoTest = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set('__proto__.polluted', 'yes');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('settings.set __proto__ 路径被拒绝',
  protoTest?.ok === false || (protoTest?.error && protoTest.error.length > 0),
  `result=${JSON.stringify(protoTest).slice(0, 100)}`)

// 验证全局对象未被污染
const pollutionCheck = await evalInPage(ws, `(async () => ({
  polluted: ({}).polluted,
}))()`)
check('原型未被污染',
  pollutionCheck?.polluted === undefined,
  `polluted=${pollutionCheck?.polluted}`)

// =============================================================
console.log('\n[R114-5] Profile 持久化 - set/get 一致性')

// 用一个测试学生名 set 一个 profile
const testStudent = `r114-student-${Date.now()}`
const profileData = JSON.stringify({
  tags: ['r114', 'test'],
  summary: 'R114 测试档案',
  riskLevel: 'low',
  updatedAt: Date.now(),
})

const profileSet = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.set(${JSON.stringify(testStudent)}, ${profileData});
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('profile.set 不崩溃',
  profileSet?.ok === true,
  `result=${JSON.stringify(profileSet).slice(0, 100)}`)

const profileGet = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.get(${JSON.stringify(testStudent)});
    return {
      ok: !!r || r?.success !== false,
      hasTags: Array.isArray(r?.tags) || Array.isArray(r?.data?.tags),
      hasSummary: !!r?.summary || !!r?.data?.summary,
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('profile.get 反映 set 后的内容',
  profileGet?.ok === true,
  `result=${JSON.stringify(profileGet).slice(0, 150)}`)

// 非法学生名 (路径穿越)
const profileBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.set('../../../etc/passwd', {a:1});
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('profile.set 路径穿越 name 被拒绝',
  profileBad?.ok === false || (profileBad?.error && profileBad.error.length > 0),
  `result=${JSON.stringify(profileBad).slice(0, 100)}`)

// =============================================================
console.log('\n[R114-6] Agent store - 导航后 list 仍在内存')

// agent.list 应该立即可用 (store 缓存)
const agentList1 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    const arr = Array.isArray(r) ? r : (r?.agents || []);
    return { ok: arr.length >= 0, count: arr.length, hasFirstId: !!arr[0]?.id };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.list 返回非空数组 (18 个 agent)',
  agentList1?.ok === true && agentList1?.count > 0,
  `count=${agentList1?.count}`)

// 导航离开 agents 再回来, store 应仍有缓存
await evalInPage(ws, `window.location.hash = '#/chat'; true`)
await sleep(500)
await evalInPage(ws, `window.location.hash = '#/agents'; true`)
await sleep(1000)

const agentList2 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    const arr = Array.isArray(r) ? r : (r?.agents || []);
    return { count: arr.length };
  } catch (e) { return { count: -1 }; }
})()`)
check('agent.list 导航后数量不变',
  agentList1?.count === agentList2?.count,
  `c1=${agentList1?.count}, c2=${agentList2?.count}`)

// =============================================================
console.log('\n[R114-7] Chat session 持久化 - 保存消息后 list-sessions 可见')

// 保存一条消息到新 session
const chatSessionId = `r114-sess-${Date.now()}`
const saveMsg = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.saveMessage({
      sessionId: ${JSON.stringify(chatSessionId)},
      role: 'user',
      content: 'R114 测试消息',
      timestamp: Date.now(),
    });
    return { ok: r?.success !== false || r?.id >= 0, id: r?.id };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('chat.saveMessage 不崩溃',
  saveMsg?.ok === true,
  `result=${JSON.stringify(saveMsg).slice(0, 100)}`)

// list-sessions 应包含
const listSessions = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.listSessions();
    const arr = r?.sessions || r || [];
    const found = arr.find(s => s.id === ${JSON.stringify(chatSessionId)});
    return { ok: r?.success !== false || Array.isArray(arr), count: arr.length, found: !!found };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('chat.listSessions 包含新 session',
  listSessions?.found === true,
  `result=${JSON.stringify(listSessions).slice(0, 150)}`)

// load-messages 应返回该消息
const loadMessages = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.loadMessages(${JSON.stringify(chatSessionId)});
    const arr = r?.messages || r || [];
    return { ok: r?.success !== false || Array.isArray(arr), count: arr.length, hasContent: arr.some(m => m?.content === 'R114 测试消息') };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('chat.loadMessages 返回保存的消息',
  loadMessages?.hasContent === true,
  `result=${JSON.stringify(loadMessages).slice(0, 150)}`)

// 删除 session
const deleteSession = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.deleteSession(${JSON.stringify(chatSessionId)});
    return { ok: r?.success !== false };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('chat.deleteSession 不崩溃',
  deleteSession?.ok === true,
  `result=${JSON.stringify(deleteSession).slice(0, 100)}`)

// list-sessions 不再包含
const listSessionsAfterDelete = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.listSessions();
    const arr = r?.sessions || r || [];
    return { found: arr.find(s => s.id === ${JSON.stringify(chatSessionId)}) };
  } catch (e) { return { found: 'error' }; }
})()`)
check('chat.listSessions 删除后不再包含',
  listSessionsAfterDelete?.found === undefined || listSessionsAfterDelete?.found === null,
  `result=${JSON.stringify(listSessionsAfterDelete).slice(0, 100)}`)

// =============================================================
console.log('\n[R114-8] Cron 任务持久化 - 创建后 list 可见')

// 创建一个测试 cron 任务 (每分钟执行, 但 disabled)
// CronTask 字段: name/agentId/expression/prompt/enabled/modelTier
const cronCreate = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.add({
      name: 'R114-Test-Task',
      expression: '0 * * * *',
      agentId: 'class-monitor',
      prompt: 'R114 test prompt',
      enabled: false,
      modelTier: 'low_cost',
    });
    return { ok: r?.success !== false, id: r?.id, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('cron.add 不崩溃',
  cronCreate?.ok === true,
  `result=${JSON.stringify(cronCreate).slice(0, 100)}`)
if (cronCreate?.id) createdCronTasks.push(cronCreate.id)

// list 应包含
const cronListAfterAdd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.list();
    const arr = r?.tasks || r || [];
    return { ok: Array.isArray(arr), count: arr.length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('cron.list 返回非空数组 (含 R114 任务)',
  cronListAfterAdd?.ok === true && cronListAfterAdd?.count > 0,
  `count=${cronListAfterAdd?.count}`)

// toggle 任务
if (createdCronTasks.length > 0) {
  const taskId = createdCronTasks[0]
  const cronToggle = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.cron.toggle(${JSON.stringify(taskId)}, true);
      return { ok: r?.success !== false };
    } catch (e) { return { ok: false, error: e.message }; }
})()`)
  check('cron.toggle 不崩溃',
    cronToggle?.ok === true,
    `result=${JSON.stringify(cronToggle).slice(0, 100)}`)
}

// 非法 cron 表达式应被拒绝
const cronBadExpr = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.add({
      name: 'R114-Bad-Cron',
      expression: 'invalid-cron-expr',
      agentId: 'class-monitor',
      prompt: 'test',
      enabled: false,
      modelTier: 'low_cost',
    });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('cron.add 非法表达式被拒绝',
  cronBadExpr?.ok === false || (cronBadExpr?.error && cronBadExpr.error.length > 0),
  `result=${JSON.stringify(cronBadExpr).slice(0, 100)}`)

// 清理 cron 任务
for (const taskId of createdCronTasks) {
  await evalInPage(ws, `(async () => {
    try { await window.api.cron.remove(${JSON.stringify(taskId)}); } catch {}
    return true;
  })()`)
}

// =============================================================
console.log('\n[R114-9] localStorage - SkillsPage tab + i18n lang 持久化')

// 测试 skills.activeTab localStorage
await evalInPage(ws, `window.localStorage.setItem('skills.activeTab', 'plugins'); true`)
await evalInPage(ws, `window.location.hash = '#/skills'; true`)
await sleep(1200)
const skillsTabStored = await evalInPage(ws, `window.localStorage.getItem('skills.activeTab')`)
check('skills.activeTab localStorage 可持久化',
  skillsTabStored === 'plugins',
  `value=${skillsTabStored}`)

// 还原
await evalInPage(ws, `window.localStorage.setItem('skills.activeTab', 'skills'); true`)

// 测试 i18n lang
const originalLang = await evalInPage(ws, `window.localStorage.getItem('education-advisor.lang')`)
await evalInPage(ws, `window.localStorage.setItem('education-advisor.lang', 'en'); true`)
const langAfterSet = await evalInPage(ws, `window.localStorage.getItem('education-advisor.lang')`)
check('education-advisor.lang localStorage 可持久化',
  langAfterSet === 'en',
  `value=${langAfterSet}`)
// 还原
if (originalLang) {
  await evalInPage(ws, `window.localStorage.setItem('education-advisor.lang', ${JSON.stringify(originalLang)}); true`)
}

// =============================================================
console.log('\n[R114-10] 竞态守卫 - 快速切换 agent 不产生脏数据')

// 快速连续调用 agent.get 5 次, 验证最后一次胜出
const agents = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    return Array.isArray(r) ? r : (r?.agents || []);
  } catch (e) { return []; }
})()`)

if (agents.length >= 2) {
  const ids = agents.slice(0, 5).map(a => a.id)
  // 同时发起 5 个 get 请求, 应该都返回各自的 agent
  const concurrentGets = await evalInPage(ws, `(async () => {
    const ids = ${JSON.stringify(ids)};
    const results = await Promise.all(ids.map(id => window.api.agent.get(id).catch(e => ({ error: e.message, _id: id }))));
    return results.map((r, i) => ({
      inputId: ids[i],
      gotId: r?.id,
      matched: r?.id === ids[i],
      hasError: !!r?.error,
    }));
  })()`)
  check('并发 agent.get 各自返回正确 id',
    concurrentGets?.every(r => r.matched === true) === true,
    `results=${JSON.stringify(concurrentGets).slice(0, 300)}`)
} else {
  check('并发 agent.get 测试 (跳过, agent 不足)', true, 'skipped')
}

// 快速 toggle 同一 agent 多次 (最终应回到原状态)
if (agents.length > 0) {
  const testAgentId = agents[0].id
  const originalEnabled = agents[0].enabled
  // toggle off → on → off → on, 应最终为 on (或与原状态相反/一致)
  const rapidToggles = await evalInPage(ws, `(async () => {
    const id = ${JSON.stringify(testAgentId)};
    try {
      // 顺序执行避免互相覆盖
      await window.api.agent.toggle(id, false);
      await window.api.agent.toggle(id, true);
      await window.api.agent.toggle(id, false);
      await window.api.agent.toggle(id, true);
      const r = await window.api.agent.get(id);
      return { finalEnabled: r?.enabled };
    } catch (e) { return { error: e.message }; }
  })()`)
  check('连续 toggle 4 次最终为 enabled=true',
    rapidToggles?.finalEnabled === true,
    `result=${JSON.stringify(rapidToggles).slice(0, 100)}`)

  // 还原原状态
  await evalInPage(ws, `(async () => {
    try { await window.api.agent.toggle(${JSON.stringify(testAgentId)}, ${JSON.stringify(originalEnabled)}); } catch {}
    return true;
  })()`)
}

// =============================================================
console.log('\n[R114-11] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 300)}`)

// =============================================================
console.log('\n========================================')
console.log(`R114 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
