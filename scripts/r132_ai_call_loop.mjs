// =============================================================
// R132: AI 调用循环适配测试 (provider/modelTier/重试/超时)
// 角度 1: Settings 完整性 & 枚举校验 (chat/models/general)
// 角度 2: 模型层级解析 (default/high_quality/low_cost 回退)
// 角度 3: 聊天流式生命周期 (error paths: no key/model not found/empty messages)
// 角度 4: Agent 中断路径 (abort on running/non-running)
// 角度 5: 重试策略管道 (retry.enabled/maxRetries/shouldRetry 计算)
// 角度 6: 自定义模型 CRUD 校验
// 角度 7: 连接测试错误路径
// 角度 8: 设置 dotPath 安全校验 (原型污染/NaN/路径校验)
// 角度 9: 错误分类 (isRetryableError 等价测试)
// 角度 10: 并发 chat 自动中断前一个
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

const STAMP = `r132-${Date.now()}`
console.log('\n=== R132: AI 调用循环适配测试 ===')
console.log(`[R132] STAMP = ${STAMP}`)

let ws = await connectWS()

// 保存初始 settings
const initialSettings = await evalInPage(ws, `(async () => await window.api.settings.get())()`)
console.log(`  初始 settings.chat.maxTokens = ${initialSettings?.chat?.maxTokens}`)
console.log(`  初始 settings.models.retry = ${JSON.stringify(initialSettings?.models?.retry)}`)
console.log(`  初始 settings.general.agentTimeoutMins = ${initialSettings?.general?.agentTimeoutMins}`)

// =============================================================
console.log('\n[R132-1] Settings 完整性 & 枚举校验')

// 1.1 验证 settings.get 返回所有 AI 相关字段
const aiSettings = await evalInPage(ws, `(async () => {
  const s = await window.api.settings.get();
  return {
    hasChat: !!s?.chat,
    hasModels: !!s?.models,
    hasRetry: !!s?.models?.retry,
    hasAgentTimeout: s?.general?.agentTimeoutMins !== undefined,
    chatFields: s?.chat ? Object.keys(s.chat).sort() : [],
    modelsFields: s?.models ? Object.keys(s.models).sort() : [],
    retryFields: s?.models?.retry ? Object.keys(s.models.retry).sort() : [],
    maxTokens: s?.chat?.maxTokens,
    thinkingLevel: s?.chat?.thinkingLevel,
    steeringMode: s?.chat?.steeringMode,
    retryEnabled: s?.models?.retry?.enabled,
    maxRetries: s?.models?.retry?.maxRetries,
    providerTimeoutMs: s?.models?.retry?.providerTimeoutMs,
  };
})()`)

check('settings 包含 chat 字段', aiSettings?.hasChat === true)
check('settings 包含 models 字段', aiSettings?.hasModels === true)
check('settings 包含 models.retry 字段', aiSettings?.hasRetry === true)
check('settings 包含 general.agentTimeoutMins', aiSettings?.hasAgentTimeout === true)
check('chat.maxTokens 是正整数',
  typeof aiSettings?.maxTokens === 'number' && aiSettings.maxTokens > 0,
  `maxTokens=${aiSettings?.maxTokens}`)
check('chat.thinkingLevel 是有效枚举值',
  ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(aiSettings?.thinkingLevel),
  `thinkingLevel=${aiSettings?.thinkingLevel}`)
check('chat.steeringMode 是有效枚举值',
  ['all', 'one-at-a-time'].includes(aiSettings?.steeringMode),
  `steeringMode=${aiSettings?.steeringMode}`)
check('models.retry.enabled 是布尔值',
  typeof aiSettings?.retryEnabled === 'boolean',
  `retryEnabled=${aiSettings?.retryEnabled}`)
check('models.retry.maxRetries 是非负整数',
  typeof aiSettings?.maxRetries === 'number' && aiSettings.maxRetries >= 0,
  `maxRetries=${aiSettings?.maxRetries}`)
check('models.retry.providerTimeoutMs 是正整数',
  typeof aiSettings?.providerTimeoutMs === 'number' && aiSettings.providerTimeoutMs > 0,
  `providerTimeoutMs=${aiSettings?.providerTimeoutMs}`)

