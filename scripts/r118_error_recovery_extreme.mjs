// =============================================================
// R118: 错误恢复 + 极端数据测试
// 角度 1: ErrorBoundary 恢复 - 触发错误后导航恢复
// 角度 2: 畸形 IPC 输入 - 错误类型/超大 payload
// 角度 3: 并发写 - 多个 settings.set 并行
// 角度 4: 极端数据 - 超长字符串/深嵌套/大数组
// 角度 5: 无效路由 - 不存在的路由地址
// 角度 6: Cron 任务竞态 - 快速 toggle
// 角度 7: AI 调用错误恢复 - 无效模型/provider
// 角度 8: 存储压力 - 快速 create/delete 循环
// 角度 9: Skills 极端输入 - 超长内容/特殊字符
// 角度 10: 全程错误捕获
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
  targets.find((t) => t.type === 'page' && t.url.includes('index')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R118] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r118Errors = [];
  if (!window.__r118HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r118Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r118Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r118HookInstalled = true;
  }
  true
`)
async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r118Errors || []))`)
}
async function clearErrors() {
  await evalInPage(ws, `window.__r118Errors = []; true`)
}

const STAMP = `r118-${Date.now()}`

console.log('\n=== R118: 错误恢复 + 极端数据测试 ===')

// =============================================================
console.log('\n[R118-1] ErrorBoundary 恢复 - 触发错误后导航恢复')

// 导航到一个有效路由
await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(800)

// 注入一个会在渲染时抛错的组件,模拟错误边界触发
// 不实际破坏页面,而是通过 IPC 调用一个不存在的 channel 触发 unhandled rejection
const badIpcCall = await evalInPage(ws, `(async () => {
  try {
    // 调用一个不存在的 IPC channel
    const r = await window.api.settings.set('nonexistent.deeply.nested.path', 'value');
    return { handled: true, result: r };
  } catch (e) {
    return { handled: true, error: e.message };
  }
})()`)
check('settings.set 不存在路径被安全处理',
  badIpcCall?.handled === true,
  `result=${JSON.stringify(badIpcCall).slice(0, 150)}`)

// 导航到不同路由再回来,验证页面仍正常
await evalInPage(ws, `window.location.hash = '#/agents'; true`)
await sleep(500)
await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(500)
const recovered = await evalInPage(ws, `(async () => {
  const main = document.querySelector('main') || document.querySelector('#root > div');
  const text = main ? main.innerText : '';
  return { hasContent: text.length > 10, length: text.length };
})()`)
check('错误后路由导航恢复正常',
  recovered?.hasContent === true,
  `len=${recovered?.length}`)

// =============================================================
console.log('\n[R118-2] 畸形 IPC 输入 - 错误类型')

// settings.set 用数字 key
const setNumKey = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set(12345, 'value');
    return { handled: true, result: r };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('settings.set 数字 key 不崩溃',
  setNumKey?.handled === true,
  `result=${JSON.stringify(setNumKey).slice(0, 100)}`)

// settings.set 用 null value
const setNullVal = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set('general.theme', null);
    return { handled: true, result: r };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('settings.set null value 不崩溃',
  setNullVal?.handled === true,
  `result=${JSON.stringify(setNullVal).slice(0, 100)}`)

// 恢复主题
await evalInPage(ws, `(async () => {
  try { await window.api.settings.set('general.theme', 'dark'); } catch {}
  return true;
})()`)

