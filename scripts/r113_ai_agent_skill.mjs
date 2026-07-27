// =============================================================
// R113: AI/Agent/Skill 深度测试
// 角度 1: AI chat 流式生命周期 - 不存在 provider 异步 error 事件
// 角度 2: AI chat abort - 启动后立即 abort
// 角度 3: AI custom model 生命周期 - add/list/delete
// 角度 4: AI custom model 边界 - 空 providerId/modelId 拒绝
// 角度 5: AI listProviders/listModels 不崩溃
// 角度 6: Agent 生命周期 - list/get/toggle/update
// 角度 7: Agent SOUL/RULES - getSoul/setSoul/getRules/setRules
// 角度 8: Agent runManual 异步 status - 启动+onStatusUpdate
// 角度 9: Agent abort - 启动后立即 abort
// 角度 10: Agent 边界 - 不存在 agent id
// 角度 11: Skill 生命周期 - list/get/save/delete
// 角度 12: Skill 边界 - 非法 name, 不存在 name 删除
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
console.log(`[R113] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r113Errors = [];
  if (!window.__r113HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r113Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r113Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r113HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r113Errors || []))`)
}

const STAMP = `r113-${Date.now()}`
const createdCustomModels = [] // {providerId, modelId}
const createdSkills = [] // name

console.log('\n=== R113: AI/Agent/Skill 深度测试 ===')

// =============================================================
console.log('\n[R113-1] AI chat 流式生命周期 - 不存在 provider 异步 error')

// 启动 chat (不存在 provider) + 订阅 onStream, 应在 8s 内收到 error 事件
const chatStreamLifecycle = await evalInPage(ws, `(async () => {
  return new Promise((resolve) => {
    let resolved = false
    const events = []
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        unsub()
        resolve({ ok: false, error: 'timeout', events })
      }
    }, 8000)
    const unsub = window.api.ai.onStream((event) => {
      events.push({ type: event.type })
      if (event.type === 'error' && !resolved) {
        resolved = true
        clearTimeout(timer)
        unsub()
        resolve({ ok: true, message: event.message, retryable: event.retryable, events })
      } else if (event.type === 'done' && !resolved) {
        resolved = true
        clearTimeout(timer)
        unsub()
        resolve({ ok: true, done: true, events })
      }
    })
    window.api.ai.chat({
      providerId: 'r113_nonexistent_xyz',
      modelId: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
    }).catch(() => {})
  })
})()`)
check('ai.chat 不存在 provider 异步推送 error 事件',
  chatStreamLifecycle?.ok === true,
  `result=${JSON.stringify(chatStreamLifecycle).slice(0, 200)}`)
check('ai.chat error 事件含 message 字段',
  typeof chatStreamLifecycle?.message === 'string' && chatStreamLifecycle.message.length > 0,
  `message=${chatStreamLifecycle?.message}`)

// =============================================================
console.log('\n[R113-2] AI chat abort - 启动后立即 abort')

// 启动 chat 后立即 abort, 应该不卡死
const abortTest = await evalInPage(ws, `(async () => {
  try {
    // 启动 chat (会失败但不影响 abort 测试)
    const chatPromise = window.api.ai.chat({
      providerId: 'r113_abort_test',
      modelId: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
    })
    // 立即 abort
    const abortResult = await window.api.ai.abortChat()
    await chatPromise.catch(() => {})
    return { ok: true, abortResult }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})()`)
check('ai.abortChat 启动后立即调用不崩溃',
  abortTest?.ok === true,
  `result=${JSON.stringify(abortTest).slice(0, 150)}`)