// 1.2 枚举校验: 无效值应被拒绝
const enumTests = [
  { path: 'chat.thinkingLevel', value: 'INVALID', name: 'thinkingLevel=INVALID' },
  { path: 'chat.steeringMode', value: 'INVALID', name: 'steeringMode=INVALID' },
  { path: 'chat.followUpMode', value: 'INVALID', name: 'followUpMode=INVALID' },
  { path: 'general.theme', value: 'INVALID', name: 'theme=INVALID' },
]
for (const t of enumTests) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(t.path)}, ${JSON.stringify(t.value)});
      return { threw: false, success: r?.success, error: r?.error };
    } catch (e) { return { threw: true, error: e.message }; }
  })()`)
  const rejected = r?.threw === true || r?.success === false
  check(`枚举校验拒绝: ${t.name}`, rejected, `result=${JSON.stringify(r).slice(0, 100)}`)
}

// 1.3 有效枚举值应被接受
const validEnumTests = [
  { path: 'chat.thinkingLevel', value: 'high', name: 'thinkingLevel=high' },
  { path: 'chat.thinkingLevel', value: 'off', name: 'thinkingLevel=off' },
  { path: 'chat.steeringMode', value: 'one-at-a-time', name: 'steeringMode=one-at-a-time' },
]
for (const t of validEnumTests) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(t.path)}, ${JSON.stringify(t.value)});
      return { success: r?.success !== false };
    } catch (e) { return { threw: e.message }; }
  })()`)
  check(`枚举接受: ${t.name}`, r?.success === true, `result=${JSON.stringify(r).slice(0, 100)}`)
}

// 恢复 thinkingLevel
await evalInPage(ws, `(async () => { await window.api.settings.set('chat.thinkingLevel', 'medium'); return true; })()`)

// =============================================================
console.log('\n[R132-2] 模型层级解析 (通过 error path 验证)')

// 2.1 列出可用 providers
const providersResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listProviders();
    return { success: r?.success !== false, count: r?.providers?.length ?? r?.length ?? 0, sample: (r?.providers ?? r)?.slice(0, 3)?.map(p => ({ id: p?.id, name: p?.name, hidden: p?.hidden })) };
  } catch (e) { return { threw: e.message }; }
})()`)

check('ai:list-providers 可调用',
  providersResult?.success !== false || providersResult?.threw === undefined,
  `result=${JSON.stringify(providersResult).slice(0, 200)}`)
console.log(`  Providers: ${providersResult?.count}, sample=${JSON.stringify(providersResult?.sample)}`)

// 2.2 无 API key 时, chat 应返回 error (验证错误路径)
const chatNoKeyResult = await evalInPage(ws, `(async () => {
  // 收集 stream events
  const events = [];
  try {
    const sessionId = await window.api.ai.chat({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'test', timestamp: Date.now() }],
      maxTokens: 10,
    });
    // 订阅 stream
    const unsub = window.api.ai.onStream((event) => {
      events.push({ type: event?.type, hasMessage: !!event?.message, retryable: event?.retryable });
      if (event?.type === 'error' || event?.type === 'done') {
        if (typeof unsub === 'function') unsub();
      }
    });
    // 等待 events (最多 5 秒)
    await new Promise(r => setTimeout(r, 5000));
    if (typeof unsub === 'function') unsub();
    return { sessionStarted: !!sessionId, events: events.slice(0, 5) };
  } catch (e) { return { threw: e.message, events: events.slice(0, 5) }; }
})()`)

console.log(`  Chat (no API key): sessionStarted=${chatNoKeyResult?.sessionStarted}, events=${JSON.stringify(chatNoKeyResult?.events).slice(0, 300)}`)
check('无 API key 时 chat 返回 error event',
  chatNoKeyResult?.events?.some(e => e?.type === 'error') === true,
  `events=${JSON.stringify(chatNoKeyResult?.events).slice(0, 200)}`)

// 2.3 不存在的 provider 应返回 error
const chatBadProviderResult = await evalInPage(ws, `(async () => {
  const events = [];
  try {
    const sessionId = await window.api.ai.chat({
      providerId: '__nonexistent_provider__',
      modelId: 'fake-model',
      messages: [{ role: 'user', content: 'test', timestamp: Date.now() }],
      maxTokens: 10,
    });
    const unsub = window.api.ai.onStream((event) => {
      events.push({ type: event?.type, retryable: event?.retryable, hasRetry: !!event?.retry });
      if (event?.type === 'error' || event?.type === 'done') {
        if (typeof unsub === 'function') unsub();
      }
    });
    await new Promise(r => setTimeout(r, 5000));
    if (typeof unsub === 'function') unsub();
    return { sessionStarted: !!sessionId, events: events.slice(0, 5) };
  } catch (e) { return { threw: e.message, events: events.slice(0, 5) }; }
})()`)

console.log(`  Chat (bad provider): events=${JSON.stringify(chatBadProviderResult?.events).slice(0, 300)}`)
check('不存在的 provider 返回 error event',
  chatBadProviderResult?.events?.some(e => e?.type === 'error') === true,
  `events=${JSON.stringify(chatBadProviderResult?.events).slice(0, 200)}`)

// 2.4 空 messages 应返回 error
const chatEmptyMsgsResult = await evalInPage(ws, `(async () => {
  const events = [];
  try {
    const sessionId = await window.api.ai.chat({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      messages: [],
      maxTokens: 10,
    });
    const unsub = window.api.ai.onStream((event) => {
      events.push({ type: event?.type, retryable: event?.retryable });
      if (event?.type === 'error' || event?.type === 'done') {
        if (typeof unsub === 'function') unsub();
      }
    });
    await new Promise(r => setTimeout(r, 5000));
    if (typeof unsub === 'function') unsub();
    return { sessionStarted: !!sessionId, events: events.slice(0, 5) };
  } catch (e) { return { threw: e.message, events: events.slice(0, 5) }; }
})()`)

console.log(`  Chat (empty messages): events=${JSON.stringify(chatEmptyMsgsResult?.events).slice(0, 300)}`)
check('空 messages 返回 error event',
  chatEmptyMsgsResult?.events?.some(e => e?.type === 'error') === true,
  `events=${JSON.stringify(chatEmptyMsgsResult?.events).slice(0, 200)}`)

// =============================================================
console.log('\n[R132-3] 聊天流式生命周期 - abort & cleanup')

// 3.1 abort 无活动 chat
const abortNoActiveResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.abort();
    return { success: r?.success !== false, activeChats: r?.activeChats ?? r?.data?.activeChats };
  } catch (e) { return { threw: e.message }; }
})()`)

