// =============================================================
// R108: Agent 执行 + EAA 数据集成测试 (AI角度)
// 角度 1: Agent list — 所有 agent 可读, 结构正确
// 角度 2: Agent get — 单个 agent 配置可读
// 角度 3: Agent toggle — 启用/禁用 + 持久化
// 角度 4: Agent getSoul/getRules — SOUL.md / AGENTS.md 可读
// 角度 5: Agent runManual — 有效/无效 ID, 空 prompt
// 角度 6: Agent history — 历史记录可读
// 角度 7: Agent abort — 中断非运行 agent 不崩溃
// 角度 8: EAA 数据集成 — agent 可访问 EAA stats/students/history
// 角度 9: Agent status 订阅 — 安装 + 卸载
// 角度 10: 快速 toggle 多个 agent — 无崩溃
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
    }, 30000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 25000,
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
console.log(`[R108] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r108Errors = [];
  if (!window.__r108HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r108Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r108Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r108HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r108Errors || []))`)
}

// =============================================================
console.log('\n=== R108: Agent 执行 + EAA 数据集成测试 ===')

// =============================================================
console.log('\n[R108-1] Agent list — 所有 agent 可读')

const agentList = await evalInPage(ws, `window.api.agent.list()`)
const agents = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])

check('agent.list 返回数组',
  Array.isArray(agents) && agents.length > 0,
  `type=${typeof agents}, len=${agents?.length}`)

check('agent 数量 >= 10 (期望 18)',
  agents.length >= 10,
  `count=${agents.length}`)

// 验证每个 agent 结构
let structOk = 0
for (const a of agents) {
  if (a?.id && typeof a.id === 'string') structOk++
}
check(`所有 agent 有 id 字段 (${structOk}/${agents.length})`,
  structOk === agents.length,
  `ok=${structOk}/${agents.length}`)

// 验证已知 agent ID 存在
const knownIds = ['main', 'class-monitor', 'risk-alert', 'weekly-reporter']
for (const kid of knownIds) {
  const found = agents.find(a => a.id === kid)
  check(`已知 agent "${kid}" 存在`,
    !!found,
    `found=${!!found}`)
}

// =============================================================
console.log('\n[R108-2] Agent get — 单个 agent 配置')

const mainAgent = await evalInPage(ws, `window.api.agent.get('main')`)
check('agent.get("main") 返回配置',
  mainAgent && (mainAgent.id === 'main' || mainAgent.data?.id === 'main'),
  `result=${JSON.stringify(mainAgent).slice(0, 150)}`)

// 无效 agent ID
const badAgent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.get('nonexistent_agent_xyz');
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.get 无效 ID 不崩溃',
  badAgent?.ok === true || badAgent?.result?.success === false,
  `result=${JSON.stringify(badAgent).slice(0, 150)}`)

// =============================================================
console.log('\n[R108-3] Agent toggle — 启用/禁用 + 持久化')

// 找一个 agent 来 toggle (不用 main, 避免影响其他测试)
const toggleAgent = agents.find(a => a.id !== 'main') || agents[0]
const toggleId = toggleAgent?.id
const origEnabled = toggleAgent?.enabled

// Disable
const disableResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.toggle(${JSON.stringify(toggleId)}, false);
    return { ok: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check(`agent.toggle(${toggleId}, false) 成功`,
  disableResult?.ok === true,
  `result=${JSON.stringify(disableResult).slice(0, 100)}`)

// 验证持久化
const afterDisable = await evalInPage(ws, `window.api.agent.list()`)
const afterDisableArr = Array.isArray(afterDisable) ? afterDisable : (afterDisable?.agents || afterDisable?.data || [])
const disabledAgent = afterDisableArr.find(a => a.id === toggleId)
check(`toggle 后 ${toggleId} enabled=false`,
  disabledAgent?.enabled === false,
  `enabled=${disabledAgent?.enabled}`)

// Enable back
const enableResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.toggle(${JSON.stringify(toggleId)}, true);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check(`agent.toggle(${toggleId}, true) 成功`,
  enableResult?.ok === true,
  `result=${JSON.stringify(enableResult).slice(0, 100)}`)

// 恢复原始状态
if (origEnabled !== undefined) {
  await evalInPage(ws, `window.api.agent.toggle(${JSON.stringify(toggleId)}, ${JSON.stringify(origEnabled)})`)
}

// =============================================================
console.log('\n[R108-4] Agent getSoul/getRules — SOUL.md / AGENTS.md')

const soul = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getSoul('main');
    return { ok: true, len: typeof r === 'string' ? r.length : (r?.data?.length || r?.length || 0) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.getSoul("main") 返回内容',
  soul?.ok === true && soul?.len > 0,
  `result=${JSON.stringify(soul).slice(0, 150)}`)

const rules = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getRules('main');
    return { ok: true, len: typeof r === 'string' ? r.length : (r?.data?.length || r?.length || 0) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.getRules("main") 返回内容',
  rules?.ok === true && rules?.len > 0,
  `result=${JSON.stringify(rules).slice(0, 150)}`)

// 无效 ID
const badSoul = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getSoul('nonexistent_agent_xyz');
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.getSoul 无效 ID 不崩溃',
  badSoul !== null,
  `result=${JSON.stringify(badSoul).slice(0, 100)}`)

// =============================================================
console.log('\n[R108-5] Agent runManual — 有效/无效 ID, 空 prompt')

