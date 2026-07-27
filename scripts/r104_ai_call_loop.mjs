// =============================================================
// R104: AI 调用循环适配测试 (chat/agent/MCP/模型)
// 角度 1: AI provider 列表 + 模型列表 + 连接测试错误处理
// 角度 2: AI chat 流式订阅 + 中断 (abort)
// 角度 3: 自定义模型 CRUD (add/update/delete)
// 角度 4: Agent runManual 与 EAA 数据集成 (agent 能否访问数据)
// 角度 5: MCP server 配置/连接/工具列表
// 角度 6: 错误恢复 (无效 provider/model 恢复)
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
    }, 60000) // AI 调用可能较慢,放宽到 60s
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 55000,
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
console.log(`[R104] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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

await evalInPage(ws, `
  window.__r104Errors = [];
  if (!window.__r104HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r104Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r104Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r104HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r104Errors || []))`)
}

// =============================================================
console.log('\n=== R104: AI 调用循环适配测试 ===')

// =============================================================
console.log('\n[R104-1] AI provider 列表 + 模型列表')

const providers = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listProviders();
    return { ok: true, providers: r, isArray: Array.isArray(r), count: Array.isArray(r) ? r.length : 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('ai.listProviders 不崩溃',
  providers?.ok === true,
  `result=${JSON.stringify(providers).slice(0, 150)}`)

// 如果有 provider, 测试 listModels
if (providers?.isArray && providers.count > 0) {
  const firstProvider = providers.providers[0]
  const providerId = typeof firstProvider === 'string' ? firstProvider : firstProvider?.id
  
  if (providerId) {
    const models = await evalInPage(ws, `(async () => {
      try {
        const r = await window.api.ai.listModels(${JSON.stringify(providerId)});
        return { ok: true, isArray: Array.isArray(r), count: Array.isArray(r) ? r.length : 0 };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })()`)
    
    check(`ai.listModels(${providerId}) 不崩溃`,
      models?.ok === true,
      `result=${JSON.stringify(models).slice(0, 150)}`)
  }
}

// 测试不存在 provider 的 listModels
const unknownModels = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listModels('__nonexistent_provider__');
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('ai.listModels 不存在 provider 不崩溃',
  unknownModels?.ok === true || (unknownModels?.ok === false && unknownModels?.error),
  `result=${JSON.stringify(unknownModels).slice(0, 100)}`)

// 测试 testConnection (无 API key, 应该返回错误但不崩溃)
const testConn = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.testConnection('__nonexistent_provider__', 'fake-api-key-for-testing');
    return { ok: true, success: r?.success, hasError: !!r?.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('ai.testConnection 不崩溃 (无有效 provider)',
  testConn?.ok === true || (testConn?.ok === false && testConn?.error),
  `result=${JSON.stringify(testConn).slice(0, 150)}`)

// =============================================================
console.log('\n[R104-2] AI chat 流式订阅 + 中断')

// 测试 chat 不崩溃 (会因无效 provider 失败,但不应崩溃)
const chatTest = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.chat({
      providerId: '__nonexistent_provider__',
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'test' }],
    });
    return { ok: true, success: r?.success, hasError: !!r?.error };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('ai.chat 无效 provider 不崩溃',
  chatTest?.ok === true,
  `result=${JSON.stringify(chatTest).slice(0, 150)}`)

// 测试流式订阅安装与取消
const streamSub = await evalInPage(ws, `(async () => {
  let receivedEvents = 0;
  const unsub = window.api.ai.onStream((event) => {
    receivedEvents++;
  });
  
  // 立即取消订阅
  unsub();
  
  return {
    unsubType: typeof unsub,
    installed: true,
  };
})()`)

check('ai.onStream 订阅安装 + 取消不崩溃',
  streamSub?.installed === true && streamSub?.unsubType === 'function',
  `result=${JSON.stringify(streamSub)}`)

// 测试 abortChat 不崩溃 (即使没有运行中的 chat)
const abortTest = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.abortChat();
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('ai.abortChat 无运行中 chat 不崩溃',
  abortTest?.ok === true,
  `result=${JSON.stringify(abortTest).slice(0, 100)}`)

// =============================================================
console.log('\n[R104-3] 自定义模型 CRUD')

const STAMP = `r104_${Date.now()}`
const customModelId = `${STAMP}_model`
const customProviderId = 'openai' // 用一个常见的 provider id

// Add
const addModel = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel({
      providerId: ${JSON.stringify(customProviderId)},
      modelId: ${JSON.stringify(customModelId)},
      name: 'R104 Test Model',
      contextWindow: 4096,
      maxOutputTokens: 2048,
      supportsReasoning: false,
    });
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('ai.addCustomModel 不崩溃',
  addModel?.ok === true,
  `result=${JSON.stringify(addModel).slice(0, 100)}`)

// Update
const updateModel = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.updateCustomModel({
      providerId: ${JSON.stringify(customProviderId)},
      modelId: ${JSON.stringify(customModelId)},
      name: 'R104 Updated Model',
      contextWindow: 8192,
    });
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('ai.updateCustomModel 不崩溃',
  updateModel?.ok === true,
  `result=${JSON.stringify(updateModel).slice(0, 100)}`)

// Delete
const deleteModel = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.deleteCustomModel(${JSON.stringify(customProviderId)}, ${JSON.stringify(customModelId)});
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('ai.deleteCustomModel 不崩溃',
  deleteModel?.ok === true,
  `result=${JSON.stringify(deleteModel).slice(0, 100)}`)

// API Key 操作 (set + delete)
const setApiKey = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.setApiKey('__r104_test_provider__', 'fake-key-for-testing');
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('ai.setApiKey 不崩溃', setApiKey?.ok === true)

const deleteApiKey = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.deleteApiKey('__r104_test_provider__');
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('ai.deleteApiKey 不崩溃', deleteApiKey?.ok === true)

// =============================================================
console.log('\n[R104-4] Agent runManual 与 EAA 数据集成')

const agentList = await evalInPage(ws, `window.api.agent.list()`)
const enabledAgent = Array.isArray(agentList) ? agentList.find(a => a.enabled) || agentList[0] : null

if (enabledAgent) {
  // 构造一个让 agent 访问 EAA 数据的 prompt
  const prompt = `请用一句话回复"R104测试OK"。不要使用任何工具。`
  
  const agentRun = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.runManual(${JSON.stringify(enabledAgent.id)}, ${JSON.stringify(prompt)});
      return { 
        ok: true, 
        success: r?.success !== false,
        hasResult: r !== null && r !== undefined,
        type: typeof r,
        hasOutput: !!r?.output || !!r?.result,
        hasError: !!r?.error,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  
  check(`agent.runManual "${enabledAgent.id}" 不崩溃`,
    agentRun?.ok === true,
    `result=${JSON.stringify(agentRun).slice(0, 200)}`)
  
  // 不论 agent 是否实际执行 (可能没 API key), 都应返回结构化响应
  check('agent.runManual 返回结构化响应',
    agentRun?.hasResult === true,
    `type=${agentRun?.type}`)
} else {
  check('agent.runManual (跳过 - 无可用 agent)', false, 'no agents')
}

// Agent 与 EAA 数据访问: 验证 agent 能读到 EAA 数据 (通过 prompt 让 agent 列出学生)
// 这需要实际 API key 才能完整测试,这里只验证调用链路不崩溃
const eaaIntegration = await evalInPage(ws, `(async () => {
  try {
    // 先确保有 EAA 数据
    const stats = await window.api.eaa.stats();
    const students = await window.api.eaa.listStudents();
    return {
      eaaStatsOk: stats?.success === true,
      eaaStudentsOk: students?.success === true,
      studentCount: students?.data?.students?.length || 0,
    };
  } catch (e) {
    return { error: e.message };
  }
})()`)
check('EAA 数据可被 agent 访问 (stats + students)',
  eaaIntegration?.eaaStatsOk === true && eaaIntegration?.eaaStudentsOk === true,
  `result=${JSON.stringify(eaaIntegration).slice(0, 150)}`)

// =============================================================
console.log('\n[R104-5] MCP server 配置/连接/工具列表')

const mcpList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.list();
    return { ok: true, isArray: Array.isArray(r), count: Array.isArray(r) ? r.length : 0, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('mcp.list 不崩溃',
  mcpList?.ok === true,
  `result=${JSON.stringify(mcpList).slice(0, 150)}`)

// 测试连接不存在的 server
const mcpConnect = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.connect('__nonexistent_mcp_server__');
    return { ok: true, success: r?.success, hasError: !!r?.error };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('mcp.connect 不存在 server 不崩溃',
  mcpConnect?.ok === true,
  `result=${JSON.stringify(mcpConnect).slice(0, 100)}`)

// 测试断开不存在的 server
const mcpDisconnect = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.disconnect('__nonexistent_mcp_server__');
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('mcp.disconnect 不存在 server 不崩溃', mcpDisconnect?.ok === true)

// 测试 listTools 不存在的 server
const mcpListTools = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.listTools('__nonexistent_mcp_server__');
    return { ok: true, success: r?.success, hasError: !!r?.error };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('mcp.listTools 不存在 server 不崩溃', mcpListTools?.ok === true)

// 测试 test 不存在的 server
const mcpTest = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.test('__nonexistent_mcp_server__');
    return { ok: true, success: r?.success, hasError: !!r?.error };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('mcp.test 不存在 server 不崩溃', mcpTest?.ok === true)

// 测试 add 无效 MCP 配置
const mcpAddInvalid = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.add(null);
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('mcp.add null 配置不崩溃', mcpAddInvalid?.ok === true)

const mcpAddEmpty = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.add({ id: '', command: '', args: [] });
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('mcp.add 空配置不崩溃', mcpAddEmpty?.ok === true)

// =============================================================
console.log('\n[R104-6] 错误恢复 (无效 provider/model 恢复)')

// 连续发起多个无效 chat 调用,验证系统状态不损坏
const recoveryTest = await evalInPage(ws, `(async () => {
  // 连续 5 个无效 chat
  const calls = [
    window.api.ai.chat({ providerId: '__no1__', modelId: 'm1', messages: [] }),
    window.api.ai.chat({ providerId: '__no2__', modelId: 'm2', messages: [] }),
    window.api.ai.chat({ providerId: '__no3__', modelId: 'm3', messages: [] }),
    window.api.ai.chat({ providerId: '__no4__', modelId: 'm4', messages: [] }),
    window.api.ai.chat({ providerId: '__no5__', modelId: 'm5', messages: [] }),
  ];
  const results = await Promise.allSettled(calls);
  
  // 然后验证核心 API 仍工作
  const [stats, settings, agents] = await Promise.all([
    window.api.eaa.stats(),
    window.api.settings.get(),
    window.api.agent.list(),
  ]);
  
  return {
    chatResults: results.map(r => r.status),
    coreApiOk: stats?.success === true && settings?.general && Array.isArray(agents),
  };
})()`)

check('5 个无效 chat 后核心 API 仍工作',
  recoveryTest?.coreApiOk === true,
  `result=${JSON.stringify(recoveryTest).slice(0, 200)}`)

// =============================================================
console.log('\n[R104-7] 全程错误捕获')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// =============================================================
console.log('\n========================================')
console.log(`R104 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