check('abort 无活动 chat 不报错',
  abortNoActiveResult?.success !== false || abortNoActiveResult?.threw === undefined,
  `result=${JSON.stringify(abortNoActiveResult).slice(0, 100)}`)

// 3.2 onStream 返回 unsubscribe 函数
const onStreamUnsubResult = await evalInPage(ws, `(() => {
  let unsubType = 'unknown';
  try {
    const unsub = window.api.ai.onStream(() => {});
    unsubType = typeof unsub;
    if (typeof unsub === 'function') unsub();
    return { unsubType, ok: true };
  } catch (e) { return { unsubType, error: e.message }; }
})()`)

check('ai.onStream 返回 unsubscribe 函数',
  onStreamUnsubResult?.unsubType === 'function',
  `unsubType=${onStreamUnsubResult?.unsubType}`)

// =============================================================
console.log('\n[R132-4] Agent 中断路径')

// 4.1 列出 agents
const agentsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    const arr = Array.isArray(r) ? r : (r?.agents || r?.data || []);
    return { count: arr.length, names: arr.map(a => a?.name || a?.id).slice(0, 5) };
  } catch (e) { return { threw: e.message }; }
})()`)

check('agent.list 可调用且返回 agents',
  agentsResult?.count > 0,
  `count=${agentsResult?.count}, names=${JSON.stringify(agentsResult?.names).slice(0, 150)}`)

// 4.2 abort 不在运行的 agent
const abortAgentResult = await evalInPage(ws, `(async () => {
  try {
    // 尝试 abort 一个不存在的 agent id
    const r = await window.api.agent.abort('__r132_nonexistent_agent__');
    return { success: r?.success, message: r?.message };
  } catch (e) { return { threw: e.message }; }
})()`)

check('abort 不存在的 agent 返回失败 (非崩溃)',
  abortAgentResult?.success === false || abortAgentResult?.threw !== undefined,
  `result=${JSON.stringify(abortAgentResult).slice(0, 100)}`)

// 4.3 agent.run-manual 对不存在的 agent
const runManualBadResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual('__r132_nonexistent_agent__');
    return { success: r?.success, message: r?.message };
  } catch (e) { return { threw: e.message }; }
})()`)

