// =============================================================
// R123: AI 调用循环端到端测试 (Agent 数据访问全链路)
// 角度 1: Agent 列表加载与配置完整性
// 角度 2: Agent SOUL/Rules 读取
// 角度 3: Agent 数据访问链路 (listStudents → history → stats)
// 角度 4: Skill 加载与 Agent 工具链
// 角度 5: AI Provider 配置完整性 (listProviders/listModels)
// 角度 6: Agent 状态更新事件订阅 (onStatusUpdate)
// 角度 7: Agent 执行历史读取 (getHistory)
// 角度 8: AI 流式事件订阅/取消订阅生命周期
// 角度 9: Agent toggle 持久化 (写入 + 读取一致性)
// 角度 10: 错误捕获与性能基线
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

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
if (!pageTarget) { console.error('No page target found.'); process.exit(1) }
console.log(`[R123] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('ws connect timeout')), 10000) })

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ✅ ${name}`) }
  else { results.fail++; results.errors.push(name); console.log(`  ❌ ${name} ${detail}`) }
}

// 错误捕获
await evalInPage(ws, `
  window.__r123Errors = [];
  if (!window.__r123HookInstalled) {
    window.addEventListener('error', (e) => { window.__r123Errors.push({ type: 'error', message: e.message }); });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r123Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r123HookInstalled = true;
  }
  true
`)
async function getErrors() { return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r123Errors || []))`) }

console.log('\n=== R123: AI 调用循环端到端测试 ===')

// =============================================================
console.log('\n[R123-1] Agent 列表加载与配置完整性')

const agentListResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    const agents = Array.isArray(r) ? r : (r?.agents || r?.data || []);
    const enabledCount = agents.filter(a => a?.enabled === true).length;
    const withSoulCount = agents.filter(a => a?.hasSoul === true || a?.soulPath || a?.hasSoulFile).length;
    return {
      ok: Array.isArray(r) || r?.success !== false,
      total: agents.length,
      enabled: enabledCount,
      withSoul: withSoulCount,
      sampleIds: agents.slice(0, 3).map(a => a?.id || a?.name),
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.list 返回非空列表',
  agentListResult?.ok === true && agentListResult?.total > 0,
  `result=${JSON.stringify(agentListResult).slice(0, 200)}`)
check(`至少 10 个 agent (实际 ${agentListResult?.total})`,
  agentListResult?.total >= 10,
  `total=${agentListResult?.total}`)

// =============================================================
console.log('\n[R123-2] Agent SOUL/Rules 读取 (取第一个 agent)')

const firstAgentId = agentListResult?.sampleIds?.[0]
let soulOk = false
let rulesOk = false
if (firstAgentId) {
  const soulResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.getSoul(${JSON.stringify(firstAgentId)});
      return { ok: typeof r === 'string' || r?.content !== undefined, len: typeof r === 'string' ? r.length : (r?.content?.length ?? 0) };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  soulOk = soulResult?.ok === true && soulResult?.len > 0
  check(`agent.getSoul("${firstAgentId}") 返回非空内容`,
    soulOk,
    `result=${JSON.stringify(soulResult).slice(0, 150)}`)

  const rulesResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.getRules(${JSON.stringify(firstAgentId)});
      return { ok: typeof r === 'string' || r?.content !== undefined, len: typeof r === 'string' ? r.length : (r?.content?.length ?? 0) };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  rulesOk = rulesResult?.ok === true
  check(`agent.getRules("${firstAgentId}") 不崩溃`,
    rulesResult?.ok === true,
    `result=${JSON.stringify(rulesResult).slice(0, 150)}`)
} else {
  check('agent.getSoul 跳过 (无 agent)', false, 'no agent id')
}

// =============================================================
console.log('\n[R123-3] Agent 数据访问链路 (模拟 agent 调用 EAA)')

const STAMP = `r123-${Date.now()}`
const testStudent = `${STAMP}-stu`

// 准备测试数据
await evalInPage(ws, `(async () => {
  try { await window.api.eaa.addStudent(${JSON.stringify(testStudent)}); } catch {}
  // 添加 3 个事件供 history 查询
  for (let i = 0; i < 3; i++) {
    try {
      await window.api.eaa.addEvent({
        studentName: ${JSON.stringify(testStudent)},
        reasonCode: 'SPEAK_IN_CLASS',
        note: 'R123 测试事件 #' + i,
        operator: 'r123-tester',
        tags: ['r123', 'test'],
      });
    } catch (e) {}
  }
  return true;
})()`)

// 模拟 agent 完整数据访问链路
const agentChainResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const steps = {};
  // Step 1: listStudents
  try {
    const r = await window.api.eaa.listStudents();
    steps.listStudents = r?.success === true;
    if (!steps.listStudents) errors.push('listStudents failed');
  } catch (e) { errors.push('listStudents: ' + e.message); }
  // Step 2: score
  try {
    const r = await window.api.eaa.score(${JSON.stringify(testStudent)});
    steps.score = r?.success !== false;
  } catch (e) { errors.push('score: ' + e.message); steps.score = false; }
  // Step 3: history
  try {
    const r = await window.api.eaa.history(${JSON.stringify(testStudent)});
    const events = r?.data?.events ?? r?.events ?? [];
    steps.history = events.length >= 3;
    steps.historyCount = events.length;
  } catch (e) { errors.push('history: ' + e.message); steps.history = false; }
  // Step 4: stats
  try {
    const r = await window.api.eaa.stats();
    steps.stats = r?.success !== false;
  } catch (e) { errors.push('stats: ' + e.message); steps.stats = false; }
  // Step 5: summary
  try {
    const r = await window.api.eaa.summary();
    steps.summary = r?.success !== false;
  } catch (e) { errors.push('summary: ' + e.message); steps.summary = false; }
  // Step 6: ranking
  try {
    const r = await window.api.eaa.ranking(10);
    steps.ranking = r?.success !== false;
  } catch (e) { errors.push('ranking: ' + e.message); steps.ranking = false; }
  // Step 7: codes (reason-codes)
  try {
    const r = await window.api.eaa.codes();
    steps.codes = r?.success !== false;
  } catch (e) { errors.push('codes: ' + e.message); steps.codes = false; }
  // Step 8: doctor (健康检查)
  try {
    const r = await window.api.eaa.doctor();
    steps.doctor = r?.success !== false;
  } catch (e) { errors.push('doctor: ' + e.message); steps.doctor = false; }
  return { steps, errorCount: errors.length, errors: errors.slice(0, 3) };
})()`)
const stepCount = Object.values(agentChainResult?.steps || {}).filter(Boolean).length
check(`Agent 数据访问链路 ${stepCount}/8 步成功`,
  stepCount >= 7,
  `result=${JSON.stringify(agentChainResult).slice(0, 300)}`)