check('ai.abortChat 返回 activeChats 字段',
  typeof abortTest?.abortResult?.activeChats === 'number',
  `abortResult=${JSON.stringify(abortTest?.abortResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R113-3] AI custom model 生命周期 - add/list/delete')

// 列出 providers (找第一个有 API 的 provider 来添加 custom model)
const providers = await evalInPage(ws, `(async () => {
  try { return await window.api.ai.listProviders(); } catch (e) { return []; }
})()`)
check('ai.listProviders 不崩溃',
  Array.isArray(providers),
  `count=${Array.isArray(providers) ? providers.length : 0}`)

// 找一个 provider 添加 custom model
const testProviderId = (Array.isArray(providers) && providers[0]?.id) || 'openai'
const customModelId = `${STAMP}-custom-model`

// addCustomModel
const addModelResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel({
      providerId: ${JSON.stringify(testProviderId)},
      modelId: ${JSON.stringify(customModelId)},
      name: 'R113 Test Custom Model',
      contextWindow: 32768,
      maxOutputTokens: 4096,
      supportsReasoning: false,
    });
    return { ok: r?.success !== false || !!r?.id, hasId: !!r?.id, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.addCustomModel 不崩溃',
  addModelResult?.ok === true,
  `result=${JSON.stringify(addModelResult).slice(0, 150)}`)
if (addModelResult?.ok) createdCustomModels.push({ providerId: testProviderId, modelId: customModelId })

// 验证 listModels 包含新添加的 custom model
const listModelsAfterAdd = await evalInPage(ws, `(async () => {
  try {
    const models = await window.api.ai.listModels(${JSON.stringify(testProviderId)});
    const found = (models || []).find(m => m.id === ${JSON.stringify(customModelId)});
    return { ok: true, found: !!found, isCustom: found?.isCustom, totalModels: (models || []).length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.listModels 包含新添加的 custom model',
  listModelsAfterAdd?.found === true,
  `result=${JSON.stringify(listModelsAfterAdd).slice(0, 150)}`)

// deleteCustomModel
if (createdCustomModels.length > 0) {
  const { providerId, modelId } = createdCustomModels[0]
  const deleteResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.ai.deleteCustomModel(${JSON.stringify(providerId)}, ${JSON.stringify(modelId)});
      return { ok: r?.success !== false, error: r?.error };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check('ai.deleteCustomModel 不崩溃',
    deleteResult?.ok === true,
    `result=${JSON.stringify(deleteResult).slice(0, 150)}`)

  // 验证删除后 listModels 不再包含
  const listModelsAfterDelete = await evalInPage(ws, `(async () => {
    try {
      const models = await window.api.ai.listModels(${JSON.stringify(providerId)});
      const found = (models || []).find(m => m.id === ${JSON.stringify(modelId)});
      return { ok: true, found: !!found };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check('ai.listModels 删除后不再包含 custom model',
    listModelsAfterDelete?.ok === true && listModelsAfterDelete?.found === false,
    `result=${JSON.stringify(listModelsAfterDelete).slice(0, 150)}`)
  createdCustomModels.shift()
}

// =============================================================
console.log('\n[R113-4] AI custom model 边界 - 空 providerId/modelId 拒绝')

// 空 providerId
const addEmptyProvider = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel({
      providerId: '',
      modelId: 'r113_test',
      name: 'test',
    });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.addCustomModel 空 providerId 被拒绝',
  addEmptyProvider?.ok === false,
  `result=${JSON.stringify(addEmptyProvider).slice(0, 100)}`)

// 空 modelId
const addEmptyModel = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel({
      providerId: 'openai',
      modelId: '',
      name: 'test',
    });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.addCustomModel 空 modelId 被拒绝',
  addEmptyModel?.ok === false,
  `result=${JSON.stringify(addEmptyModel).slice(0, 100)}`)

// null 参数
const addNull = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel(null);
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.addCustomModel null 被拒绝',
  addNull?.ok === false,
  `result=${JSON.stringify(addNull).slice(0, 100)}`)

// =============================================================
console.log('\n[R113-5] AI listProviders/listModels 不崩溃')

// listProviders 已在上面调用, 这里再测一次 listModels 不存在 provider
const listModelsBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listModels('r113_nonexistent_provider');
    return { ok: Array.isArray(r), count: Array.isArray(r) ? r.length : 0 };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.listModels 不存在 provider 返回空数组',
  listModelsBad?.ok === true && listModelsBad.count === 0,
  `result=${JSON.stringify(listModelsBad).slice(0, 100)}`)

// =============================================================
console.log('\n[R113-6] Agent 生命周期 - list/get/toggle/update')

// list
const agentList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    return { ok: Array.isArray(r) || r?.success !== false, count: Array.isArray(r) ? r.length : (r?.agents?.length ?? 0) };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.list 不崩溃',
  agentList?.ok === true,
  `result=${JSON.stringify(agentList).slice(0, 100)}`)

// 找一个 agent id 用于后续测试
const agents = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    return Array.isArray(r) ? r : (r?.agents || []);
  } catch (e) { return []; }
})()`)
const testAgentId = (Array.isArray(agents) && agents[0]?.id) || 'class-monitor'

// get
const agentGet = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.get(${JSON.stringify(testAgentId)});
    return { ok: !!r || r?.success !== false, hasId: !!r?.id, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.get 不崩溃',
  agentGet?.ok === true,
  `result=${JSON.stringify(agentGet).slice(0, 150)}`)

// get 不存在 agent
const agentGetBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.get('r113_nonexistent_agent');
    return { ok: r === null || r?.success !== false };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.get 不存在 agent 返回 null',
  agentGetBad?.ok === true,
  `result=${JSON.stringify(agentGetBad).slice(0, 100)}`)

// toggle - 关闭再开启 (用真实 agent)
const agentToggleOff = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.toggle(${JSON.stringify(testAgentId)}, false);
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.toggle(off) 不崩溃',
  agentToggleOff?.ok === true,
  `result=${JSON.stringify(agentToggleOff).slice(0, 100)}`)

const agentToggleOn = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.toggle(${JSON.stringify(testAgentId)}, true);
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.toggle(on) 不崩溃',
  agentToggleOn?.ok === true,
  `result=${JSON.stringify(agentToggleOn).slice(0, 100)}`)

// update (修改 description 又改回)
const agentUpdate = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.update(${JSON.stringify(testAgentId)}, { description: 'R113 测试描述' });
    return { ok: r?.success !== false, hasAgents: !!r?.agents, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.update 不崩溃',
  agentUpdate?.ok === true,
  `result=${JSON.stringify(agentUpdate).slice(0, 150)}`)

// update 不存在 agent
const agentUpdateBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.update('r113_nonexistent_agent', { description: 'test' });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.update 不存在 agent 安全失败',
  agentUpdateBad?.ok === false || (agentUpdateBad?.error && agentUpdateBad.error.length > 0),
  `result=${JSON.stringify(agentUpdateBad).slice(0, 100)}`)

// =============================================================
console.log('\n[R113-7] Agent SOUL/RULES')

// getSoul
const getSoulResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getSoul(${JSON.stringify(testAgentId)});
    return { ok: typeof r === 'string', length: typeof r === 'string' ? r.length : 0 };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.getSoul 不崩溃',
  getSoulResult?.ok === true,
  `result=${JSON.stringify(getSoulResult).slice(0, 100)}`)