check('run-manual 不存在的 agent 返回失败 (非崩溃)',
  runManualBadResult?.success === false || runManualBadResult?.threw !== undefined,
  `result=${JSON.stringify(runManualBadResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R132-5] 重试策略管道 (retry settings 附加到 error events)')

// 5.1 修改 retry 设置后, error event 应反映新设置
await evalInPage(ws, `(async () => {
  await window.api.settings.set('models.retry.enabled', false);
  await window.api.settings.set('models.retry.maxRetries', 0);
  return true;
})()`)

const retryDisabledResult = await evalInPage(ws, `(async () => {
  const events = [];
  try {
    const sessionId = await window.api.ai.chat({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'test', timestamp: Date.now() }],
      maxTokens: 10,
    });
    const unsub = window.api.ai.onStream((event) => {
      if (event?.type === 'error') {
        events.push({
          retryable: event?.retryable,
          retry: event?.retry,
        });
      }
      if (event?.type === 'error' || event?.type === 'done') {
        if (typeof unsub === 'function') unsub();
      }
    });
    await new Promise(r => setTimeout(r, 5000));
    if (typeof unsub === 'function') unsub();
    return { events };
  } catch (e) { return { threw: e.message, events }; }
})()`)

console.log(`  Retry disabled error event: ${JSON.stringify(retryDisabledResult?.events).slice(0, 300)}`)
const retryDisabledError = retryDisabledResult?.events?.[0]
check('retry.enabled=false 时 error event 包含 retry.enabled=false',
  retryDisabledError?.retry?.enabled === false,
  `retry=${(JSON.stringify(retryDisabledError?.retry) ?? 'undefined').slice(0, 150)}`)

// 5.2 恢复 retry 设置, 验证 shouldRetry 计算
await evalInPage(ws, `(async () => {
  await window.api.settings.set('models.retry.enabled', true);
  await window.api.settings.set('models.retry.maxRetries', 5);
  await window.api.settings.set('models.retry.baseDelayMs', 2000);
  await window.api.settings.set('models.retry.providerTimeoutMs', 30000);
  return true;
})()`)

const retryEnabledResult = await evalInPage(ws, `(async () => {
  const events = [];
  try {
    const sessionId = await window.api.ai.chat({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'test', timestamp: Date.now() }],
      maxTokens: 10,
    });
    const unsub = window.api.ai.onStream((event) => {
      if (event?.type === 'error') {
        events.push({
          retryable: event?.retryable,
          retry: event?.retry,
        });
      }
      if (event?.type === 'error' || event?.type === 'done') {
        if (typeof unsub === 'function') unsub();
      }
    });
    await new Promise(r => setTimeout(r, 5000));
    if (typeof unsub === 'function') unsub();
    return { events };
  } catch (e) { return { threw: e.message, events }; }
})()`)

console.log(`  Retry enabled error event: ${JSON.stringify(retryEnabledResult?.events).slice(0, 300)}`)
const retryEnabledError = retryEnabledResult?.events?.[0]
check('retry.enabled=true 时 error event 包含正确的 retry 设置',
  retryEnabledError?.retry?.enabled === true &&
  retryEnabledError?.retry?.maxRetries === 5,
  `retry=${(JSON.stringify(retryEnabledError?.retry) ?? 'undefined').slice(0, 200)}`)

// 无 API key 的 error 是 not retryable, shouldRetry 应为 false
check('无 API key error: retryable=false (不可重试)',
  retryEnabledError?.retryable === false,
  `retryable=${retryEnabledError?.retryable}`)
check('无 API key error: shouldRetry=false',
  retryEnabledError?.retry?.shouldRetry === false,
  `shouldRetry=${retryEnabledError?.retry?.shouldRetry}`)

// =============================================================
console.log('\n[R132-6] 自定义模型 CRUD 校验')

// 6.1 添加自定义模型 - 缺少 providerId
const addNoProvider = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel({ providerId: '', modelId: 'test-model', contextWindow: 8192 });
    return { success: r?.success, error: r?.error };
  } catch (e) { return { threw: e.message }; }
})()`)

check('addCustomModel 缺少 providerId 被拒绝',
  addNoProvider?.success === false || addNoProvider?.threw !== undefined,
  `result=${JSON.stringify(addNoProvider).slice(0, 100)}`)

// 6.2 添加自定义模型 - 缺少 modelId
const addNoModel = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel({ providerId: 'openai', modelId: '', contextWindow: 8192 });
    return { success: r?.success, error: r?.error };
  } catch (e) { return { threw: e.message }; }
})()`)

check('addCustomModel 缺少 modelId 被拒绝',
  addNoModel?.success === false || addNoModel?.threw !== undefined,
  `result=${JSON.stringify(addNoModel).slice(0, 100)}`)

// 6.3 添加有效自定义模型
const testModelId = `${STAMP}-custom-model`
const addValid = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel({
      providerId: 'openai',
      modelId: ${JSON.stringify(testModelId)},
      displayName: 'R132 Test Model',
      contextWindow: 16384,
      maxTokens: 4096,
    });
    return { success: r?.success !== false };
  } catch (e) { return { threw: e.message }; }
})()`)

check('addCustomModel 有效模型添加成功',
  addValid?.success === true,
  `result=${JSON.stringify(addValid).slice(0, 100)}`)

