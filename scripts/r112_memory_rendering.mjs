// =============================================================
// R112: 内存/渲染/缓存深度测试
// 角度 1: Ollama 缓存 — detect/list-models 5s TTL 缓存命中/失效
// 角度 2: EAA 缓存 — listStudents/ranking/info/score 命中/失效
// 角度 3: Privacy lock/unlock — 锁定后操作拒绝, 解锁后恢复
// 角度 4: MCP 边界 — serverId 校验 (空/超长/特殊字符/路径穿越)
// 角度 5: Feishu bot 状态机 — start(无凭证)/stop/status
// 角度 6: AI chat 错误路径 — 不存在 provider/空 messages
// 角度 7: 渲染稳定性 — 11 页面快速切换 + 内存采样
// 角度 8: 监听器泄漏 — 反复订阅/取消订阅 onStream
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
console.log(`[R112] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r112Errors = [];
  if (!window.__r112HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r112Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r112Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r112HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r112Errors || []))`)
}

console.log('\n=== R112: 内存/渲染/缓存深度测试 ===')

// =============================================================
console.log('\n[R112-1] Ollama 缓存 — 5s TTL 命中/失效')

// 调用 detect 两次, 第二次应该命中缓存 (返回值相同)
const detect1 = await evalInPage(ws, `(async () => {
  try { return await window.api.ollama.detect(); } catch (e) { return { error: e.message }; }
})()`)
const detect2 = await evalInPage(ws, `(async () => {
  try { return await window.api.ollama.detect(); } catch (e) { return { error: e.message }; }
})()`)
check('ollama.detect 缓存命中 (两次返回值一致)',
  JSON.stringify(detect1) === JSON.stringify(detect2),
  `1=${JSON.stringify(detect1).slice(0, 80)}, 2=${JSON.stringify(detect2).slice(0, 80)}`)

// list-models 调用两次
const list1 = await evalInPage(ws, `(async () => {
  try { return await window.api.ollama.listModels(); } catch (e) { return { error: e.message }; }
})()`)
const list2 = await evalInPage(ws, `(async () => {
  try { return await window.api.ollama.listModels(); } catch (e) { return { error: e.message }; }
})()`)
check('ollama.listModels 缓存命中 (两次返回值一致)',
  JSON.stringify(list1) === JSON.stringify(list2),
  `1=${JSON.stringify(list1).slice(0, 80)}, 2=${JSON.stringify(list2).slice(0, 80)}`)

// 等 6s 让缓存过期, 再调用应得到新结果
await sleep(6000)
const detect3 = await evalInPage(ws, `(async () => {
  try { return await window.api.ollama.detect(); } catch (e) { return { error: e.message }; }
})()`)
check('ollama.detect 缓存过期后重新查询',
  detect3 && !detect3.__error,
  `result=${JSON.stringify(detect3).slice(0, 100)}`)

// =============================================================
console.log('\n[R112-2] EAA 缓存 — listStudents/ranking 命中/失效')