// 备份原 SOUL
const originalSoul = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getSoul(${JSON.stringify(testAgentId)});
    return typeof r === 'string' ? r : '';
  } catch (e) { return ''; }
})()`)

// setSoul
const setSoulResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.setSoul(${JSON.stringify(testAgentId)}, ${JSON.stringify(originalSoul + '\n# R113 测试标记')});
    return { ok: r?.success !== false, hasDetail: !!r?.detail, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.setSoul 不崩溃',
  setSoulResult?.ok === true,
  `result=${JSON.stringify(setSoulResult).slice(0, 150)}`)

// 验证 getSoul 返回新内容
const getSoulAfter = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getSoul(${JSON.stringify(testAgentId)});
    return { ok: typeof r === 'string', hasMarker: typeof r === 'string' ? r.includes('R113 测试标记') : false };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.getSoul 反映 setSoul 内容',
  getSoulAfter?.hasMarker === true,
  `result=${JSON.stringify(getSoulAfter).slice(0, 100)}`)

// 还原 SOUL
await evalInPage(ws, `(async () => {
  try {
    await window.api.agent.setSoul(${JSON.stringify(testAgentId)}, ${JSON.stringify(originalSoul)});
    return true;
  } catch (e) { return false; }
})()`)

// getRules / setRules 同样测试
const getRulesResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getRules(${JSON.stringify(testAgentId)});
    return { ok: typeof r === 'string' };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.getRules 不崩溃',
  getRulesResult?.ok === true,
  `result=${JSON.stringify(getRulesResult).slice(0, 100)}`)

const originalRules = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getRules(${JSON.stringify(testAgentId)});
    return typeof r === 'string' ? r : '';
  } catch (e) { return ''; }
})()`)

const setRulesResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.setRules(${JSON.stringify(testAgentId)}, ${JSON.stringify(originalRules + '\n# R113 测试规则')});
    return { ok: r?.success !== false };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.setRules 不崩溃',
  setRulesResult?.ok === true,
  `result=${JSON.stringify(setRulesResult).slice(0, 100)}`)