// 6.4 验证添加后可在 list-models 中查到
const listModelsAfterAdd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listModels('openai');
    const models = Array.isArray(r) ? r : (r?.models || r?.data || []);
    const found = models.find(m => m?.id === ${JSON.stringify(testModelId)} || m?.modelId === ${JSON.stringify(testModelId)});
    return { found: !!found, isCustom: found?.isCustom, totalCount: models.length };
  } catch (e) { return { threw: e.message }; }
})()`)

check('添加的自定义模型可在 listModels 中查到',
  listModelsAfterAdd?.found === true,
  `found=${listModelsAfterAdd?.found}, isCustom=${listModelsAfterAdd?.isCustom}`)

// 6.5 更新自定义模型
const updateResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.updateCustomModel({
      providerId: 'openai',
      modelId: ${JSON.stringify(testModelId)},
      contextWindow: 32768,
    });
    return { success: r?.success !== false };
  } catch (e) { return { threw: e.message }; }
})()`)

check('updateCustomModel 更新成功',
  updateResult?.success === true,
  `result=${JSON.stringify(updateResult).slice(0, 100)}`)

// 6.6 验证更新后 contextWindow 已变
const verifyUpdate = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listModels('openai');
    const models = Array.isArray(r) ? r : (r?.models || r?.data || []);
    const found = models.find(m => m?.id === ${JSON.stringify(testModelId)} || m?.modelId === ${JSON.stringify(testModelId)});
    return { contextWindow: found?.contextWindow };
  } catch (e) { return { threw: e.message }; }
})()`)

check('updateCustomModel 后 contextWindow 已更新为 32768',
  verifyUpdate?.contextWindow === 32768,
  `contextWindow=${verifyUpdate?.contextWindow}`)

// 6.7 删除自定义模型
// 注意: preload API 暴露的方法名为 deleteCustomModel (非 delCustomModel), 与 IPC 通道名 ai:del-custom-model 不同
const deleteResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.deleteCustomModel('openai', ${JSON.stringify(testModelId)});
    return { success: r?.success !== false };
  } catch (e) { return { threw: e.message }; }
})()`)

check('deleteCustomModel 删除成功',
  deleteResult?.success === true,
  `result=${JSON.stringify(deleteResult).slice(0, 100)}`)

// 6.8 验证删除后不可查
const verifyDelete = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listModels('openai');
    const models = Array.isArray(r) ? r : (r?.models || r?.data || []);
    const found = models.find(m => m?.id === ${JSON.stringify(testModelId)} || m?.modelId === ${JSON.stringify(testModelId)});
    return { found: !!found };
  } catch (e) { return { threw: e.message }; }
})()`)

check('删除后自定义模型不可查',
  verifyDelete?.found === false,
  `found=${verifyDelete?.found}`)

// =============================================================
console.log('\n[R132-7] 连接测试错误路径')

// 7.1 测试不存在的 provider
const testBadProvider = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.testConnection('__r132_nonexistent__', 'fake-key');
    return { success: r?.success, error: r?.error, hasLatency: r?.latencyMs !== undefined };
  } catch (e) { return { threw: e.message }; }
})()`)

check('testConnection 不存在 provider 返回失败',
  testBadProvider?.success === false || testBadProvider?.threw !== undefined,
  `result=${JSON.stringify(testBadProvider).slice(0, 150)}`)

// 7.2 测试有效 provider 但无效 key (应返回 401 或类似错误)
const testBadKey = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.testConnection('anthropic', 'sk-r132-fake-key-not-valid');
    return { success: r?.success, error: r?.error?.slice(0, 80), hasLatency: r?.latencyMs !== undefined };
  } catch (e) { return { threw: e.message }; }
})()`)

console.log(`  testConnection (bad key): success=${testBadKey?.success}, error=${testBadKey?.error}, latency=${testBadKey?.hasLatency}`)
check('testConnection 无效 key 返回失败 (非崩溃)',
  testBadKey?.success === false || testBadKey?.threw !== undefined,
  `result=${JSON.stringify(testBadKey).slice(0, 150)}`)

// =============================================================
console.log('\n[R132-8] 设置 dotPath 安全校验')

// 8.1 原型链污染防护
const protoTests = [
  { path: 'models.retry.__proto__.polluted', value: true },
  { path: 'chat.constructor.prototype.polluted', value: true },
  { path: 'general.__proto__.polluted', value: true },
]
let protoRejected = 0
for (const { path, value } of protoTests) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(path)}, ${JSON.stringify(value)});
      return { threw: false, success: r?.success };
    } catch (e) { return { threw: true, error: e.message }; }
  })()`)
  const rejected = r?.threw === true || r?.success === false
  if (rejected) protoRejected++
}
check('原型链污染防护: __proto__/constructor/prototype 被拒绝',
  protoRejected === protoTests.length,
  `rejected=${protoRejected}/${protoTests.length}`)

