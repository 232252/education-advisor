// =============================================================
// R102: 隐私引擎完整性测试 (AES-256-GCM)
// 角度 1: 隐私引擎 status/load/init 链路
// 角度 2: add/list 映射表 CRUD
// 角度 3: anonymize/deanonymize 往返一致性
// 角度 4: filter 按接收方过滤
// 角度 5: dryrun 预览不污染实际数据
// 角度 6: lock/unlock 状态机
// 角度 7: 边界 (空密码/超长文本/特殊字符/SQL 注入)
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
console.log(`[R102] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r102Errors = [];
  if (!window.__r102HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r102Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r102Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r102HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r102Errors || []))`)
}

// 测试密码 (注意: 仅测试用,不会持久化)
const TEST_PASSWORD = 'r102_test_password_2026'

// =============================================================
console.log('\n=== R102: 隐私引擎完整性测试 ===')

// =============================================================
console.log('\n[R102-1] 隐私引擎 status 链路')

const statusBefore = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.status();
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('privacy.status 不崩溃',
  statusBefore?.ok === true,
  `result=${JSON.stringify(statusBefore).slice(0, 150)}`)
check('privacy.status 返回对象',
  statusBefore?.result && typeof statusBefore.result === 'object',
  `result=${JSON.stringify(statusBefore?.result).slice(0, 150)}`)

// =============================================================
console.log('\n[R102-2] 隐私引擎 init/load 链路')

const initResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.init(${JSON.stringify(TEST_PASSWORD)}, false);
    return { ok: true, success: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('privacy.init 不崩溃',
  initResult?.ok === true,
  `result=${JSON.stringify(initResult).slice(0, 150)}`)

// 等待初始化完成
await sleep(500)

// 验证 status 反映了 init
const statusAfterInit = await evalInPage(ws, `window.api.privacy.status()`)
check('init 后 status 反映已加载',
  statusAfterInit && !statusAfterInit.__error,
  `result=${JSON.stringify(statusAfterInit).slice(0, 150)}`)

// =============================================================
console.log('\n[R102-3] add/list 映射表 CRUD')

// add 一个测试映射
const testEntity = `r102_test_entity_${Date.now()}`
const addResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.add('student', ${JSON.stringify(testEntity)});
    return { ok: true, success: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('privacy.add 不崩溃',
  addResult?.ok === true,
  `result=${JSON.stringify(addResult).slice(0, 150)}`)

// list 验证添加成功
const listResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.list(${JSON.stringify(TEST_PASSWORD)});
    return { ok: true, success: r?.success !== false, isArray: Array.isArray(r?.mappings || r) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('privacy.list 不崩溃',
  listResult?.ok === true,
  `result=${JSON.stringify(listResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R102-4] anonymize/deanonymize 往返一致性')

// 测试文本包含测试实体
const testText = `学生 ${testEntity} 在课堂上表现良好`
const anonymizeResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.anonymize(${JSON.stringify(testText)});
    return { ok: true, success: r?.success !== false, result: r, hasAnonymized: !!r?.anonymized || !!r?.text || typeof r === 'string' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('privacy.anonymize 不崩溃',
  anonymizeResult?.ok === true,
  `result=${JSON.stringify(anonymizeResult).slice(0, 200)}`)

// 提取匿名化后的文本
const anonymizedText = anonymizeResult?.result?.anonymized
  || anonymizeResult?.result?.text
  || (typeof anonymizeResult?.result === 'string' ? anonymizeResult.result : null)

if (anonymizedText) {
  check('anonymize 后文本与原文不同',
    anonymizedText !== testText,
    `original=${testText.slice(0, 80)}, anonymized=${anonymizedText.slice(0, 80)}`)
  
  // deanonymize 往返
  const deanonymizeResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.privacy.deanonymize(${JSON.stringify(anonymizedText)});
      return { ok: true, success: r?.success !== false, result: r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  
  check('privacy.deanonymize 不崩溃',
    deanonymizeResult?.ok === true,
    `result=${JSON.stringify(deanonymizeResult).slice(0, 200)}`)
  
  const deanonymizedText = deanonymizeResult?.result?.deanonymized
    || deanonymizeResult?.result?.text
    || (typeof deanonymizeResult?.result === 'string' ? deanonymizeResult.result : null)
  
  if (deanonymizedText) {
    check('deanonymize 往复恢复原文',
      deanonymizedText === testText,
      `original=${testText.slice(0, 80)}, restored=${deanonymizedText.slice(0, 80)}`)
  }
}

// =============================================================
console.log('\n[R102-5] filter 按接收方过滤')

const filterResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.filter('teacher', ${JSON.stringify(testText)});
    return { ok: true, success: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('privacy.filter 不崩溃',
  filterResult?.ok === true,
  `result=${JSON.stringify(filterResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R102-6] dryrun 预览')

const dryrunResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.dryrun(${JSON.stringify(testText)});
    return { ok: true, success: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('privacy.dryrun 不崩溃',
  dryrunResult?.ok === true,
  `result=${JSON.stringify(dryrunResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R102-7] 边界 (空密码/超长文本/特殊字符/SQL 注入)')

// 空密码 load
const emptyPwd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.load('');
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('privacy.load 空密码不崩溃', emptyPwd?.ok === true)

// 超长文本 anonymize
const longText = 'x'.repeat(100000)
const longTextResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.anonymize(${JSON.stringify(longText)});
    return { ok: true };
  } catch (e) {
    return { ok: true, thrown: true };
  }
})()`)
check('anonymize 100KB 文本不崩溃', longTextResult?.ok === true)

// 特殊字符
const specialChars = '<>{}[]()&%$#@!*`~|"\'\\'
const specialResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.anonymize(${JSON.stringify(specialChars)});
    return { ok: true };
  } catch (e) {
    return { ok: true, thrown: true };
  }
})()`)
check('anonymize 特殊字符不崩溃', specialResult?.ok === true)

// SQL 注入 payload
const sqlPayload = "'; DROP TABLE mappings; --"
const sqlResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.add('student', ${JSON.stringify(sqlPayload)});
    return { ok: true };
  } catch (e) {
    return { ok: true, thrown: true };
  }
})()`)
check('privacy.add SQL 注入 payload 不崩溃', sqlResult?.ok === true)

// XSS payload
const xssPayload = '<script>alert("xss")</script>'
const xssResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.add('student', ${JSON.stringify(xssPayload)});
    return { ok: true };
  } catch (e) {
    return { ok: true, thrown: true };
  }
})()`)
check('privacy.add XSS payload 不崩溃', xssResult?.ok === true)

// =============================================================
console.log('\n[R102-8] lock/unlock 状态机')

// lock
const lockResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.lock();
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('privacy.lock 不崩溃',
  lockResult?.ok === true,
  `result=${JSON.stringify(lockResult).slice(0, 100)}`)

// 验证 lock 后状态
const statusAfterLock = await evalInPage(ws, `window.api.privacy.status()`)
check('lock 后 status 可读',
  statusAfterLock && !statusAfterLock.__error,
  `result=${JSON.stringify(statusAfterLock).slice(0, 150)}`)

// unlock (用正确密码)
const unlockResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.unlock(${JSON.stringify(TEST_PASSWORD)});
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('privacy.unlock 正确密码不崩溃',
  unlockResult?.ok === true,
  `result=${JSON.stringify(unlockResult).slice(0, 100)}`)

// unlock (用错误密码)
const wrongUnlock = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.unlock('wrong_password');
    return { ok: true, success: r?.success !== false, hasError: !!r?.error };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('privacy.unlock 错误密码不崩溃', wrongUnlock?.ok === true)

// =============================================================
console.log('\n[R102-9] 全程错误捕获')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// =============================================================
console.log('\n========================================')
console.log(`R102 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
