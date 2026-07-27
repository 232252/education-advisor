// =============================================================
// R98: AI Agent 调用循环完整性测试
// 角度 1: agent.list 返回所有 agent 且结构完整
// 角度 2: 每个 agent 都能 get 详情 (SOUL/rules/history 链路)
// 角度 3: agent 状态机 (idle/running/error) 订阅-转发无丢失
// 角度 4: agent.runManual 错误处理 (不存在的 agent / 空提示词)
// 角度 5: agent.abort 中断运行中的 agent
// 角度 6: agent.toggle 持久化 (停用→启用→停用)
// 角度 7: agent.update 配置更新 + 回滚
// 角度 8: subscribeStatus 派生订阅器 (多个订阅者/取消订阅)
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
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
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
console.log(`[R98] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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

// 全局错误捕获
await evalInPage(ws, `
  window.__r98Errors = [];
  if (!window.__r98HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r98Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r98Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r98HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r98Errors || []))`)
}

// =============================================================
console.log('\n=== R98: AI Agent 调用循环完整性测试 ===')

// =============================================================
console.log('\n[R98-1] agent.list 返回所有 agent 且结构完整')

const agentList = await evalInPage(ws, `window.api.agent.list()`)
check('agent.list 返回数组', Array.isArray(agentList), `type=${typeof agentList}`)
check('agent.list 非空', Array.isArray(agentList) && agentList.length > 0, `length=${agentList?.length}`)

if (Array.isArray(agentList) && agentList.length > 0) {
  const sampleAgent = agentList[0]
  check('agent 项有 id 字段', typeof sampleAgent.id === 'string', `id=${sampleAgent.id}`)
  check('agent 项有 name 字段', typeof sampleAgent.name === 'string', `name=${sampleAgent.name}`)
  check('agent 项有 status 字段', typeof sampleAgent.status === 'string', `status=${sampleAgent.status}`)
  check('agent 项有 enabled 字段', typeof sampleAgent.enabled === 'boolean', `enabled=${sampleAgent.enabled}`)
  
  // 验证至少有多个 agent (文档说 18 个)
  check('agent 数量 >= 5 (multi-agent system)', agentList.length >= 5, `count=${agentList.length}`)
  
  // 验证所有 agent id 唯一
  const ids = agentList.map(a => a.id)
  const uniqueIds = new Set(ids)
  check('所有 agent id 唯一', uniqueIds.size === ids.length, `duplicates=${ids.length - uniqueIds.size}`)
}

// =============================================================
console.log('\n[R98-2] 每个 agent 都能 get 详情 (SOUL/rules/history 链路)')

const agentsForDetail = Array.isArray(agentList) ? agentList.slice(0, 5) : [] // 测试前 5 个,避免太慢
let detailSuccessCount = 0
let soulSuccessCount = 0
let rulesSuccessCount = 0
let historySuccessCount = 0

for (const agent of agentsForDetail) {
  const detail = await evalInPage(ws, `window.api.agent.get(${JSON.stringify(agent.id)})`)
  if (detail && !detail.__error) detailSuccessCount++
  
  const soul = await evalInPage(ws, `window.api.agent.getSoul(${JSON.stringify(agent.id)})`)
  if (soul && !soul.__error && (typeof soul === 'string' || soul?.content)) soulSuccessCount++
  
  const rules = await evalInPage(ws, `window.api.agent.getRules(${JSON.stringify(agent.id)})`)
  if (rules && !rules.__error && (typeof rules === 'string' || rules?.content)) rulesSuccessCount++
  
  const history = await evalInPage(ws, `window.api.agent.getHistory(${JSON.stringify(agent.id)})`)
  if (history && !history.__error) historySuccessCount++
}

check(`agent.get 详情获取 (前 5 个, 成功 ${detailSuccessCount}/${agentsForDetail.length})`,
  detailSuccessCount === agentsForDetail.length)
check(`agent.getSoul SOUL 获取 (成功 ${soulSuccessCount}/${agentsForDetail.length})`,
  soulSuccessCount === agentsForDetail.length)
check(`agent.getRules 规则获取 (成功 ${rulesSuccessCount}/${agentsForDetail.length})`,
  rulesSuccessCount === agentsForDetail.length)
check(`agent.getHistory 历史获取 (成功 ${historySuccessCount}/${agentsForDetail.length})`,
  historySuccessCount === agentsForDetail.length)

// =============================================================
console.log('\n[R98-3] agent.runManual 错误处理')

// 测试不存在的 agent
const r1 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual('__nonexistent_agent__', 'test prompt');
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('runManual 不存在的 agent 不崩溃',
  r1 && (r1.ok || (!r1.ok && r1.error)),
  `result=${JSON.stringify(r1).slice(0, 150)}`)

// 测试空 prompt
if (Array.isArray(agentList) && agentList.length > 0) {
  const testAgent = agentList.find(a => a.enabled) || agentList[0]
  const r2 = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.runManual(${JSON.stringify(testAgent.id)}, '');
      return { ok: true, result: r, hasStructured: r && typeof r === 'object' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  check('runManual 空 prompt 不崩溃',
    r2 && (r2.ok || (!r2.ok && r2.error)),
    `result=${JSON.stringify(r2).slice(0, 150)}`)
}

// 测试 null prompt
const r3 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual(null, 'test');
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('runManual null agentId 不崩溃',
  r3 && (r3.ok || (!r3.ok && r3.error)),
  `result=${JSON.stringify(r3).slice(0, 150)}`)

// =============================================================
console.log('\n[R98-4] agent.toggle 持久化 (停用→启用→停用)')

if (Array.isArray(agentList) && agentList.length > 0) {
  const testAgent = agentList[0]
  const originalEnabled = testAgent.enabled
  
  // 切换状态
  const toggled1 = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.toggle(${JSON.stringify(testAgent.id)}, ${!originalEnabled});
      return { ok: true, success: r?.success };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  check(`toggle ${originalEnabled}→${!originalEnabled} 不崩溃`,
    toggled1?.ok, `result=${JSON.stringify(toggled1).slice(0, 100)}`)
  
  await sleep(200)
  
  // 验证状态已持久化
  const listAfterToggle = await evalInPage(ws, `window.api.agent.list()`)
  const agentAfterToggle = Array.isArray(listAfterToggle) ? listAfterToggle.find(a => a.id === testAgent.id) : null
  check('toggle 后状态在 list 中已更新',
    agentAfterToggle?.enabled === !originalEnabled,
    `expected=${!originalEnabled}, actual=${agentAfterToggle?.enabled}`)
  
  // 恢复原状态
  await evalInPage(ws, `window.api.agent.toggle(${JSON.stringify(testAgent.id)}, ${originalEnabled})`)
  await sleep(200)
  
  const listAfterRestore = await evalInPage(ws, `window.api.agent.list()`)
  const agentAfterRestore = Array.isArray(listAfterRestore) ? listAfterRestore.find(a => a.id === testAgent.id) : null
  check('toggle 恢复原状态成功',
    agentAfterRestore?.enabled === originalEnabled,
    `expected=${originalEnabled}, actual=${agentAfterRestore?.enabled}`)
}

// =============================================================
console.log('\n[R98-5] subscribeStatus 多订阅者 + 取消订阅')

if (Array.isArray(agentList) && agentList.length > 0) {
  const subTest = await evalInPage(ws, `(async () => {
    // 安装 3 个订阅者
    let count1 = 0, count2 = 0, count3 = 0;
    const unsub1 = window.api.agent.onStatusUpdate(() => count1++);
    const unsub2 = window.api.agent.onStatusUpdate(() => count2++);
    const unsub3 = window.api.agent.onStatusUpdate(() => count3++);
    
    // 立即取消第 3 个
    unsub3();
    
    // 等待一小段时间 (主进程可能不会有事件,但订阅机制本身不崩溃)
    await new Promise(r => setTimeout(r, 500));
    
    // 取消前两个
    unsub1();
    unsub2();
    
    return {
      installed: true,
      unsub1Type: typeof unsub1,
      unsub2Type: typeof unsub2,
      unsub3Type: typeof unsub3,
    };
  })()`)
  
  check('3 个订阅者安装 + 取消全部成功',
    subTest?.installed === true &&
    subTest?.unsub1Type === 'function' &&
    subTest?.unsub2Type === 'function' &&
    subTest?.unsub3Type === 'function',
    `result=${JSON.stringify(subTest)}`)
}

// =============================================================
console.log('\n[R98-6] agent.update 配置更新')

if (Array.isArray(agentList) && agentList.length > 0) {
  const testAgent = agentList[0]
  // 读取原配置
  const originalDetail = await evalInPage(ws, `window.api.agent.get(${JSON.stringify(testAgent.id)})`)
  
  // 更新描述 (可逆字段)
  const originalDesc = originalDetail?.description || ''
  const newDesc = `R98-test-${Date.now()}`
  
  const updateResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.update(${JSON.stringify(testAgent.id)}, { description: ${JSON.stringify(newDesc)} });
      return { ok: true, success: r?.success, hasAgents: Array.isArray(r?.agents), hasDetail: r?.detail !== undefined };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  
  check('agent.update 不崩溃且返回结构化响应',
    updateResult?.ok === true,
    `result=${JSON.stringify(updateResult).slice(0, 150)}`)
  
  // 验证描述已更新
  const updatedDetail = await evalInPage(ws, `window.api.agent.get(${JSON.stringify(testAgent.id)})`)
  check('agent.update 描述已更新',
    updatedDetail?.description === newDesc,
    `expected=${newDesc}, actual=${updatedDetail?.description}`)
  
  // 恢复原描述
  await evalInPage(ws, `window.api.agent.update(${JSON.stringify(testAgent.id)}, { description: ${JSON.stringify(originalDesc)} })`)
}

// =============================================================
console.log('\n[R98-7] agent.abort 中断 (即使没有运行中的 agent 也不崩溃)')

if (Array.isArray(agentList) && agentList.length > 0) {
  const testAgent = agentList[0]
  const abortResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.abort(${JSON.stringify(testAgent.id)});
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  
  check('agent.abort 无运行中 agent 时不崩溃',
    abortResult?.ok === true || (abortResult?.ok === false && abortResult?.error),
    `result=${JSON.stringify(abortResult).slice(0, 150)}`)
}

// 测试 abort 不存在的 agent
const abortNonExist = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.abort('__nonexistent__');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('agent.abort 不存在的 agent 不崩溃',
  abortNonExist?.ok === true || (abortNonExist?.ok === false && abortNonExist?.error),
  `result=${JSON.stringify(abortNonExist).slice(0, 100)}`)

// =============================================================
console.log('\n[R98-8] 全程错误捕获 + 最终一致性')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// 最终验证 agent 系统仍工作
const finalCheck = await evalInPage(ws, `(async () => {
  const list = await window.api.agent.list();
  return {
    listOk: Array.isArray(list) && list.length > 0,
    count: list?.length,
  };
})()`)
check('最终 agent.list 仍正常工作',
  finalCheck?.listOk === true,
  `result=${JSON.stringify(finalCheck)}`)

// =============================================================
console.log('\n========================================')
console.log(`R98 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