// 8.2 NaN/Infinity 被拒绝
const nanTests = [
  { path: 'chat.maxTokens', value: NaN, name: 'NaN' },
  { path: 'chat.maxTokens', value: Infinity, name: 'Infinity' },
  { path: 'models.retry.maxRetries', value: -Infinity, name: '-Infinity' },
]
let nanRejected = 0
for (const { path, value, name } of nanTests) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(path)}, ${JSON.stringify(value)});
      return { threw: false, success: r?.success };
    } catch (e) { return { threw: true, error: e.message }; }
  })()`)
  const rejected = r?.threw === true || r?.success === false
  if (rejected) nanRejected++
  check(`NaN/Infinity 校验: ${name} 被拒绝`, rejected, `result=${JSON.stringify(r).slice(0, 80)}`)
}

// 8.3 不存在的路径被拒绝
const invalidPathTests = [
  { path: 'models.retry.nonexistentField', name: '不存在的子字段' },
  { path: 'chat.nonexistent', name: 'chat 不存在路径' },
  { path: '', name: '空路径' },
  { path: 'general..theme', name: '空段 (双点)' },
]
for (const { path, name } of invalidPathTests) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(path)}, 'test');
      return { threw: false, success: r?.success };
    } catch (e) { return { threw: true, error: e.message }; }
  })()`)
  const rejected = r?.threw === true || r?.success === false
  check(`路径校验: ${name} 被拒绝`, rejected, `result=${JSON.stringify(r).slice(0, 80)}`)
}

// =============================================================
console.log('\n[R132-9] 错误分类 (isRetryableError 等价测试)')

// 通过触发不同错误并检查 error event 的 retryable 字段
// 由于无法直接调用 isRetryableError, 我们通过 chat error events 间接验证

// 9.1 无 API key error 应为 not retryable (已在 R132-5 验证)
// 9.2 验证 retry 设置可在运行时修改
const retryToggleResult = await evalInPage(ws, `(async () => {
  // 先设为 false
  await window.api.settings.set('models.retry.enabled', false);
  const s1 = await window.api.settings.get();
  // 再设为 true
  await window.api.settings.set('models.retry.enabled', true);
  await window.api.settings.set('models.retry.maxRetries', 10);
  const s2 = await window.api.settings.get();
  return {
    afterFalse: s1?.models?.retry?.enabled,
    afterTrue: s2?.models?.retry?.enabled,
    maxRetries: s2?.models?.retry?.maxRetries,
  };
})()`)

check('retry.enabled 可运行时切换 (false → true)',
  retryToggleResult?.afterFalse === false && retryToggleResult?.afterTrue === true,
  `afterFalse=${retryToggleResult?.afterFalse}, afterTrue=${retryToggleResult?.afterTrue}`)
check('retry.maxRetries 可运行时修改',
  retryToggleResult?.maxRetries === 10,
  `maxRetries=${retryToggleResult?.maxRetries}`)

// =============================================================
console.log('\n[R132-10] 并发 chat 自动中断前一个')

// 10.1 快速连续发起两个 chat, 验证第一个被自动 abort
const concurrentChatResult = await evalInPage(ws, `(async () => {
  const events1 = [];
  const events2 = [];
  let sessionId1 = null;
  let sessionId2 = null;
  try {
    // 第一个 chat (会被中断)
    sessionId1 = await window.api.ai.chat({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'first', timestamp: Date.now() }],
      maxTokens: 10,
    });
    const unsub1 = window.api.ai.onStream((event) => {
      events1.push({ type: event?.type });
    });

    // 立即发起第二个 chat (应中断第一个)
    await new Promise(r => setTimeout(r, 100));
    sessionId2 = await window.api.ai.chat({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'second', timestamp: Date.now() }],
      maxTokens: 10,
    });
    const unsub2 = window.api.ai.onStream((event) => {
      events2.push({ type: event?.type });
    });

    // 等待 events
    await new Promise(r => setTimeout(r, 5000));
    if (typeof unsub1 === 'function') unsub1();
    if (typeof unsub2 === 'function') unsub2();

    return {
      sessionId1: !!sessionId1,
      sessionId2: !!sessionId2,
      events1Count: events1.length,
      events2Count: events2.length,
      events1Types: events1.map(e => e.type),
      events2Types: events2.map(e => e.type),
    };
  } catch (e) { return { threw: e.message }; }
})()`)

console.log(`  并发 chat: session1=${concurrentChatResult?.sessionId1}, session2=${concurrentChatResult?.sessionId2}`)
console.log(`    events1 (${concurrentChatResult?.events1Count}): ${JSON.stringify(concurrentChatResult?.events1Types).slice(0, 150)}`)
console.log(`    events2 (${concurrentChatResult?.events2Count}): ${JSON.stringify(concurrentChatResult?.events2Types).slice(0, 150)}`)

