// =============================================================
// R96: 错误恢复与崩溃容错测试 (新角度)
// 角度 1: IPC 异常注入 - 用非法参数调用各 API,验证优雅降级
// 角度 2: 并发错误状态 - 多个错误同时发生
// 角度 3: 错误后恢复 - 出错后正常调用是否仍工作
// 角度 4: 全程 0 unhandledrejection/error
// 角度 5: 错误信息可读性 - 错误返回结构化 (有 error/success 字段)
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
console.log(`[R96] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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

// ---------- 全局错误捕获 ----------
await evalInPage(ws, `
  window.__r96Errors = [];
  if (!window.__r96HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r96Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r96Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r96HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r96Errors || []))`)
}

async function clearErrors() {
  await evalInPage(ws, `window.__r96Errors = []; true`)
}

// 执行 IPC 调用并捕获结果 (不抛出)
async function tryCall(expr) {
  try {
    const result = await evalInPage(ws, `(async () => {
      try {
        const r = ${expr};
        const v = await r;
        return { ok: true, value: v };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    })()`)
    return result
  } catch (e) {
    return { ok: false, error: `eval failed: ${e.message}` }
  }
}

// =============================================================
console.log('\n=== R96: 错误恢复与崩溃容错测试 ===')

// =============================================================
console.log('\n[R96-1] IPC 异常参数注入 (优雅降级)')

// EAA: 非法参数
const r1 = await tryCall('window.api.eaa.ranking("not-a-number")')
check('EAA.ranking 非数字参数不崩溃', !r1.ok || (r1.value && r1.value.success === false),
  `result=${JSON.stringify(r1).slice(0, 100)}`)

const r2 = await tryCall('window.api.eaa.history(null)')
check('EAA.history null 参数不崩溃', !r2.ok || (r2.value && r2.value.success === false),
  `result=${JSON.stringify(r2).slice(0, 100)}`)

const r3 = await tryCall('window.api.eaa.range(-1, -10, 0)')
check('EAA.range 非法范围不崩溃', !r3.ok || (r3.value && r3.value.success === false),
  `result=${JSON.stringify(r3).slice(0, 100)}`)

// Settings: 非法 dotPath
const r4 = await tryCall(`window.api.settings.set('', 'value')`)
check('Settings.set 空 dotPath 不崩溃', !r4.ok || (r4.value && r4.value.success === false),
  `result=${JSON.stringify(r4).slice(0, 100)}`)

const r5 = await tryCall(`window.api.settings.set('__proto__.polluted', 'evil')`)
check('Settings.set 原型链污染尝试被拒', !r5.ok || (r5.value && r5.value.success === false),
  `result=${JSON.stringify(r5).slice(0, 100)}`)

const r6 = await tryCall(`window.api.settings.set('nonexistent.deep.path', 'value')`)
check('Settings.set 不存在路径被拒', !r6.ok || (r6.value && r6.value.success === false),
  `result=${JSON.stringify(r6).slice(0, 100)}`)

// Agent: 不存在的 agent ID
const r7 = await tryCall(`window.api.agent.runManual('__nonexistent_agent__', 'test')`)
check('Agent.runManual 不存在 agent 不崩溃', !r7.ok || (r7.value !== undefined) || (r7.error !== undefined),
  `result=${JSON.stringify(r7).slice(0, 100)}`)

// Skill: 不存在的 skill
const r8 = await tryCall(`window.api.skill.get('__nonexistent_skill__')`)
check('Skill.get 不存在 skill 不崩溃', !r8.ok || (r8.value !== undefined) || (r8.error !== undefined),
  `result=${JSON.stringify(r8).slice(0, 100)}`)

// Profile: 非法文件名
const r9 = await tryCall(`window.api.profile.set('../../../etc/passwd', { data: 'evil' })`)
check('Profile.set 路径穿越尝试被拒', !r9.ok || (r9.value && r9.value.success === false),
  `result=${JSON.stringify(r9).slice(0, 100)}`)

// Cron: 非法 cron 表达式
const r10 = await tryCall(`window.api.cron.add({ name: 'test', expression: 'not-a-cron', task: 'noop' })`)
check('Cron.add 非法表达式不崩溃', !r10.ok || (r10.value && r10.value.success === false) || (r10.error !== undefined),
  `result=${JSON.stringify(r10).slice(0, 100)}`)

// AI: 非法 provider
const r11 = await tryCall(`window.api.ai.chat({ providerId: '__bad_provider__', modelId: 'x', messages: [] })`)
check('AI.chat 非法 provider 不崩溃', !r11.ok || (r11.value !== undefined) || (r11.error !== undefined),
  `result=${JSON.stringify(r11).slice(0, 100)}`)

// =============================================================
console.log('\n[R96-2] 并发错误状态 (10 个错误同时发生)')

await clearErrors()
const concurrentErrors = await evalInPage(ws, `(async () => {
  const calls = [
    window.api.eaa.ranking('bad'),
    window.api.eaa.history(undefined),
    window.api.settings.set('', 'x'),
    window.api.settings.set('__proto__.x', 'y'),
    window.api.agent.runManual('__no_agent__', 'x'),
    window.api.skill.get('__no_skill__'),
    window.api.profile.set('../../etc/passwd', {}),
    window.api.cron.add({ name: 't', expression: 'bad', task: 'x' }),
    window.api.eaa.range(-1, -1, -1),
    window.api.ai.chat({ providerId: '__no_provider__', modelId: 'x', messages: [] }),
  ];
  const settled = await Promise.allSettled(calls);
  return settled.map((s, i) => ({
    idx: i,
    status: s.status,
    hasValue: s.status === 'fulfilled' && s.value !== undefined,
    hasError: s.status === 'rejected',
    errorMsg: s.status === 'rejected' ? String(s.reason?.message || s.reason).slice(0, 80) : null,
  }));
})()`)

const errorsArray = Array.isArray(concurrentErrors) ? concurrentErrors : []
const allHandled = errorsArray.length === 10 && errorsArray.every(e => e.hasValue || e.hasError)
check('10 个并发错误全部被处理 (无 hang)', allHandled, `count=${errorsArray.length}, results=${JSON.stringify(concurrentErrors).slice(0, 200)}`)

const concurrentErrMsgs = await getErrors()
check('并发错误未产生 unhandledrejection', concurrentErrMsgs.length === 0, `errors=${concurrentErrMsgs.length}`)

// =============================================================
console.log('\n[R96-3] 错误后恢复正常工作 (恢复能力)')

// 错误"风暴"后,正常 API 是否仍工作
const recovery1 = await tryCall('window.api.eaa.stats()')
check('错误后 EAA.stats 正常', recovery1.ok && recovery1.value && recovery1.value.success !== false,
  `result=${JSON.stringify(recovery1).slice(0, 100)}`)

const recovery2 = await tryCall('window.api.eaa.listStudents()')
check('错误后 EAA.listStudents 正常', recovery2.ok && recovery2.value && recovery2.value.success !== false,
  `result=${JSON.stringify(recovery2).slice(0, 100)}`)

const recovery3 = await tryCall('window.api.settings.get()')
check('错误后 Settings.get 正常', recovery3.ok && recovery3.value,
  `result=${JSON.stringify(recovery3).slice(0, 100)}`)

const recovery4 = await tryCall('window.api.agent.list()')
check('错误后 Agent.list 正常', recovery4.ok && Array.isArray(recovery4.value),
  `result=${JSON.stringify(recovery4).slice(0, 100)}`)

const recovery5 = await tryCall('window.api.skill.list()')
check('错误后 Skill.list 正常', recovery5.ok && Array.isArray(recovery5.value),
  `result=${JSON.stringify(recovery5).slice(0, 100)}`)

// =============================================================
console.log('\n[R96-4] UI 错误捕获 (全程 0 unhandledrejection)')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error', finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// =============================================================
console.log('\n[R96-5] 错误返回结构化 (用户可读)')

// 验证错误返回包含可识别的字段 (success/error/msg)
const structuredCheck = await evalInPage(ws, `(async () => {
  const calls = [
    window.api.eaa.ranking('bad'),
    window.api.settings.set('', 'x'),
    window.api.profile.set('../../evil', {}),
  ];
  const results = await Promise.allSettled(calls);
  return results.map((s, i) => {
    if (s.status === 'fulfilled') {
      const v = s.value;
      // 结构化错误应有: success=false 或 error 字段
      const hasStructured = v && (v.success === false || v.error || v.message);
      return { idx: i, hasStructured, fields: v ? Object.keys(v).slice(0, 5) : [] };
    }
    return { idx: i, hasStructured: false, rejected: true };
  });
})()`)

const structuredArray = Array.isArray(structuredCheck) ? structuredCheck : []
const allStructured = structuredArray.length === 3 && structuredArray.every(r => r.hasStructured)
check('错误返回结构化 (有 success/error 字段)', allStructured,
  `count=${structuredArray.length}, results=${JSON.stringify(structuredCheck).slice(0, 200)}`)

// =============================================================
console.log('\n[R96-6] 模拟用户快速操作 (出错后立即正常操作)')

await clearErrors()

// 模拟用户:错误操作 → 立即正常操作 → 错误操作 → 立即正常操作
const interleaved = await evalInPage(ws, `(async () => {
  const ops = [
    { type: 'bad', call: () => window.api.eaa.ranking('x') },
    { type: 'good', call: () => window.api.eaa.stats() },
    { type: 'bad', call: () => window.api.settings.set('__proto__.x', 'y') },
    { type: 'good', call: () => window.api.eaa.listStudents() },
    { type: 'bad', call: () => window.api.profile.set('../evil', {}) },
    { type: 'good', call: () => window.api.agent.list() },
    { type: 'bad', call: () => window.api.cron.add({ expression: 'bad' }) },
    { type: 'good', call: () => window.api.skill.list() },
  ];
  const results = [];
  for (const op of ops) {
    try {
      const v = await op.call();
      results.push({ type: op.type, ok: true, success: v?.success, hasError: !!v?.error });
    } catch (e) {
      results.push({ type: op.type, ok: false, error: e.message?.slice(0, 60) });
    }
  }
  return results;
})()`)

// bad 操作可以是 reject 或 success:false; good 操作必须成功
const interArray = Array.isArray(interleaved) ? interleaved : []
const badHandled = interArray.filter(r => r.type === 'bad').every(r => r.ok === false || r.success === false)
const goodWorked = interArray.filter(r => r.type === 'good').every(r => r.ok === true && r.success !== false)
check('bad 操作全部被处理 (reject 或 success:false)', badHandled, `bad=${JSON.stringify(interArray.filter(r => r.type === 'bad'))}`)
check('good 操作全部成功 (错误不污染正常调用)', goodWorked, `good=${JSON.stringify(interArray.filter(r => r.type === 'good'))}`)

const interErrors = await getErrors()
check('交错操作 0 unhandledrejection', interErrors.length === 0, `errors=${interErrors.length}`)

// =============================================================
console.log('\n========================================')
console.log(`R96 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