// =============================================================
console.log('\n[R123-4] Skill 加载与 Agent 工具链')

const skillResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.list();
    const skills = Array.isArray(r) ? r : (r?.skills || r?.data || []);
    return {
      ok: Array.isArray(r) || r?.success !== false,
      count: skills.length,
      sampleNames: skills.slice(0, 3).map(s => typeof s === 'string' ? s : (s?.name || s?.id)),
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('skill.list 返回非空列表',
  skillResult?.ok === true && skillResult?.count > 0,
  `result=${JSON.stringify(skillResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R123-5] AI Provider 配置完整性')

const providerResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listProviders();
    const providers = Array.isArray(r) ? r : (r?.providers || r?.data || []);
    return {
      ok: Array.isArray(r) || r?.success !== false,
      count: providers.length,
      ids: providers.slice(0, 5).map(p => p?.id || p?.providerId),
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.listProviders 不崩溃',
  providerResult?.ok === true,
  `result=${JSON.stringify(providerResult).slice(0, 150)}`)

// 测试每个 provider 的 listModels
if (providerResult?.ids?.length > 0) {
  const modelsResult = await evalInPage(ws, `(async () => {
    const ids = ${JSON.stringify(providerResult.ids)};
    const errors = [];
    let totalModels = 0;
    let providersWithModels = 0;
    for (const id of ids) {
      try {
        const r = await window.api.ai.listModels(id);
        const models = Array.isArray(r) ? r : (r?.models || r?.data || []);
        totalModels += models.length;
        if (models.length > 0) providersWithModels++;
      } catch (e) { errors.push(id + ': ' + e.message); }
    }
    return { totalModels, providersWithModels, errorCount: errors.length, errors: errors.slice(0, 2) };
  })()`)
  check(`AI 模型列表加载 (${modelsResult?.providersWithModels} 个 provider 有模型, 共 ${modelsResult?.totalModels} 个)`,
    modelsResult?.errorCount === 0,
    `result=${JSON.stringify(modelsResult).slice(0, 200)}`)
}

// =============================================================
console.log('\n[R123-6] Agent 状态更新事件订阅 (onStatusUpdate)')

// 订阅 + 立即取消订阅 (验证生命周期)
const subResult = await evalInPage(ws, `(async () => {
  try {
    let received = 0;
    const unsub = window.api.agent.onStatusUpdate(() => { received++; });
    // 等待 500ms 看是否有事件
    await new Promise(r => setTimeout(r, 500));
    const beforeUnsub = received;
    // 取消订阅
    if (typeof unsub === 'function') unsub();
    // 再等 500ms, 确认不再收到 (但这个无法严格验证, 只验证 unsub 不抛错)
    return { ok: typeof unsub === 'function', receivedBeforeUnsub: beforeUnsub };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.onStatusUpdate 返回取消订阅函数',
  subResult?.ok === true,
  `result=${JSON.stringify(subResult)}`)

// =============================================================
console.log('\n[R123-7] Agent 执行历史读取 (getHistory)')

if (firstAgentId) {
  const historyResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.getHistory(${JSON.stringify(firstAgentId)});
      const history = Array.isArray(r) ? r : (r?.history || r?.data || []);
      return { ok: Array.isArray(r) || r?.success !== false, count: history.length };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check(`agent.getHistory("${firstAgentId}") 不崩溃`,
    historyResult?.ok === true,
    `result=${JSON.stringify(historyResult).slice(0, 150)}`)
}

// =============================================================
console.log('\n[R123-8] AI 流式事件订阅/取消订阅生命周期')

const streamSubResult = await evalInPage(ws, `(async () => {
  try {
    let received = 0;
    const unsub = window.api.ai.onStream(() => { received++; });
    await new Promise(r => setTimeout(r, 300));
    // 多次调用取消订阅不应崩溃
    if (typeof unsub === 'function') {
      unsub();
      unsub(); // 二次取消应安全
    }
    return { ok: typeof unsub === 'function' };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.onStream 返回取消订阅函数 (二次取消安全)',
  streamSubResult?.ok === true,
  `result=${JSON.stringify(streamSubResult)}`)

// =============================================================
console.log('\n[R123-9] Agent toggle 持久化 (写入 + 读取一致性)')

if (firstAgentId) {
  // 读取当前状态
  const beforeState = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.get(${JSON.stringify(firstAgentId)});
      return { ok: r !== null, enabled: r?.enabled };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)

  if (beforeState?.ok) {
    const originalEnabled = beforeState.enabled
    // 切换状态
    const toggleResult = await evalInPage(ws, `(async () => {
      try {
        const r = await window.api.agent.toggle(${JSON.stringify(firstAgentId)}, ${!originalEnabled});
        return { ok: r?.success !== false };
      } catch (e) { return { ok: false, error: e.message }; }
    })()`)
    check(`agent.toggle 切换为 ${!originalEnabled}`,
      toggleResult?.ok === true,
      `result=${JSON.stringify(toggleResult)}`)

    // 验证状态已持久化
    const afterState = await evalInPage(ws, `(async () => {
      try {
        const r = await window.api.agent.get(${JSON.stringify(firstAgentId)});
        return { ok: r !== null, enabled: r?.enabled };
      } catch (e) { return { ok: false, error: e.message }; }
    })()`)
    check('agent.toggle 后 get 反映新状态',
      afterState?.enabled === !originalEnabled,
      `before=${originalEnabled}, after=${afterState?.enabled}`)

    // 恢复原状态
    await evalInPage(ws, `(async () => {
      try {
        await window.api.agent.toggle(${JSON.stringify(firstAgentId)}, ${originalEnabled});
      } catch (e) {}
      return true;
    })()`)
    const restoredState = await evalInPage(ws, `(async () => {
      try {
        const r = await window.api.agent.get(${JSON.stringify(firstAgentId)});
        return r?.enabled;
      } catch (e) { return null; }
    })()`)
    check('agent.toggle 恢复原状态',
      restoredState === originalEnabled,
      `expected=${originalEnabled}, actual=${restoredState}`)
  } else {
    check('agent.get 读取失败,跳过 toggle 测试', false, JSON.stringify(beforeState))
  }
}

// =============================================================
console.log('\n[R123-10] 错误捕获 + 性能基线')

// 多次读取 agent.list 测量耗时
const t0 = Date.now()
for (let i = 0; i < 5; i++) {
  await evalInPage(ws, `window.api.agent.list()`)
}
const listDurationMs = Date.now() - t0
check(`5 次 agent.list 平均耗时 < 500ms (实际 ${Math.round(listDurationMs / 5)}ms)`,
  listDurationMs < 2500,
  `total=${listDurationMs}ms`)

const finalErrors = await getErrors()
check('AI 循环测试期间 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// =============================================================
console.log('\n[R123-11] 清理 - 删除测试学生')

const cleanupResult = await evalInPage(ws, `(async () => {
  try {
    await window.api.eaa.deleteStudent(${JSON.stringify(testStudent)});
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('清理测试学生',
  cleanupResult?.ok === true,
  `result=${JSON.stringify(cleanupResult)}`)

// =============================================================
console.log('\n========================================')
console.log(`R123 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