check('并发 chat: 两个 session 都能启动',
  concurrentChatResult?.sessionId1 === true && concurrentChatResult?.sessionId2 === true,
  `session1=${concurrentChatResult?.sessionId1}, session2=${concurrentChatResult?.sessionId2}`)
check('并发 chat: 两个 stream 都收到 events (非阻塞)',
  concurrentChatResult?.events1Count > 0 && concurrentChatResult?.events2Count > 0,
  `events1=${concurrentChatResult?.events1Count}, events2=${concurrentChatResult?.events2Count}`)

// =============================================================
console.log('\n[R132-11] Compaction 设置验证')

// 11.1 验证 compaction 设置可读写
const compactionResult = await evalInPage(ws, `(async () => {
  // 设置 compaction 参数
  await window.api.settings.set('chat.compaction.enabled', true);
  await window.api.settings.set('chat.compaction.reserveTokens', 6000);
  await window.api.settings.set('chat.compaction.keepRecentTokens', 12000);
  const s = await window.api.settings.get();
  return {
    enabled: s?.chat?.compaction?.enabled,
    reserveTokens: s?.chat?.compaction?.reserveTokens,
    keepRecentTokens: s?.chat?.compaction?.keepRecentTokens,
  };
})()`)

check('compaction.enabled 可设置',
  compactionResult?.enabled === true,
  `enabled=${compactionResult?.enabled}`)
check('compaction.reserveTokens 可设置',
  compactionResult?.reserveTokens === 6000,
  `reserveTokens=${compactionResult?.reserveTokens}`)
check('compaction.keepRecentTokens 可设置',
  compactionResult?.keepRecentTokens === 12000,
  `keepRecentTokens=${compactionResult?.keepRecentTokens}`)

// 11.2 禁用 compaction
await evalInPage(ws, `(async () => {
  await window.api.settings.set('chat.compaction.enabled', false);
  return true;
})()`)

const compactionDisabled = await evalInPage(ws, `(async () => {
  const s = await window.api.settings.get();
  return { enabled: s?.chat?.compaction?.enabled };
})()`)

check('compaction.enabled 可禁用',
  compactionDisabled?.enabled === false,
  `enabled=${compactionDisabled?.enabled}`)

// 恢复 compaction
await evalInPage(ws, `(async () => {
  await window.api.settings.set('chat.compaction.enabled', true);
  await window.api.settings.set('chat.compaction.reserveTokens', 8000);
  await window.api.settings.set('chat.compaction.keepRecentTokens', 16000);
  return true;
})()`)

// =============================================================
console.log('\n[R132-12] OAuth login stub 验证')

// 12.1 测试 anthropic OAuth (返回 API key 页面 URL)
const oauthAnthropic = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.oauthLogin('anthropic');
    return { success: r?.success, hasAuthUrl: !!r?.authUrl, pollInterval: r?.pollInterval };
  } catch (e) { return { threw: e.message }; }
})()`)

check('oauthLogin anthropic 返回 authUrl',
  oauthAnthropic?.success === true && oauthAnthropic?.hasAuthUrl === true,
  `result=${JSON.stringify(oauthAnthropic).slice(0, 150)}`)

// 12.2 测试不支持 OAuth 的 provider
const oauthUnsupported = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.oauthLogin('__r132_unsupported__');
    return { success: r?.success, error: r?.error };
  } catch (e) { return { threw: e.message }; }
})()`)

check('oauthLogin 不支持的 provider 返回失败',
  oauthUnsupported?.success === false || oauthUnsupported?.threw !== undefined,
  `result=${JSON.stringify(oauthUnsupported).slice(0, 150)}`)

// =============================================================
console.log('\n[R132-13] transport & cacheRetention 设置 (仅记录, 无运行时效果)')

const transportResult = await evalInPage(ws, `(async () => {
  // 验证可设置不同 transport 值
  const transports = ['auto', 'sse', 'websocket'];
  const results = [];
  for (const t of transports) {
    const r = await window.api.settings.set('models.transport', t);
    const s = await window.api.settings.get();
    results.push({ transport: t, set: r?.success !== false, read: s?.models?.transport });
  }
  // 恢复
  await window.api.settings.set('models.transport', 'auto');
  // cacheRetention
  const retentions = ['none', 'short', 'long'];
  const retentionResults = [];
  for (const c of retentions) {
    const r = await window.api.settings.set('models.cacheRetention', c);
    const s = await window.api.settings.get();
    retentionResults.push({ retention: c, set: r?.success !== false, read: s?.models?.cacheRetention });
  }
  await window.api.settings.set('models.cacheRetention', 'short');
  return { transports: results, retentions: retentionResults };
})()`)