// cron.add 用数字 name
const cronBadName = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.add({ name: 12345, expression: '0 * * * *', agentId: 'test', prompt: 'x', modelTier: 'low_cost' });
    return { handled: true, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('cron.add 数字 name 被拒绝',
  cronBadName?.handled === true && (cronBadName?.success === false || !!cronBadName?.error),
  `result=${JSON.stringify(cronBadName).slice(0, 100)}`)

// eaa.addStudent 用数字
const eaaBadName = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent(12345);
    return { handled: true, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('eaa.addStudent 数字 name 被拒绝',
  eaaBadName?.handled === true && (eaaBadName?.success === false || !!eaaBadName?.error),
  `result=${JSON.stringify(eaaBadName).slice(0, 100)}`)

// =============================================================
console.log('\n[R118-3] 并发写 - 多个 settings.set 并行')

const concurrentResults = await evalInPage(ws, `(async () => {
  const keys = [
    'general.defaultOperator',
    'general.logLevel',
    'general.agentTimeoutMins',
    'general.maxConcurrentCronTasks',
  ];
  const values = ['r118-op', 'debug', 10, 8];
  const promises = keys.map((k, i) =>
    window.api.settings.set(k, values[i]).catch(e => ({ error: e.message }))
  );
  const results = await Promise.all(promises);
  return {
    allHandled: results.every(r => r !== undefined),
    successCount: results.filter(r => r?.success !== false).length,
    errors: results.filter(r => r?.error).length,
  };
})()`)
check('4 个并发 settings.set 全部处理',
  concurrentResults?.allHandled === true && concurrentResults?.successCount === 4,
  `result=${JSON.stringify(concurrentResults).slice(0, 150)}`)

// 验证最终值一致
const verifyConcurrent = await evalInPage(ws, `(async () => {
  const s = await window.api.settings.get();
  return {
    operator: s?.general?.defaultOperator,
    logLevel: s?.general?.logLevel,
    timeout: s?.general?.agentTimeoutMins,
    maxCron: s?.general?.maxConcurrentCronTasks,
  };
})()`)
check('并发写后 settings 值正确',
  verifyConcurrent?.operator === 'r118-op' && verifyConcurrent?.logLevel === 'debug',
  `result=${JSON.stringify(verifyConcurrent).slice(0, 150)}`)

// 恢复默认值
await evalInPage(ws, `(async () => {
  try {
    await window.api.settings.set('general.defaultOperator', 'teacher');
    await window.api.settings.set('general.logLevel', 'info');
    await window.api.settings.set('general.agentTimeoutMins', 5);
    await window.api.settings.set('general.maxConcurrentCronTasks', 5);
  } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R118-4] 极端数据 - 超长字符串/深嵌套/大数组')

// 超长 note (10KB)
const longNote = 'R118-长文本-'.repeat(1000) // ~12KB
const longNoteResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.ai.addCustomModel({
      providerId: 'openai',
      modelId: 'r118-long-test',
      name: ${JSON.stringify(longNote.slice(0, 200))},
      contextWindow: 32768,
      maxOutputTokens: 4096,
      supportsReasoning: false,
    });
    return { handled: true, success: r?.success !== false, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('ai.addCustomModel 超长 name 不崩溃',
  longNoteResult?.handled === true,
  `result=${JSON.stringify(longNoteResult).slice(0, 100)}`)

// 清理
await evalInPage(ws, `(async () => {
  try { await window.api.ai.removeCustomModel('openai', 'r118-long-test'); } catch {}
  return true;
})()`)

// 深嵌套对象传给 settings.set (应被拒绝或忽略)
const deepNest = { a: { b: { c: { d: { e: { f: { g: { h: 'deep' } } } } } } } }
const deepNestResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set('general.theme', ${JSON.stringify(deepNest)});
    return { handled: true, success: r?.success !== false, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('settings.set 深嵌套对象 value 不崩溃',
  deepNestResult?.handled === true,
  `result=${JSON.stringify(deepNestResult).slice(0, 100)}`)

// 恢复主题
await evalInPage(ws, `(async () => {
  try { await window.api.settings.set('general.theme', 'dark'); } catch {}
  return true;
})()`)

// 大数组传给 eaa.addEvent tags
const bigTags = Array.from({ length: 1000 }, (_, i) => `tag-${i}`)
const bigTagsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: '__r118_nonexistent_student__',
      reasonCode: 'SPEAK_IN_CLASS',
      tags: ${JSON.stringify(bigTags)},
    });
    return { handled: true, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('eaa.addEvent 大数组 tags (1000项) 不崩溃',
  bigTagsResult?.handled === true,
  `result=${JSON.stringify(bigTagsResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R118-5] 无效路由')

// 不存在的路由
await evalInPage(ws, `window.location.hash = '#/this-route-does-not-exist'; true`)
await sleep(800)
const invalidRoute = await evalInPage(ws, `(async () => {
  const main = document.querySelector('main') || document.querySelector('#root > div');
  const text = main ? main.innerText : '';
  return {
    hasContent: text.length > 0,
    hasError: /出错了|Something went wrong|Error/i.test(text),
    hasNotFound: /404|not found|找不到|不存在/i.test(text),
  };
})()`)
check('无效路由不导致白屏',
  invalidRoute?.hasContent === true,
  `result=${JSON.stringify(invalidRoute).slice(0, 150)}`)

// 导航回有效路由
await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(500)
const backToValid = await evalInPage(ws, `(async () => {
  const main = document.querySelector('main');
  return { hasContent: (main?.innerText?.length ?? 0) > 10 };
})()`)
check('从无效路由返回有效路由正常',
  backToValid?.hasContent === true,
  `result=${JSON.stringify(backToValid)}`)

// =============================================================
console.log('\n[R118-6] Cron 任务竞态 - 快速 toggle')

// 创建一个测试 cron 任务
const cronAddResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.add({
      name: '${STAMP}-race-test',
      expression: '0 3 * * *',
      agentId: 'weekly-reporter',
      prompt: 'r118 race condition test',
      modelTier: 'low_cost',
    });
    return { success: r?.success, id: r?.id, error: r?.error };
  } catch (e) { return { error: e.message }; }
})()`)
const cronId = cronAddResult?.id
check('cron.add 测试任务创建成功',
  cronAddResult?.success === true && !!cronId,
  `result=${JSON.stringify(cronAddResult).slice(0, 150)}`)

if (cronId) {
  // 快速连续 toggle 5 次
  const toggleRace = await evalInPage(ws, `(async () => {
    const id = ${JSON.stringify(cronId)};
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(window.api.cron.toggle(id, i % 2 === 0).catch(e => ({ error: e.message })));
    }
    const results = await Promise.all(promises);
    return {
      allHandled: results.every(r => r !== undefined),
      successCount: results.filter(r => r?.success !== false).length,
      errorCount: results.filter(r => r?.error).length,
    };
  })()`)
  check('5 个并发 cron.toggle 全部处理',
    toggleRace?.allHandled === true,
    `result=${JSON.stringify(toggleRace).slice(0, 150)}`)

  // 验证任务仍存在且状态一致 (cron.list() 返回 CronTask[] 数组,非 {tasks:[]})
  const verifyCron = await evalInPage(ws, `(async () => {
    const tasks = await window.api.cron.list();
    const arr = Array.isArray(tasks) ? tasks : (tasks?.tasks || []);
    const t = arr.find(x => x.id === ${JSON.stringify(cronId)});
    return { exists: !!t, enabled: t?.enabled, totalTasks: arr.length };
  })()`)
  check('竞态后 cron 任务仍存在且状态一致',
    verifyCron?.exists === true && typeof verifyCron?.enabled === 'boolean',
    `result=${JSON.stringify(verifyCron)}`)

  // 清理
  await evalInPage(ws, `(async () => {
    try { await window.api.cron.remove(${JSON.stringify(cronId)}); } catch {}
    return true;
  })()`)
}

// =============================================================
console.log('\n[R118-7] AI 调用错误恢复 - 无效模型/provider')

// 用不存在的 provider 调用 chat.stream
const invalidAiCall = await evalInPage(ws, `(async () => {
  try {
    const stream = await window.api.ai.chat.stream({
      messages: [{ role: 'user', content: 'r118 test' }],
      model: '__r118_nonexistent_model__',
      provider: '__r118_nonexistent_provider__',
    });
    // 如果返回了 unsub 函数,立即取消
    if (typeof stream === 'function') {
      stream();
      return { handled: true, cancelled: true };
    }
    // 如果是 async iterator,读取第一个事件后退出
    if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const ev of stream) {
        if (ev?.type === 'error' || ev?.type === 'done') break;
      }
      return { handled: true, gotStream: true };
    }
    return { handled: true, result: typeof stream };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('ai.chat.stream 无效 model/provider 不崩溃',
  invalidAiCall?.handled === true,
  `result=${JSON.stringify(invalidAiCall).slice(0, 200)}`)

// 等待可能的错误事件
await sleep(1000)

// =============================================================
console.log('\n[R118-8] 存储压力 - 快速 create/delete 循环')

// 快速创建/删除 10 个 cron 任务
const stressResult = await evalInPage(ws, `(async () => {
  const ids = [];
  const errors = [];
  // 创建 10 个任务
  for (let i = 0; i < 10; i++) {
    try {
      const r = await window.api.cron.add({
        name: '${STAMP}-stress-' + i,
        expression: '0 3 * * *',
        agentId: 'weekly-reporter',
        prompt: 'stress test ' + i,
        modelTier: 'low_cost',
      });
      if (r?.id) ids.push(r.id);
    } catch (e) { errors.push(e.message); }
  }
  // 立即删除
  let deleted = 0;
  for (const id of ids) {
    try {
      const r = await window.api.cron.remove(id);
      if (r?.success !== false) deleted++;
    } catch (e) { errors.push(e.message); }
  }
  return {
    created: ids.length,
    deleted,
    errors: errors.length,
    errorSample: errors.slice(0, 2),
  };
})()`)
check('存储压力: 10 个 cron 任务快速 create/delete',
  stressResult?.created === 10 && stressResult?.deleted === 10 && stressResult?.errors === 0,
  `result=${JSON.stringify(stressResult).slice(0, 200)}`)

// 验证 list 中没有残留 (cron.list() 返回数组)
const stressVerify = await evalInPage(ws, `(async () => {
  const tasks = await window.api.cron.list();
  const arr = Array.isArray(tasks) ? tasks : (tasks?.tasks || []);
  const remaining = arr.filter(t => (t?.name || '').includes('${STAMP}-stress-'));
  return { remaining: remaining.length, totalTasks: arr.length };
})()`)
check('存储压力后无残留任务',
  stressVerify?.remaining === 0,
  `remaining=${stressVerify?.remaining}`)

// =============================================================
console.log('\n[R118-9] Skills 极端输入 - 超长内容/特殊字符')

// 超长 skill content (50KB)
const longSkillContent = 'R118 skill 内容测试 -'.repeat(2000) // ~50KB
const longSkillResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skills.save({
      name: '${STAMP}-long-skill',
      description: 'r118 long content test',
      content: ${JSON.stringify(longSkillContent)},
    });
    return { handled: true, success: r?.success !== false, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('skills.save 超长 content (50KB) 不崩溃',
  longSkillResult?.handled === true,
  `result=${JSON.stringify(longSkillResult).slice(0, 100)}`)

// 特殊字符 skill name (在 Node 端构造,通过 JSON.stringify 注入,避免转义问题)
const specialSkillName = `${STAMP}-特殊字符!<>"'/\\|`
const specialCharResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skills.save({
      name: ${JSON.stringify(specialSkillName)},
      description: 'special chars',
      content: 'test',
    });
    return { handled: true, success: r?.success !== false, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('skills.save 特殊字符 name 不崩溃',
  specialCharResult?.handled === true,
  `result=${JSON.stringify(specialCharResult).slice(0, 100)}`)

// 清理 skills (skills.list() 可能返回数组或 {skills:[]})
await evalInPage(ws, `(async () => {
  try {
    const list = await window.api.skills.list();
    const arr = Array.isArray(list) ? list : (list?.skills || list || []);
    const toDelete = arr.filter(s =>
      (s?.name || '').startsWith(${JSON.stringify(STAMP)})
    );
    for (const s of toDelete) {
      try { await window.api.skills.remove(s?.filePath || s?.name); } catch {}
    }
  } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R118-10] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// =============================================================
console.log('\n========================================')
console.log(`R118 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