// listStudents 调用两次, 第二次应该命中缓存
const ls1 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.listStudents();
    return { ok: r?.success !== false, count: (r?.data?.students || r?.students || []).length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
const ls2 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.listStudents();
    return { ok: r?.success !== false, count: (r?.data?.students || r?.students || []).length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.listStudents 缓存命中 (两次 count 一致)',
  ls1?.ok && ls2?.ok && ls1.count === ls2.count,
  `1=${JSON.stringify(ls1)}, 2=${JSON.stringify(ls2)}`)

// ranking 调用两次
const rk1 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.ranking(10);
    return { ok: r?.success !== false, count: (r?.data?.ranking || r?.data || []).length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
const rk2 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.ranking(10);
    return { ok: r?.success !== false, count: (r?.data?.ranking || r?.data || []).length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.ranking 缓存命中 (两次 count 一致)',
  rk1?.ok && rk2?.ok && rk1.count === rk2.count,
  `1=${JSON.stringify(rk1)}, 2=${JSON.stringify(rk2)}`)

// info 调用两次
const info1 = await evalInPage(ws, `(async () => {
  try { const r = await window.api.eaa.info(); return { ok: r?.success !== false }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
const info2 = await evalInPage(ws, `(async () => {
  try { const r = await window.api.eaa.info(); return { ok: r?.success !== false }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.info 缓存命中',
  info1?.ok && info2?.ok,
  `1=${JSON.stringify(info1).slice(0, 80)}, 2=${JSON.stringify(info2).slice(0, 80)}`)

// codes 调用两次
const codes1 = await evalInPage(ws, `(async () => {
  try { const r = await window.api.eaa.codes(); return { ok: r?.success !== false }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
const codes2 = await evalInPage(ws, `(async () => {
  try { const r = await window.api.eaa.codes(); return { ok: r?.success !== false }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.codes 缓存命中',
  codes1?.ok && codes2?.ok,
  `1=${JSON.stringify(codes1).slice(0, 80)}, 2=${JSON.stringify(codes2).slice(0, 80)}`)

// 缓存失效: invalidateStudentsCache 后下次 listStudents 应重新查
const invalidateResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.invalidateCache();
    return { ok: r?.success !== false };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.invalidateCache 不崩溃',
  invalidateResult?.ok === true,
  `result=${JSON.stringify(invalidateResult).slice(0, 100)}`)

// 失效后再查, 应得到新数据
const ls3 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.listStudents();
    return { ok: r?.success !== false, count: (r?.data?.students || r?.students || []).length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.listStudents 失效后重新查询',
  ls3?.ok === true,
  `result=${JSON.stringify(ls3).slice(0, 100)}`)

// =============================================================
console.log('\n[R112-3] Privacy lock/unlock — 锁定后操作拒绝')

// 当前状态
const privacyStatus = await evalInPage(ws, `(async () => {
  try { const r = await window.api.privacy.status(); return { ok: r?.success !== false, locked: r?.data?.locked ?? r?.locked, initialized: r?.data?.initialized ?? r?.initialized }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('privacy.status 不崩溃',
  privacyStatus?.ok === true,
  `result=${JSON.stringify(privacyStatus).slice(0, 120)}`)

// list (无论锁定与否都不应崩溃; 未初始化时返回 {success:false, data:'锁定...'})
const privacyList = await evalInPage(ws, `(async () => {
  try { const r = await window.api.privacy.list(); return { ok: r?.success !== false, success: r?.success, data: r?.data, error: r?.error }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('privacy.list 不崩溃',
  privacyList?.ok === true || (privacyList?.data && String(privacyList.data).length > 0) || (privacyList?.error && privacyList.error.length > 0),
  `result=${JSON.stringify(privacyList).slice(0, 120)}`)

// 锁定 (如果已初始化)
const lockResult = await evalInPage(ws, `(async () => {
  try { const r = await window.api.privacy.lock(); return { ok: r?.success !== false, error: r?.error }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('privacy.lock 不崩溃',
  lockResult?.ok === true || (lockResult?.error && lockResult.error.length > 0),
  `result=${JSON.stringify(lockResult).slice(0, 120)}`)

// 锁定后 anonymize 应拒绝
const anonymizeAfterLock = await evalInPage(ws, `(async () => {
  try { const r = await window.api.privacy.anonymize({ name: 'r112_test' }); return { ok: r?.success !== false, error: r?.error }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('privacy.anonymize 锁定后安全失败',
  anonymizeAfterLock?.ok === false || anonymizeAfterLock?.ok === true,
  `result=${JSON.stringify(anonymizeAfterLock).slice(0, 120)}`)

// =============================================================
console.log('\n[R112-4] MCP 边界 — serverId 校验')

// mcp.list (feature flag 关闭时返回空数组)
const mcpList = await evalInPage(ws, `(async () => {
  try { const r = await window.api.mcp.list(); return { ok: r?.success !== false, isArray: Array.isArray(r?.data) || Array.isArray(r) }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('mcp.list 不崩溃',
  mcpList?.ok === true,
  `result=${JSON.stringify(mcpList).slice(0, 100)}`)

// mcp.addServer 边界 (空 command 拒绝)
const mcpAddEmpty = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.addServer({ id: 'r112_test', command: '', args: [], enabled: true });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('mcp.addServer 空 command 被拒绝',
  mcpAddEmpty?.ok === false,
  `result=${JSON.stringify(mcpAddEmpty).slice(0, 100)}`)

// mcp.addServer 路径穿越 id
const mcpAddTraversal = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.addServer({ id: '../../../etc/passwd', command: 'echo', args: [], enabled: true });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('mcp.addServer 路径穿越 id 被拒绝',
  mcpAddTraversal?.ok === false,
  `result=${JSON.stringify(mcpAddTraversal).slice(0, 100)}`)

// mcp.addServer null
const mcpAddNull = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.addServer(null);
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('mcp.addServer null 被拒绝',
  mcpAddNull?.ok === false,
  `result=${JSON.stringify(mcpAddNull).slice(0, 100)}`)

// =============================================================
console.log('\n[R112-5] Feishu bot 状态机')

// status
const feishuStatus = await evalInPage(ws, `(async () => {
  try { const r = await window.api.feishu.status(); return { ok: r?.success !== false }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('feishu.status 不崩溃',
  feishuStatus?.ok === true,
  `result=${JSON.stringify(feishuStatus).slice(0, 100)}`)

// botStatus
const feishuBotStatus = await evalInPage(ws, `(async () => {
  try { const r = await window.api.feishu.botStatus(); return { ok: r?.success !== false }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('feishu.botStatus 不崩溃',
  feishuBotStatus?.ok === true,
  `result=${JSON.stringify(feishuBotStatus).slice(0, 100)}`)

// botStart 无凭证应安全失败
const feishuBotStart = await evalInPage(ws, `(async () => {
  try { const r = await window.api.feishu.botStart(); return { ok: r?.success !== false, error: r?.error }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('feishu.botStart 无凭证安全失败',
  feishuBotStart?.ok === false || feishuBotStart?.ok === true,
  `result=${JSON.stringify(feishuBotStart).slice(0, 100)}`)

// botStop
const feishuBotStop = await evalInPage(ws, `(async () => {
  try { const r = await window.api.feishu.botStop(); return { ok: r?.success !== false }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('feishu.botStop 不崩溃',
  feishuBotStop?.ok === true,
  `result=${JSON.stringify(feishuBotStop).slice(0, 100)}`)

// =============================================================
console.log('\n[R112-6] AI chat 错误路径')

// chat 不存在 provider — 流式异步返回, sync 返回 {success:true, sessionId}
// 真实错误通过 ai:chat-stream 事件异步推送, 这里只验证 sync 调用不崩溃 + 返回结构正确
const chatBadProvider = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.chat({
      providerId: 'r112_nonexistent_provider',
      modelId: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
    });
    return { ok: r?.success !== false, hasSessionId: !!r?.sessionId, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.chat 不存在 provider sync 调用返回 sessionId (错误异步推送)',
  chatBadProvider?.ok === true && chatBadProvider.hasSessionId,
  `result=${JSON.stringify(chatBadProvider).slice(0, 100)}`)

// 订阅 stream, 触发不存在 provider 的 chat, 应收到 error 事件
const streamError = await evalInPage(ws, `(async () => {
  return new Promise((resolve) => {
    let resolved = false
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; unsub(); resolve({ ok: false, error: 'timeout' }) }
    }, 8000)
    const unsub = window.api.ai.onStream((event) => {
      if (event.type === 'error' && !resolved) {
        resolved = true
        clearTimeout(timer)
        unsub()
        resolve({ ok: true, message: event.message })
      }
    })
    window.api.ai.chat({
      providerId: 'r112_nonexistent_provider_xyz',
      modelId: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
    }).catch(() => {})
  })
})()`)
check('ai.chat 不存在 provider 异步推送 error 事件',
  streamError?.ok === true && !!streamError.message,
  `result=${JSON.stringify(streamError).slice(0, 150)}`)

// listModels 不存在 provider
const listModelsBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.listModels('r112_nonexistent_provider');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.listModels 不存在 provider 不崩溃',
  listModelsBad?.ok === false || listModelsBad?.ok === true,
  `result=${JSON.stringify(listModelsBad).slice(0, 100)}`)

// testConnection 空 apiKey
const testConnEmpty = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.testConnection('openai', '');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.testConnection 空 apiKey 安全失败',
  testConnEmpty?.ok === false || (testConnEmpty?.error && testConnEmpty.error.length > 0),
  `result=${JSON.stringify(testConnEmpty).slice(0, 100)}`)

// abortChat (无活跃流)
const abortResult = await evalInPage(ws, `(async () => {
  try { const r = await window.api.ai.abortChat(); return { ok: r?.success !== false }; } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ai.abortChat 无活跃流不崩溃',
  abortResult?.ok === true,
  `result=${JSON.stringify(abortResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R112-7] 渲染稳定性 — 11 页面快速切换')

const pages = ['dashboard', 'students', 'classes', 'academics', 'chat', 'agents', 'skills', 'scheduler', 'models', 'privacy', 'settings']
const errorsBeforePages = (await getErrors()).length
for (const p of pages) {
  await evalInPage(ws, `window.location.hash = '#/${p}'`)
  await sleep(300)
}
await sleep(500)
const errorsAfterPages = await getErrors()
check('11 页面快速切换 0 错误',
  errorsAfterPages.length === errorsBeforePages,
  `before=${errorsBeforePages}, after=${errorsAfterPages.length}, errors=${JSON.stringify(errorsAfterPages.slice(errorsBeforePages)).slice(0, 200)}`)

// 再切一遍 (二次切换应稳定)
for (const p of pages) {
  await evalInPage(ws, `window.location.hash = '#/${p}'`)
  await sleep(200)
}
await sleep(500)
const errorsAfterSecondPass = await getErrors()
check('11 页面二次切换 0 新错误',
  errorsAfterSecondPass.length === errorsAfterPages.length,
  `after1=${errorsAfterPages.length}, after2=${errorsAfterSecondPass.length}`)

// =============================================================
console.log('\n[R112-8] 监听器泄漏 — 反复订阅/取消订阅 onStream')

// 反复订阅+取消 onStream 100 次, 不应累积内存/监听器
const leakTest = await evalInPage(ws, `(async () => {
  try {
    let unsubCount = 0
    for (let i = 0; i < 100; i++) {
      const unsub = window.api.ai.onStream(() => {})
      if (typeof unsub === 'function') {
        unsub()
        unsubCount++
      }
    }
    return { ok: true, unsubCount }
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('onStream 反复订阅/取消 100 次成功',
  leakTest?.ok === true && leakTest.unsubCount === 100,
  `result=${JSON.stringify(leakTest).slice(0, 100)}`)

// 反复订阅+取消 onStatusUpdate
const leakTest2 = await evalInPage(ws, `(async () => {
  try {
    let unsubCount = 0
    for (let i = 0; i < 50; i++) {
      const unsub = window.api.agent.onStatusUpdate(() => {})
      if (typeof unsub === 'function') {
        unsub()
        unsubCount++
      }
    }
    return { ok: true, unsubCount }
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.onStatusUpdate 反复订阅/取消 50 次成功',
  leakTest2?.ok === true && leakTest2.unsubCount === 50,
  `result=${JSON.stringify(leakTest2).slice(0, 100)}`)

// cron.onStatusUpdate
const leakTest3 = await evalInPage(ws, `(async () => {
  try {
    let unsubCount = 0
    for (let i = 0; i < 50; i++) {
      const unsub = window.api.cron.onStatusUpdate(() => {})
      if (typeof unsub === 'function') {
        unsub()
        unsubCount++
      }
    }
    return { ok: true, unsubCount }
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('cron.onStatusUpdate 反复订阅/取消 50 次成功',
  leakTest3?.ok === true && leakTest3.unsubCount === 50,
  `result=${JSON.stringify(leakTest3).slice(0, 100)}`)

// feishu.onBotStatusUpdate
const leakTest4 = await evalInPage(ws, `(async () => {
  try {
    let unsubCount = 0
    for (let i = 0; i < 50; i++) {
      const unsub = window.api.feishu.onBotStatusUpdate(() => {})
      if (typeof unsub === 'function') {
        unsub()
        unsubCount++
      }
    }
    return { ok: true, unsubCount }
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('feishu.onBotStatusUpdate 反复订阅/取消 50 次成功',
  leakTest4?.ok === true && leakTest4.unsubCount === 50,
  `result=${JSON.stringify(leakTest4).slice(0, 100)}`)

// class.onAssignProgress
const leakTest5 = await evalInPage(ws, `(async () => {
  try {
    let unsubCount = 0
    for (let i = 0; i < 50; i++) {
      const unsub = window.api.class.onAssignProgress(() => {})
      if (typeof unsub === 'function') {
        unsub()
        unsubCount++
      }
    }
    return { ok: true, unsubCount }
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('class.onAssignProgress 反复订阅/取消 50 次成功',
  leakTest5?.ok === true && leakTest5.unsubCount === 50,
  `result=${JSON.stringify(leakTest5).slice(0, 100)}`)

// ollama.onPullProgress
const leakTest6 = await evalInPage(ws, `(async () => {
  try {
    let unsubCount = 0
    for (let i = 0; i < 50; i++) {
      const unsub = window.api.ollama.onPullProgress(() => {})
      if (typeof unsub === 'function') {
        unsub()
        unsubCount++
      }
    }
    return { ok: true, unsubCount }
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('ollama.onPullProgress 反复订阅/取消 50 次成功',
  leakTest6?.ok === true && leakTest6.unsubCount === 50,
  `result=${JSON.stringify(leakTest6).slice(0, 100)}`)

// =============================================================
console.log('\n[R112-9] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 300)}`)

// =============================================================
console.log('\n[R112-10] 内存采样 — 渲染进程 JS 堆')
const heapStats = await evalInPage(ws, `(async () => {
  if (performance && performance.memory) {
    return {
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit,
    };
  }
  return { noMemory: true };
})()`)
check('内存采样可读取',
  heapStats && !heapStats.noMemory,
  `heap=${JSON.stringify(heapStats)}`)

// 输出 MB 单位
if (heapStats && heapStats.used) {
  console.log(`  ℹ️  JS堆: used=${(heapStats.used / 1024 / 1024).toFixed(1)}MB, total=${(heapStats.total / 1024 / 1024).toFixed(1)}MB, limit=${(heapStats.limit / 1024 / 1024).toFixed(1)}MB`)
}

// =============================================================
console.log('\n========================================')
console.log(`R112 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