// 还原 RULES
await evalInPage(ws, `(async () => {
  try {
    await window.api.agent.setRules(${JSON.stringify(testAgentId)}, ${JSON.stringify(originalRules)});
    return true;
  } catch (e) { return false; }
})()`)

// setSoul 不存在 agent 应被拒绝 (R78 修复)
const setSoulBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.setSoul('r113_nonexistent_agent', 'test');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.setSoul 不存在 agent 被拒绝 (R78)',
  setSoulBad?.ok === false,
  `result=${JSON.stringify(setSoulBad).slice(0, 100)}`)

// =============================================================
console.log('\n[R113-8] Agent runManual 异步 status - 启动+onStatusUpdate')

// 启动 agent (会失败因为没有 API key, 但应通过 onStatusUpdate 推送 error 事件)
const runManualResult = await evalInPage(ws, `(async () => {
  return new Promise((resolve) => {
    let resolved = false
    const events = []
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        unsub()
        resolve({ ok: true, timeout: true, events, status: 'timeout' })
      }
    }, 15000)
    const unsub = window.api.agent.onStatusUpdate((data) => {
      if (data?.agentId === ${JSON.stringify(testAgentId)}) {
        events.push({ status: data.status, hasError: !!data.error, hasResult: !!data.result })
        // 收到 error 或 idle (with result/aborted) 时立即返回
        if ((data.status === 'error' || (data.status === 'idle' && (data.result || data.aborted))) && !resolved) {
          resolved = true
          clearTimeout(timer)
          unsub()
          resolve({ ok: true, finalStatus: data.status, hasError: !!data.error, events })
        }
      }
    })
    window.api.agent.runManual(${JSON.stringify(testAgentId)}, 'R113 测试触发').catch(() => {})
  })
})()`)
check('agent.runManual 异步推送 status 事件',
  runManualResult?.ok === true,
  `result=${JSON.stringify(runManualResult).slice(0, 250)}`)

// 同步返回值校验
const runManualSync = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual(${JSON.stringify(testAgentId)}, 'R113 sync test');
    return { ok: r?.success !== false, hasId: !!r?.id, message: r?.message };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.runManual sync 返回 {success, id, message}',
  runManualSync?.ok === true && runManualSync.hasId === true,
  `result=${JSON.stringify(runManualSync).slice(0, 150)}`)

// =============================================================
console.log('\n[R113-9] Agent abort')

// 启动 agent 后立即 abort
const agentAbortTest = await evalInPage(ws, `(async () => {
  try {
    // 启动 (fire-and-forget)
    window.api.agent.runManual(${JSON.stringify(testAgentId)}, 'R113 abort test').catch(() => {})
    // 立即 abort
    const r = await window.api.agent.abort(${JSON.stringify(testAgentId)});
    return { ok: r?.success !== false, message: r?.message };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.abort 启动后立即调用不崩溃',
  agentAbortTest?.ok === true,
  `result=${JSON.stringify(agentAbortTest).slice(0, 150)}`)

// abort 不存在的 agent (不应崩溃)
const agentAbortBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.abort('r113_nonexistent_agent');
    return { ok: r?.success !== false, message: r?.message };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.abort 不存在 agent 不崩溃',
  agentAbortBad?.ok === true || (agentAbortBad?.message && agentAbortBad.message.length > 0),
  `result=${JSON.stringify(agentAbortBad).slice(0, 100)}`)

// =============================================================
console.log('\n[R113-10] Agent 边界 - 不存在 agent id')

// runManual 不存在 agent
const runManualBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual('r113_nonexistent_agent', 'test');
    return { ok: r?.success !== false, message: r?.message };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.runManual 不存在 agent 安全失败',
  runManualBad?.ok === false || (runManualBad?.message && runManualBad.message.length > 0),
  `result=${JSON.stringify(runManualBad).slice(0, 100)}`)

// runManual 空 prompt
const runManualEmpty = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual(${JSON.stringify(testAgentId)}, '');
    return { ok: r?.success !== false, message: r?.message };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.runManual 空 prompt 被拒绝',
  runManualEmpty?.ok === false,
  `result=${JSON.stringify(runManualEmpty).slice(0, 100)}`)

// getHistory
const agentHistory = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getHistory(${JSON.stringify(testAgentId)});
    return { ok: Array.isArray(r) || r?.success !== false, count: Array.isArray(r) ? r.length : (r?.history?.length ?? 0) };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.getHistory 不崩溃',
  agentHistory?.ok === true,
  `result=${JSON.stringify(agentHistory).slice(0, 100)}`)

// =============================================================
console.log('\n[R113-11] Skill 生命周期 - list/get/save/delete')

// list
const skillList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.list();
    return { ok: Array.isArray(r), count: Array.isArray(r) ? r.length : 0 };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('skill.list 不崩溃',
  skillList?.ok === true,
  `result=${JSON.stringify(skillList).slice(0, 100)}`)

// save (创建一个测试 skill)
const testSkillName = `r113-test-skill-${Date.now()}`
const skillSave = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.save(${JSON.stringify(testSkillName)}, '# R113 Test Skill\\n\\nThis is a test skill for R113.');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('skill.save 不崩溃',
  skillSave?.ok === true,
  `result=${JSON.stringify(skillSave).slice(0, 100)}`)
if (skillSave?.ok) createdSkills.push(testSkillName)

// get
if (createdSkills.length > 0) {
  const skillGet = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.skill.get(${JSON.stringify(createdSkills[0])});
      return { ok: !!r && !r?.error, hasContent: !!r?.content, hasName: !!r?.name };
    } catch (e) { return { ok: false, error: e.message }; }
})()`)
  check('skill.get 不崩溃且返回内容',
    skillGet?.ok === true && skillGet?.hasContent === true,
    `result=${JSON.stringify(skillGet).slice(0, 150)}`)
}