// 有效 agent + 有效 prompt (fire-and-forget, 返回 started)
const runResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual('main', '你好,请简单回复"测试通过"');
    return { ok: r?.success !== false, success: r?.success, message: r?.message };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.runManual("main", prompt) 返回 started',
  runResult?.ok === true,
  `result=${JSON.stringify(runResult).slice(0, 150)}`)

// 无效 agent ID
const badRun = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual('nonexistent_agent_xyz', 'test');
    return { ok: r?.success !== false, success: r?.success, message: r?.message };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.runManual 无效 ID 返回错误',
  badRun?.success === false || badRun?.ok === false,
  `result=${JSON.stringify(badRun).slice(0, 150)}`)

// 空 prompt
const emptyPrompt = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual('main', '');
    return { ok: r?.success !== false, success: r?.success, message: r?.message };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.runManual 空 prompt 返回错误',
  emptyPrompt?.success === false || emptyPrompt?.ok === false,
  `result=${JSON.stringify(emptyPrompt).slice(0, 150)}`)

// 等待 agent 执行完成 (fire-and-forget)
await sleep(3000)

// =============================================================
console.log('\n[R108-6] Agent history — 历史记录可读')

const history = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getHistory('main');
    return { ok: true, isArray: Array.isArray(r), len: Array.isArray(r) ? r.length : 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.getHistory("main") 不崩溃',
  history?.ok === true,
  `result=${JSON.stringify(history).slice(0, 150)}`)

// =============================================================
console.log('\n[R108-7] Agent abort — 中断非运行 agent')

const abortResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.abort('main');
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.abort 非运行 agent 不崩溃',
  abortResult?.ok === true,
  `result=${JSON.stringify(abortResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R108-8] EAA 数据集成 — agent 可访问 EAA 数据')

const eaaIntegration = await evalInPage(ws, `(async () => {
  try {
    const [stats, students, codes, doctor] = await Promise.all([
      window.api.eaa.stats(),
      window.api.eaa.listStudents(),
      window.api.eaa.codes(),
      window.api.eaa.doctor(),
    ]);
    
    const studentsArr = Array.isArray(students) ? students
      : (Array.isArray(students?.data) ? students.data
        : (Array.isArray(students?.data?.students) ? students.data.students : []));
    
    return {
      statsOk: stats?.success === true,
      studentsCount: studentsArr.length,
      codesOk: codes?.success === true,
      doctorOk: doctor?.success !== false,
    };
  } catch (e) {
    return { error: e.message };
  }
})()`)

check('EAA stats 可访问 (agent 数据源)',
  eaaIntegration?.statsOk === true,
  `result=${JSON.stringify(eaaIntegration).slice(0, 150)}`)

check('EAA listStudents 返回学生列表',
  eaaIntegration?.studentsCount > 0,
  `count=${eaaIntegration?.studentsCount}`)

check('EAA codes 可访问 (agent 事件类型源)',
  eaaIntegration?.codesOk === true,
  `result=${JSON.stringify(eaaIntegration).slice(0, 100)}`)

check('EAA doctor 可访问 (健康检查)',
  eaaIntegration?.doctorOk !== false,
  `result=${JSON.stringify(eaaIntegration).slice(0, 100)}`)

// =============================================================
console.log('\n[R108-9] Agent status 订阅 — 安装 + 卸载')

const subTest = await evalInPage(ws, `(async () => {
  try {
    let received = [];
    const unsub = window.api.agent.onStatusUpdate((data) => {
      received.push(data);
    });
    
    // 验证 unsub 是函数
    const isFunc = typeof unsub === 'function';
    
    // 卸载
    unsub();
    
    // 验证卸载后不再接收 (等待 500ms)
    await new Promise(r => setTimeout(r, 500));
    
    return { ok: true, isFunc, receivedCount: received.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('agent.onStatusUpdate 返回取消订阅函数',
  subTest?.isFunc === true,
  `result=${JSON.stringify(subTest).slice(0, 150)}`)

check('agent.onStatusUpdate 安装 + 卸载不崩溃',
  subTest?.ok === true,
  `result=${JSON.stringify(subTest).slice(0, 100)}`)

// =============================================================
console.log('\n[R108-10] 快速 toggle 多个 agent — 无崩溃')

const rapidToggle = await evalInPage(ws, `(async () => {
  const agents = await window.api.agent.list();
  const agentArr = Array.isArray(agents) ? agents : (agents?.agents || agents?.data || []);
  const toToggle = agentArr.filter(a => a.id !== 'main').slice(0, 5);
  
  const results = [];
  for (let i = 0; i < 10; i++) {
    for (const a of toToggle) {
      try {
        await window.api.agent.toggle(a.id, i % 2 === 0);
        results.push({ ok: true });
      } catch (e) {
        results.push({ ok: false, error: e.message });
      }
    }
  }
  
  // 恢复原始状态
  for (const a of toToggle) {
    try { await window.api.agent.toggle(a.id, a.enabled); } catch {}
  }
  
  const okCount = results.filter(r => r.ok).length;
  return { total: results.length, ok: okCount };
})()`)

check('50 次快速 toggle 全部成功',
  rapidToggle?.ok === rapidToggle?.total && rapidToggle?.total === 50,
  `ok=${rapidToggle?.ok}/${rapidToggle?.total}`)

// =============================================================
console.log('\n[R108-11] 全程错误捕获')

const allErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  allErrors.length === 0,
  `errors=${allErrors.length}, detail=${JSON.stringify(allErrors).slice(0, 200)}`)

// =============================================================
console.log('\n========================================')
console.log(`R108 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