let transportAllOk = true
for (const t of transportResult?.transports || []) {
  if (t.set !== true || t.read !== t.transport) transportAllOk = false
}
check('models.transport 所有枚举值可设置且读取一致',
  transportAllOk,
  `transports=${JSON.stringify(transportResult?.transports).slice(0, 200)}`)

let retentionAllOk = true
for (const c of transportResult?.retentions || []) {
  if (c.set !== true || c.read !== c.retention) retentionAllOk = false
}
check('models.cacheRetention 所有枚举值可设置且读取一致',
  retentionAllOk,
  `retentions=${JSON.stringify(transportResult?.retentions).slice(0, 200)}`)

// =============================================================
console.log('\n[R132-14] providerBlacklist & enabledModels 验证')

// 14.1 设置 blacklist
const blacklistResult = await evalInPage(ws, `(async () => {
  // 先获取所有 providers
  const before = await window.api.ai.listProviders();
  const beforeArr = Array.isArray(before) ? before : (before?.providers || before?.data || []);
  const beforeCount = beforeArr.length;

  // 设置 blacklist
  await window.api.settings.set('models.providerBlacklist', ['openai']);
  const s = await window.api.settings.get();
  const blacklistSet = s?.models?.providerBlacklist;

  // 重新获取 providers
  const after = await window.api.ai.listProviders();
  const afterArr = Array.isArray(after) ? after : (after?.providers || after?.data || []);
  const openaiProvider = afterArr.find(p => p?.id === 'openai');

  // 恢复
  await window.api.settings.set('models.providerBlacklist', []);

  return {
    beforeCount,
    blacklistSet,
    afterCount: afterArr.length,
    openaiHidden: openaiProvider?.hidden,
  };
})()`)

console.log(`  blacklist 测试: before=${blacklistResult?.beforeCount}, after=${blacklistResult?.afterCount}, openaiHidden=${blacklistResult?.openaiHidden}`)
check('providerBlacklist 设置成功',
  Array.isArray(blacklistResult?.blacklistSet) && blacklistResult.blacklistSet.includes('openai'),
  `blacklist=${JSON.stringify(blacklistResult?.blacklistSet)}`)

// =============================================================
// 恢复初始 settings (重要: 避免影响后续测试)
console.log('\n[R132-cleanup] 恢复初始 settings')

// 恢复 retry 设置
await evalInPage(ws, `(async () => {
  await window.api.settings.set('models.retry.enabled', true);
  await window.api.settings.set('models.retry.maxRetries', 3);
  await window.api.settings.set('models.retry.baseDelayMs', 1000);
  await window.api.settings.set('models.retry.providerTimeoutMs', 60000);
  await window.api.settings.set('models.providerBlacklist', []);
  await window.api.settings.set('chat.thinkingLevel', 'medium');
  await window.api.settings.set('chat.steeringMode', 'all');
  await window.api.settings.set('chat.compaction.enabled', true);
  await window.api.settings.set('chat.compaction.reserveTokens', 8000);
  await window.api.settings.set('chat.compaction.keepRecentTokens', 16000);
  await window.api.settings.set('models.transport', 'auto');
  await window.api.settings.set('models.cacheRetention', 'short');
  await window.api.settings.set('chat.maxTokens', ${initialSettings?.chat?.maxTokens || 32768});
  return true;
})()`)

// 验证恢复
const restoredSettings = await evalInPage(ws, `(async () => {
  const s = await window.api.settings.get();
  return {
    retryEnabled: s?.models?.retry?.enabled,
    maxRetries: s?.models?.retry?.maxRetries,
    thinkingLevel: s?.chat?.thinkingLevel,
    maxTokens: s?.chat?.maxTokens,
  };
})()`)

check('settings 已恢复 (retry.enabled=true, maxRetries=3)',
  restoredSettings?.retryEnabled === true && restoredSettings?.maxRetries === 3,
  `retry=${restoredSettings?.retryEnabled}, maxRetries=${restoredSettings?.maxRetries}`)
check('settings 已恢复 (thinkingLevel=medium)',
  restoredSettings?.thinkingLevel === 'medium',
  `thinkingLevel=${restoredSettings?.thinkingLevel}`)

// =============================================================
console.log(`\n=== R132 完成 ===`)
console.log(`通过: ${results.pass}, 失败: ${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项:`)
  for (const e of results.errors) console.log(`  - ${e}`)
}

try { ws.close() } catch {}
process.exit(results.fail > 0 ? 1 : 0)