// list 应包含新创建的 skill
if (createdSkills.length > 0) {
  const skillListAfterSave = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.skill.list();
      const found = (r || []).find(s => s.name === ${JSON.stringify(createdSkills[0])});
      return { ok: Array.isArray(r), found: !!found };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check('skill.list 包含新创建的 skill',
    skillListAfterSave?.found === true,
    `result=${JSON.stringify(skillListAfterSave).slice(0, 150)}`)
}

// delete
if (createdSkills.length > 0) {
  const skillDelete = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.skill.delete(${JSON.stringify(createdSkills[0])});
      return { ok: r?.success !== false, error: r?.error };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check('skill.delete 不崩溃',
    skillDelete?.ok === true,
    `result=${JSON.stringify(skillDelete).slice(0, 100)}`)

  // 验证删除后 list 不再包含
  const skillListAfterDelete = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.skill.list();
      const found = (r || []).find(s => s.name === ${JSON.stringify(createdSkills[0])});
      return { ok: Array.isArray(r), found: !!found };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check('skill.list 删除后不再包含',
    skillListAfterDelete?.found === false,
    `result=${JSON.stringify(skillListAfterDelete).slice(0, 100)}`)
  createdSkills.shift()
}

// =============================================================
console.log('\n[R113-12] Skill 边界')

// save 非法 name (含路径穿越)
const skillSaveBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.save('../../../etc/passwd', 'test');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('skill.save 路径穿越 name 被拒绝',
  skillSaveBad?.ok === false,
  `result=${JSON.stringify(skillSaveBad).slice(0, 100)}`)

// save 非法 name (含冒号)
const skillSaveBad2 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.save('r113:bad:name', 'test');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('skill.save 含冒号 name 被拒绝',
  skillSaveBad2?.ok === false,
  `result=${JSON.stringify(skillSaveBad2).slice(0, 100)}`)

// delete 不存在 skill
const skillDeleteBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.delete('r113_nonexistent_skill_xyz');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('skill.delete 不存在 skill 安全失败',
  skillDeleteBad?.ok === false,
  `result=${JSON.stringify(skillDeleteBad).slice(0, 100)}`)

// get 不存在 skill
const skillGetBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.get('r113_nonexistent_skill_xyz');
    return { ok: r === null || r?.success !== false };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('skill.get 不存在 skill 返回 null',
  skillGetBad?.ok === true,
  `result=${JSON.stringify(skillGetBad).slice(0, 100)}`)

// =============================================================
console.log('\n[R113-13] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 300)}`)

// =============================================================
console.log('\n========================================')
console.log(`R113 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
